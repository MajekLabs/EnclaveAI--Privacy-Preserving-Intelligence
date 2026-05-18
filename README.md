# AuraNode — Confidential AI Inference on Stellar

A decentralized AI network that pairs Intel SGX hardware enclaves with BN254 ZK proofs verified natively on Stellar using Protocol 26 (CAP-0080). Your data never leaves the enclave. Every result is cryptographically proven on-chain.

## The Problem

Traditional AI sends your sensitive data to a central server where it can be stored, used for training, or breached. There is no way to verify what actually happened inside the model.

## The Solution

AuraNode moves computation into hardware-isolated SGX enclaves. A Noir UltraPlonk circuit proves the computation happened correctly. The proof is verified on-chain by the `auranode-verifier` contract using CAP-0080 BN254 native host functions — at ~90% lower cost than equivalent Wasm verification.

## Deployed Contracts (Stellar Testnet)

| Contract | ID | Explorer |
|---|---|---|
| `auranode-pool` | `CDGW4Y626MRU3MSXH4HUKEQWIQS6UAKAOTZCE7PR7OVAUK5J7UDRFLXB` | [View](https://stellar.expert/explorer/testnet/contract/CDGW4Y626MRU3MSXH4HUKEQWIQS6UAKAOTZCE7PR7OVAUK5J7UDRFLXB) |
| `auranode-verifier` | `CDT4P3FKFLT7K7R6S3VVDXTTDE4SKOOFN4C4LIU7TI37U7LSRX4TRJBS` | [View](https://stellar.expert/explorer/testnet/contract/CDT4P3FKFLT7K7R6S3VVDXTTDE4SKOOFN4C4LIU7TI37U7LSRX4TRJBS) |
| `enclaveai-contract` | `CC6EZQDTQJK3BEDNQ7BXFI5SW4LQAE2BF4RJF4VHBJJ4L4CTVE3PDDUV` | [View](https://stellar.expert/explorer/testnet/contract/CC6EZQDTQJK3BEDNQ7BXFI5SW4LQAE2BF4RJF4VHBJJ4L4CTVE3PDDUV) |

Network: Stellar Testnet · Protocol 26  
RPC: `https://soroban-testnet.stellar.org`  
Deployer: `GDAVI7UVKQNRGWEAMS6FIYHIFOO3XVOWMWS4P3BJHEN22MK357AVA37B`

Initialization transactions:
- Pool: [374ee5f0](https://stellar.expert/explorer/testnet/tx/374ee5f09188090c332e96033d1fbba1765dafa402d7117df5a6791e2a03fdf5)
- Verifier: [1e3d84f2](https://stellar.expert/explorer/testnet/tx/1e3d84f270c8e704a7cf605226253354baefb27a84e6d012072f2d3f8d168b00)
- Enclave: [949a00c7](https://stellar.expert/explorer/testnet/tx/949a00c7c5838effeffca5a2e1db6b8eb421edd2ecd5beca7df1bc2257862486)

## Architecture

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

## Protocol 26 Features Used

| CAP | Feature | Usage |
|---|---|---|
| CAP-0080 | BN254 native host functions | `bn254.g1_mul`, `bn254.g1_add`, `bn254.pairing_check` in verifier |
| CAP-0078 | Precise TTL storage | Task escrows auto-purge after 24h; proof records after 48h |
| CAP-0082 | Checked 256-bit arithmetic | All stake, slash, and bounty math uses `checked_mul`/`checked_add` |

## Repository Structure

```
contracts/
  auranode-pool/       # Node registration, staking, task escrow, slashing
  auranode-verifier/   # CAP-0080 BN254 UltraPlonk proof verification
smart-contracts/       # enclaveai-contract (compatibility shim)
circuits/              # Noir ZK circuit for inference verification
  src/main.nr          # UltraPlonk circuit (Pedersen hash constraints)
  Prover.toml          # Sample witness inputs
  proofs/              # Sample generated proof
node-daemon/           # Rust daemon: Horizon SSE → SGX enclave → proof submission
frontend/              # Next.js 15 playground + validators UI
scripts/
  deploy-contracts.sh  # Full deployment script
  prove.sh             # nargo prove integration
```

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs) + `wasm32v1-none` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) >= 26.0.0
- [Nargo](https://noir-lang.org/docs/getting_started/installation) >= 0.36 (for ZK proofs)
- Node.js >= 20

### Build Contracts

```bash
rustup target add wasm32v1-none
cargo build --release --target wasm32v1-none \
  --package auranode-pool \
  --package auranode-verifier \
  --package enclaveai-contract
```

### Run Contract Tests

```bash
cargo test --package auranode-pool --package auranode-verifier --package enclaveai-contract
```

### Deploy to Testnet

```bash
./scripts/deploy-contracts.sh
```

### Generate ZK Proof

```bash
./scripts/prove.sh
# or manually:
cd circuits && nargo prove
```

### Run Frontend

```bash
cd frontend
cp ../.env.contracts .env.local
npm install
npm run dev
```

## Environment Variables

Copy `.env.contracts` to `frontend/.env.local`:

```env
NEXT_PUBLIC_POOL_CONTRACT_ID=CDGW4Y626MRU3MSXH4HUKEQWIQS6UAKAOTZCE7PR7OVAUK5J7UDRFLXB
NEXT_PUBLIC_VERIFIER_CONTRACT_ID=CDT4P3FKFLT7K7R6S3VVDXTTDE4SKOOFN4C4LIU7TI37U7LSRX4TRJBS
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

## Security Model

- **Client-side encryption**: AES-256-GCM in-browser via Web Crypto API before any data leaves the browser
- **SGX attestation**: MRENCLAVE measurement binds the model identity to the ZK proof
- **Economic security**: Nodes stake XLM collateral; invalid proofs trigger automatic 20% slash
- **On-chain verification**: Every inference result has a verifiable BN254 pairing proof on Stellar

## License

MIT License — see [LICENSE](LICENSE)
