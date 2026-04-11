// EnclaveAI Smart Contract for Stellar Soroban
// This contract manages the decentralized AI processing network

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec, Map, BytesN};

// Contract data keys
const ADMIN: Symbol = Symbol::short("ADMIN");
const TEE_NODES: Symbol = Symbol::short("TEE_NODES");
const PROCESSING_REQUESTS: Symbol = Symbol::short("REQS");
const NETWORK_STATS: Symbol = Symbol::short("STATS");
const MIN_STAKE: Symbol = Symbol::short("MIN_STK");

// TEE Node structure
#[derive(Clone)]
pub struct TEENode {
    pub operator: Address,
    pub endpoint: String,
    pub public_key: BytesN<32>,
    pub stake_amount: i128,
    pub is_active: bool,
    pub reputation_score: u32,
    pub last_heartbeat: u64,
}

// Processing Request structure
#[derive(Clone)]
pub struct ProcessingRequest {
    pub client: Address,
    pub node_id: u32,
    pub request_hash: BytesN<32>,
    pub fee_paid: i128,
    pub status: u8, // 0: pending, 1: processing, 2: completed, 3: failed
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

// Network Statistics
#[derive(Clone)]
pub struct NetworkStats {
    pub total_requests: u64,
    pub completed_requests: u64,
    pub failed_requests: u64,
    pub total_nodes: u32,
    pub active_nodes: u32,
}

#[contract]
pub struct EnclaveAIContract;

#[contractimpl]
impl EnclaveAIContract {
    // Initialize the contract
    pub fn initialize(env: Env, admin: Address, min_stake: i128) {
        // Only allow initialization once
        if env.storage().instance().has(&ADMIN) {
            panic!("Contract already initialized");
        }

        // Set admin
        env.storage().instance().set(&ADMIN, &admin);
        
        // Set minimum stake amount
        env.storage().instance().set(&MIN_STAKE, &min_stake);
        
        // Initialize empty collections
        env.storage().instance().set(&TEE_NODES, &Vec::<TEENode>::new(&env));
        env.storage().instance().set(&PROCESSING_REQUESTS, &Vec::<ProcessingRequest>::new(&env));
        
        // Initialize network stats
        let stats = NetworkStats {
            total_requests: 0,
            completed_requests: 0,
            failed_requests: 0,
            total_nodes: 0,
            active_nodes: 0,
        };
        env.storage().instance().set(&NETWORK_STATS, &stats);
    }

    // Register a new TEE node
    pub fn register_node(
        env: Env,
        operator: Address,
        endpoint: String,
        public_key: BytesN<32>,
        stake_amount: i128,
    ) -> u32 {
        let min_stake: i128 = env.storage().instance().get(&MIN_STAKE).unwrap_or(1000000000); // Default 0.1 XLM
        
        // Check stake amount
        if stake_amount < min_stake {
            panic!("Insufficient stake amount");
        }

        let mut nodes: Vec<TEENode> = env.storage().instance().get(&TEE_NODES).unwrap();
        
        // Generate node ID
        let node_id = nodes.len() as u32;
        
        // Create new node
        let node = TEENode {
            operator,
            endpoint,
            public_key,
            stake_amount,
            is_active: false, // Requires admin approval
            reputation_score: 100, // Start with perfect reputation
            last_heartbeat: env.ledger().timestamp(),
        };
        
        nodes.push_back(node);
        env.storage().instance().set(&TEE_NODES, &nodes);
        
        // Update stats
        let mut stats: NetworkStats = env.storage().instance().get(&NETWORK_STATS).unwrap();
        stats.total_nodes += 1;
        env.storage().instance().set(&NETWORK_STATS, &stats);
        
        node_id
    }

    // Approve a TEE node (admin only)
    pub fn approve_node(env: Env, admin: Address, node_id: u32) {
        // Verify admin
        let contract_admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        if admin != contract_admin {
            panic!("Unauthorized: Only admin can approve nodes");
        }

        let mut nodes: Vec<TEENode> = env.storage().instance().get(&TEE_NODES).unwrap();
        
        if node_id >= nodes.len() as u32 {
            panic!("Invalid node ID");
        }
        
        nodes.get(node_id as u32).unwrap().is_active = true;
        env.storage().instance().set(&TEE_NODES, &nodes);
        
        // Update stats
        let mut stats: NetworkStats = env.storage().instance().get(&NETWORK_STATS).unwrap();
        stats.active_nodes += 1;
        env.storage().instance().set(&NETWORK_STATS, &stats);
    }

