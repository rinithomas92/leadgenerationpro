import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: { "/*": ["./certs/supabase-ca.crt"] },
  webpack(config, { webpack }) {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/, require.resolve("./lib/vercel-env.ts")));
    return config;
  },
};

export default nextConfig;
