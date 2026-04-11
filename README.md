# EnclaveAI - Privacy-Preserving Intelligence

A decentralized AI network that utilizes Trusted Execution Environments (TEEs) to process requests while maintaining complete data privacy and sovereignty.

## The Problem

When you use traditional AI, your sensitive personal data or proprietary business secrets are sent to a central server. This data is often stored, used for further training, or becomes a target for massive data breaches.

## The Solution

EnclaveAI moves computation to secure, decentralized "enclaves" within hardware, ensuring that even the person running the hardware cannot "see" the data being processed.

## Privacy Advantages

- **Zero-Knowledge Processing**: The network provides the answer without ever "learning" the input
- **Sovereign Data**: Your files never live on a central company's database
- **Regulatory Compliance**: Simplifies adherence to strict laws like GDPR or HIPAA

## Architecture

```
EnclaveAI/
frontend/          # React web application
backend/           # Node.js API server with TEE integration
smart-contracts/   # Stellar blockchain contracts
docs/             # Documentation
scripts/          # Deployment and utility scripts
tests/            # Test suites
config/           # Configuration files
```

## Technology Stack

- **Frontend**: React, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Node.js, Express, TEE SDK
- **Blockchain**: Stellar Soroban
- **Security**: Intel SGX/AMD SEV, End-to-end encryption
- **Infrastructure**: Docker, Kubernetes

## Getting Started

1. Clone the repository
2. Install dependencies in each component directory
3. Configure environment variables
4. Run the development environment

See individual component READMEs for detailed setup instructions.

## License

MIT License - see LICENSE file for details
