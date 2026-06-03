import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from '@privy-io/wagmi'
import { PrivyProvider } from '@privy-io/react-auth'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { celo, celoAlfajores } from 'wagmi/chains'
import './index.css'
import App from './App'
import { wagmiConfig } from '@/lib/wagmi'
import ErrorBoundary from '@/components/ui/ErrorBoundary'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
    },
  },
})

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID as string
if (!privyAppId) {
  console.warn('[Valor] VITE_PRIVY_APP_ID is not set — get one at https://dashboard.privy.io')
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
    <PrivyProvider
      appId={privyAppId ?? 'placeholder'}
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
            createOnLogin: 'users-without-wallets',
          },
        },
        defaultChain: celo,
        supportedChains: [celo, celoAlfajores],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
    </ErrorBoundary>
  </StrictMode>,
)
