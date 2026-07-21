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
    ...(walletConnectProjectId
      ? [walletConnect({
          projectId: walletConnectProjectId,
          // The SDK (2.23.x) defaults its relay to `wss://relay.walletconnect.org`, which
          // fails to resolve on many mobile carrier/ISP resolvers ("hostname could not be
          // found") — desktop browsers work only because they use DNS-over-HTTPS and bypass
          // it. Pin the relay to the older `.com` endpoint (still live, different IPs/network
          // path) so mobile wallet connect works where `.org` is unreachable. Revisit if
          // WalletConnect deprecates `.com`.
          relayUrl: 'wss://relay.walletconnect.com',
          // Explicit metadata so the wallet prompt shows Valor's identity and,
          // crucially, a `url` that matches the domain allowlisted in the Reown/
          // WalletConnect Cloud project. A mismatch (or missing entry) makes the
          // upgraded Reown stack reject the pairing — the mobile "Open" button then
          // never becomes ready and the wallet app won't launch.
          metadata: {
            name: 'Valor',
            description: 'Earn your honor — web3 tactical FPS on Celo.',
            url: 'https://playvalor.app',
            icons: ['https://playvalor.app/favicon.svg'],
          },
        })]
      : []),
  ],
  transports: {
    [celo.id]: http('https://forno.celo.org'),
    [celoAlfajores.id]: http('https://alfajores-forno.celo-testnet.org'),
  },
})
