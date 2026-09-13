/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [],
  // @hiero-ledger/sdk rides in devDependencies and uses protobufjs dynamic
  // requires that break webpack bundling — keep it external (Node require at
  // runtime). The anchor path degrades to warn-only if it ever goes missing.
  serverExternalPackages: ["@hiero-ledger/sdk"],
};

export default nextConfig;
