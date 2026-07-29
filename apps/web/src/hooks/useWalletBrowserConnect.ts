'use client'

import { useEffect, useRef } from 'react'
import { useAccount, useConnect } from 'wagmi'
import { celo } from 'wagmi/chains'
import { WALLET_BROWSER_CONNECT_PARAM } from '@/lib/mobileWallets'

// Completes a connect that STARTED in the phone's normal browser.
//
// A player on mobile Safari or Chrome has no wallet in the page, so the only
// route that can ever sign is their wallet's own built-in browser, where the
// wallet publishes `window.ethereum` directly. SignInModal deep-links them
// there. This is the other half of that trip: the deep link carries a marker,
// and when Valor loads inside the wallet's browser this connects the wallet the
// player already chose.
//
// Without it the player arrives signed out and has to pick their wallet a second
// time, which is the clunky double hop that got this route shelved in July.
//
// Connects through the GENERIC `injected` connector on purpose. Inside a
// wallet's browser the wallet IS `window.ethereum`, which is exactly what that
// connector targets. Picking an EIP-6963-announced connector by name instead
// could land on an SDK that merely announces itself as a wallet without being
// the one in the page.
//
// Runs at most once per page load, and never when a wallet is already connected,
// so a player who is fine is never interrupted.
export function useWalletBrowserConnect() {
  const { isConnected, status } = useAccount()
  const { connectors, connectAsync } = useConnect()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    // Wait for wagmi to settle. During 'connecting'/'reconnecting' it does not
    // yet know whether a session is being restored, and connecting on top of
    // that would race it.
    if (status === 'connecting' || status === 'reconnecting') return

    const url = new URL(window.location.href)
    if (url.searchParams.get(WALLET_BROWSER_CONNECT_PARAM) !== '1') return

    done.current = true

    // Drop the marker either way, so a reload or a shared link does not try to
    // connect again.
    url.searchParams.delete(WALLET_BROWSER_CONNECT_PARAM)
    window.history.replaceState(null, '', url.toString())

    if (isConnected) return

    const injectedConnector = connectors.find((c) => c.id === 'injected')
    if (!injectedConnector) return
    if (!(window as { ethereum?: unknown }).ethereum) return

    // Failure here is silent on purpose. The player still has the sign-in modal
    // in front of them with their wallet listed, and it is now a real in-page
    // wallet, so the ordinary tap works. A red banner about an automatic step
    // they never asked for by name would only confuse.
    void connectAsync({ connector: injectedConnector, chainId: celo.id }).catch((err) => {
      console.warn('[wallet] auto-connect in wallet browser failed:', err)
    })
  }, [isConnected, status, connectors, connectAsync])
}
