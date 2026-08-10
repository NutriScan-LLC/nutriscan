import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@nutriscan/scanner",
    "@nutriscan/scoring",
    "@nutriscan/workflows",
  ],
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
};

export default nextConfig;
