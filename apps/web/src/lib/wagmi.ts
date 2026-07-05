import { createConfig, http } from 'wagmi'
import { celo, celoAlfajores } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

// Primary login is Magic's embedded wallet (see MagicAuthProvider), which
// deliberately does NOT go through a wagmi connector. These two connectors
// are for the separate "I already have a wallet" path (MetaMask, WalletConnect-
// compatible mobile wallets) — safe to wire through wagmi normally because
// they're wagmi's own first-party integrations talking directly to the
// wallet, not a shim bridging a third-party SDK's own async state.
export const wagmiConfig = createConfig({
  chains: [celo, celoAlfajores],
  connectors: [
    injected(),
    ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId })] : []),
  ],
  transports: {
    [celo.id]: http('https://forno.celo.org'),
    [celoAlfajores.id]: http('https://alfajores-forno.celo-testnet.org'),
  },
})
