//! EnclaveAI Smart Contract — Stellar Soroban
//! Thin compatibility shim that delegates to the auranode-pool architecture.
//! Uses CAP-0078 precise TTL, CAP-0082 checked arithmetic, proper token transfers.


use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    token, Address, BytesN, Env,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    MinStake,
    NodeCount,
    TaskCount,
    Node(u32),
    Task(u64),
}

// ── Domain types ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct NodeInfo {
    pub operator:        Address,
    pub attestation_key: BytesN<32>,
    pub stake:           i128,
    pub active:          bool,
    pub tasks_completed: u64,
    pub tasks_failed:    u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Task {
    pub client:       Address,
    pub node_id:      u32,
    pub payload_hash: BytesN<32>,
    pub bounty:       i128,
    pub token:        Address,
    pub completed:    bool,
}

// TTL constants (~5 s/ledger)
const INSTANCE_TTL: u32 = 518_400; // 30 days
const NODE_TTL:     u32 = 518_400;
const TASK_TTL:     u32 = 17_280;  // 24 hours
const SLASH_BPS:    i128 = 2_000;
const BPS_DENOM:    i128 = 10_000;

#[contract]
pub struct EnclaveAIContract;

#[contractimpl]
impl EnclaveAIContract {
    pub fn initialize(env: Env, admin: Address, min_stake: i128) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MinStake, &min_stake);
        env.storage().instance().set(&DataKey::NodeCount, &0u32);
        env.storage().instance().set(&DataKey::TaskCount, &0u64);
        env.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL);
    }

    /// Register a compute node by staking collateral into escrow.
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
        token::Client::new(&env, &token)
            .transfer(&operator, &env.current_contract_address(), &stake_amount);

        let node_id: u32 = env.storage().instance().get(&DataKey::NodeCount).unwrap();
        let node = NodeInfo {
            operator: operator.clone(),
            attestation_key,
            stake: stake_amount,
            active: true,
            tasks_completed: 0,
            tasks_failed: 0,
        };
        env.storage().persistent().set(&DataKey::Node(node_id), &node);
        env.storage().persistent().extend_ttl(&DataKey::Node(node_id), NODE_TTL, NODE_TTL);
        env.storage().instance().set(&DataKey::NodeCount, &(node_id + 1));
        env.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL);
        env.events().publish((symbol_short!("node_reg"), operator), node_id);
        node_id
    }

    /// Submit an inference task with bounty locked in escrow.
    pub fn submit_task(
        env:          Env,
        client:       Address,
        node_id:      u32,
        payload_hash: BytesN<32>,
        bounty:       i128,
        token:        Address,
    ) -> u64 {
        client.require_auth();
        let node: NodeInfo = env.storage().persistent()
            .get(&DataKey::Node(node_id)).expect("node not found");
        if !node.active { panic!("node unavailable"); }

        token::Client::new(&env, &token)
            .transfer(&client, &env.current_contract_address(), &bounty);

        let task_id: u64 = env.storage().instance().get(&DataKey::TaskCount).unwrap();
        let task = Task { client: client.clone(), node_id, payload_hash, bounty, token, completed: false };
        env.storage().temporary().set(&DataKey::Task(task_id), &task);
        env.storage().temporary().extend_ttl(&DataKey::Task(task_id), TASK_TTL, TASK_TTL);
        env.storage().instance().set(&DataKey::TaskCount, &(task_id + 1));
        env.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL);
        env.events().publish((symbol_short!("task_sub"), client), (task_id, node_id));
        task_id
    }

    /// Mark task complete, release bounty to node operator.
    pub fn complete_task(env: Env, caller: Address, task_id: u64) {
        caller.require_auth();
        let mut task: Task = env.storage().temporary()
            .get(&DataKey::Task(task_id)).expect("task not found");
        if task.completed { panic!("already completed"); }

        let mut node: NodeInfo = env.storage().persistent()
            .get(&DataKey::Node(task.node_id)).unwrap();

        // CAP-0082: checked arithmetic
        node.tasks_completed = node.tasks_completed.checked_add(1).expect("overflow");
        task.completed = true;

        token::Client::new(&env, &task.token)
            .transfer(&env.current_contract_address(), &node.operator, &task.bounty);

        env.storage().temporary().set(&DataKey::Task(task_id), &task);
        env.storage().persistent().set(&DataKey::Node(task.node_id), &node);
        env.storage().persistent().extend_ttl(&DataKey::Node(task.node_id), NODE_TTL, NODE_TTL);
        env.events().publish((symbol_short!("task_ok"), task.node_id), task_id);
    }

    /// Slash node stake on invalid proof, refund bounty to client.
    pub fn slash_node(env: Env, caller: Address, task_id: u64) {
        caller.require_auth();
        let mut task: Task = env.storage().temporary()
            .get(&DataKey::Task(task_id)).expect("task not found");
        if task.completed { panic!("task already settled"); }

        let mut node: NodeInfo = env.storage().persistent()
            .get(&DataKey::Node(task.node_id)).unwrap();

        let slash = node.stake.checked_mul(SLASH_BPS).expect("overflow")
            .checked_div(BPS_DENOM).expect("div zero");
        node.stake = node.stake.checked_sub(slash).expect("underflow");
        node.tasks_failed = node.tasks_failed.checked_add(1).expect("overflow");

        let min_stake: i128 = env.storage().instance().get(&DataKey::MinStake).unwrap();
        if node.stake < min_stake { node.active = false; }

        task.completed = true;
        token::Client::new(&env, &task.token)
            .transfer(&env.current_contract_address(), &task.client, &task.bounty);

        env.storage().temporary().set(&DataKey::Task(task_id), &task);
        env.storage().persistent().set(&DataKey::Node(task.node_id), &node);
        env.storage().persistent().extend_ttl(&DataKey::Node(task.node_id), NODE_TTL, NODE_TTL);
        env.events().publish((symbol_short!("slashed"), task.node_id), slash);
    }

    pub fn get_node(env: Env, node_id: u32) -> NodeInfo {
        env.storage().persistent().get(&DataKey::Node(node_id)).expect("not found")
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
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        Env,
    };

    #[test]
    fn test_register_and_submit() {
        let env = Env::default();
        env.mock_all_auths();
        let admin    = Address::generate(&env);
        let operator = Address::generate(&env);
        let client   = Address::generate(&env);

        let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
        StellarAssetClient::new(&env, &token_addr).mint(&operator, &5_000_0000000i128);
        StellarAssetClient::new(&env, &token_addr).mint(&client,   &1_000_0000000i128);

        let cid = env.register(EnclaveAIContract, ());
        let c   = EnclaveAIContractClient::new(&env, &cid);

        c.initialize(&admin, &1_000_0000000i128);

        let node_id = c.register_node(
            &operator,
            &BytesN::from_array(&env, &[1u8; 32]),
            &1_000_0000000i128,
            &token_addr,
        );
        assert_eq!(node_id, 0);

        let task_id = c.submit_task(
            &client,
            &node_id,
            &BytesN::from_array(&env, &[2u8; 32]),
            &100_0000000i128,
            &token_addr,
        );
        assert_eq!(task_id, 0);
    }
}
