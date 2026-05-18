//! AuraNode Pool Contract
//! Handles node registration, collateral staking, task escrow, bounty distribution,
//! and automatic slashing. Uses CAP-0078 precise TTL controls for storage rent.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    token, Address, BytesN, Env, Symbol,
};

// ── Storage key types ────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    VerifierContract,
    MinStake,
    NodeCount,
    Node(u32),
    TaskCount,
    Task(u64),
    NodeTask(u32),   // active task assigned to node
}

// ── Domain types ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct NodeInfo {
    pub operator:        Address,
    pub attestation_key: BytesN<32>,  // SGX report public key
    pub stake:           i128,
    pub active:          bool,
    pub slashed:         bool,
    pub tasks_completed: u64,
    pub tasks_failed:    u64,
    pub registered_at:   u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Task {
    pub client:       Address,
    pub node_id:      u32,
    pub payload_hash: BytesN<32>,  // SHA-256 of encrypted payload
    pub bounty:       i128,
    pub token:        Address,
    pub status:       TaskStatus,
    pub created_at:   u64,
    pub proof_hash:   BytesN<32>,  // filled on completion
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum TaskStatus {
    Pending,
    Assigned,
    Completed,
    Failed,
    Disputed,
}

// TTL constants (ledgers). ~5s/ledger on Stellar.
const TASK_TTL_LEDGERS:    u32 = 17_280;  // ~24 hours
const NODE_TTL_LEDGERS:    u32 = 518_400; // ~30 days
const INSTANCE_TTL_LEDGERS: u32 = 518_400;

const SLASH_BPS: i128 = 2_000; // 20% slash on failure
const BPS_DENOM: i128 = 10_000;

#[contract]
pub struct AuraNodePool;

#[contractimpl]
impl AuraNodePool {
    // ── Initialisation ────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, verifier: Address, min_stake: i128) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VerifierContract, &verifier);
        env.storage().instance().set(&DataKey::MinStake, &min_stake);
        env.storage().instance().set(&DataKey::NodeCount, &0u32);
        env.storage().instance().set(&DataKey::TaskCount, &0u64);
        // CAP-0078: set precise TTL on instance storage
        env.storage().instance().extend_ttl(INSTANCE_TTL_LEDGERS, INSTANCE_TTL_LEDGERS);
    }

    // ── Node registration ─────────────────────────────────────────────────

    /// Register a compute node by staking collateral.
    pub fn register_node(
        env:             Env,
        operator:        Address,
        attestation_key: BytesN<32>,
        stake_amount:    i128,
        token:           Address,
    ) -> u32 {
        operator.require_auth();

        let min_stake: i128 = env.storage().instance().get(&DataKey::MinStake).unwrap();
        if stake_amount < min_stake {
            panic!("stake below minimum");
        }

        // Transfer stake into contract escrow
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&operator, &env.current_contract_address(), &stake_amount);

        let node_id: u32 = env.storage().instance().get(&DataKey::NodeCount).unwrap();

        let node = NodeInfo {
            operator:        operator.clone(),
            attestation_key,
            stake:           stake_amount,
            active:          true,
            slashed:         false,
            tasks_completed: 0,
            tasks_failed:    0,
            registered_at:   env.ledger().timestamp(),
        };

        // CAP-0078: per-node persistent storage with explicit TTL
        env.storage().persistent().set(&DataKey::Node(node_id), &node);
        env.storage().persistent().extend_ttl(
            &DataKey::Node(node_id),
            NODE_TTL_LEDGERS,
            NODE_TTL_LEDGERS,
        );

        env.storage().instance().set(&DataKey::NodeCount, &(node_id + 1));
        env.storage().instance().extend_ttl(INSTANCE_TTL_LEDGERS, INSTANCE_TTL_LEDGERS);

        env.events().publish(
            (symbol_short!("node_reg"), operator),
            node_id,
        );

        node_id
    }

    // ── Task lifecycle ────────────────────────────────────────────────────

    /// Client submits an inference task with bounty in escrow.
    pub fn submit_task(
        env:          Env,
        client:       Address,
        node_id:      u32,
        payload_hash: BytesN<32>,
        bounty:       i128,
        token:        Address,
    ) -> u64 {
        client.require_auth();

        let node: NodeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Node(node_id))
            .expect("node not found");

        if !node.active || node.slashed {
            panic!("node unavailable");
        }

        // Lock bounty in contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&client, &env.current_contract_address(), &bounty);

        let task_id: u64 = env.storage().instance().get(&DataKey::TaskCount).unwrap();

        let task = Task {
            client:       client.clone(),
            node_id,
            payload_hash,
            bounty,
            token,
            status:       TaskStatus::Assigned,
            created_at:   env.ledger().timestamp(),
            proof_hash:   BytesN::from_array(&env, &[0u8; 32]),
        };

        // CAP-0078: temporary storage for active tasks — auto-purged after TTL
        env.storage().temporary().set(&DataKey::Task(task_id), &task);
        env.storage().temporary().extend_ttl(
            &DataKey::Task(task_id),
            TASK_TTL_LEDGERS,
            TASK_TTL_LEDGERS,
        );

        env.storage().instance().set(&DataKey::TaskCount, &(task_id + 1));
        env.storage().instance().extend_ttl(INSTANCE_TTL_LEDGERS, INSTANCE_TTL_LEDGERS);

        env.events().publish(
            (symbol_short!("task_sub"), client),
            (task_id, node_id),
        );

        task_id
    }

    /// Called by the verifier contract after successful ZK proof verification.
    /// Releases bounty to node operator.
    pub fn complete_task(
        env:        Env,
        task_id:    u64,
        proof_hash: BytesN<32>,
    ) {
        // Only the registered verifier contract may call this
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::VerifierContract)
            .unwrap();
        verifier.require_auth();

        let mut task: Task = env
            .storage()
            .temporary()
            .get(&DataKey::Task(task_id))
            .expect("task not found");

        if task.status != TaskStatus::Assigned {
            panic!("task not in assigned state");
        }

        let mut node: NodeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Node(task.node_id))
            .unwrap();

        task.status     = TaskStatus::Completed;
        task.proof_hash = proof_hash;

        // CAP-0082: checked arithmetic for reward calculation
        node.tasks_completed = node.tasks_completed.checked_add(1).expect("overflow");

        // Pay bounty to operator
        let token_client = token::Client::new(&env, &task.token);
        token_client.transfer(
            &env.current_contract_address(),
            &node.operator,
            &task.bounty,
        );

        env.storage().temporary().set(&DataKey::Task(task_id), &task);
        env.storage().persistent().set(&DataKey::Node(task.node_id), &node);
        env.storage().persistent().extend_ttl(
            &DataKey::Node(task.node_id),
            NODE_TTL_LEDGERS,
            NODE_TTL_LEDGERS,
        );

        env.events().publish(
            (symbol_short!("task_ok"), task.node_id),
            task_id,
        );
    }

    /// Slash a node that submitted an invalid proof. Called by verifier on failure.
    pub fn slash_node(env: Env, task_id: u64) {
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::VerifierContract)
            .unwrap();
        verifier.require_auth();

        let mut task: Task = env
            .storage()
            .temporary()
            .get(&DataKey::Task(task_id))
            .expect("task not found");

        if task.status != TaskStatus::Assigned {
            panic!("task not slashable");
        }

        let mut node: NodeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Node(task.node_id))
            .unwrap();

        // CAP-0082: checked arithmetic for slash amount
        let slash_amount = node
            .stake
            .checked_mul(SLASH_BPS)
            .expect("overflow")
            .checked_div(BPS_DENOM)
            .expect("div zero");

        node.stake = node.stake.checked_sub(slash_amount).expect("underflow");
        node.tasks_failed = node.tasks_failed.checked_add(1).expect("overflow");

        // Deactivate node if stake falls below minimum
        let min_stake: i128 = env.storage().instance().get(&DataKey::MinStake).unwrap();
        if node.stake < min_stake {
            node.active  = false;
            node.slashed = true;
        }

        task.status = TaskStatus::Failed;

        // Refund bounty to client
        let token_client = token::Client::new(&env, &task.token);
        token_client.transfer(
            &env.current_contract_address(),
            &task.client,
            &task.bounty,
        );

        env.storage().temporary().set(&DataKey::Task(task_id), &task);
        env.storage().persistent().set(&DataKey::Node(task.node_id), &node);
        env.storage().persistent().extend_ttl(
            &DataKey::Node(task.node_id),
            NODE_TTL_LEDGERS,
            NODE_TTL_LEDGERS,
        );

        env.events().publish(
            (symbol_short!("slashed"), task.node_id),
            slash_amount,
        );
    }

    // ── Views ─────────────────────────────────────────────────────────────

    pub fn get_node(env: Env, node_id: u32) -> NodeInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Node(node_id))
            .expect("node not found")
    }

    pub fn get_task(env: Env, task_id: u64) -> Task {
        env.storage()
            .temporary()
            .get(&DataKey::Task(task_id))
            .expect("task not found")
    }

    pub fn node_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::NodeCount).unwrap_or(0)
    }

    pub fn task_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::TaskCount).unwrap_or(0)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Env,
    };

    fn setup() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin    = Address::generate(&env);
        let verifier = Address::generate(&env);
        let operator = Address::generate(&env);
        let client   = Address::generate(&env);

        (env, admin, verifier, operator, client)
    }

    fn create_token(env: &Env, admin: &Address) -> Address {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        token_id.address()
    }

    #[test]
    fn test_register_and_submit() {
        let (env, admin, verifier, operator, client) = setup();
        let token_addr = create_token(&env, &admin);

        // Mint tokens
        let stellar_asset = StellarAssetClient::new(&env, &token_addr);
        stellar_asset.mint(&operator, &10_000_0000000i128);
        stellar_asset.mint(&client,   &1_000_0000000i128);

        let pool_id = env.register(AuraNodePool, ());
        let pool    = AuraNodePoolClient::new(&env, &pool_id);

        pool.initialize(&admin, &verifier, &1_000_0000000i128);

        let node_id = pool.register_node(
            &operator,
            &BytesN::from_array(&env, &[1u8; 32]),
            &1_000_0000000i128,
            &token_addr,
        );
        assert_eq!(node_id, 0);

        let task_id = pool.submit_task(
            &client,
            &node_id,
            &BytesN::from_array(&env, &[2u8; 32]),
            &100_0000000i128,
            &token_addr,
        );
        assert_eq!(task_id, 0);

        let task = pool.get_task(&task_id);
        assert_eq!(task.status, TaskStatus::Assigned);
    }

    #[test]
    fn test_slash_on_failure() {
        let (env, admin, verifier, operator, client) = setup();
        let token_addr = create_token(&env, &admin);

        let stellar_asset = StellarAssetClient::new(&env, &token_addr);
        stellar_asset.mint(&operator, &10_000_0000000i128);
        stellar_asset.mint(&client,   &1_000_0000000i128);

        let pool_id = env.register(AuraNodePool, ());
        let pool    = AuraNodePoolClient::new(&env, &pool_id);

        pool.initialize(&admin, &verifier, &1_000_0000000i128);

        let node_id = pool.register_node(
            &operator,
            &BytesN::from_array(&env, &[1u8; 32]),
            &5_000_0000000i128,
            &token_addr,
        );

        let task_id = pool.submit_task(
            &client,
            &node_id,
            &BytesN::from_array(&env, &[2u8; 32]),
            &100_0000000i128,
            &token_addr,
        );

        pool.slash_node(&task_id);

        let node = pool.get_node(&node_id);
        // 20% of 5_000 = 1_000 slashed → remaining 4_000
        assert_eq!(node.stake, 4_000_0000000i128);
        assert_eq!(node.tasks_failed, 1);
    }
}
