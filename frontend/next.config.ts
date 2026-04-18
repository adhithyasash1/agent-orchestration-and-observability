import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep development output isolated from production builds so switching
  // between `next dev` and `next build` cannot leave a mixed `.next`
  // directory with missing server vendor chunks.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};

export default nextConfig;
