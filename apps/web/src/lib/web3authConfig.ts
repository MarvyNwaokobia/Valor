import { WEB3AUTH_NETWORK } from '@web3auth/modal'
import type { Web3AuthContextConfig } from '@web3auth/modal/react'
import { CELO_CHAIN_ID } from '@/lib/magic'

// Web3Auth is Valor's EXTERNAL-WALLET connector, and nothing else.
//
// Sign-in identity stays exactly where it was: Magic owns email and Google, and
// every wallet Valor mints is a Magic wallet. Web3Auth is here only to answer
// "I already have a wallet, let me connect it" — the path we used to serve with
// a self-hosted WalletConnect connector, which broke constantly because we owned
// the relay host, the cloud project, and the domain allowlist (see lib/wagmi.ts).
// Web3Auth runs all of that as managed infrastructure.
//
// Keeping it to wallets-only is the whole safety argument. Web3Auth's social
// logins would mint NEW embedded wallets, so the same person signing in with
// Google via Magic and via Web3Auth would end up holding two different
// addresses — which orphans their rank, items and G$, and is the exact pattern
// behind the GoodDollar one-face dedup that un-whitelisted ~44% of our wallets
// (see apps/api/migrations/add_magic_identity.sql). An external wallet has no
// such problem: the address belongs to the player already and we only ever read
// it. So every auth connection below is hidden, leaving only wallet discovery.
const HIDDEN = { showOnModal: false } as const

export const web3AuthContextConfig: Web3AuthContextConfig = {
  web3AuthOptions: {
    clientId: process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID ?? '',
    web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_MAINNET,
    // Celo mainnet only, matching Magic — there is no "wrong network" state to
    // handle, so a connected wallet is either on Celo or gets switched to it.
    chains: [
      {
        chainNamespace: 'eip155',
        chainId: `0x${CELO_CHAIN_ID.toString(16)}`,
        rpcTarget: process.env.NEXT_PUBLIC_CELO_RPC_URL ?? 'https://forno.celo.org',
        displayName: 'Celo Mainnet',
        ticker: 'CELO',
        tickerName: 'Celo',
        blockExplorerUrl: 'https://celoscan.io',
        logo: 'https://cryptologos.cc/logos/celo-celo-logo.png',
      },
    ],
    defaultChainId: `0x${CELO_CHAIN_ID.toString(16)}`,
    modalConfig: {
      connectors: {
        auth: {
          label: 'auth',
          // Every social/passwordless method Web3Auth offers, all off. If the
          // SDK adds a new one later it would appear by default, so this list
          // is worth re-checking on upgrade.
          loginMethods: {
            google: HIDDEN,
            twitter: HIDDEN,
            facebook: HIDDEN,
            discord: HIDDEN,
            farcaster: HIDDEN,
            apple: HIDDEN,
            github: HIDDEN,
            reddit: HIDDEN,
            line: HIDDEN,
            kakao: HIDDEN,
            linkedin: HIDDEN,
            twitch: HIDDEN,
            telegram: HIDDEN,
            wechat: HIDDEN,
            email_passwordless: HIDDEN,
            sms_passwordless: HIDDEN,
            passkeys: HIDDEN,
            authenticator: HIDDEN,
          },
        },
      },
    },
  },
}

export const isWeb3AuthConfigured = Boolean(process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID)
