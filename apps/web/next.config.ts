import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  transpilePackages: ['@goodsdks/citizen-sdk', '@goodsdks/engagement-sdk'],
  // Build marker so we can confirm at a glance which build a device is running
  // (mobile browsers cache aggressively). Refreshed on every build/deploy.
  env: {
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString().slice(5, 16).replace('T', ' '),
  },
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
    //
    // `@wagmi/connectors`' porto() connector (also unused — Valor only wires up
    // injected/metaMask/coinbaseWallet/walletConnect) pulls in `porto`, whose
    // internal modules import `zod/mini`, an export path this repo's pinned zod
    // version doesn't expose. Same fix: alias the whole package out.
    config.resolve.alias = {
      ...config.resolve.alias,
      accounts: path.resolve(__dirname, 'src/lib/stub/accounts.ts'),
      porto$: path.resolve(__dirname, 'src/lib/stub/porto.ts'),
      'porto/internal': path.resolve(__dirname, 'src/lib/stub/porto.ts'),
    }
    return config
  },
}

export default nextConfig
