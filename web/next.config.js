/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['yahoo-finance2'],
  // Force Vercel's file tracer to include yahoo-finance2 in the deployment.
  // This acts as a safety net: even if the static import('yahoo-finance2') in
  // stockDataService.ts is somehow missed by @vercel/nft, all package files
  // are explicitly included so the module is always available at runtime.
  outputFileTracingIncludes: {
    '/**': ['./node_modules/yahoo-finance2/**/*'],
  },
};

module.exports = nextConfig;
