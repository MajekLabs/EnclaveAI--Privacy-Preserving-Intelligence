#!/bin/bash

# EnclaveAI Setup Script
# This script sets up the development environment for EnclaveAI

set -e

echo "Setting up EnclaveAI development environment..."

# Check prerequisites
echo "Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js 18+"
    exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker"
    exit 1
fi

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "Docker Compose is not installed. Please install Docker Compose"
    exit 1
fi

# Check Rust (for smart contracts)
if ! command -v cargo &> /dev/null; then
    echo "Rust is not installed. Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source ~/.cargo/env
fi

# Install Soroban CLI
echo "Installing Soroban CLI..."
cargo install --locked soroban-cli

echo "Prerequisites check completed."

# Setup frontend
echo "Setting up frontend..."
cd frontend
npm install
cd ..

# Setup backend
echo "Setting up backend..."
cd backend
npm install
cd ..

# Setup smart contracts
echo "Setting up smart contracts..."
cd smart-contracts
cargo build --release
cd ..

# Create environment files
echo "Creating environment files..."
if [ ! -f backend/.env ]; then
    cp backend/.env.example backend/.env
    echo "Created backend/.env - please update with your configuration"
fi

if [ ! -f frontend/.env ]; then
    cp frontend/.env.example frontend/.env.local
    echo "Created frontend/.env.local - please update with your configuration"
fi

# Create logs directory
mkdir -p backend/logs

echo "Setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Update environment files with your configuration"
echo "2. Get a Stellar testnet account"
echo "3. Install Freighter wallet browser extension"
echo "4. Run 'docker-compose up -d' to start the development environment"
echo "5. Visit http://localhost:3000 to access the application"
echo ""
echo "For more information, see docs/DEPLOYMENT.md"
