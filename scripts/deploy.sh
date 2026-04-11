#!/bin/bash

# EnclaveAI Deployment Script
# This script deploys EnclaveAI to a production environment

set -e

# Configuration
ENVIRONMENT=${1:-production}
NETWORK=${2:-mainnet}
REGION=${3:-us-west-2}

echo "Deploying EnclaveAI to $ENVIRONMENT environment on $NETWORK..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install AWS CLI"
    exit 1
fi

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    echo "kubectl is not installed. Please install kubectl"
    exit 1
fi

# Build Docker images
echo "Building Docker images..."
docker build -t enclaveai/frontend:latest ./frontend
docker build -t enclaveai/backend:latest ./backend

# Tag images for ECR
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

echo "Tagging images for ECR..."
docker tag enclaveai/frontend:latest $ECR_REGISTRY/enclaveai/frontend:latest
docker tag enclaveai/backend:latest $ECR_REGISTRY/enclaveai/backend:latest

# Push to ECR
echo "Pushing images to ECR..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
docker push $ECR_REGISTRY/enclaveai/frontend:latest
docker push $ECR_REGISTRY/enclaveai/backend:latest

# Deploy smart contracts
echo "Deploying smart contracts to $NETWORK..."
cd smart-contracts
if [ "$NETWORK" = "mainnet" ]; then
    cargo build --release --target wasm32-unknown-unknown
    soroban contract deploy \
        --wasm target/wasm32-unknown-unknown/release/enclaveai_contract.wasm \
        --source $STELLAR_SECRET_KEY \
        --network mainnet
else
    cargo build --release --target wasm32-unknown-unknown
    soroban contract deploy \
        --wasm target/wasm32-unknown-unknown/release/enclaveai_contract.wasm \
        --source $STELLAR_SECRET_KEY \
        --network testnet
fi
cd ..

# Deploy to Kubernetes
echo "Deploying to Kubernetes..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/services.yaml
kubectl apply -f k8s/ingress.yaml

# Wait for deployments
echo "Waiting for deployments to be ready..."
kubectl rollout status deployment/backend -n enclaveai --timeout=300s
kubectl rollout status deployment/frontend -n enclaveai --timeout=300s

# Get external IP
EXTERNAL_IP=$(kubectl get ingress enclaveai-ingress -n enclaveai -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

echo "Deployment completed successfully!"
echo "Application is available at: http://$EXTERNAL_IP"
echo "API is available at: http://api.$EXTERNAL_IP"

# Run health checks
echo "Running health checks..."
sleep 30

FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://$EXTERNAL_IP/health)
BACKEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://api.$EXTERNAL_IP/health)

if [ "$FRONTEND_STATUS" = "200" ] && [ "$BACKEND_STATUS" = "200" ]; then
    echo "All services are healthy!"
else
    echo "Some services may not be ready yet. Please check the logs:"
    echo "kubectl logs -n enclaveai deployment/backend"
    echo "kubectl logs -n enclaveai deployment/frontend"
fi

echo "Deployment completed. Please update your DNS records to point to $EXTERNAL_IP"
