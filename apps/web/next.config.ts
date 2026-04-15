import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@escrowflow/ui", "@escrowflow/types"],
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    return config;
  },
};

export default nextConfig;
