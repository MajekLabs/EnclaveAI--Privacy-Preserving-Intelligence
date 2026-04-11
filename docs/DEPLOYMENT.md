# EnclaveAI Deployment Guide

## Overview

This guide covers the deployment of EnclaveAI across different environments, from local development to production.

## Prerequisites

### System Requirements

- **Node.js**: 18.0+ 
- **Rust**: 1.70+ (for smart contracts)
- **Docker**: 20.0+
- **Docker Compose**: 2.0+
- **Git**: 2.30+

### External Services

- **Stellar Testnet Account**: For blockchain operations
- **Freighter Wallet**: Browser extension for Stellar
- **TEE Hardware**: Intel SGX/AMD SEV capable (production)

## Environment Setup

### 1. Clone Repository

```bash
git clone https://github.com/enclaveai/enclaveai.git
cd enclaveai
```

### 2. Install Dependencies

```bash
# Frontend dependencies
cd frontend
npm install

# Backend dependencies  
cd ../backend
npm install

# Smart contract dependencies
cd ../smart-contracts
cargo build --release
```

### 3. Environment Configuration

```bash
# Copy environment templates
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Edit configuration files
nano backend/.env
nano frontend/.env
```

## Local Development

### Docker Compose Setup

Create `docker-compose.dev.yml`:

```yaml
version: '3.8'

services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:3001
      - NEXT_PUBLIC_STELLAR_NETWORK=testnet
    volumes:
      - ./frontend:/app
      - /app/node_modules
    command: npm run dev

  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - NODE_ENV=development
      - STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
      - FRONTEND_URL=http://localhost:3000
    volumes:
      - ./backend:/app
      - /app/node_modules
    command: npm run dev

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

### Start Development Environment

```bash
docker-compose -f docker-compose.dev.yml up -d
```

### Access Services

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **API Documentation**: http://localhost:3001/api-docs
- **Redis**: localhost:6379

## Smart Contract Deployment

### 1. Build Contract

```bash
cd smart-contracts
cargo build --target wasm32-unknown-unknown --release
```

### 2. Deploy to Testnet

```bash
# Install Soroban CLI
cargo install --locked soroban-cli

# Deploy contract
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/enclaveai_contract.wasm \
  --source YOUR_SECRET_KEY \
  --network testnet

# Initialize contract
soroban contract invoke \
  --id CONTRACT_ID \
  --function initialize \
  --arg ADMIN_ADDRESS \
  --arg 1000000000 \
  --source YOUR_SECRET_KEY \
  --network testnet
```

### 3. Verify Deployment

```bash
soroban contract read \
  --id CONTRACT_ID \
  --function get_network_stats \
  --network testnet
```

## Production Deployment

### Infrastructure Requirements

### Kubernetes Cluster

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: enclaveai
---
# k8s/frontend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: enclaveai
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: enclaveai/frontend:latest
        ports:
        - containerPort: 3000
        env:
        - name: NEXT_PUBLIC_API_URL
          value: "https://api.enclave.ai"
        - name: NEXT_PUBLIC_STELLAR_NETWORK
          value: "mainnet"
---
# k8s/backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: enclaveai
spec:
  replicas: 5
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: enclaveai/backend:latest
        ports:
        - containerPort: 3001
        env:
        - name: PORT
          value: "3001"
        - name: NODE_ENV
          value: "production"
        - name: STELLAR_HORIZON_URL
          value: "https://horizon.stellar.org"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Load Balancer Configuration

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: enclaveai-ingress
  namespace: enclaveai
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - enclave.ai
    - api.enclave.ai
    secretName: enclaveai-tls
  rules:
  - host: enclave.ai
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend-service
            port:
              number: 3000
  - host: api.enclave.ai
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: backend-service
            port:
              number: 3001
```

### Database Setup

```yaml
# k8s/redis.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: enclaveai
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
        volumeMounts:
        - name: redis-storage
          mountPath: /data
      volumes:
      - name: redis-storage
        persistentVolumeClaim:
          claimName: redis-pvc
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: redis-pvc
  namespace: enclaveai
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

## TEE Node Deployment

### Hardware Requirements

- **CPU**: Intel Xeon with SGX support or AMD EPYC with SEV
- **Memory**: 32GB+ RAM
- **Storage**: 500GB+ SSD
- **Network**: 10Gbps+ connectivity

### Node Setup

```bash
# Install SGX driver (Intel)
sudo apt-get update
sudo apt-get install -y intel-sgx-dkms

# Install Docker with SGX support
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# Pull TEE node image
docker pull enclaveai/tee-node:latest

# Run TEE node
docker run -d \
  --name tee-node \
  --device /dev/sgx \
  -p 8080:8080 \
  -e NODE_ID=tee-node-1 \
  -e ENDPOINT=https://tee-node-1.enclave.ai \
  -e BACKEND_URL=https://api.enclave.ai \
  enclaveai/tee-node:latest
```

### Node Registration

```bash
# Register node with smart contract
soroban contract invoke \
  --id CONTRACT_ID \
  --function register_node \
  --arg NODE_OPERATOR_ADDRESS \
  --arg "https://tee-node-1.enclave.ai" \
  --arg NODE_PUBLIC_KEY \
  --arg 10000000000 \
  --source NODE_OPERATOR_SECRET \
  --network mainnet

