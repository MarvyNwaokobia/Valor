'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Wallet } from 'lucide-react'
import { useConnect } from 'wagmi'
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

// The landing page's ENTER VALOR button, reused so the modal's primary action
// reads as the same object the player just pressed.
const GOLD_GRADIENT =
  'linear-gradient(135deg, #fefce8 0%, #fde047 20%, #eab308 55%, #ca8a04 80%, #92400e 100%)'

/** Uppercase Cinzel rule used to separate the three ways in. */
function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent to-valor-border" />
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
        {label}
      </span>
      <div className="flex-1 h-px bg-gradient-to-l from-transparent to-valor-border" />
    </div>
  )
}

export default function SignInModal({ onClose }: Props) {
  const { loginWithEmailOTP, loginWithGoogle } = useMagicAuthContext()
  const { connect: connectWeb3AuthWallet, isReady: web3authReady } = useWeb3AuthWallet()
  const { connectors, connect } = useConnect()
  const reduceMotion = useReducedMotion()
  const emailId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  // wagmi's static config always includes the generic `injected` connector,
  // whether or not a provider exists for it to target. wagmi auto-discovers real
  // extensions individually by name via EIP-6963 (MetaMask, Coinbase, Brave...),
  // so only fall back to the generic one when a legacy provider is actually
  // present, and hide it once a named one exists.
  const [hasLegacyProvider, setHasLegacyProvider] = useState(false)
  useEffect(() => {
    setHasLegacyProvider(typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum)
  }, [])
  const hasNamedInjected = connectors.some((c) => c.type === 'injected' && c.id !== 'injected')
  const visibleConnectors = connectors.filter(
    (c) => c.id !== 'injected' || (hasLegacyProvider && !hasNamedInjected),
  )

  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState<'email' | 'google' | 'web3auth' | string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const emailInvalid = touched && email.length > 0 && !EMAIL_RE.test(email)
  const busy = !!pending

  // Escape closes, matching every other dismissible surface in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pending])

  async function handleGoogle() {
    if (busy) return
    setPending('google')
    setError(null)
    try {
      await loginWithGoogle() // navigates away on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed — try again.')
      setPending(null)
    }
  }

  async function handleEmail() {
    if (!EMAIL_RE.test(email) || busy) return
    setPending('email')
    setError(null)
    try {
      // Magic shows its own OTP-entry modal on top of this one and resolves
      // once the player enters the code — nothing else to build here.
      await loginWithEmailOTP(email)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed — try again.')
    } finally {
      setPending(null)
    }
  }

  async function handleWeb3AuthWallet() {
    if (busy) return
    setPending('web3auth')
    setError(null)
    try {
      await connectWeb3AuthWallet()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open wallet options — try again.')
    } finally {
      setPending(null)
    }
  }

  async function handleConnectWallet(connectorId: string) {
    if (busy) return
    const connector = connectors.find((c) => c.id === connectorId)
    if (!connector) return
    setPending(connectorId)
    setError(null)
    try {
      await connect({ connector })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect wallet — try again.')
    } finally {
      setPending(null)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* Click-outside lives on the scrim itself. It was previously on the
          wrapper above, which never fired: this absolutely-positioned layer
          covers the wrapper, so it — not the wrapper — is always the event
          target, and the `target === currentTarget` check could never pass. */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={() => { if (!pending) onClose() }}
        aria-hidden
      />

      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${emailId}-title`}
        className="relative w-full max-w-sm max-h-[88dvh] overflow-y-auto border border-valor-border bg-valor-surface px-6 pt-6 pb-5 flex flex-col gap-4"
        style={{
          // Deep shadow plus a gold rim, so the panel reads as lit from the
          // same source as the gold CTA rather than floating grey.
          boxShadow: '0 24px 70px rgba(0,0,0,0.9), 0 0 0 1px rgba(234,179,8,0.10), 0 0 60px rgba(234,179,8,0.06)',
        }}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 18 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        // Exit is quicker than enter so dismissing feels responsive.
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: reduceMotion ? 0.15 : 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Gold hairline crest — the one bit of chrome that ties the panel to
            the landing page's gold without competing with the CTA. */}
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, #eab308 22%, #fde047 50%, #eab308 78%, transparent)' }}
          aria-hidden
        />

        <div className="flex flex-col gap-1.5">
          <h2
            id={`${emailId}-title`}
            className="font-display font-black uppercase text-white text-[22px] leading-none tracking-[0.13em]"
          >
            Enter Valor
          </h2>
          <p className="text-slate-400 text-[13px] leading-relaxed">
            One human, one fighter. Sign in to forge your warrior.
          </p>
        </div>

        {/* ── Google ─────────────────────────────────────────────────────
            Google's own dark-theme button spec: their mark on a near-black
            surface. Deliberately not restyled in Valor gold — the logo has to
            stay recognisable, and the gold is reserved for the primary CTA. */}
        <button
          onClick={handleGoogle}
          disabled={busy}
          className="group flex items-center justify-center gap-3 w-full min-h-12 rounded-md border border-[#5f6368] bg-[#131314] text-white font-semibold text-sm tracking-wide transition-colors hover:bg-[#1c1c1f] hover:border-[#8e918f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valor-gold focus-visible:ring-offset-2 focus-visible:ring-offset-valor-surface disabled:opacity-45 disabled:cursor-not-allowed"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="shrink-0">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.68-3.87 2.68-6.62Z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"/>
            <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"/>
          </svg>
          {pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <Divider label="or" />

        {/* ── Email ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor={emailId}
            className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400"
          >
            Email address
          </label>
          <input
            id={emailId}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={e => { setEmail(e.target.value.trim()); if (error) setError(null) }}
            onBlur={() => setTouched(true)}
            placeholder="you@example.com"
            aria-invalid={emailInvalid}
            aria-describedby={emailInvalid ? `${emailId}-err` : undefined}
            className={`w-full min-h-12 px-3.5 rounded-md bg-valor-surface-2 border text-white font-medium text-base placeholder:text-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-valor-gold/70 focus:border-valor-gold/70 disabled:opacity-45 ${
              emailInvalid ? 'border-red-500/70' : 'border-valor-border'
            }`}
            onKeyDown={e => { if (e.key === 'Enter') handleEmail() }}
            disabled={busy}
          />
          {emailInvalid && (
            <p id={`${emailId}-err`} role="alert" className="text-red-400 text-xs font-medium">
              Enter a valid email address.
            </p>
          )}

          {/* Primary action. Angular clip + gold gradient + sheen, matching the
              landing page's ENTER VALOR so the flow feels continuous. */}
          <button
            onClick={handleEmail}
            disabled={!EMAIL_RE.test(email) || busy}
            className="relative overflow-hidden clip-angled w-full min-h-12 font-display font-black uppercase text-[13px] tracking-[0.2em] text-[#080610] transition-transform enabled:hover:scale-[1.015] enabled:active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valor-gold-light focus-visible:ring-offset-2 focus-visible:ring-offset-valor-surface disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: GOLD_GRADIENT,
              // Drop the glow while disabled. Lit gold at 40% opacity reads as
              // muddy olive rather than "not yet available", and this is the
              // first thing on screen before an email is typed.
              boxShadow: EMAIL_RE.test(email) && !busy
                ? '0 0 26px rgba(234,179,8,0.34), 0 4px 16px rgba(0,0,0,0.7)'
                : '0 4px 16px rgba(0,0,0,0.7)',
            }}
          >
            {!reduceMotion && EMAIL_RE.test(email) && !busy && (
              <motion.span
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'linear-gradient(108deg, transparent 28%, rgba(255,255,255,0.32) 50%, transparent 72%)' }}
                animate={{ x: ['-140%', '220%'] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'linear', repeatDelay: 3.2 }}
                aria-hidden
              />
            )}
            <span className="relative">
              {pending === 'email' ? 'Sending code…' : 'Continue with Email'}
            </span>
          </button>
        </div>

        {/* ── Bring your own wallet ──────────────────────────────────────── */}
        {(visibleConnectors.length > 0 || isWeb3AuthConfigured) && (
          <>
            <Divider label="or connect a wallet" />

            <div className="flex flex-col gap-2">
              {visibleConnectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => handleConnectWallet(connector.id)}
                  disabled={busy}
                  className="flex items-center justify-center gap-2.5 w-full min-h-12 rounded-md bg-valor-surface-2 border border-valor-border text-slate-200 font-semibold text-sm transition-colors hover:border-valor-gold/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valor-gold focus-visible:ring-offset-2 focus-visible:ring-offset-valor-surface disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Wallet size={16} className="shrink-0" aria-hidden />
                  {pending === connector.id ? 'Connecting…' : (CONNECTOR_LABELS[connector.id] ?? connector.name)}
                </button>
              ))}

              {isWeb3AuthConfigured && (
                <button
                  onClick={handleWeb3AuthWallet}
                  disabled={busy || !web3authReady}
                  className="flex items-center justify-center gap-2.5 w-full min-h-12 rounded-md bg-valor-surface-2 border border-valor-border text-slate-200 font-semibold text-sm transition-colors hover:border-valor-gold/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valor-gold focus-visible:ring-offset-2 focus-visible:ring-offset-valor-surface disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Wallet size={16} className="shrink-0" aria-hidden />
                  {pending === 'web3auth'
                    ? 'Opening wallets…'
                    : visibleConnectors.length > 0
                      ? 'Other Wallets'
                      : 'Connect a Wallet'}
                </button>
              )}
            </div>
          </>
        )}

        <AnimatePresence>
          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="text-red-400 text-xs font-medium"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <button
          onClick={onClose}
          disabled={busy}
          className="mx-auto font-display text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-valor-gold focus-visible:ring-offset-2 focus-visible:ring-offset-valor-surface disabled:opacity-40"
        >
          Cancel
        </button>
      </motion.div>
    </motion.div>
  )
}
