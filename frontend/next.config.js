/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
  },
  env: {
    NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
    NEXT_PUBLIC_API_URL: 'http://localhost:3001',
  },
}

module.exports = nextConfig
