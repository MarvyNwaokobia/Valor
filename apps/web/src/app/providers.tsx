'use client'

import { useState } from 'react'
import { WEB3AUTH_NETWORK } from '@web3auth/modal'
import { Web3AuthProvider } from '@web3auth/modal/react'
import { WagmiProvider } from '@web3auth/modal/react/wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { celoChainConfig, celoAlfajoresChainConfig } from '@/lib/wagmi'
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
