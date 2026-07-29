'use client'

import { useEffect, useRef } from 'react'
import { useAccount, useConfig, useDisconnect } from 'wagmi'
import { getWalletClient } from 'wagmi/actions'

/** How long to wait before deciding a connection really is dead, not just slow. */
const CONFIRM_DELAY_MS = 5_000

// Drops an external-wallet connection that exists on paper but cannot sign.
//
// WHY THIS EXISTS. wagmi persists the last connection and restores it on every
// load. When that restored connection can no longer reach its wallet — the
// pairing died, the app was uninstalled, the session was made by a connector
// that was never a real wallet in the first place — wagmi still reports
// `isConnected: true` with the old address. The app therefore says "signed in",
// shows the balance, enables every button, and then cannot produce a signer for
// anything. The player is walled out of buying and withdrawing with no way back
// except finding the sign-out button, and no reason to think that would help.
//
// This is not hypothetical. Prod diagnostics for one wallet show it five times
// in a day, from the installed iPhone PWA: `wagmiConnected: true`,
// `hasInjected: false`, no provider on either bridge, on /bank and /marketplace
// — the two pages where money moves.
//
// A connection that cannot build a wallet client is not a connection. Ending it
// puts the player back at a sign-in that works, which is the outcome they wanted
// from the moment it broke. Deliberately conservative: it only acts while wagmi
// is fully 'connected' (never mid-reconnect), and only after asking a second
// time a few seconds later, so a slow wallet or a one-off blip is not mistaken
// for a dead one.
export function useWalletSessionHeal() {
  const { status, address } = useAccount()
  const config = useConfig()
  const { disconnect } = useDisconnect()
  // Per-address, so a player who reconnects the same wallet gets a fresh check
  // rather than being judged on the previous session's verdict.
  const checked = useRef<string | null>(null)

  useEffect(() => {
    if (status !== 'connected' || !address) return
    if (checked.current === address) return
    checked.current = address

    let cancelled = false

    const canSign = async () => {
      try {
        const client = await getWalletClient(config)
        return !!client?.account
      } catch {
        return false
      }
    }

    void (async () => {
      if (await canSign()) return
      await new Promise((r) => setTimeout(r, CONFIRM_DELAY_MS))
      if (cancelled) return
      if (await canSign()) return
      if (cancelled) return
      console.warn('[wallet] dropping a connected wallet that cannot sign:', address)
      disconnect()
    })()

    return () => {
      cancelled = true
    }
  }, [status, address, config, disconnect])
}
