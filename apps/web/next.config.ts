import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@nutriscan/scanner",
    "@nutriscan/scoring",
    "@nutriscan/workflows",
  ],
};

export default nextConfig;
