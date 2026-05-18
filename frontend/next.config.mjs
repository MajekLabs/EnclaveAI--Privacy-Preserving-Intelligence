/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable WASM for client-side SHA-256 / AES-GCM hashing before payload dispatch
  webpack(config, { isServer }) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    if (!isServer) {
      config.output.webassemblyModuleFilename = "static/wasm/[modulehash].wasm";
    }
    return config;
  },
};

export default nextConfig;