    // Submit a processing request
    pub fn submit_request(
        env: Env,
        client: Address,
        request_hash: BytesN<32>,
        fee_paid: i128,
    ) -> u64 {
        let mut requests: Vec<ProcessingRequest> = env.storage().instance().get(&PROCESSING_REQUESTS).unwrap();
        let nodes: Vec<TEENode> = env.storage().instance().get(&TEE_NODES).unwrap();
        
        // Find available node
        let mut available_node_id: Option<u32> = None;
        for (i, node) in nodes.iter().enumerate() {
            if node.is_active {
                available_node_id = Some(i as u32);
                break;
            }
        }
        
        let node_id = available_node_id.expect("No available TEE nodes");
        
        // Create request
        let request_id = requests.len() as u64;
        let request = ProcessingRequest {
            client,
            node_id,
            request_hash,
            fee_paid,
            status: 0, // pending
            created_at: env.ledger().timestamp(),
            completed_at: None,
        };
        
        requests.push_back(request);
        env.storage().instance().set(&PROCESSING_REQUESTS, &requests);
        
        // Update stats
        let mut stats: NetworkStats = env.storage().instance().get(&NETWORK_STATS).unwrap();
        stats.total_requests += 1;
        env.storage().instance().set(&NETWORK_STATS, &stats);
        
        request_id
    }

    // Update request status (called by TEE node)
    pub fn update_request_status(
        env: Env,
        node_operator: Address,
        request_id: u64,
        status: u8,
    ) {
        let mut requests: Vec<ProcessingRequest> = env.storage().instance().get(&PROCESSING_REQUESTS).unwrap();
        let nodes: Vec<TEENode> = env.storage().instance().get(&TEE_NODES).unwrap();
        
        if request_id >= requests.len() as u64 {
            panic!("Invalid request ID");
        }
        
        let request = requests.get(request_id as u32).unwrap();
        let node = nodes.get(request.node_id).unwrap();
        
        // Verify node operator
        if node.operator != node_operator {
            panic!("Unauthorized: Invalid node operator");
        }
        
        // Update request
        let mut updated_request = request.clone();
        updated_request.status = status;
        if status == 2 || status == 3 { // completed or failed
            updated_request.completed_at = Some(env.ledger().timestamp());
        }
        
        requests.set(request_id as u32, updated_request);
        env.storage().instance().set(&PROCESSING_REQUESTS, &requests);
        
        // Update stats
        let mut stats: NetworkStats = env.storage().instance().get(&NETWORK_STATS).unwrap();
        if status == 2 {
            stats.completed_requests += 1;
        } else if status == 3 {
            stats.failed_requests += 1;
        }
        env.storage().instance().set(&NETWORK_STATS, &stats);
    }

    // Node heartbeat
    pub fn node_heartbeat(env: Env, node_operator: Address) {
        let mut nodes: Vec<TEENode> = env.storage().instance().get(&TEE_NODES).unwrap();
        
        for (i, node) in nodes.iter().enumerate() {
            if node.operator == node_operator {
                let mut updated_node = node.clone();
                updated_node.last_heartbeat = env.ledger().timestamp();
                nodes.set(i as u32, updated_node);
                env.storage().instance().set(&TEE_NODES, &nodes);
                return;
            }
        }
        
        panic!("Node not found");
    }

    // Get network statistics
    pub fn get_network_stats(env: Env) -> NetworkStats {
        env.storage().instance().get(&NETWORK_STATS).unwrap()
    }

    // Get all TEE nodes
    pub fn get_tee_nodes(env: Env) -> Vec<TEENode> {
        env.storage().instance().get(&TEE_NODES).unwrap()
    }

    // Get processing requests for a client
    pub fn get_client_requests(env: Env, client: Address) -> Vec<ProcessingRequest> {
        let all_requests: Vec<ProcessingRequest> = env.storage().instance().get(&PROCESSING_REQUESTS).unwrap();
        let mut client_requests = Vec::<ProcessingRequest>::new(&env);
        
        for request in all_requests.iter() {
            if request.client == client {
                client_requests.push_back(request.clone());
            }
        }
        
        client_requests
    }

    // Update node reputation (admin only)
    pub fn update_node_reputation(
        env: Env,
        admin: Address,
        node_id: u32,
        new_score: u32,
    ) {
        let contract_admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        if admin != contract_admin {
            panic!("Unauthorized: Only admin can update reputation");
        }

        let mut nodes: Vec<TEENode> = env.storage().instance().get(&TEE_NODES).unwrap();
        
        if node_id >= nodes.len() as u32 {
            panic!("Invalid node ID");
        }
        
        let mut node = nodes.get(node_id).unwrap().clone();
        node.reputation_score = new_score;
        nodes.set(node_id, node);
        env.storage().instance().set(&TEE_NODES, &nodes);
    }

    // Remove a node (admin only)
    pub fn remove_node(env: Env, admin: Address, node_id: u32) {
        let contract_admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        if admin != contract_admin {
            panic!("Unauthorized: Only admin can remove nodes");
        }

        let mut nodes: Vec<TEENode> = env.storage().instance().get(&TEE_NODES).unwrap();
        
        if node_id >= nodes.len() as u32 {
            panic!("Invalid node ID");
        }
        
        let node = nodes.get(node_id).unwrap();
        
        // Remove node
        nodes.remove(node_id as u32);
        env.storage().instance().set(&TEE_NODES, &nodes);
        
        // Update stats
        let mut stats: NetworkStats = env.storage().instance().get(&NETWORK_STATS).unwrap();
        stats.total_nodes -= 1;
        if node.is_active {
            stats.active_nodes -= 1;
        }
        env.storage().instance().set(&NETWORK_STATS, &stats);
    }
}
