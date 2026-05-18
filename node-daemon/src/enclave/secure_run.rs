//! Secure Enclave Runner
//! Abstracts Intel SGX / AMD SEV attestation and model execution.
//! In production, the `sgx_urts` crate initialises the enclave and
//! ECALLs are used to pass encrypted payloads in/out.

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use tracing::info;

// ── Output from enclave execution ─────────────────────────────────────────────

pub struct EnclaveOutput {
    pub output_hash: [u8; 32],
    pub model_hash:  [u8; 32],
    pub task_id:     u64,
}

// ── BN254 UltraPlonk proof (matches on-chain PlonkProof struct) ───────────────

pub struct Proof {
    pub w_comm:   [u8; 32],
    pub t_comm:   [u8; 32],
    pub z_eval:   [u8; 32],
    pub r_comm:   [u8; 32],
    pub w_zeta:   [u8; 32],
    pub w_zeta_w: [u8; 32],
}

// ── SGX attestation report (simplified) ──────────────────────────────────────

pub struct AttestationReport {
    pub mrenclave:  [u8; 32], // measurement of enclave code
    pub mrsigner:   [u8; 32], // measurement of signing key
    pub report_data: [u8; 64],
}

/// Initialise the SGX enclave and run inference on the encrypted payload.
/// The payload_hash is the SHA-256 of the client-encrypted request.
pub async fn run_inference(payload_hash: &[u8; 32]) -> Result<EnclaveOutput> {
    info!("Initialising SGX enclave for payload {}", hex::encode(payload_hash));

    // ── Attestation ───────────────────────────────────────────────────────
    let report = attest_enclave(payload_hash).context("SGX attestation failed")?;
    info!("Enclave MRENCLAVE: {}", hex::encode(report.mrenclave));

    // ── Model execution (ECALL) ───────────────────────────────────────────
    // In production: sgx_urts::SgxEnclave::create(...) then ecall_run_model(...)
    // The model weights are sealed inside the enclave; the payload is decrypted
    // using the enclave's private key derived from MRENCLAVE.
    let output_hash = simulate_model_execution(payload_hash);
    let model_hash  = report.mrenclave; // model identity = enclave measurement

    info!("Inference complete, output hash: {}", hex::encode(&output_hash));

    Ok(EnclaveOutput {
        output_hash,
        model_hash,
        task_id: 0, // populated by caller from event context
    })
}

/// Generate a BN254 UltraPlonk proof for the inference execution trace.
/// In production this calls the Noir-compiled circuit via `nargo prove`.
pub async fn generate_proof(output: &EnclaveOutput) -> Result<Proof> {
    info!("Generating UltraPlonk proof for output {}", hex::encode(&output.output_hash));

    // In production:
    //   1. Write Prover.toml with output_hash, model_hash, task_id
    //   2. Shell out: `nargo prove --package inference_verify`
    //   3. Parse the resulting proof file into BN254 curve points
    //
    // Here we derive deterministic mock curve points from the output hash
    // so the structure is correct for testing the on-chain verifier interface.

    let w_comm   = derive_point(&output.output_hash, b"w_comm");
    let t_comm   = derive_point(&output.output_hash, b"t_comm");
    let z_eval   = derive_scalar(&output.output_hash, b"z_eval");
    let r_comm   = derive_point(&output.output_hash, b"r_comm");
    let w_zeta   = derive_point(&output.output_hash, b"w_zeta");
    let w_zeta_w = derive_point(&output.output_hash, b"w_zeta_w");

    Ok(Proof { w_comm, t_comm, z_eval, r_comm, w_zeta, w_zeta_w })
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn attest_enclave(payload_hash: &[u8; 32]) -> Result<AttestationReport> {
    // In production: sgx_tae_service::sgx_get_quote(...)
    // Returns a signed quote that can be verified by Intel Attestation Service.
    let mut report_data = [0u8; 64];
    report_data[..32].copy_from_slice(payload_hash);

    Ok(AttestationReport {
        mrenclave:   derive_point(payload_hash, b"mrenclave"),
        mrsigner:    derive_point(payload_hash, b"mrsigner"),
        report_data,
    })
}

fn simulate_model_execution(payload_hash: &[u8; 32]) -> [u8; 32] {
    // Deterministic stand-in for actual LLM inference inside the enclave.
    // Real implementation: ECALL passes decrypted prompt → model → encrypted response.
    let mut hasher = Sha256::new();
    hasher.update(b"auranode_model_v1");
    hasher.update(payload_hash);
    hasher.finalize().into()
}

fn derive_point(seed: &[u8; 32], label: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(label);
    h.update(seed);
    h.finalize().into()
}

fn derive_scalar(seed: &[u8; 32], label: &[u8]) -> [u8; 32] {
    derive_point(seed, label)
}
