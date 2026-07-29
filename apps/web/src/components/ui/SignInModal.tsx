'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Wallet } from 'lucide-react'
import { useConnect } from 'wagmi'
import { celo } from 'wagmi/chains'
import { useMagicAuthContext } from '@/components/providers/MagicAuthProvider'
import { useWeb3AuthWallet } from '@/components/providers/Web3AuthSessionProvider'
import { isWeb3AuthConfigured } from '@/lib/web3authConfig'

interface Props {
  onClose: () => void
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CONNECTOR_LABELS: Record<string, string> = {
  injected: 'Browser Wallet',
}

// EIP-6963 announcements that are NOT an installed wallet.
//
// `io.metamask.mmc` is @metamask/connect-evm, which Web3Auth's SDK bundles and
// which announces itself on the 6963 channel exactly like a real extension
// would. wagmi's auto-discovery cannot tell the difference, so it became a
// connector, and this modal advertised it as "MetaMask · Detected · connects in
// one tap" — on phones with no MetaMask installed at all. Verified in a clean
// browser: window.ethereum absent, one announcement, and it was this.
//
// Tapping it is what produced the sessions in prod that report wagmi=true,
// injected=false and cannot sign a single thing: a connection that half-exists
// and can never be rebuilt. It is not a detected wallet, so it is not listed as
// one. Anyone who actually has MetaMask reaches it through the chooser below,
// which is the route that works.
const NOT_INSTALLED_WALLETS = new Set(['io.metamask.mmc'])

// Connector errors arrive as developer text ("User rejected the request.",
// "An error occurred when attempting to switch chain."). Say the same thing in
// words that tell the player what to do about it.
function friendlyConnectError(err: unknown): string {
  const raw = err instanceof Error ? err.message : ''
  if (/rejected|denied|cancel/i.test(raw)) return 'You cancelled that in your wallet. Tap to try again.'
  if (/chain|network/i.test(raw)) return 'Your wallet needs to be on the Celo network. Approve the network switch and try again.'
  if (/already pending|pending request/i.test(raw)) return 'Your wallet already has a request open — finish it there first.'
  return 'Could not connect that wallet. Try again, or use the wallet chooser below.'
}

export default function SignInModal({ onClose }: Props) {
  const { loginWithEmailOTP, loginWithGoogle } = useMagicAuthContext()
  const { connect: connectWeb3AuthWallet, isReady: web3authReady } = useWeb3AuthWallet()
  const { connectors, connectAsync } = useConnect()
  // wagmi's static config always includes the generic `injected` connector,
  // regardless of whether a provider actually exists for it to target — on
  // a plain mobile browser (no wallet app, no extension) there's no
  // window.ethereum at all, so it'd show a button that can never work.
  // wagmi auto-discovers real wallet extensions individually by name via
  // EIP-6963 (MetaMask, Coinbase Wallet, Brave Wallet, ...); only fall back
  // to the generic one if a legacy (non-EIP-6963) provider is actually
  // present, and hide it entirely once a named one exists.
  const [hasLegacyProvider, setHasLegacyProvider] = useState(false)
  useEffect(() => {
    setHasLegacyProvider(typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum)
  }, [])
  const installed = connectors.filter((c) => !NOT_INSTALLED_WALLETS.has(c.id))
  const hasNamedInjected = installed.some((c) => c.type === 'injected' && c.id !== 'injected')
  const visibleConnectors = installed
    .filter((c) => c.id !== 'injected' || (hasLegacyProvider && !hasNamedInjected))
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState<'email' | 'google' | string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleWeb3AuthWallet() {
    if (pending) return
    setPending('web3auth')
    setError(null)
    try {
      // Only closes on a REAL connection now. This used to run unconditionally,
      // because the SDK resolves with null instead of throwing — so a wallet that
      // hung got the same treatment as one that connected: modal closed, no
      // error, nothing signed in. The provider now rejects on failure, which is
      // what makes this catch reachable at all.
      await connectWeb3AuthWallet()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open wallet options — try again.')
    } finally {
      setPending(null)
    }
  }

  async function handleConnectWallet(connectorId: string) {
    if (pending) return
    const connector = connectors.find((c) => c.id === connectorId)
    if (!connector) return
    setPending(connectorId)
    setError(null)
    try {
      // connectAsync, NOT connect. `useConnect().connect` is a fire-and-forget
      // mutate: it returns void, never throws, and parks failures in its own
      // state. So `await connect(...)` settled instantly whatever happened, and
      // the line below closed the modal on a connect that had failed or that the
      // player had rejected — no wallet, no error, no clue. Reproduced in a
      // clean browser: the modal vanished 1.5s after the tap with nothing
      // connected. Only the async variant actually reports the outcome.
      //
      // `chainId` connects straight onto Celo. Without it a wallet sitting on
      // Ethereum connects happily and then rejects every signature later, since
      // our EIP-712 domains and writes are all Celo — a failure that surfaces at
      // the checkout, which is the worst place to find it.
      await connectAsync({ connector, chainId: celo.id })
      onClose()
    } catch (err) {
      setError(friendlyConnectError(err))
    } finally {
      setPending(null)
    }
  }

  async function handleEmail() {
    if (!EMAIL_RE.test(email) || pending) return
    setPending('email')
    setError(null)
    try {
      // Magic shows its own OTP-entry modal on top of this one and resolves
      // once the user enters the code — nothing else to build here.
      await loginWithEmailOTP(email)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed — try again.')
    } finally {
      setPending(null)
    }
  }

  async function handleGoogle() {
    if (pending) return
    setPending('google')
    setError(null)
    try {
      await loginWithGoogle() // navigates away on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed — try again.')
      setPending(null)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <motion.div
        // Capped and scrollable: with the mobile wallet list expanded, the
        // panel is taller than a phone viewport and Cancel would sit off-screen.
        className="relative w-full max-w-sm max-h-[85dvh] overflow-y-auto rounded-2xl border border-valor-border bg-valor-surface p-6 flex flex-col gap-5"
        initial={{ scale: 0.92, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 16 }}
      >
        <div>
          <h2 className="font-display font-black text-white text-xl">Enter Valor</h2>
          <p className="text-slate-400 text-sm mt-1">
            One human, one fighter. Sign in to forge your warrior.
          </p>
        </div>

        <button
          onClick={handleGoogle}
          disabled={!!pending}
          className="flex items-center justify-center gap-2.5 w-full py-3 rounded-xl bg-white text-black font-bold text-sm hover:bg-slate-100 transition-colors disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.68-3.87 2.68-6.62Z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"/>
            <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"/>
          </svg>
          {pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-valor-border" />
          <span className="text-[10px] uppercase tracking-widest text-slate-600 font-bold">or</span>
          <div className="flex-1 h-px bg-valor-border" />
        </div>

        <div className="flex flex-col gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value.trim())}
            placeholder="you@example.com"
            className="w-full px-3.5 py-3 rounded-xl bg-valor-surface-2 border border-valor-border text-white font-medium text-sm placeholder:text-slate-600 focus:outline-none focus:border-valor-gold/60 transition-colors"
            onKeyDown={e => { if (e.key === 'Enter') handleEmail() }}
            disabled={!!pending}
          />
          <button
            onClick={handleEmail}
            disabled={!EMAIL_RE.test(email) || !!pending}
            className="w-full py-3 rounded-xl bg-valor-gold text-black font-bold text-sm hover:bg-valor-gold-light transition-colors disabled:opacity-40"
          >
            {pending === 'email' ? 'Sending code…' : 'Continue with Email'}
          </button>
        </div>

        {/* Bring-your-own-wallet, in exactly two rows now: a wallet already in
            this page (no network hop at all), then the chooser for every other
            wallet on earth, WalletConnect included. Our own WalletConnect row
            used to sit here too and was pure duplication — the chooser already
            offers it, and running both put two WalletConnect cores on one page. */}
        {(visibleConnectors.length > 0 || isWeb3AuthConfigured) && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-valor-border" />
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">or connect a wallet</span>
              <div className="flex-1 h-px bg-valor-border" />
            </div>

            {/* One grouped list rather than two identical floating cards. The
                rows aren't equivalent — a detected wallet connects in a tap,
                the chooser opens a picker — so each gets a subtitle saying
                which it is, and a chevron marks the one that opens more UI. */}
            <div className="rounded-xl border border-valor-border bg-valor-surface-2/50 overflow-hidden divide-y divide-valor-border">
              {visibleConnectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => handleConnectWallet(connector.id)}
                  disabled={!!pending}
                  className="group flex items-center gap-3 w-full px-3.5 py-3 text-left transition-colors hover:bg-valor-gold/[0.07] disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span className="flex items-center justify-center w-9 h-9 shrink-0 rounded-lg bg-valor-surface border border-valor-border text-slate-300 transition-colors group-hover:border-valor-gold/50 group-hover:text-valor-gold">
                    <Wallet size={16} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-white font-bold text-sm truncate">
                      {CONNECTOR_LABELS[connector.id] ?? connector.name}
                    </span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {/* Every row here is now a wallet genuinely present in
                          this page, so "detected" is finally true of all of
                          them. */}
                      {pending === connector.id ? 'Connecting…' : 'Detected · connects in one tap'}
                    </span>
                  </span>
                </button>
              ))}

              {isWeb3AuthConfigured && (
                <button
                  onClick={handleWeb3AuthWallet}
                  disabled={!!pending || !web3authReady}
                  className="group flex items-center gap-3 w-full px-3.5 py-3 text-left transition-colors hover:bg-valor-gold/[0.07] disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span className="flex items-center justify-center w-9 h-9 shrink-0 rounded-lg bg-valor-surface border border-valor-border text-slate-300 transition-colors group-hover:border-valor-gold/50 group-hover:text-valor-gold">
                    <Wallet size={16} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-white font-bold text-sm truncate">
                      {visibleConnectors.length > 0 ? 'Other Wallets' : 'Connect a Wallet'}
                    </span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {pending === 'web3auth'
                        ? 'Opening wallets…'
                        : !web3authReady
                          ? 'Loading…'
                          : visibleConnectors.length > 0
                            // Don't name a wallet that already has its own row above.
                            ? 'WalletConnect, Coinbase, Trust and more'
                            : 'MetaMask, Coinbase, Trust and more'}
                    </span>
                  </span>
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-slate-600 transition-colors group-hover:text-valor-gold"
                    aria-hidden
                  />
                </button>
              )}
            </div>
          </>
        )}


        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="text-red-400 text-xs font-medium -mt-2"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <button
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Cancel
        </button>
      </motion.div>
    </motion.div>
  )
}
