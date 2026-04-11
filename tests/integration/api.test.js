const request = require('supertest');
const app = require('../../backend/src/server');

describe('EnclaveAI API Integration Tests', () => {
  let server;

  beforeAll(() => {
    server = app.listen(3001);
  });

  afterAll(() => {
    server.close();
  });

  describe('Health Check', () => {
    test('GET /health should return 200', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version');
    });
  });

  describe('Network Status', () => {
    test('GET /api/network/status should return network information', async () => {
      const response = await request(app)
        .get('/api/network/status')
        .expect(200);

      expect(response.body).toHaveProperty('totalNodes');
      expect(response.body).toHaveProperty('healthyNodes');
      expect(response.body).toHaveProperty('activeNodes');
      expect(response.body).toHaveProperty('networkHealth');
      expect(response.body).toHaveProperty('nodes');
    });
  });

  describe('Processing Request', () => {
    test('POST /api/process should create a processing request', async () => {
      const requestData = {
        data: { text: 'Sample text for processing' },
        publicKey: 'test-public-key',
        stellarAccount: 'test-stellar-account'
      };

      const response = await request(app)
        .post('/api/process')
        .send(requestData)
        .expect(200);

      expect(response.body).toHaveProperty('requestId');
      expect(response.body).toHaveProperty('status', 'pending');
      expect(response.body).toHaveProperty('nodeId');
      expect(response.body).toHaveProperty('estimatedTime');
    });

    test('POST /api/process should fail with missing data', async () => {
      const response = await request(app)
        .post('/api/process')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Missing required fields');
    });
  });

  describe('Request Status', () => {
    let requestId;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/process')
        .send({
          data: { text: 'Test data' },
          publicKey: 'test-key',
          stellarAccount: 'test-account'
        });
      
      requestId = response.body.requestId;
    });

    test('GET /api/process/:requestId/status should return request status', async () => {
      const response = await request(app)
        .get(`/api/process/${requestId}/status`)
        .expect(200);

      expect(response.body).toHaveProperty('requestId', requestId);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('progress');
      expect(response.body).toHaveProperty('createdAt');
    });

    test('GET /api/process/:requestId/status should return 404 for invalid request', async () => {
      const response = await request(app)
        .get('/api/process/invalid-request-id/status')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Request not found');
    });
  });

  describe('Stellar Transaction Validation', () => {
    test('POST /api/stellar/validate should validate transaction', async () => {
      // Mock transaction XDR (simplified for testing)
      const mockXdr = 'AAAAAgAAAAABbbVb9yXjz0s+3A6FgIz6K8B9QAAAAEAAAAA';

      const response = await request(app)
        .post('/api/stellar/validate')
        .send({ transactionXdr: mockXdr })
        .expect(400); // Expected to fail with invalid XDR

      expect(response.body).toHaveProperty('valid', false);
      expect(response.body).toHaveProperty('error');
    });

    test('POST /api/stellar/validate should fail with missing XDR', async () => {
      const response = await request(app)
        .post('/api/stellar/validate')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Transaction XDR required');
    });
  });

  describe('TEE Node Heartbeat', () => {
    test('POST /api/tee/heartbeat/:nodeId should update node heartbeat', async () => {
      const response = await request(app)
        .post('/api/tee/heartbeat/tee-node-1')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });

    test('POST /api/tee/heartbeat/:nodeId should return 404 for invalid node', async () => {
      const response = await request(app)
        .post('/api/tee/heartbeat/invalid-node')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Node not found');
    });
  });

  describe('Processing History', () => {
    test('GET /api/process/history should return processing history', async () => {
      const response = await request(app)
        .get('/api/process/history')
        .expect(200);

      expect(response.body).toHaveProperty('requests');
      expect(Array.isArray(response.body.requests)).toBe(true);
    });
  });
});
