import { http } from 'wagmi'
import { celo, celoAlfajores } from 'wagmi/chains'
import { createConfig } from '@privy-io/wagmi'

// Privy handles WalletConnect and injected wallet connectors internally —
// no separate WalletConnect project ID required here.
export const wagmiConfig = createConfig({
  chains: [celo, celoAlfajores],
  transports: {
    [celo.id]: http('https://forno.celo.org'),
    [celoAlfajores.id]: http('https://alfajores-forno.celo-testnet.org'),
  },
})
