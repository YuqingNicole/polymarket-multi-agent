import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The ingestion worker uses `ws` and the Prisma client; keep them external
  // so Next doesn't try to bundle native/long-lived modules into the server.
  serverExternalPackages: ['ws', '@prisma/client'],
}

export default nextConfig
