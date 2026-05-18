#!/usr/bin/env bash
# scripts/deploy-contracts.sh — Build and deploy AuraNode contracts to Stellar testnet
# Usage: ./scripts/deploy-contracts.sh
# Requires: stellar CLI >= 26.0.0, cargo, rust wasm32 target
#
# After deployment, contract IDs are written to .env.contracts and README is updated.

set -euo pipefail

NETWORK="testnet"
RPC_URL="https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
HORIZON_URL="https://horizon-testnet.stellar.org"
CONTRACTS_FILE=".env.contracts"

# ── Preflight checks ──────────────────────────────────────────────────────────
for cmd in stellar cargo; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found. Install from:"
    echo "  stellar: https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli"
    echo "  cargo:   https://rustup.rs"
    exit 1
  fi
done

# Ensure wasm target
rustup target add wasm32-unknown-unknown 2>/dev/null || true

# ── Fund deployer account ─────────────────────────────────────────────────────
echo "==> Setting up deployer identity..."
stellar keys generate --overwrite deployer --network "$NETWORK" 2>/dev/null || true
DEPLOYER=$(stellar keys address deployer)
echo "Deployer: $DEPLOYER"

echo "==> Funding deployer via Friendbot..."
curl -s "https://friendbot.stellar.org?addr=$DEPLOYER" | grep -q '"successful"' \
  && echo "Funded." || echo "Already funded or Friendbot unavailable."

# ── Build contracts ───────────────────────────────────────────────────────────
echo ""
echo "==> Building contracts (release + wasm)..."
cargo build --release --target wasm32-unknown-unknown \
  --package auranode-pool \
  --package auranode-verifier \
  --package enclaveai-contract

POOL_WASM="target/wasm32-unknown-unknown/release/auranode_pool.wasm"
VERIFIER_WASM="target/wasm32-unknown-unknown/release/auranode_verifier.wasm"
ENCLAVE_WASM="target/wasm32-unknown-unknown/release/enclaveai_contract.wasm"

# ── Upload + deploy auranode-pool ─────────────────────────────────────────────
echo ""
echo "==> Deploying auranode-pool..."
POOL_CONTRACT_ID=$(stellar contract deploy \
  --wasm "$POOL_WASM" \
  --source deployer \
  --network "$NETWORK")
echo "auranode-pool: $POOL_CONTRACT_ID"

# ── Upload + deploy auranode-verifier ─────────────────────────────────────────
echo ""
echo "==> Deploying auranode-verifier..."
VERIFIER_CONTRACT_ID=$(stellar contract deploy \
  --wasm "$VERIFIER_WASM" \
  --source deployer \
  --network "$NETWORK")
echo "auranode-verifier: $VERIFIER_CONTRACT_ID"

# ── Upload + deploy enclaveai-contract ────────────────────────────────────────
echo ""
echo "==> Deploying enclaveai-contract..."
ENCLAVE_CONTRACT_ID=$(stellar contract deploy \
  --wasm "$ENCLAVE_WASM" \
  --source deployer \
  --network "$NETWORK")
echo "enclaveai-contract: $ENCLAVE_CONTRACT_ID"

# ── Initialize contracts ──────────────────────────────────────────────────────
echo ""
echo "==> Initializing auranode-pool..."
stellar contract invoke \
  --id "$POOL_CONTRACT_ID" \
  --source deployer \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER" \
  --verifier "$VERIFIER_CONTRACT_ID" \
  --min_stake 10000000  # 1 XLM in stroops

echo "==> Initializing auranode-verifier..."
stellar contract invoke \
  --id "$VERIFIER_CONTRACT_ID" \
  --source deployer \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER" \
  --pool "$POOL_CONTRACT_ID"

echo "==> Initializing enclaveai-contract..."
stellar contract invoke \
  --id "$ENCLAVE_CONTRACT_ID" \
  --source deployer \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER" \
  --min_stake 10000000

# ── Write contract IDs ────────────────────────────────────────────────────────
echo ""
echo "==> Writing contract IDs to $CONTRACTS_FILE..."
cat > "$CONTRACTS_FILE" <<EOF
# AuraNode Testnet Contract IDs — generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")
NEXT_PUBLIC_POOL_CONTRACT_ID=$POOL_CONTRACT_ID
NEXT_PUBLIC_VERIFIER_CONTRACT_ID=$VERIFIER_CONTRACT_ID
ENCLAVE_CONTRACT_ID=$ENCLAVE_CONTRACT_ID
NEXT_PUBLIC_SOROBAN_RPC_URL=$RPC_URL
HORIZON_URL=$HORIZON_URL
DEPLOYER_ADDRESS=$DEPLOYER
EOF

echo ""
echo "==> Updating README with contract IDs..."
# Replace the contract IDs section in README
python3 - <<PYEOF
import re, pathlib

readme = pathlib.Path("README.md").read_text()
block = f"""## Deployed Contracts (Stellar Testnet)

| Contract | ID |
|---|---|
| auranode-pool | \`{POOL_CONTRACT_ID}\` |
| auranode-verifier | \`{VERIFIER_CONTRACT_ID}\` |
| enclaveai-contract | \`{ENCLAVE_CONTRACT_ID}\` |

Network: Stellar Testnet (Protocol 26)
RPC: {RPC_URL}
"""

# Replace existing deployed contracts section or append
if "## Deployed Contracts" in readme:
    readme = re.sub(r"## Deployed Contracts.*?(?=\n## |\Z)", block, readme, flags=re.DOTALL)
else:
    readme = readme.rstrip() + "\n\n" + block + "\n"

pathlib.Path("README.md").write_text(readme)
print("README updated.")
PYEOF

echo ""
echo "✓ Deployment complete!"
echo ""
echo "  Pool contract:     $POOL_CONTRACT_ID"
echo "  Verifier contract: $VERIFIER_CONTRACT_ID"
echo "  Enclave contract:  $ENCLAVE_CONTRACT_ID"
echo ""
echo "Copy $CONTRACTS_FILE to frontend/.env.local to connect the playground."
