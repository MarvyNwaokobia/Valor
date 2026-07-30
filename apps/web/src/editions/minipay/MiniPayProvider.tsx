'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAccount, useConnect } from 'wagmi'
import { isMiniPayHost } from './detect'

/**
 * @module editions/minipay/MiniPayProvider
 * @description Opens the MiniPay door. Attaches the host wallet with no UI.
 *
 * WHY THIS GOES THROUGH WAGMI AND NOT lib/walletBridge
 * ----------------------------------------------------
 * The bridge exists for embedded-wallet SDKs (Magic, Web3Auth) that own an
 * async "am I logged in yet" state wagmi cannot see. MiniPay is not that. It
 * is an in-wallet dApp browser that injects a ready, unlocked EIP-1193
 * provider into the page — precisely the case `injected()` was kept for, per
 * the note in lib/wagmi.ts.
 *
 * So the only thing actually missing is the tap. MiniPay Mini Apps have no
 * connect button; the wallet is expected to be attached already. This
 * component supplies that one missing action and nothing else.
 *
 * Routing it through wagmi rather than the bridge means:
 *   - lib/walletBridge.ts is untouched (no new BridgeSource)
 *   - hooks/useResolvedAuth.ts is untouched — its existing `isConnected &&
 *     walletAddress` branch already reports source 'wallet'
 *   - hooks/useActiveWalletClient.ts is untouched — it already returns wagmi's
 *     own client for that source, so all ten signing call sites just work
 *   - account switches and disconnects stay wagmi's problem, not ours
 *
 * Outside MiniPay this component renders its children and does nothing at all,
 * so it is safe to mount unconditionally in app/providers.tsx.
 */

export type MiniPayStatus =
  /** Not running in MiniPay. The overwhelmingly common case. */
  | 'not-minipay'
  /** In MiniPay, attaching the wallet. */
  | 'connecting'
  /** In MiniPay with an account attached. */
  | 'ready'
  /**
   * In MiniPay but no account came back. Rare and not recoverable by us —
   * surface it rather than silently rendering a game the player cannot buy in.
   */
  | 'failed'

interface MiniPayContextValue {
  status: MiniPayStatus
  address: `0x${string}` | undefined
  /** Retry after a failure. No-op outside MiniPay. */
  retry: () => void
}

const MiniPayContext = createContext<MiniPayContextValue>({
  status: 'not-minipay',
  address: undefined,
  retry: () => {},
})

/** MiniPay attach state. Safe to call from any edition; reports 'not-minipay' elsewhere. */
export function useMiniPay(): MiniPayContextValue {
  return useContext(MiniPayContext)
}

export function MiniPayProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount()
  const { connectAsync, connectors } = useConnect()

  // Resolved in an effect, never during render. `isMiniPayHost()` reads
  // `window`, and reading it at render time would make the server HTML and the
  // first client render disagree — the same hydration trap wagmi's `ssr: true`
  // is set for in lib/wagmi.ts.
  const [status, setStatus] = useState<MiniPayStatus>('not-minipay')
  const [attempt, setAttempt] = useState(0)

  // React 18 StrictMode runs effects twice in development. Without this guard
  // that is two concurrent connect calls against one wallet.
  const attaching = useRef(false)

  useEffect(() => {
    if (!isMiniPayHost()) {
      setStatus('not-minipay')
      return
    }
    if (isConnected) {
      setStatus('ready')
      return
    }
    if (attaching.current) return

    let cancelled = false
    attaching.current = true
    setStatus('connecting')

    void (async () => {
      try {
        // MiniPay publishes one provider on `window.ethereum`. wagmi's injected
        // connector is the only one configured (see lib/wagmi.ts) and targets
        // exactly that, additionally discovering EIP-6963 announcements.
        const connector = connectors.find((c) => c.type === 'injected') ?? connectors[0]
        if (!connector) {
          if (!cancelled) setStatus('failed')
          return
        }

        const result = await connectAsync({ connector })

        // Verify by inspecting what came back, not by the absence of a throw.
        // A connect that resolves with zero accounts is a failure that looks
        // exactly like success from the caller's side, and treating it as
        // success is how a player reaches the shop with an unsignable session.
        if (cancelled) return
        setStatus(result.accounts?.length ? 'ready' : 'failed')
      } catch {
        if (!cancelled) setStatus('failed')
      } finally {
        attaching.current = false
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isConnected, connectAsync, connectors, attempt])

  const retry = useCallback(() => {
    attaching.current = false
    setAttempt((n) => n + 1)
  }, [])

  return (
    <MiniPayContext.Provider value={{ status, address, retry }}>
      {children}
    </MiniPayContext.Provider>
  )
}
