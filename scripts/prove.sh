#!/usr/bin/env bash
# scripts/prove.sh — Generate a UltraPlonk ZK proof for AuraNode inference verification
# Usage: ./scripts/prove.sh [task_id] [output_hash_lo] [output_hash_hi]
# Requires: nargo >= 0.36 (https://noir-lang.org/docs/getting_started/installation)

set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "$0")/../circuits" && pwd)"
PROOF_OUT="$CIRCUITS_DIR/proofs/inference_verify.proof"

# ── Install nargo if missing ──────────────────────────────────────────────────
if ! command -v nargo &>/dev/null; then
  echo "nargo not found — installing via noirup..."
  curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
  export PATH="$HOME/.nargo/bin:$PATH"
fi

NARGO_VERSION=$(nargo --version 2>/dev/null | head -1)
echo "Using $NARGO_VERSION"

# ── Override Prover.toml values from CLI args ─────────────────────────────────
TASK_ID="${1:-0x000000000000000000000000000000000000000000000000000000000000002a}"
OUTPUT_LO="${2:-0x0f7e5a3b2c1d4e6f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f}"
OUTPUT_HI="${3:-0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b}"

# Patch Prover.toml with provided values
sed -i "s|^task_id = .*|task_id = \"$TASK_ID\"|" "$CIRCUITS_DIR/Prover.toml"
sed -i "/^\[output_hash\]/,/^\[/ s|^lo = .*|lo = \"$OUTPUT_LO\"|" "$CIRCUITS_DIR/Prover.toml"
sed -i "/^\[output_hash\]/,/^\[/ s|^hi = .*|hi = \"$OUTPUT_HI\"|" "$CIRCUITS_DIR/Prover.toml"

# ── Compile + prove ───────────────────────────────────────────────────────────
echo "Compiling circuit..."
cd "$CIRCUITS_DIR"
nargo compile

echo "Generating UltraPlonk proof..."
nargo prove

echo "Proof written to: $PROOF_OUT"
echo ""
echo "Proof hex (first 64 bytes):"
xxd -l 64 "$PROOF_OUT" 2>/dev/null || head -2 "$PROOF_OUT"

echo ""
echo "Submit to auranode-verifier via:"
echo "  stellar contract invoke --id \$VERIFIER_CONTRACT_ID \\"
echo "    --fn verify_inference_proof \\"
echo "    --arg \"\$(cat $PROOF_OUT | xxd -p | tr -d '\n')\""
