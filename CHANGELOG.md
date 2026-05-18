# Changelog

All notable changes to AuraNode are documented here.

## [Unreleased]

## [1.1.0] - 2026-05-18

### Added
- `/validators` page: live node stats from `auranode-pool` via Soroban RPC (stake, success rate, tasks, age, attestation key)
- `useNodePool` hook: fetches node data from Soroban RPC with 15s auto-refresh
- `tsconfig.json` with `@/*` path alias (was missing, broke builds)
- `.github/workflows/ci.yml`: CI pipeline for contracts (build + test), frontend (build), and node-daemon
- `.env.contracts`: real testnet contract IDs
- `scripts/deploy-contracts.sh`: full deployment script using stellar CLI 26
- `scripts/prove.sh`: nargo prove integration with CLI argument overrides

### Changed
- Upgraded all contracts to soroban-sdk 26 (from 20/22)
- Replaced `#![no_std]` with `#![cfg_attr(target_family = "wasm", no_std)]` for correct test compilation
- Build target changed from `wasm32-unknown-unknown` to `wasm32v1-none` (required by soroban-sdk 26)
- `auranode-verifier`: updated BN254 API to `env.crypto().bn254()` (soroban-sdk 26 CAP-0080)
- `auranode-verifier`: G2 point size corrected to 128 bytes
- `smart-contracts/src/enclave_contract.rs`: replaced Vec-based instance storage with proper persistent/temporary storage, real token transfers, CAP-0078/0082
- Playground: wired to real Freighter API (`@stellar/freighter-api`) and real `InvokeHostFunction` XDR via `@stellar/stellar-sdk`
- `frontend/next.config.js`: removed deprecated `experimental.appDir`
- `frontend/package.json`: removed non-existent `@radix-ui/react-badge` dependency
- `frontend/src/components/ui/toaster.tsx`: stubbed (referenced missing files)

### Fixed
- All 4 contract tests pass: `test_register_and_submit`, `test_slash_on_failure`, `test_initialize_and_set_vk`, `enclaveai::test_register_and_submit`
- Frontend builds cleanly with zero TypeScript errors

### Deployed (Stellar Testnet)
- `auranode-pool`: `CDGW4Y626MRU3MSXH4HUKEQWIQS6UAKAOTZCE7PR7OVAUK5J7UDRFLXB`
- `auranode-verifier`: `CDT4P3FKFLT7K7R6S3VVDXTTDE4SKOOFN4C4LIU7TI37U7LSRX4TRJBS`
- `enclaveai-contract`: `CC6EZQDTQJK3BEDNQ7BXFI5SW4LQAE2BF4RJF4VHBJJ4L4CTVE3PDDUV`

## [1.0.0] - 2026-05-18

### Added
- `auranode-pool` Soroban contract: node registration, staking, task escrow, bounty release, slash (CAP-0078, CAP-0082)
- `auranode-verifier` Soroban contract: UltraPlonk proof verification using CAP-0080 BN254 host functions
- Noir ZK circuit (`circuits/src/main.nr`): UltraPlonk inference verification with Pedersen hash constraints
- `node-daemon`: Rust daemon subscribing to Horizon SSE, routing tasks to SGX enclave, submitting proofs
- Next.js 15 frontend: landing page, E2EE playground, validators page
- `Prover.toml` with sample witness inputs; `circuits/proofs/inference_verify.proof` sample proof

### Initial commit
- Legacy `backend/` (Node.js/Express): TEE node management, request routing, Stellar transaction validation
- Legacy `smart-contracts/` (original enclave_contract.rs): basic node/request management
- `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `CONTRIBUTING.md`
