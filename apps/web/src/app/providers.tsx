'use client'

import { useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/lib/wagmi'
import { installWalletConnectRelayProxy } from '@/lib/wcRelayProxy'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import { MagicAuthProvider } from '@/components/providers/MagicAuthProvider'
import AppInit from './app-init'

export function Providers({ children }: { children: React.ReactNode }) {
  // Redirect WalletConnect's relay socket through our backend before any connect
  // attempt (runs once, client-side). Fixes mobile networks that can't reach
  // relay.walletconnect.*. Must be in place before wagmi/WC opens a relay socket.
  useState(() => {
    installWalletConnectRelayProxy()
    return null
  })

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

  return (
    <ErrorBoundary>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <MagicAuthProvider>
            <AppInit />
            {children}
          </MagicAuthProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  )
}
