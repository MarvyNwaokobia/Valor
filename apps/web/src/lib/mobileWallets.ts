// Mobile external-wallet connect.
//
// This is how Valor connects external wallets on mobile, now that we no longer
// run a WalletConnect connector of our own. WalletConnect proved unusable for
// this: its pairing relay (`relay.walletconnect.*`) is unreachable on many
// carrier/ISP resolvers, and proxying the relay only fixes OUR browser's leg —
// the wallet app still opens its own socket to the real relay and hangs on
// "Connecting…". See lib/wagmi.ts.
//
// Deep-linking the user INTO their wallet's built-in dApp browser has none of
// that failure surface. There the wallet injects `window.ethereum`, so the
// plain `injected` connector connects in one tap with no relay, no cloud
// project, and no domain allowlist in the loop. Desktop (extension present)
// and in-wallet-browser sessions already have an injected provider and never
// reach this path.

export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
    navigator.userAgent,
  )
}

export function hasInjectedProvider(): boolean {
  return typeof window !== 'undefined' && !!(window as { ethereum?: unknown }).ethereum
}

export interface MobileWalletLink {
  id: string
  name: string
  /** Deep link that re-opens THIS page inside the wallet's dApp browser. */
  build: () => string
}

/**
 * Marker the deep link carries so the wallet's browser knows the player has
 * ALREADY asked to connect.
 *
 * Without it the hop is two separate journeys: the wallet's browser opens Valor
 * cold, signed out, and the player has to find Enter Valor and pick their wallet
 * a second time — having just done exactly that in Safari. That double hop is
 * the reason this route was shelved in July, and it is the only thing that was
 * ever wrong with it.
 *
 * The tap in Safari is real intent. This carries that intent across the hop so
 * the wallet's browser can finish the job the player already started, which
 * makes the whole thing one tap.
 */
export const WALLET_BROWSER_CONNECT_PARAM = 'valor_connect'

/** This page's URL, plus the connect marker, preserving any existing query. */
function dappUrl(): string {
  const url = new URL(window.location.href)
  url.searchParams.set(WALLET_BROWSER_CONNECT_PARAM, '1')
  return url.toString()
}

// MetaMask's deep link takes the target with the scheme stripped, so it needs
// host+path+query rather than a full URL.
function dappHostPath(): string {
  const url = new URL(dappUrl())
  return `${url.host}${url.pathname}${url.search}`
}

export const MOBILE_WALLETS: MobileWalletLink[] = [
  {
    id: 'metamask',
    name: 'MetaMask',
    // https://metamask.app.link/dapp/<host+path> opens the URL in MM's browser
    // (or routes to the App/Play store if MetaMask isn't installed).
    build: () => `https://metamask.app.link/dapp/${dappHostPath()}`,
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    build: () => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(dappUrl())}`,
  },
  {
    id: 'trust',
    name: 'Trust Wallet',
    build: () => `https://link.trustwallet.com/open_url?coin_id=52752&url=${encodeURIComponent(dappUrl())}`,
  },
]
