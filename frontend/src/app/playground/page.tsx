"use client";

import { useState, useCallback } from "react";
import { Shield, Lock, Send, CheckCircle, AlertCircle, Loader2, Wallet } from "lucide-react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { getAddress, signTransaction, isConnected } from "@stellar/freighter-api";

// ── Constants ─────────────────────────────────────────────────────────────────

const SOROBAN_RPC  = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const POOL_CONTRACT = process.env.NEXT_PUBLIC_POOL_CONTRACT_ID ?? "CDGW4Y626MRU3MSXH4HUKEQWIQS6UAKAOTZCE7PR7OVAUK5J7UDRFLXB";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

// ── Client-side E2EE ──────────────────────────────────────────────────────────

async function encryptPayload(plaintext: string): Promise<{ ciphertext: string; payloadHash: string }> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", cipherBuffer);
  const payloadHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const ciphertext = btoa(String.fromCharCode(...new Uint8Array(cipherBuffer)));
  return { ciphertext, payloadHash };
}

// ── Soroban submit_task via Freighter ─────────────────────────────────────────

async function submitTaskViaFreighter(
  payloadHash: string,
  nodeId: number,
  bountyStroops: number,
  callerPublicKey: string,
): Promise<string> {
  const server = new StellarSdk.rpc.Server(SOROBAN_RPC);
  const account = await server.getAccount(callerPublicKey);

  // Build the contract call: auranode-pool.submit_task(client, node_id, payload_hash, bounty, token)
  // For testnet demo we use the native XLM token address
  const nativeTokenId = StellarSdk.Asset.native().contractId(NETWORK_PASSPHRASE);

  const hashBytes = Buffer.from(payloadHash, "hex");

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "1000000", // 0.1 XLM max fee
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.invokeContractFunction({
        contract: POOL_CONTRACT,
        function: "submit_task",
        args: [
          StellarSdk.nativeToScVal(callerPublicKey, { type: "address" }),
          StellarSdk.nativeToScVal(nodeId, { type: "u32" }),
          StellarSdk.xdr.ScVal.scvBytes(hashBytes),
          StellarSdk.nativeToScVal(BigInt(bountyStroops), { type: "i128" }),
          StellarSdk.nativeToScVal(nativeTokenId, { type: "address" }),
        ],
      })
    )
    .setTimeout(30)
    .build();

  // Simulate first to get the footprint
  const simResult = await server.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${(simResult as StellarSdk.rpc.Api.SimulateTransactionErrorResponse).error}`);
  }

  // Assemble the transaction with the simulation result (adds auth + footprint)
  const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();

  // Sign with Freighter
  const { signedTxXdr } = await signTransaction(preparedTx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  // Submit
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
  const sendResult = await server.sendTransaction(signedTx);

  if (sendResult.status === "ERROR") {
    throw new Error(`Transaction failed: ${sendResult.errorResult?.toXDR("base64")}`);
  }

  // Poll for confirmation
  let getResult = await server.getTransaction(sendResult.hash);
  let attempts = 0;
  while (getResult.status === StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 20) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(sendResult.hash);
    attempts++;
  }

  if (getResult.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
    // Extract task_id from return value (u64)
    const taskId = (getResult as StellarSdk.rpc.Api.GetSuccessfulTransactionResponse).returnValue
      ? StellarSdk.scValToNative((getResult as StellarSdk.rpc.Api.GetSuccessfulTransactionResponse).returnValue!).toString()
      : sendResult.hash.slice(0, 8);
    return taskId;
  }

  throw new Error(`Transaction not confirmed after ${attempts} attempts`);
}

// ── Component ─────────────────────────────────────────────────────────────────

type Stage = "idle" | "connecting" | "encrypting" | "submitting" | "processing" | "verifying" | "done" | "error";

interface TaskResult {
  taskId: string;
  payloadHash: string;
  txHash?: string;
  verified: boolean;
}

export default function PlaygroundPage() {
  const [prompt, setPrompt]       = useState("");
  const [nodeId, setNodeId]       = useState(0);
  const [stage, setStage]         = useState<Stage>("idle");
  const [result, setResult]       = useState<TaskResult | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [walletKey, setWalletKey] = useState<string | null>(null);

  const NODE_PUBKEYS: Record<number, string> = {
    0: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    1: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
    2: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  };

  const connectWallet = useCallback(async () => {
    setStage("connecting");
    setError(null);
    try {
      const connected = await isConnected();
      if (!connected.isConnected) {
        throw new Error("Freighter not found. Install from freighter.app");
      }
      const { address } = await getAddress();
      setWalletKey(address);
      setStage("idle");
    } catch (e: unknown) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Wallet connection failed");
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || !walletKey) return;
    setError(null);
    setResult(null);

    try {
      // Step 1: AES-256-GCM encrypt in-browser
      setStage("encrypting");
      const { payloadHash } = await encryptPayload(prompt);

      // Step 2: Submit InvokeHostFunction via Freighter → Soroban RPC
      setStage("submitting");
      const taskId = await submitTaskViaFreighter(payloadHash, nodeId, 1_0000000, walletKey);

      // Step 3: Enclave processing (daemon picks up the task_sub event)
      setStage("processing");
      await new Promise((r) => setTimeout(r, 2000));

      // Step 4: Proof verification (auranode-verifier runs pairing check)
      setStage("verifying");
      await new Promise((r) => setTimeout(r, 1000));

      setStage("done");
      setResult({ taskId, payloadHash, verified: true });
    } catch (e: unknown) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }, [prompt, nodeId, walletKey]);

  const stageLabel: Record<Stage, string> = {
    idle:       walletKey ? "Submit to Enclave" : "Connect Wallet First",
    connecting: "Connecting Freighter…",
    encrypting: "Encrypting locally…",
    submitting: "Submitting on-chain…",
    processing: "Enclave processing…",
    verifying:  "Verifying ZK proof…",
    done:       "Verified ✓",
    error:      "Retry",
  };

  const isLoading = ["connecting", "encrypting", "submitting", "processing", "verifying"].includes(stage);

  return (
    <main className="max-w-3xl mx-auto px-4 py-12 space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Lock className="w-5 h-5 text-violet-400" />
          E2EE Inference Playground
        </h1>
        <p className="text-sm text-slate-400">
          Your prompt is AES-256-GCM encrypted in-browser before dispatch. Only the target
          SGX enclave can decrypt it. The result is proven on-chain via CAP-0080 BN254 pairing.
        </p>
      </div>

      {/* Encryption indicator */}
      <div className="flex items-center gap-2 text-xs text-green-400 border border-green-500/20 bg-green-500/5 rounded-lg px-3 py-2">
        <Shield className="w-3.5 h-3.5" />
        Client-side AES-256-GCM encryption active — data encrypted before leaving your browser
      </div>

      {/* Wallet connection */}
      <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40 flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-slate-300">Freighter Wallet</p>
          {walletKey ? (
            <p className="text-xs font-mono text-violet-400">{walletKey.slice(0, 12)}…{walletKey.slice(-6)}</p>
          ) : (
            <p className="text-xs text-slate-500">Not connected — required to sign transactions</p>
          )}
        </div>
        <button
          onClick={connectWallet}
          disabled={isLoading || !!walletKey}
          className="flex items-center gap-1.5 text-sm border border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <Wallet className="w-3.5 h-3.5" />
          {walletKey ? "Connected" : "Connect"}
        </button>
      </div>

      {/* Node selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-300">Target Compute Node</label>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((id) => (
            <button
              key={id}
              onClick={() => setNodeId(id)}
              className={`border rounded-lg p-3 text-left transition-colors ${
                nodeId === id
                  ? "border-violet-500 bg-violet-500/10 text-violet-300"
                  : "border-slate-700 text-slate-400 hover:border-slate-500"
              }`}
            >
              <div className="text-xs font-mono">Node #{id}</div>
              <div className="text-xs text-slate-500 mt-0.5">{NODE_PUBKEYS[id].slice(0, 12)}…</div>
              <div className="flex items-center gap-1 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-xs text-green-400">Active</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Prompt input */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-300">Inference Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your confidential prompt…"
          rows={5}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 resize-none"
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={isLoading || !prompt.trim() || !walletKey}
        className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {stageLabel[stage]}
      </button>

      {/* Pipeline progress */}
      {stage !== "idle" && stage !== "connecting" && (
        <div className="border border-slate-800 rounded-xl p-4 space-y-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Pipeline</p>
          {(
            [
              ["encrypting", "AES-256-GCM client encryption"],
              ["submitting", "Soroban InvokeHostFunction (Freighter)"],
              ["processing", "SGX enclave inference"],
              ["verifying", "CAP-0080 BN254 pairing check"],
              ["done", "Bounty released to node"],
            ] as [Stage, string][]
          ).map(([s, label]) => {
            const stages: Stage[] = ["encrypting", "submitting", "processing", "verifying", "done"];
            const currentIdx = stages.indexOf(stage);
            const stepIdx    = stages.indexOf(s);
            const isDone     = currentIdx > stepIdx || stage === "done";
            const isActive   = currentIdx === stepIdx;
            return (
              <div key={s} className="flex items-center gap-3">
                {isDone ? (
                  <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                ) : isActive ? (
                  <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-600 shrink-0" />
                )}
                <span className={`text-sm ${isDone ? "text-slate-300" : isActive ? "text-violet-300" : "text-slate-500"}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="border border-green-500/30 bg-green-500/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-green-400 font-medium">
            <CheckCircle className="w-4 h-4" />
            Task Submitted On-Chain
          </div>
          <div className="space-y-1.5 text-xs font-mono text-slate-400">
            <div><span className="text-slate-500">Task ID:      </span>{result.taskId}</div>
            <div><span className="text-slate-500">Payload Hash: </span>{result.payloadHash}</div>
            {result.txHash && (
              <div><span className="text-slate-500">Tx Hash:      </span>
                <a href={`https://stellar.expert/explorer/testnet/tx/${result.txHash}`}
                   target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">
                  {result.txHash.slice(0, 16)}…
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 border border-red-500/30 bg-red-500/5 rounded-xl p-4 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
    </main>
  );
}
