//! AuraNode Compute Daemon
//! Listens for inference tasks on Stellar via Horizon SSE, routes them to the
//! secure enclave runner, generates a BN254 ZK proof, and submits it back.

mod enclave;

use anyhow::{Context, Result};
use serde::Deserialize;
use std::env;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

// ── Config ────────────────────────────────────────────────────────────────────

struct Config {
    horizon_url:       String,
    pool_contract:     String,
    verifier_contract: String,
    soroban_rpc_url:   String,
    node_secret:       String,
}

impl Config {
    fn from_env() -> Result<Self> {
        Ok(Self {
            horizon_url:       env::var("HORIZON_URL")
                .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".into()),
            pool_contract:     env::var("POOL_CONTRACT_ID")
                .context("POOL_CONTRACT_ID required")?,
            verifier_contract: env::var("VERIFIER_CONTRACT_ID")
                .context("VERIFIER_CONTRACT_ID required")?,
            soroban_rpc_url:   env::var("SOROBAN_RPC_URL")
                .unwrap_or_else(|_| "https://soroban-testnet.stellar.org".into()),
            node_secret:       env::var("NODE_SECRET_KEY")
                .context("NODE_SECRET_KEY required")?,
        })
    }
}

// ── Horizon SSE event types ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct HorizonEvent {
    #[serde(rename = "type")]
    event_type: String,
    id:         String,
    paging_token: String,
}

#[derive(Debug, Deserialize)]
struct ContractEvent {
    #[serde(rename = "contractId")]
    contract_id: String,
    topic:       Vec<String>,
    value:       serde_json::Value,
}

// ── Inference task parsed from on-chain event ─────────────────────────────────

#[derive(Debug)]
struct InferenceTask {
    task_id:      u64,
    node_id:      u32,
    payload_hash: [u8; 32],
}

// ── Main event loop ───────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("node_daemon=info".parse()?),
        )
        .init();

    let cfg = Config::from_env()?;
    info!("AuraNode daemon starting");
    info!("Pool contract:     {}", cfg.pool_contract);
    info!("Verifier contract: {}", cfg.verifier_contract);

    // Spawn gRPC task distribution server alongside the event loop
    let grpc_handle = tokio::spawn(grpc::serve());

    // Main Horizon event sync loop with exponential back-off
    let mut backoff = Duration::from_secs(1);
    loop {
        match event_loop(&cfg).await {
            Ok(()) => {
                info!("Event stream ended, reconnecting…");
                backoff = Duration::from_secs(1);
            }
            Err(e) => {
                error!("Event loop error: {e:#}");
                warn!("Reconnecting in {}s", backoff.as_secs());
                sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(60));
            }
        }
    }
}

async fn event_loop(cfg: &Config) -> Result<()> {
    let client = reqwest::Client::new();

    // Subscribe to contract events for the pool contract via Horizon SSE
    let url = format!(
        "{}/contracts/{}/events?cursor=now",
        cfg.horizon_url, cfg.pool_contract
    );

    info!("Subscribing to Horizon events: {url}");

    let mut response = client
        .get(&url)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .context("Horizon SSE connect failed")?;

    let mut buffer = String::new();

    while let Some(chunk) = response.chunk().await? {
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Process complete SSE lines
        while let Some(pos) = buffer.find("\n\n") {
            let event_text = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            if let Some(task) = parse_task_event(&event_text) {
                info!("Received task {} for node {}", task.task_id, task.node_id);
                if let Err(e) = handle_task(cfg, task).await {
                    error!("Task handling failed: {e:#}");
                }
            }
        }
    }

    Ok(())
}

fn parse_task_event(raw: &str) -> Option<InferenceTask> {
    // SSE format: "data: <json>"
    let data = raw
        .lines()
        .find(|l| l.starts_with("data:"))?
        .trim_start_matches("data:")
        .trim();

    let event: ContractEvent = serde_json::from_str(data).ok()?;

    // Filter for "task_sub" events (topic[0] == "task_sub")
    if event.topic.first().map(|t| t.as_str()) != Some("task_sub") {
        return None;
    }

    // value is (task_id, node_id) tuple encoded as XDR/JSON
    let arr = event.value.as_array()?;
    let task_id = arr.first()?.as_u64()?;
    let node_id = arr.get(1)?.as_u64()? as u32;

    // payload_hash comes from topic[2] (hex-encoded)
    let hash_hex = event.topic.get(2)?;
    let hash_bytes = hex::decode(hash_hex).ok()?;
    if hash_bytes.len() != 32 {
        return None;
    }
    let mut payload_hash = [0u8; 32];
    payload_hash.copy_from_slice(&hash_bytes);

    Some(InferenceTask { task_id, node_id, payload_hash })
}

async fn handle_task(cfg: &Config, task: InferenceTask) -> Result<()> {
    info!("Processing task {} in secure enclave", task.task_id);

    // ── 1. Run inference inside the hardware enclave ──────────────────────
    let output = enclave::run_inference(&task.payload_hash)
        .await
        .context("enclave inference failed")?;

    info!("Enclave produced output hash: {}", hex::encode(&output.output_hash));

    // ── 2. Generate BN254 UltraPlonk proof ────────────────────────────────
    let proof = enclave::generate_proof(&output)
        .await
        .context("proof generation failed")?;

    info!("Proof generated, submitting to verifier contract");

    // ── 3. Submit proof to auranode-verifier via Soroban RPC ─────────────
    submit_proof(cfg, &task, &output.output_hash, &proof).await?;

    Ok(())
}

async fn submit_proof(
    cfg:         &Config,
    task:        &InferenceTask,
    output_hash: &[u8; 32],
    proof:       &enclave::Proof,
) -> Result<()> {
    // Build the Soroban RPC invocation payload
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "simulateTransaction",
        "params": {
            "transaction": build_verify_xdr(cfg, task, output_hash, proof)?
        }
    });

    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .post(&cfg.soroban_rpc_url)
        .json(&payload)
        .send()
        .await?
        .json()
        .await?;

    if resp["result"]["error"].is_null() {
        info!("Proof submission simulated successfully, broadcasting…");
        // In production: sign with node_secret and sendTransaction
    } else {
        error!("Simulation error: {}", resp["result"]["error"]);
    }

    Ok(())
}

fn build_verify_xdr(
    cfg:         &Config,
    task:        &InferenceTask,
    output_hash: &[u8; 32],
    proof:       &enclave::Proof,
) -> Result<String> {
    // Construct XDR for verifier.verify_inference_proof invocation.
    // In production this uses stellar-xdr crate to build a proper InvokeHostFunction.
    // Here we return a placeholder that documents the structure.
    let _ = (cfg, task, output_hash, proof);
    Ok("AAAAAA==".to_string()) // placeholder XDR base64
}

// ── gRPC task distribution server ─────────────────────────────────────────────

mod grpc {
    use anyhow::Result;
    use tracing::info;

    pub async fn serve() -> Result<()> {
        let addr = "0.0.0.0:50051".parse()?;
        info!("gRPC task distribution server listening on {addr}");
        // In production: tonic::transport::Server::builder()
        //     .add_service(TaskServiceServer::new(TaskServiceImpl))
        //     .serve(addr).await?;
        // Kept as a stub to avoid requiring proto compilation in CI.
        tokio::signal::ctrl_c().await?;
        Ok(())
    }
}
