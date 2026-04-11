# Contributing to EnclaveAI

We welcome contributions to EnclaveAI! This document provides guidelines for contributors.

## Getting Started

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Docker
- Git

### Setup

1. Fork the repository
2. Clone your fork
3. Follow the setup instructions in `scripts/setup.sh`
4. Create a new branch for your feature

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Changes

- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed

### 3. Test Your Changes

```bash
# Frontend tests
cd frontend && npm test

# Backend tests
cd backend && npm test

# Smart contract tests
cd smart-contracts && cargo test

# Integration tests
npm run test:integration
```

### 4. Submit Pull Request

- Push your branch to your fork
- Create a pull request to the main branch
- Wait for code review

## Code Style

### Frontend (React/TypeScript)

- Use TypeScript for all new code
- Follow ESLint configuration
- Use functional components with hooks
- Prefer shadcn/ui components
- Add proper JSDoc comments

### Backend (Node.js)

- Use async/await for asynchronous code
- Follow ESLint configuration
- Add proper error handling
- Use Winston for logging
- Add input validation with Joi

### Smart Contracts (Rust)

- Follow Rust naming conventions
- Add comprehensive error handling
- Include proper documentation
- Use Soroban SDK best practices
- Add unit tests for all functions

## Testing

### Unit Tests

- Test individual functions and components
- Mock external dependencies
- Aim for high code coverage

### Integration Tests

- Test API endpoints
- Test smart contract interactions
- Test database operations

### End-to-End Tests

- Test complete user workflows
- Test with real blockchain (testnet)
- Test TEE node interactions

## Documentation

### Code Documentation

- Add JSDoc comments to all public functions
- Include parameter types and return values
- Add usage examples

### README Updates

- Update feature descriptions
- Update setup instructions
- Update API documentation

### API Documentation

- Document all API endpoints
- Include request/response examples
- Document error codes

## Security Considerations

### Code Review

- All changes require code review
- Security-focused review for sensitive areas
- Automated security scanning

### Secrets Management

- Never commit secrets to the repository
- Use environment variables for configuration
- Use secret management in production

### Smart Contract Security

- Formal verification for critical contracts
- Security audit before mainnet deployment
- Bug bounty program for vulnerabilities

## Issue Reporting

### Bug Reports

- Use the issue template
- Include reproduction steps
- Include environment details
- Add relevant logs

### Feature Requests

- Describe the use case
- Include implementation suggestions
- Consider security implications

## Community Guidelines

### Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Follow the project's code of conduct

### Communication

- Use GitHub for technical discussions
- Use Discord for general chat
- Be patient with responses
- Provide clear and concise messages

## Release Process

### Versioning

- Use semantic versioning
- Update CHANGELOG.md
- Tag releases properly

### Deployment

- Test on staging first
- Monitor deployment health
- Have rollback plan ready
- Update documentation

## Recognition

### Contributors

- All contributors are recognized
- Top contributors highlighted
- Annual contributor awards

### Contributions

- Code contributions
- Documentation improvements
- Bug reports and fixes
- Community support

## Getting Help

### Resources

- Documentation: `/docs`
- Examples: `/examples`
- API Reference: `/docs/api`
- Community: Discord

### Support Channels

- GitHub Issues: Bug reports and feature requests
- Discord: General discussion and help
- Email: security@enclave.ai (security issues only)

## License

By contributing to EnclaveAI, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to EnclaveAI!
