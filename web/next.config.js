/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['yahoo-finance2'],
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'yahoo-finance2': 'yahoo-finance2/dist/cjs/index.js',
    };
    return config;
  },
};

module.exports = nextConfig;
