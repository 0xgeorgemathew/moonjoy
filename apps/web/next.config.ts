import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@moonjoy/game"],
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
