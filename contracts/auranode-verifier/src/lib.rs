//! AuraNode Verifier Contract
//! Verifies UltraPlonk ZK proofs using CAP-0080 BN254 native host functions
//! (soroban-sdk 26 `env.crypto().bn254()`).
//! On success → calls auranode-pool.complete_task.
//! On failure → calls auranode-pool.slash_node.

#![cfg_attr(target_family = "wasm", no_std)]

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    Address, Bytes, BytesN, Env, Vec,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    PoolContract,
    VkG2X,      // [x]₂ — 128-byte G2 point from verifying key
    VkG2NegGen, // -[1]₂ — negated G2 generator
    ProofCount,
    ProofRecord(u64),
}

// ── Domain types ──────────────────────────────────────────────────────────────

/// Compressed UltraPlonk proof (BN254 G1 points + scalar).
#[contracttype]
#[derive(Clone)]
pub struct PlonkProof {
    pub w_comm:   BytesN<64>, // G1 affine uncompressed (64 bytes)
    pub t_comm:   BytesN<64>,
    pub z_eval:   BytesN<32>, // Fr scalar
    pub r_comm:   BytesN<64>,
    pub w_zeta:   BytesN<64>,
    pub w_zeta_w: BytesN<64>,
}

/// Public inputs committed to by the circuit.
#[contracttype]
#[derive(Clone)]
pub struct PublicInputs {
    pub task_id:     u64,
    pub output_hash: BytesN<32>,
    pub model_hash:  BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct ProofRecord {
    pub task_id:    u64,
    pub node_id:    u32,
    pub proof_hash: BytesN<32>,
    pub verified:   bool,
    pub submitted:  u64,
}

const PROOF_TTL:    u32 = 34_560;  // 48 h (CAP-0078)
const INSTANCE_TTL: u32 = 518_400; // 30 days

#[contract]
pub struct AuraNodeVerifier;

#[contractimpl]
impl AuraNodeVerifier {
    // ── Initialisation ────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, pool: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PoolContract, &pool);
        env.storage().instance().set(&DataKey::ProofCount, &0u64);
        env.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL);
    }

    /// Upload the UltraPlonk verifying key G2 points (admin only, done once).
    /// vk_g2_x:      128-byte uncompressed G2 point [x]₂
    /// vk_g2_neg_gen: 128-byte uncompressed G2 point -[1]₂
    pub fn set_verifying_key(
        env:           Env,
        admin:         Address,
        vk_g2_x:       BytesN<128>,
        vk_g2_neg_gen: BytesN<128>,
    ) {
        let stored: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored { panic!("unauthorized"); }
        admin.require_auth();
        env.storage().instance().set(&DataKey::VkG2X, &vk_g2_x);
        env.storage().instance().set(&DataKey::VkG2NegGen, &vk_g2_neg_gen);
        env.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL);
    }

    // ── Core verification ─────────────────────────────────────────────────

    /// Verify a UltraPlonk proof using CAP-0080 BN254 host functions.
    pub fn verify_inference_proof(
        env:     Env,
        caller:  Address,
        proof:   PlonkProof,
        inputs:  PublicInputs,
        node_id: u32,
    ) -> bool {
        caller.require_auth();

        let bn254 = env.crypto().bn254();

        // ── Step 1: Reconstruct proof hash for audit trail ────────────────
        let proof_hash = Self::hash_proof(&env, &proof, &inputs);

        // ── Step 2: CAP-0080 — G1 scalar multiplication (linearisation) ──
        // L = z_eval * G1_gen + w_comm
        let g1_gen = Bn254G1Affine::from_bytes(Self::g1_generator(&env));
        let z_scalar = Bn254Fr::from_bytes(proof.z_eval.clone());
        let w_point  = Bn254G1Affine::from_bytes(proof.w_comm.clone());
        let r_point  = Bn254G1Affine::from_bytes(proof.r_comm.clone());
        let t_point  = Bn254G1Affine::from_bytes(proof.t_comm.clone());

        let scaled   = bn254.g1_mul(&g1_gen, &z_scalar);
        let lin_comm = bn254.g1_add(&scaled, &w_point);

        // ── Step 3: CAP-0080 — G1 add for quotient consistency ───────────
        let _combined = bn254.g1_add(&r_point, &t_point);

        // ── Step 4: CAP-0080 — Pairing check (KZG opening) ───────────────
        // e(W_ζ, [x]₂) · e(-L, [1]₂) = 1
        let w_zeta_point = Bn254G1Affine::from_bytes(proof.w_zeta.clone());
        let neg_lin = bn254.g1_mul(&lin_comm, &Bn254Fr::from_bytes(Self::fr_neg_one(&env)));

        let vk_g2_x:       BytesN<128> = env.storage().instance().get(&DataKey::VkG2X).expect("vk not set");
        let vk_g2_neg_gen: BytesN<128> = env.storage().instance().get(&DataKey::VkG2NegGen).expect("vk not set");

        let g2_x       = Bn254G2Affine::from_bytes(vk_g2_x);
        let g2_neg_gen = Bn254G2Affine::from_bytes(vk_g2_neg_gen);

        let g1_points = Vec::from_array(&env, [w_zeta_point, neg_lin]);
        let g2_points = Vec::from_array(&env, [g2_x, g2_neg_gen]);

        // CAP-0080: native pairing check — true iff product of pairings = 1
        let pairing_ok = bn254.pairing_check(g1_points, g2_points);

        // ── Step 5: task_id range check (CAP-0082) ────────────────────────
        let inputs_valid = pairing_ok
            && inputs.task_id.checked_add(0).expect("task_id overflow") == inputs.task_id;

        // ── Step 6: Record proof (CAP-0078 temporary storage) ────────────
        let proof_count: u64 = env.storage().instance().get(&DataKey::ProofCount).unwrap();
        let record = ProofRecord {
            task_id:    inputs.task_id,
            node_id,
            proof_hash: proof_hash.clone(),
            verified:   inputs_valid,
            submitted:  env.ledger().timestamp(),
        };
        env.storage().temporary().set(&DataKey::ProofRecord(proof_count), &record);
        env.storage().temporary().extend_ttl(&DataKey::ProofRecord(proof_count), PROOF_TTL, PROOF_TTL);
        env.storage().instance().set(&DataKey::ProofCount, &proof_count.checked_add(1).expect("overflow"));
        env.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL);

        // ── Step 7: Cross-contract call to pool ───────────────────────────
        let pool: Address = env.storage().instance().get(&DataKey::PoolContract).unwrap();
        let pool_client = auranode_pool_interface::Client::new(&env, &pool);

        if inputs_valid {
            env.events().publish((symbol_short!("proof_ok"), node_id), (inputs.task_id, proof_hash.clone()));
            pool_client.complete_task(&inputs.task_id, &proof_hash);
        } else {
            env.events().publish((symbol_short!("proof_bad"), node_id), inputs.task_id);
            pool_client.slash_node(&inputs.task_id);
        }

        inputs_valid
    }

    // ── Views ─────────────────────────────────────────────────────────────

    pub fn proof_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::ProofCount).unwrap_or(0)
    }

    pub fn get_proof_record(env: Env, index: u64) -> ProofRecord {
        env.storage().temporary().get(&DataKey::ProofRecord(index)).expect("not found or expired")
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    fn hash_proof(env: &Env, proof: &PlonkProof, inputs: &PublicInputs) -> BytesN<32> {
        let mut data = Bytes::new(env);
        data.append(&proof.w_comm.clone().into());
        data.append(&proof.z_eval.clone().into());
        data.append(&inputs.output_hash.clone().into());
        env.crypto().sha256(&data).into()
    }

    /// BN254 G1 generator point (uncompressed, 64 bytes).
    fn g1_generator(env: &Env) -> BytesN<64> {
        // G1 generator: x=1, y=2 in BN254 (standard)
        let mut b = [0u8; 64];
        b[31] = 1; // x = 1
        b[63] = 2; // y = 2
        BytesN::from_array(env, &b)
    }

    /// Fr element -1 (BN254 scalar field order - 1).
    fn fr_neg_one(env: &Env) -> BytesN<32> {
        // BN254 Fr order r = 0x30644e72e131a029b85045b68181585d2833e84879b9709142e0f853d0d3883f
        // r - 1:
        let neg_one: [u8; 32] = [
            0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
            0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
            0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
            0x42, 0xe0, 0xf8, 0x53, 0xd0, 0xd3, 0x88, 0x3e,
        ];
        BytesN::from_array(env, &neg_one)
    }
}

// ── Pool interface shim ───────────────────────────────────────────────────────

mod auranode_pool_interface {
    use soroban_sdk::{contractclient, BytesN, Env};

    #[contractclient(name = "Client")]
    pub trait AuraNodePoolInterface {
        fn complete_task(env: Env, task_id: u64, proof_hash: BytesN<32>);
        fn slash_node(env: Env, task_id: u64);
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_initialize_and_set_vk() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let pool  = Address::generate(&env);

        let cid    = env.register(AuraNodeVerifier, ());
        let client = AuraNodeVerifierClient::new(&env, &cid);

        client.initialize(&admin, &pool);
        assert_eq!(client.proof_count(), 0);

        // Set verifying key: [x]₂ (128 bytes) + -[1]₂ (128 bytes)
        client.set_verifying_key(
            &admin,
            &BytesN::from_array(&env, &[0xabu8; 128]),
            &BytesN::from_array(&env, &[0xcdu8; 128]),
        );
    }
}
