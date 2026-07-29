'use client'

import { useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'
import { getBridgedProviderFor } from '@/lib/walletBridge'
import { getMagic } from '@/lib/magic'
import { useResolvedAuth } from './useResolvedAuth'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

// Reports WHY a session cannot sign, once per page load, to the existing
// client-errors endpoint.
//
// WHY THIS EXISTS. A session that is signed in but cannot sign has been
// diagnosed three times from screenshots, and each time the answer stopped at
// "one of these branches, can't tell which from the server". The client knows
// exactly which one; it just had no way to say so. Every field below is a
// question that was asked and could not be answered:
//
//   - which auth source claimed this address, and did Magic ever resolve
//   - is Magic's SDK even constructible here, and does it still hold a session
//     (ITP evicts its storage in mobile Safari and installed PWAs, leaving a
//     cached address that reads valid and refuses to sign — see lib/magic.ts)
//   - did either SDK publish a provider to the bridge
//   - does wagmi believe it is connected, and is there an injected provider for
//     it to talk to
//   - is this the installed PWA, where deep-linking out to a wallet behaves
//     differently from a browser tab
//
// Best-effort and non-blocking: a failed report must never affect the page. It
// fires only when the session genuinely cannot sign, so it is not chatty.
export function useSignerDiagnostic(canSign: boolean) {
  const { status, address, source } = useResolvedAuth()
  const { isConnected, connector } = useAccount()
  const sent = useRef(false)

  useEffect(() => {
    if (canSign || status !== 'ready' || !address || sent.current) return
    sent.current = true

    void (async () => {
      let magicPresent = false
      let magicLoggedIn: boolean | string = false
      try {
        const magic = getMagic()
        magicPresent = !!magic
        if (magic) magicLoggedIn = await magic.user.isLoggedIn()
      } catch (e) {
        magicLoggedIn = `threw: ${e instanceof Error ? e.message : String(e)}`
      }

      const diag = {
        address,
        source,
        status,
        magicPresent,
        magicLoggedIn,
        bridgeMagic: !!getBridgedProviderFor('magic'),
        bridgeWeb3auth: !!getBridgedProviderFor('web3auth'),
        wagmiConnected: isConnected,
        wagmiConnector: connector?.id ?? null,
        hasInjected:
          typeof window !== 'undefined' && !!(window as { ethereum?: unknown }).ethereum,
        standalone:
          typeof window !== 'undefined' &&
          (window.matchMedia?.('(display-mode: standalone)').matches ||
            (window.navigator as { standalone?: boolean }).standalone === true),
      }

      try {
        await fetch(`${API}/client-errors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `SIGNER_DIAGNOSTIC source=${source} magicLoggedIn=${magicLoggedIn} bridgeMagic=${diag.bridgeMagic} bridgeWeb3auth=${diag.bridgeWeb3auth} wagmi=${isConnected} injected=${diag.hasInjected} pwa=${diag.standalone}`,
            stack: JSON.stringify(diag, null, 2),
            url: typeof window !== 'undefined' ? window.location.href : undefined,
            wallet_address: address,
          }),
        })
      } catch {
        // Never let a diagnostic break the page it is diagnosing.
      }
    })()
  }, [canSign, status, address, source, isConnected, connector])
}
