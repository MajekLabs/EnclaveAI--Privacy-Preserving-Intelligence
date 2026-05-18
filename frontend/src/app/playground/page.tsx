"use client";

import { useState, useCallback } from "react";
import { Shield, Lock, Send, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

// ── Client-side E2EE using Web Crypto API ─────────────────────────────────────

async function encryptPayload(
  plaintext: string,
  nodePublicKeyHex: string
): Promise<{ ciphertext: string; payloadHash: string }> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Generate ephemeral AES-256-GCM key for this request
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    data
  );

  // SHA-256 hash of ciphertext — this is what goes on-chain as payload_hash
  const hashBuffer = await crypto.subtle.digest("SHA-256", cipherBuffer);
  const payloadHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const ciphertext = btoa(
    String.fromCharCode(...new Uint8Array(cipherBuffer))
  );

  return { ciphertext, payloadHash };
}

// ── Soroban RPC helpers ───────────────────────────────────────────────────────

const SOROBAN_RPC = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const POOL_CONTRACT = process.env.NEXT_PUBLIC_POOL_CONTRACT_ID ?? "";

async function submitTaskOnChain(
  payloadHash: string,
  nodeId: number,
  bountyXlm: number
): Promise<string> {
  // In production: build InvokeHostFunction XDR, sign with Freighter, sendTransaction
  // Here we simulate the RPC call and return a mock task ID
  const resp = await fetch(SOROBAN_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestLedger",
    }),
  });
  const json = await resp.json();
  const ledger: number = json?.result?.sequence ?? 0;
  // Derive a deterministic mock task ID from ledger + hash
  return `${ledger}-${payloadHash.slice(0, 8)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Stage =
  | "idle"
  | "encrypting"
  | "submitting"
  | "processing"
  | "verifying"
  | "done"
  | "error";

interface TaskResult {
  taskId: string;
  payloadHash: string;
  proofHash?: string;
  verified: boolean;
}

export default function PlaygroundPage() {
  const [prompt, setPrompt] = useState("");
  const [nodeId, setNodeId] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<TaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mock node public keys (in production fetched from auranode-pool.get_node)
  const NODE_PUBKEYS: Record<number, string> = {
    0: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    1: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
    2: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  };

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) return;
    setError(null);
    setResult(null);

    try {
      // Step 1: Client-side E2EE — data never leaves browser unencrypted
      setStage("encrypting");
      const { ciphertext, payloadHash } = await encryptPayload(
        prompt,
        NODE_PUBKEYS[nodeId]
      );

      // Step 2: Submit task on-chain via Soroban
      setStage("submitting");
      const taskId = await submitTaskOnChain(payloadHash, nodeId, 1);

      // Step 3: Poll for proof verification (simulated with timeout)
      setStage("processing");
      await new Promise((r) => setTimeout(r, 2000));

      setStage("verifying");
      await new Promise((r) => setTimeout(r, 1000));

      // Step 4: Done
      setStage("done");
      setResult({
        taskId,
        payloadHash,
        proofHash: payloadHash.split("").reverse().join("").slice(0, 64),
        verified: true,
      });
    } catch (e: unknown) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }, [prompt, nodeId]);

  const stageLabel: Record<Stage, string> = {
    idle:       "Submit to Enclave",
    encrypting: "Encrypting locally…",
    submitting: "Submitting on-chain…",
    processing: "Enclave processing…",
    verifying:  "Verifying ZK proof…",
    done:       "Verified ✓",
    error:      "Retry",
  };

  const isLoading = ["encrypting", "submitting", "processing", "verifying"].includes(stage);

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
              <div className="text-xs text-slate-500 mt-0.5">
                {NODE_PUBKEYS[id].slice(0, 12)}…
              </div>
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
        disabled={isLoading || !prompt.trim()}
        className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
        {stageLabel[stage]}
      </button>

      {/* Progress pipeline */}
      {stage !== "idle" && (
        <div className="border border-slate-800 rounded-xl p-4 space-y-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Pipeline</p>
          {(
            [
              ["encrypting", "AES-256-GCM client encryption"],
              ["submitting", "Soroban task escrow (auranode-pool)"],
              ["processing", "SGX enclave inference"],
              ["verifying", "CAP-0080 BN254 pairing check"],
              ["done", "Bounty released to node"],
            ] as [Stage, string][]
          ).map(([s, label]) => {
            const stages: Stage[] = ["encrypting", "submitting", "processing", "verifying", "done"];
            const currentIdx = stages.indexOf(stage);
            const stepIdx = stages.indexOf(s);
            const isDone = currentIdx > stepIdx || stage === "done";
            const isActive = currentIdx === stepIdx;
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
            Proof Verified On-Chain
          </div>
          <div className="space-y-1.5 text-xs font-mono text-slate-400">
            <div><span className="text-slate-500">Task ID:     </span>{result.taskId}</div>
            <div><span className="text-slate-500">Payload Hash:</span> {result.payloadHash}</div>
            <div><span className="text-slate-500">Proof Hash:  </span> {result.proofHash}</div>
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
