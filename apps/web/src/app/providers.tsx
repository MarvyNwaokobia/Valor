'use client'

import { useState } from 'react'
import { PrivyProvider } from '@privy-io/react-auth'
import { WagmiProvider } from '@privy-io/wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { celo, celoAlfajores } from 'wagmi/chains'
import { wagmiConfig } from '@/lib/wagmi'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import AppInit from './app-init'

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

  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? 'placeholder'

  return (
    <ErrorBoundary>
      <PrivyProvider
        appId={privyAppId}
        config={{
          loginMethods: ['email', 'wallet', 'google'],
          appearance: {
            theme: 'dark',
            accentColor: '#eab308',
            landingHeader: 'Enter Valor',
            loginMessage: 'Every champion begins somewhere.',
          },
          embeddedWallets: {
            ethereum: {
              createOnLogin: 'off',
            },
          },
          defaultChain: celo,
          supportedChains: [celo, celoAlfajores],
        }}
      >
        <QueryClientProvider client={queryClient}>
          <WagmiProvider config={wagmiConfig}>
            <AppInit />
            {children}
          </WagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    </ErrorBoundary>
  )
}
