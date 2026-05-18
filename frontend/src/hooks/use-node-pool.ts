"use client";

import { useState, useEffect, useCallback } from "react";

const SOROBAN_RPC =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const POOL_CONTRACT = process.env.NEXT_PUBLIC_POOL_CONTRACT_ID ?? "";

// Mirrors the on-chain NodeInfo struct from auranode-pool
export interface NodeInfo {
  id: number;
  operator: string;
  attestationKey: string; // hex
  stake: number; // in stroops (1 XLM = 10_000_000 stroops)
  active: boolean;
  slashed: boolean;
  tasksCompleted: number;
  tasksFailed: number;
  registeredAt: number; // unix timestamp
}

export interface PoolStats {
  nodeCount: number;
  taskCount: number;
}

// ── Soroban RPC helpers ───────────────────────────────────────────────────────

async function sorobanCall(method: string, params: unknown): Promise<unknown> {
  const res = await fetch(SOROBAN_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// Build a minimal simulateTransaction payload for a read-only contract call.
// In production this would use stellar-sdk to build proper XDR; here we use
// the getLatestLedger trick to derive a mock ledger sequence for the simulation.
async function readContractU32(fnName: string): Promise<number> {
  // Fallback: derive from latest ledger sequence as a stable mock value
  const result = (await sorobanCall("getLatestLedger", {})) as {
    sequence: number;
  };
  // Seed deterministic mock counts from ledger sequence
  const seed = result.sequence % 100;
  if (fnName === "node_count") return 3 + (seed % 3); // 3–5 nodes
  if (fnName === "task_count") return 10 + seed;       // 10–109 tasks
  return 0;
}

// Derive a stable mock NodeInfo from node_id + ledger sequence.
// In production: simulateTransaction → XDR decode → NodeInfo
function mockNode(id: number, ledgerSeq: number): NodeInfo {
  const operators = [
    "GBVKI23OQZCANDUZ5OLFPWM5BZPJZXKYS6OWYOI4BJKZKV4TZOT4OX5",
    "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZXG5AUXZSB9BKZF4DKFH",
    "GDQJUTQYK2MQX2YUVFURIQNZMZEXDPZ6BHPWHKP5EKJGY4LFKDQNXLB",
    "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
    "GCFONE23AB7Y6C5XTEWARKFENBWT5CDAPNXKZJH4SKDQNXLB2UXQHSKB",
  ];
  const keys = [
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
    "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
    "e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
  ];
  const base = (id * 7 + ledgerSeq) % 100;
  return {
    id,
    operator: operators[id % operators.length],
    attestationKey: keys[id % keys.length],
    stake: 1_000_0000000 + base * 100_0000000,
    active: id < 3 || base > 20,
    slashed: false,
    tasksCompleted: 10 + base * (id + 1),
    tasksFailed: id % 3,
    registeredAt: Math.floor(Date.now() / 1000) - 86400 * (id + 1),
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNodePool(refreshInterval = 15_000) {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [stats, setStats] = useState<PoolStats>({ nodeCount: 0, taskCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetch = useCallback(async () => {
    try {
      setError(null);
      const ledger = (await sorobanCall("getLatestLedger", {})) as {
        sequence: number;
      };
      const nodeCount = await readContractU32("node_count");
      const taskCount = await readContractU32("task_count");

      const nodeList: NodeInfo[] = Array.from({ length: nodeCount }, (_, i) =>
        mockNode(i, ledger.sequence)
      );

      setNodes(nodeList);
      setStats({ nodeCount, taskCount });
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch node data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, refreshInterval);
    return () => clearInterval(id);
  }, [fetch, refreshInterval]);

  return { nodes, stats, loading, error, lastUpdated, refresh: fetch };
}
