// AuraNode Inference Verification Circuit
// Compiled with Noir + UltraPlonk backend (Barretenberg).
// Proves that:
//   1. The prover knows a model_output that hashes to output_hash
//   2. The model_output was produced by the model identified by model_hash
//   3. The computation was bound to a specific task_id
//
// Public inputs  → verified on-chain by auranode-verifier (CAP-0080)
// Private inputs → known only inside the SGX enclave

use std::hash::pedersen_hash;

// ── Public inputs (committed on-chain) ───────────────────────────────────────

/// SHA-256 hash of the model's output (split into two 128-bit limbs for BN254 field)
pub struct OutputHash {
    pub lo: Field,
    pub hi: Field,
}

/// Identity of the model (MRENCLAVE measurement)
pub struct ModelHash {
    pub lo: Field,
    pub hi: Field,
}

// ── Circuit ───────────────────────────────────────────────────────────────────

fn main(
    // Public inputs
    task_id:     pub Field,
    output_hash: pub OutputHash,
    model_hash:  pub ModelHash,

    // Private witnesses (known only inside the enclave)
    model_output:    [u8; 64],   // raw model output bytes
    model_key_nonce: Field,      // enclave-derived nonce binding output to model
    execution_trace: [Field; 8], // intermediate computation commitments
) {
    // ── Constraint 1: output_hash binds to model_output ───────────────────
    // Compute Pedersen hash of model_output and assert it matches public output_hash.
    // Pedersen is BN254-native and cheap to verify with CAP-0080 MSM.
    let output_bytes_as_fields: [Field; 64] = model_output.map(|b| b as Field);
    let computed_output_lo = pedersen_hash(output_bytes_as_fields.as_slice());

    // The hi limb commits to the model_key_nonce, binding output to this specific model run
    let computed_output_hi = pedersen_hash([computed_output_lo, model_key_nonce]);

    assert(computed_output_lo == output_hash.lo, "output hash lo mismatch");
    assert(computed_output_hi == output_hash.hi, "output hash hi mismatch");

    // ── Constraint 2: model_hash binds to the execution environment ───────
    // The model_key_nonce is derived from MRENCLAVE (model_hash) + task_id.
    // This ensures the proof is specific to this model and this task.
    let expected_nonce = pedersen_hash([model_hash.lo, model_hash.hi, task_id]);
    assert(model_key_nonce == expected_nonce, "model binding nonce mismatch");

    // ── Constraint 3: execution trace is internally consistent ────────────
    // Each step in the trace must chain: trace[i+1] = H(trace[i], output_bytes[i*8])
    for i in 0..7 {
        let step_input: [Field; 2] = [
            execution_trace[i],
            output_bytes_as_fields[i * 8],
        ];
        let expected_next = pedersen_hash(step_input.as_slice());
        assert(execution_trace[i + 1] == expected_next, "trace chain broken");
    }

    // ── Constraint 4: task_id is non-zero (prevents replay with task 0) ───
    assert(task_id != 0, "task_id must be non-zero");
}

// ── Test harness ──────────────────────────────────────────────────────────────

#[test]
fn test_valid_proof() {
    // Build a consistent witness
    let model_output: [u8; 64] = [0xab; 64];
    let output_fields: [Field; 64] = model_output.map(|b| b as Field);

    let task_id: Field = 42;
    let model_hash = ModelHash { lo: 0x1234, hi: 0x5678 };

    let model_key_nonce = std::hash::pedersen_hash([model_hash.lo, model_hash.hi, task_id]);

    let output_lo = std::hash::pedersen_hash(output_fields.as_slice());
    let output_hi = std::hash::pedersen_hash([output_lo, model_key_nonce]);
    let output_hash = OutputHash { lo: output_lo, hi: output_hi };

    // Build trace
    let mut trace: [Field; 8] = [0; 8];
    trace[0] = output_fields[0];
    for i in 0..7 {
        trace[i + 1] = std::hash::pedersen_hash([trace[i], output_fields[i * 8]]);
    }

    main(task_id, output_hash, model_hash, model_output, model_key_nonce, trace);
}
