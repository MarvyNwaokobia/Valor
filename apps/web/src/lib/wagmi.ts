import { createConfig, fallback, http } from 'wagmi'
import { celo, celoAlfajores } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

// Primary login is Magic's embedded wallet, which deliberately does NOT go
// through a wagmi connector — it publishes its EIP-1193 provider to
// lib/walletBridge instead. wagmi's job here is only the separate "I already
// have a wallet" path.
//
// That path is `injected()` alone, on purpose. We used to also run a
// self-hosted `walletConnect()` connector, and every mobile connect bug we've
// had traced back to owning that integration: the pairing relay host getting
// sinkholed by consumer router/ISP resolvers (the endless "Connecting…" hang),
// the Reown Cloud domain allowlist rejecting pairings when `metadata.url`
// drifted, and relay-host pins that fixed our browser's leg while the wallet
// app still dialled the blocked host itself. None of it was ours to fix.
//
// `injected()` needs no relay, no cloud project, and no allowlist: it talks to
// a provider that is already in the page. Desktop extensions and in-wallet
// dApp browsers inject one; a plain mobile browser doesn't, so SignInModal
// deep-links those users into their wallet's own browser, where one exists.
// wagmi additionally auto-discovers named extensions via EIP-6963.
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

export const wagmiConfig = createConfig({
  chains: [celo, celoAlfajores],
  connectors: [
    injected(),
    // WalletConnect is BACK, and owned by us again.
    //
    // It was removed in 968926d and replaced with Web3Auth's chooser, on the
    // reasoning that a managed integration would stop us fighting relay hosts.
    // The opposite happened: @web3auth/no-modal hardcodes
    // `relayUrl: "wss://relay.walletconnect.com"` and its modal exposes no way
    // to change it (ModalConfig carries label/showOnModal/loginMethods and
    // nothing else). That host is precisely the one some ISP/router resolvers
    // sinkhole — the failure diagnosed on-device on 2026-07-25 and fixed in
    // a7d53ba by pinning Reown's host. So swapping to Web3Auth reintroduced the
    // exact bug we had already fixed, and made it unfixable: the wallet hangs
    // on "Connecting to DApp" forever because the pairing socket never opens.
    //
    // Owning the connector is what lets us point at a relay that resolves.
    ...(walletConnectProjectId
      ? [walletConnect({
          projectId: walletConnectProjectId,
          // Reown's current relay host — the same relay network, under a name
          // those DNS filters don't catch. NOT relay.walletconnect.com, which
          // is blocked by the same filter.
          relayUrl: 'wss://relay.reown.com',
          // `url` must match the domain allowlisted in the Reown Cloud project,
          // or the pairing is rejected and the mobile "Open" button never arms.
          metadata: {
            name: 'Valor',
            description: 'Earn your honor. Web3 tactical FPS on Celo.',
            url: 'https://playvalor.app',
            icons: ['https://playvalor.app/valor-icon.png'],
          },
        })]
      : []),
  ],
  // Defer connector reconnection to a client effect instead of running it
  // during render, so the server HTML and first client render agree. The game
  // shell stays server-rendered; without this, wagmi reads persisted connection
  // state at render time and the tree can hydrate mismatched.
  ssr: true,
  transports: {
    // Reads go through a private RPC when one is configured and fall back to
    // public forno, so a single provider having a bad day doesn't take the
    // shop, balances, and claim checks down with it.
    [celo.id]: fallback([
      ...(process.env.NEXT_PUBLIC_CELO_RPC_URL
        ? [http(process.env.NEXT_PUBLIC_CELO_RPC_URL)]
        : []),
      http('https://forno.celo.org'),
    ]),
    [celoAlfajores.id]: http('https://alfajores-forno.celo-testnet.org'),
  },
})
