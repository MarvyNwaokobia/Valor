import { createConfig, fallback, http } from 'wagmi'
import { celo, celoAlfajores } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// Primary login is Magic's embedded wallet, which deliberately does NOT go
// through a wagmi connector — it publishes its EIP-1193 provider to
// lib/walletBridge instead. wagmi's job here is only the separate "I already
// have a wallet" path, and only for a wallet that is ALREADY IN THIS PAGE.
//
// NO WALLETCONNECT CONNECTOR HERE, deliberately and permanently.
//
// Every mobile connect bug we have ever had traced back to owning that
// integration: the pairing relay host sinkholed by consumer router/ISP
// resolvers (the endless "Connecting…" hang), the Reown Cloud domain allowlist
// rejecting pairings when `metadata.url` drifted, relay-host pins that fixed our
// browser's leg while the wallet app still dialled the blocked host itself.
// None of it was ever ours to fix.
//
// Worse, it was also redundant. Web3Auth's chooser already carries WalletConnect
// (see lib/web3authConfig.ts), so running our own put TWO WalletConnect cores on
// one page — the SDK says so out loud: "WalletConnect Core is already
// initialized. This is probably a mistake and can lead to unexpected behavior.
// Init() was called 2 times." Two cores racing over one pairing store is not a
// state worth debugging when the second one buys nothing.
//
// So the bring-your-own-wallet story is exactly two routes now:
//   • `injected()` — a provider already in the page. No relay, no cloud project,
//     no allowlist. Desktop extensions and in-wallet dApp browsers inject one;
//     wagmi additionally auto-discovers named extensions via EIP-6963.
//   • Web3Auth's chooser — everything else, including WalletConnect, run as
//     managed infrastructure we do not host.
export const wagmiConfig = createConfig({
  chains: [celo, celoAlfajores],
  connectors: [injected()],
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
