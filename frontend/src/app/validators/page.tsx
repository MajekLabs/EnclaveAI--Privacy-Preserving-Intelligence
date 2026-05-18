"use client";

import { useNodePool, NodeInfo } from "@/hooks/use-node-pool";
import {
  Shield,
  CheckCircle,
  XCircle,
  RefreshCw,
  AlertCircle,
  Loader2,
  Activity,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatStake(stake: number): string {
  // 7 decimal places (Stellar stroops)
  const xlm = stake / 10_000_000;
  return xlm.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " XLM";
}

function formatAge(registeredAt: number): string {
  const days = Math.floor((Date.now() / 1000 - registeredAt) / 86400);
  return days === 1 ? "1 day" : `${days} days`;
}

function successRate(node: NodeInfo): number {
  const total = node.tasksCompleted + node.tasksFailed;
  if (total === 0) return 100;
  return Math.round((node.tasksCompleted / total) * 100);
}

// ── Node card ─────────────────────────────────────────────────────────────────

function NodeCard({ node }: { node: NodeInfo }) {
  const rate = successRate(node);
  const statusColor = node.slashed
    ? "text-red-400"
    : node.active
    ? "text-green-400"
    : "text-slate-500";
  const statusLabel = node.slashed ? "Slashed" : node.active ? "Active" : "Inactive";
  const statusDot = node.slashed
    ? "bg-red-400"
    : node.active
    ? "bg-green-400 animate-pulse"
    : "bg-slate-500";

  return (
    <div className="border border-slate-800 rounded-xl p-5 bg-slate-900/40 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-400 shrink-0" />
            <span className="font-semibold text-slate-100">Node #{node.id}</span>
          </div>
          <p className="text-xs font-mono text-slate-500 break-all">
            {node.operator.slice(0, 12)}…{node.operator.slice(-6)}
          </p>
        </div>
        <div className={`flex items-center gap-1.5 text-xs font-medium ${statusColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          {statusLabel}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="space-y-0.5">
          <p className="text-xs text-slate-500">Stake</p>
          <p className="font-medium text-slate-200">{formatStake(node.stake)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-slate-500">Success Rate</p>
          <p className={`font-medium ${rate >= 95 ? "text-green-400" : rate >= 80 ? "text-yellow-400" : "text-red-400"}`}>
            {rate}%
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-slate-500">Tasks Done</p>
          <p className="font-medium text-slate-200">{node.tasksCompleted.toLocaleString()}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-slate-500">Age</p>
          <p className="font-medium text-slate-200">{formatAge(node.registeredAt)}</p>
        </div>
      </div>

      {/* Attestation key */}
      <div className="border-t border-slate-800 pt-3 space-y-1">
        <p className="text-xs text-slate-500">SGX Attestation Key</p>
        <p className="text-xs font-mono text-slate-400 break-all">
          {node.attestationKey.slice(0, 24)}…
        </p>
      </div>

      {/* Task bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-slate-500">
          <span>{node.tasksCompleted} completed</span>
          {node.tasksFailed > 0 && (
            <span className="text-red-400">{node.tasksFailed} failed</span>
          )}
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-500 rounded-full transition-all"
            style={{ width: `${rate}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ValidatorsPage() {
  const { nodes, stats, loading, error, lastUpdated, refresh } = useNodePool(15_000);

  const activeNodes = nodes.filter((n) => n.active && !n.slashed);
  const totalStake = nodes.reduce((sum, n) => sum + n.stake, 0);

  return (
    <main className="max-w-5xl mx-auto px-4 py-12 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-violet-400" />
            Live Validators
          </h1>
          <p className="text-sm text-slate-400">
            Compute nodes registered in the{" "}
            <span className="font-mono text-violet-400">auranode-pool</span> contract.
            Stakes are slashed on invalid ZK proofs.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Nodes", value: stats.nodeCount },
          { label: "Active Nodes", value: activeNodes.length },
          { label: "Tasks Processed", value: stats.taskCount.toLocaleString() },
          { label: "Total Staked", value: formatStake(totalStake) },
        ].map((s) => (
          <div
            key={s.label}
            className="border border-slate-800 rounded-xl p-4 bg-slate-900/40 space-y-1"
          >
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="text-xl font-bold text-slate-100">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 border border-red-500/30 bg-red-500/5 rounded-xl p-4 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && nodes.length === 0 && (
        <div className="flex items-center justify-center py-20 gap-2 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Fetching node data from Soroban RPC…</span>
        </div>
      )}

      {/* Node grid */}
      {nodes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {nodes.map((node) => (
            <NodeCard key={node.id} node={node} />
          ))}
        </div>
      )}

      {/* Protocol note */}
      <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40 flex items-start gap-3 text-sm text-slate-400">
        <Shield className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
        <p>
          Each node stakes XLM collateral. The{" "}
          <span className="font-mono text-violet-400">auranode-verifier</span> contract
          runs a CAP-0080 BN254 pairing check on every submitted proof — a failed check
          triggers an automatic 20% stake slash via{" "}
          <span className="font-mono text-violet-400">slash_node</span>.
        </p>
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <p className="text-xs text-slate-600 text-right">
          Last updated: {lastUpdated.toLocaleTimeString()} · auto-refreshes every 15s
        </p>
      )}
    </main>
  );
}
