import { http, createConfig } from 'wagmi'
import { celo, celoAlfajores } from 'wagmi/chains'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID

if (!walletConnectProjectId) {
  throw new Error('Missing VITE_WALLETCONNECT_PROJECT_ID')
}

export const wagmiConfig = getDefaultConfig({
  appName: 'Valor',
  projectId: walletConnectProjectId,
  chains: [celo, celoAlfajores],
  transports: {
    [celo.id]: http(),
    [celoAlfajores.id]: http(),
  },
  ssr: false,
})
