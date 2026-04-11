const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const StellarSDK = require('stellar-sdk');
const crypto = require('crypto');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Configure logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize Stellar
const server = new StellarSDK.Server(process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org');
const networkPassphrase = StellarSDK.Networks.TESTNET;

// In-memory storage (replace with database in production)
const processingRequests = new Map();
const teeNodes = new Map();

// TEE Node management
class TEENode {
  constructor(id, publicKey, endpoint) {
    this.id = id;
    this.publicKey = publicKey;
    this.endpoint = endpoint;
    this.isOnline = false;
    this.lastHeartbeat = Date.now();
    this.processingCount = 0;
  }

  async heartbeat() {
    this.lastHeartbeat = Date.now();
    this.isOnline = true;
  }

  isHealthy() {
    return this.isOnline && (Date.now() - this.lastHeartbeat) < 60000; // 1 minute timeout
  }
}

// Initialize sample TEE nodes
function initializeTEENodes() {
  const nodes = [
    { id: 'tee-node-1', publicKey: 'TEE_NODE_1_PUB_KEY', endpoint: 'https://tee-node-1.enclave.ai' },
    { id: 'tee-node-2', publicKey: 'TEE_NODE_2_PUB_KEY', endpoint: 'https://tee-node-2.enclave.ai' },
    { id: 'tee-node-3', publicKey: 'TEE_NODE_3_PUB_KEY', endpoint: 'https://tee-node-3.enclave.ai' }
  ];

  nodes.forEach(node => {
    teeNodes.set(node.id, new TEENode(node.id, node.publicKey, node.endpoint));
  });

  logger.info(`Initialized ${teeNodes.size} TEE nodes`);
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Get network status
app.get('/api/network/status', (req, res) => {
  const healthyNodes = Array.from(teeNodes.values()).filter(node => node.isHealthy());
  
  res.json({
    totalNodes: teeNodes.size,
    healthyNodes: healthyNodes.length,
    activeNodes: healthyNodes.length,
    networkHealth: healthyNodes.length > 0 ? (healthyNodes.length / teeNodes.size) * 100 : 0,
    nodes: Array.from(teeNodes.values()).map(node => ({
      id: node.id,
      isOnline: node.isOnline,
      processingCount: node.processingCount,
      lastHeartbeat: node.lastHeartbeat
    }))
  });
});

// Submit processing request
app.post('/api/process', async (req, res) => {
  try {
    const { data, publicKey, stellarAccount } = req.body;

    if (!data || !publicKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate request ID
    const requestId = uuidv4();
    
    // Select available TEE node
    const availableNodes = Array.from(teeNodes.values()).filter(node => node.isHealthy());
    if (availableNodes.length === 0) {
      return res.status(503).json({ error: 'No TEE nodes available' });
    }

    const selectedNode = availableNodes[Math.floor(Math.random() * availableNodes.length)];
    selectedNode.processingCount++;

    // Store request
    const request = {
      id: requestId,
      data,
      publicKey,
      stellarAccount,
      nodeId: selectedNode.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      progress: 0
    };

    processingRequests.set(requestId, request);

    // Start processing (simulate)
    processRequest(requestId);

    res.json({
      requestId,
      status: 'pending',
      nodeId: selectedNode.id,
      estimatedTime: '30-60 seconds'
    });

  } catch (error) {
    logger.error('Error processing request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get processing status
app.get('/api/process/:requestId/status', (req, res) => {
  const { requestId } = req.params;
  const request = processingRequests.get(requestId);

  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  res.json({
    requestId: request.id,
    status: request.status,
    progress: request.progress,
    createdAt: request.createdAt,
    completedAt: request.completedAt,
    result: request.result
  });
});

// Get processing history
app.get('/api/process/history', (req, res) => {
  const requests = Array.from(processingRequests.values())
    .filter(req => req.status === 'completed')
    .slice(-10) // Last 10 requests
    .reverse();

  res.json({
    requests: requests.map(req => ({
      id: req.id,
      status: req.status,
      createdAt: req.createdAt,
      completedAt: req.completedAt,
      nodeId: req.nodeId
    }))
  });
});

// Stellar transaction validation
app.post('/api/stellar/validate', async (req, res) => {
  try {
    const { transactionXdr } = req.body;

    if (!transactionXdr) {
      return res.status(400).json({ error: 'Transaction XDR required' });
    }

    const transaction = new StellarSDK.Transaction(transactionXdr, networkPassphrase);
    
    // Validate transaction structure
    if (!transaction.operations || transaction.operations.length === 0) {
      return res.status(400).json({ error: 'Invalid transaction structure' });
    }

    res.json({
      valid: true,
      operations: transaction.operations.length,
      sourceAccount: transaction.sourceAccount,
      fee: transaction.fee
    });

  } catch (error) {
    logger.error('Error validating Stellar transaction:', error);
    res.status(400).json({ 
      valid: false, 
      error: 'Invalid transaction XDR' 
    });
  }
});

// TEE node heartbeat
app.post('/api/tee/heartbeat/:nodeId', (req, res) => {
  const { nodeId } = req.params;
  const node = teeNodes.get(nodeId);

  if (!node) {
    return res.status(404).json({ error: 'Node not found' });
  }

  node.heartbeat();
  res.json({ status: 'ok', timestamp: node.lastHeartbeat });
});

// Processing simulation
async function processRequest(requestId) {
  const request = processingRequests.get(requestId);
  if (!request) return;

  const node = teeNodes.get(request.nodeId);
  if (!node) return;

  try {
    // Simulate processing stages
    const stages = [
      { status: 'Initializing enclave...', progress: 10, delay: 1000 },
      { status: 'Encrypting data...', progress: 30, delay: 2000 },
      { status: 'Processing in secure enclave...', progress: 60, delay: 3000 },
      { status: 'Decrypting results...', progress: 90, delay: 1500 },
      { status: 'Processing complete', progress: 100, delay: 500 }
    ];

    for (const stage of stages) {
      await new Promise(resolve => setTimeout(resolve, stage.delay));
      
      request.status = stage.status;
      request.progress = stage.progress;
      
      if (stage.progress === 100) {
        request.completedAt = new Date().toISOString();
        request.result = {
          success: true,
          processedData: 'AI processing results would appear here',
          hash: crypto.createHash('sha256').update(JSON.stringify(request.data)).digest('hex')
        };
      }
    }

    node.processingCount--;
    logger.info(`Request ${requestId} completed successfully`);

  } catch (error) {
    logger.error(`Error processing request ${requestId}:`, error);
    request.status = 'failed';
    request.progress = 0;
    node.processingCount--;
  }
}

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`EnclaveAI Backend Server running on port ${PORT}`);
  initializeTEENodes();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;
