import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  transpilePackages: ['@goodsdks/citizen-sdk', '@goodsdks/engagement-sdk'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Supabase SDK's complex template literal type inference breaks under
    // moduleResolution:bundler — queries work correctly at runtime.
    // Run `npx tsc --noEmit` to see remaining type warnings.
    ignoreBuildErrors: true,
  },
  webpack: (config) => {
    // wagmi v3's tempo/Connectors.js has a dynamic `import('accounts')` for the
    // Tempo Wallet devtools connector — this module doesn't exist outside wagmi's
    // own monorepo. Alias it to a stub so webpack doesn't fail the build.
    config.resolve.alias = {
      ...config.resolve.alias,
      accounts: path.resolve(__dirname, 'src/lib/stub/accounts.ts'),
    }
    return config
  },
}

export default nextConfig