# Wait for admin approval
soroban contract invoke \
  --id CONTRACT_ID \
  --function approve_node \
  --arg ADMIN_ADDRESS \
  --arg 0 \
  --source ADMIN_SECRET \
  --network mainnet
```

## Monitoring Setup

### Prometheus Configuration

```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'enclaveai-backend'
    static_configs:
      - targets: ['backend-service:3001']
    metrics_path: '/metrics'
    
  - job_name: 'enclaveai-frontend'
    static_configs:
      - targets: ['frontend-service:3000']
    metrics_path: '/api/metrics'
    
  - job_name: 'tee-nodes'
    static_configs:
      - targets: ['tee-node-1:8080', 'tee-node-2:8080', 'tee-node-3:8080']
    metrics_path: '/metrics'
```

### Grafana Dashboard

```json
{
  "dashboard": {
    "title": "EnclaveAI Monitoring",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(enclaveai_requests_total[5m])"
          }
        ]
      },
      {
        "title": "Active TEE Nodes",
        "type": "stat",
        "targets": [
          {
            "expr": "enclaveai_active_nodes"
          }
        ]
      },
      {
        "title": "Processing Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(enclaveai_processing_duration_seconds_bucket[5m]))"
          }
        ]
      }
    ]
  }
}
```

## Security Configuration

### SSL/TLS Setup

```bash
# Generate SSL certificates
certbot certonly --webroot \
  -w /var/www/html \
  -d enclave.ai \
  -d api.enclave.ai

# Configure nginx
cat > /etc/nginx/sites-available/enclaveai << EOF
server {
    listen 443 ssl http2;
    server_name enclave.ai;
    
    ssl_certificate /etc/letsencrypt/live/enclave.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/enclave.ai/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 443 ssl http2;
    server_name api.enclave.ai;
    
    ssl_certificate /etc/letsencrypt/live/api.enclave.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.enclave.ai/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF
```

### Firewall Rules

```bash
# Configure UFW
sudo ufw enable
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 3001/tcp  # Backend API (internal)
sudo ufw deny 3000/tcp   # Frontend (internal only)
```

## CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy EnclaveAI

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
    - name: Install dependencies
      run: |
        cd frontend && npm install
        cd ../backend && npm install
    - name: Run tests
      run: |
        cd frontend && npm test
        cd ../backend && npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - name: Build Docker images
      run: |
        docker build -t enclaveai/frontend:${{ github.sha }} ./frontend
        docker build -t enclaveai/backend:${{ github.sha }} ./backend
    - name: Push to registry
      run: |
        echo ${{ secrets.DOCKER_PASSWORD }} | docker login -u ${{ secrets.DOCKER_USERNAME }} --password-stdin
        docker push enclaveai/frontend:${{ github.sha }}
        docker push enclaveai/backend:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - name: Deploy to Kubernetes
      run: |
        echo ${{ secrets.KUBECONFIG }} | base64 -d > kubeconfig
        export KUBECONFIG=kubeconfig
        kubectl set image deployment/frontend frontend=enclaveai/frontend:${{ github.sha }} -n enclaveai
        kubectl set image deployment/backend backend=enclaveai/backend:${{ github.sha }} -n enclaveai
        kubectl rollout status deployment/frontend -n enclaveai
        kubectl rollout status deployment/backend -n enclaveai
```

## Troubleshooting

### Common Issues

1. **TEE Node Not Responding**
   ```bash
   # Check SGX status
   sudo sgx-detect
   
   # Check Docker logs
   docker logs tee-node-1
   
   # Verify network connectivity
   curl https://tee-node-1.enclave.ai/health
   ```

2. **Smart Contract Transaction Failed**
   ```bash
   # Check contract status
   soroban contract read --id CONTRACT_ID --function get_network_stats --network mainnet
   
   # Check account balance
   soroban account info YOUR_ADDRESS --network mainnet
   ```

3. **High Memory Usage**
   ```bash
   # Monitor memory usage
   kubectl top pods -n enclaveai
   
   # Scale backend
   kubectl scale deployment backend --replicas=10 -n enclaveai
   ```

### Performance Optimization

1. **Database Optimization**
   ```bash
   # Redis memory optimization
   redis-cli CONFIG SET maxmemory 2gb
   redis-cli CONFIG SET maxmemory-policy allkeys-lru
   ```

2. **Load Balancer Tuning**
   ```bash
   # Nginx optimization
   nginx -s reload
   ```

3. **Container Resource Limits**
   ```bash
   # Update resource limits
   kubectl patch deployment backend -p '{"spec":{"template":{"spec":{"containers":[{"name":"backend","resources":{"limits":{"memory":"1Gi","cpu":"1000m"}}}]}}}}' -n enclaveai
   ```

## Maintenance

### Regular Tasks

- **Daily**: Monitor system health and performance
- **Weekly**: Update security patches and dependencies
- **Monthly**: Review logs and optimize performance
- **Quarterly**: Security audit and penetration testing

### Backup Procedures

```bash
# Backup Redis data
kubectl exec -n enclaveai redis-0 -- redis-cli BGSAVE
kubectl cp enclaveai/redis-0:/data/dump.sql ./backups/

# Backup smart contract state
soroban contract read --id CONTRACT_ID --function get_network_stats --network mainnet > ./backups/contract_state.json
```

### Disaster Recovery

1. **System Failure**: Auto-failover to backup nodes
2. **Data Loss**: Restore from encrypted backups
3. **Security Breach**: Isolate affected components
4. **Network Outage**: Switch to backup connectivity
