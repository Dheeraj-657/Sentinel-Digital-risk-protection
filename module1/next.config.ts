import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it out of the server bundle.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
  poweredByHeader: false,
  // Next 16 writes an AGENTS.md on `next dev` by default; keep the repo clean.
  agentRules: false,
};

export default nextConfig;
