import { createConfig, http } from 'wagmi'
import { celo, celoAlfajores } from 'wagmi/chains'

// No connectors wired up yet — login is being rebuilt from scratch. This
// config exists purely so the wagmi hooks used elsewhere in the app
// (useGBalance, useMarketplace, useRankPool, useResale, etc.) have a
// provider to read from; `useAccount().address` will just stay undefined
// until a real connector is added.
export const wagmiConfig = createConfig({
  chains: [celo, celoAlfajores],
  transports: {
    [celo.id]: http('https://forno.celo.org'),
    [celoAlfajores.id]: http('https://alfajores-forno.celo-testnet.org'),
  },
})
