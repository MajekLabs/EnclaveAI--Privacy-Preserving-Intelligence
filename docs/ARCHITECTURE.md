# AuraNode Architecture

## Overview

AuraNode is a decentralized confidential AI inference network on Stellar. It combines Intel SGX hardware enclaves with BN254 ZK proofs verified natively on-chain using Stellar Protocol 26 (CAP-0080).

## System Architecture

```
Browser (AES-256-GCM E2EE)
        │
        ▼
Stellar Soroban (auranode-pool)   ← submit_task (payload_hash + bounty escrow)
        │  Horizon SSE event stream
        ▼
AuraNode Daemon (node-daemon)     ← listens for task_sub events
        │
        ▼
Intel SGX Enclave                 ← decrypts payload, runs model, produces output_hash
        │
        ▼
Noir Circuit (circuits/)          ← nargo prove → UltraPlonk BN254 proof
        │
        ▼
auranode-verifier                 ← CAP-0080 bn254.pairing_check()
        │
        ├─ pass → auranode-pool.complete_task() → bounty released to node
        └─ fail → auranode-pool.slash_node()    → 20% stake slashed, bounty refunded
```

## Components

### Smart Contracts (Rust / Soroban SDK 26)

**auranode-pool** (`contracts/auranode-pool/`)
- Node registration with XLM stake collateral (token transfer into escrow)
- Task submission with bounty escrow
- `complete_task` — releases bounty to node operator (called by verifier)
- `slash_node` — slashes 20% of node stake, refunds client (called by verifier)
- CAP-0078: persistent storage for nodes (30-day TTL), temporary for tasks (24-hour TTL)
- CAP-0082: all arithmetic uses `checked_mul` / `checked_add` / `checked_sub`

**auranode-verifier** (`contracts/auranode-verifier/`)
- Accepts UltraPlonk proof + public inputs from compute nodes
- CAP-0080: `env.crypto().bn254().g1_mul()`, `.g1_add()`, `.pairing_check()`
- Stores proof records in temporary storage (48-hour TTL, CAP-0078)
- Cross-contract calls to `auranode-pool` on pass/fail

**enclaveai-contract** (`smart-contracts/`)
- Compatibility shim with the same staking/task/slash interface
- Uses identical CAP-0078/0082 patterns

### ZK Circuit (Noir)

**circuits/src/main.nr**
- UltraPlonk circuit compiled with Nargo + Barretenberg backend
- Proves: output_hash binds to model_output (Pedersen hash)
- Proves: model_key_nonce derived from MRENCLAVE + task_id (model binding)
- Proves: execution trace is internally consistent (chain of Pedersen hashes)
- Public inputs: `task_id`, `output_hash`, `model_hash` — committed on-chain
- Private witnesses: `model_output`, `model_key_nonce`, `execution_trace` — stay in enclave

### Node Daemon (Rust)

**node-daemon/src/**
- Subscribes to Horizon SSE event stream for `task_sub` events from `auranode-pool`
- Routes tasks to the SGX enclave runner (`enclave/secure_run.rs`)
- Generates BN254 UltraPlonk proof via `nargo prove`
- Submits proof to `auranode-verifier` via Soroban RPC `sendTransaction`
- Exponential back-off reconnection on Horizon SSE disconnect

**node-daemon/src/enclave/secure_run.rs**
- SGX attestation stub (production: `sgx_urts::SgxEnclave::create` + ECALL)
- Deterministic mock inference for testing (SHA-256 of payload_hash)
- Proof generation stub (production: shells out to `nargo prove`, parses BN254 points)

### Frontend (Next.js 15)

**frontend/src/app/**
- `/` — Landing page with protocol overview and architecture diagram
- `/playground` — E2EE inference playground
  - AES-256-GCM in-browser encryption via Web Crypto API
  - Freighter wallet connection via `@stellar/freighter-api`
  - Real `InvokeHostFunction` XDR built with `@stellar/stellar-sdk`
  - `simulateTransaction` → `assembleTransaction` → Freighter sign → `sendTransaction`
- `/validators` — Live node stats from `auranode-pool` via Soroban RPC

## Protocol 26 Features

| CAP | Feature | Where Used |
|---|---|---|
| CAP-0080 | BN254 native host functions | `auranode-verifier`: `g1_mul`, `g1_add`, `pairing_check` |
| CAP-0078 | Precise TTL storage | All contracts: `extend_ttl` on instance, persistent, temporary storage |
| CAP-0082 | Checked 256-bit arithmetic | All contracts: stake, slash, bounty, counter arithmetic |

## Deployed Contracts (Testnet)

| Contract | ID |
|---|---|
| auranode-pool | `CDGW4Y626MRU3MSXH4HUKEQWIQS6UAKAOTZCE7PR7OVAUK5J7UDRFLXB` |
| auranode-verifier | `CDT4P3FKFLT7K7R6S3VVDXTTDE4SKOOFN4C4LIU7TI37U7LSRX4TRJBS` |
| enclaveai-contract | `CC6EZQDTQJK3BEDNQ7BXFI5SW4LQAE2BF4RJF4VHBJJ4L4CTVE3PDDUV` |

## Security Model

- **Client-side encryption**: AES-256-GCM in-browser; ciphertext SHA-256 hash goes on-chain as `payload_hash`
- **SGX attestation**: MRENCLAVE measurement binds model identity to the ZK proof nonce
- **Economic security**: Nodes stake XLM; invalid proofs trigger automatic 20% slash via `slash_node`
- **On-chain verification**: Every inference result has a BN254 pairing proof verified by `auranode-verifier`
- **No central server**: The backend (`backend/`) is a legacy component; the production path is browser → Soroban → daemon → enclave → verifier

## Development Setup

```bash
# Contracts
rustup target add wasm32v1-none
cargo build --release --target wasm32v1-none --package auranode-pool --package auranode-verifier --package enclaveai-contract
cargo test --package auranode-pool --package auranode-verifier --package enclaveai-contract

# Frontend
cd frontend && npm install && npm run dev

# ZK proofs (requires nargo >= 0.36)
./scripts/prove.sh

# Deploy to testnet (requires stellar CLI >= 26)
./scripts/deploy-contracts.sh
```
