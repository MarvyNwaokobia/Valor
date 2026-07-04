'use client'

import { useState } from 'react'
import { WEB3AUTH_NETWORK } from '@web3auth/modal'
import { Web3AuthProvider } from '@web3auth/modal/react'
import { WagmiProvider } from '@web3auth/modal/react/wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { celoChainConfig, celoAlfajoresChainConfig } from '@/lib/wagmi'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import AppInit from './app-init'

// Only Google, email OTP, and SMS OTP stay on the "auth" connector — every
// other social provider is hidden. Fewer OAuth surfaces means less exposure
// to the MPC-wallet-derivation race documented in providers.tsx below; social
// crashes were the ones observed in production, wallet connectors were not.
// NOTE: sms_passwordless also needs an SMS provider configured on the
// Web3Auth Dashboard project — this flag alone won't make it functional.
const HIDDEN = { showOnModal: false } as const

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 2,
          },
        },
      }),
  )

  const web3AuthClientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID ?? 'placeholder'

  return (
    <ErrorBoundary>
      <Web3AuthProvider
        config={{
          web3AuthOptions: {
            clientId: web3AuthClientId,
            web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_MAINNET,
            chains: [celoChainConfig, celoAlfajoresChainConfig],
            defaultChainId: celoChainConfig.chainId,
            uiConfig: {
              appName: 'Enter Valor',
              theme: { primary: '#eab308' },
              mode: 'dark',
              // Popup mode has a known race: Web3Auth's own wagmi bridge can
              // report "connected" a beat before the MPC-derived wallet
              // address for social logins is actually ready, leaving users
              // bounced back to the sign-in screen. Redirect mode forces a
              // full page round-trip, so on return the whole app boots fresh
              // and rehydrates the session as one sequential flow instead of
              // resuming mid-popup — avoiding that race entirely.
              //
              // Confirmed 2026-07: redirect mode alone does NOT reliably fix
              // this — the race can still happen on cold boot after the
              // Google redirect returns. useWalletBridgeGuard (app-init.tsx)
              // is the actual fix: it detects the stall and repairs it.
              uxMode: 'redirect',
            },
            modalConfig: {
              connectors: {
                auth: {
                  label: 'auth',
                  loginMethods: {
                    twitter: HIDDEN,
                    facebook: HIDDEN,
                    discord: HIDDEN,
                    apple: HIDDEN,
                    github: HIDDEN,
                    reddit: HIDDEN,
                    twitch: HIDDEN,
                    linkedin: HIDDEN,
                    line: HIDDEN,
                    kakao: HIDDEN,
                    wechat: HIDDEN,
                    sms_passwordless: { showOnModal: true },
                  },
                },
              },
            },
          },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <WagmiProvider>
            <AppInit />
            {children}
          </WagmiProvider>
        </QueryClientProvider>
      </Web3AuthProvider>
    </ErrorBoundary>
  )
}
