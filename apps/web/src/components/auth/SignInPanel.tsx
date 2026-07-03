'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useConnect, useAccount } from 'wagmi'
import { WALLET_ADAPTERS, ADAPTER_STATUS } from '@web3auth/base'
import { LOGIN_PROVIDER } from '@web3auth/auth'
import { getWeb3Auth, initWeb3Auth, getLastAdapterError } from '@/lib/wagmi-config'

export const OAUTH_PENDING_KEY = 'valor_oauth_pending'

function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : ''
  return msg ? ` (${msg})` : ''
}

interface Props {
  onClose?: () => void
}

export default function SignInPanel({ onClose }: Props) {
  const { isConnected } = useAccount()
  const { connect, connectors, isPending, error: connectError } = useConnect()

  const [connecting, setConnecting] = useState(() =>
    typeof window !== 'undefined' && !!sessionStorage.getItem(OAUTH_PENDING_KEY),
  )
  const [authChecking, setAuthChecking] = useState(() =>
    typeof window !== 'undefined' && !!sessionStorage.getItem(OAUTH_PENDING_KEY),
  )
  const [slowWarning, setSlowWarning] = useState(false)
  const [authError, setAuthError] = useState('')
  const [showWalletPicker, setShowWalletPicker] = useState(false)

  const web3authConnector = connectors.find((c) => c.id === 'web3auth-eoa')
  const walletOptions = connectors.filter((c) => c.id !== 'web3auth-eoa')

  useEffect(() => {
    if (authChecking) return
    if (!isPending && !isConnected) setConnecting(false)
  }, [isPending, isConnected, authChecking])

  // Mount: handle an OAuth redirect coming back, or pre-warm Web3Auth.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (window.location.hash.startsWith('#error=') || params.has('error')) {
      const msg = params.get('error_description') || 'Sign-in was cancelled.'
      setAuthError(msg.replace(/\+/g, ' '))
      window.history.replaceState(null, '', window.location.pathname)
      sessionStorage.removeItem(OAUTH_PENDING_KEY)
      setConnecting(false)
      setAuthChecking(false)
      return
    }

    const wasOAuthPending = !!sessionStorage.getItem(OAUTH_PENDING_KEY)

    initWeb3Auth().then(() => {
      sessionStorage.removeItem(OAUTH_PENDING_KEY)
      const w = getWeb3Auth()
      if (!w.connected) {
        setConnecting(false)
        setAuthChecking(false)
        if (wasOAuthPending) {
          const err = getLastAdapterError()
          setAuthError(`Sign-in didn't complete${describeError(err)}. Please try again.`)
        }
        return
      }
      if (web3authConnector) {
        setConnecting(true)
        connect({ connector: web3authConnector })
      }
      setAuthChecking(false)
    }).catch((err) => {
      sessionStorage.removeItem(OAUTH_PENDING_KEY)
      setConnecting(false)
      setAuthChecking(false)
      if (wasOAuthPending) {
        setAuthError(`Sign-in didn't complete${describeError(err)}. Please try again.`)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (connectError && !isConnected) {
      setConnecting(false)
      setAuthError(`Sign-in didn't complete${describeError(connectError)}. Please try again.`)
    }
  }, [connectError, isConnected])

  // Slow warning at 10s, hard reset at 20s — a stuck connect() should never
  // strand the user with a spinner and no way out.
  useEffect(() => {
    if (!connecting && !isPending) { setSlowWarning(false); return }
    if (isConnected) return
    const warn = setTimeout(() => setSlowWarning(true), 10_000)
    const bail = setTimeout(() => {
      setConnecting(false)
      setAuthChecking(false)
      setSlowWarning(false)
      setAuthError("Sign-in didn't complete. Please try again.")
    }, 20_000)
    return () => { clearTimeout(warn); clearTimeout(bail) }
  }, [connecting, isPending, isConnected])

  const triggerConnect = async (loginProvider: string) => {
    setConnecting(true)
    setAuthError('')
    sessionStorage.setItem(OAUTH_PENDING_KEY, '1')
    const web3auth = getWeb3Auth()
    try {
      await initWeb3Auth()
      // connectTo() fires the adapter's connect() without awaiting/catching
      // it internally — if a previous attempt is still CONNECTING, calling
      // it again throws "Already connecting" as an unhandled rejection and
      // the page hangs forever with no feedback. Bail out early instead.
      const authAdapter = web3auth.walletAdapters?.[WALLET_ADAPTERS.AUTH]
      if (authAdapter?.status === ADAPTER_STATUS.CONNECTING) {
        throw new Error('A previous sign-in attempt is still in progress — please wait or refresh the page')
      }
      await web3auth.connectTo(WALLET_ADAPTERS.AUTH, {
        loginProvider,
        redirectUrl: window.location.origin + window.location.pathname,
      })
    } catch (err) {
      sessionStorage.removeItem(OAUTH_PENDING_KEY)
      setConnecting(false)
      setAuthError(`Sign-in didn't complete${describeError(err)}. Please try again.`)
      return
    }
    if (web3authConnector) connect({ connector: web3authConnector })
    else setConnecting(false)
  }

  const connectWithWallet = (connectorId: string) => {
    setAuthError('')
    const c = connectors.find((c) => c.id === connectorId)
    if (c) {
      setShowWalletPicker(false)
      setConnecting(true)
      connect({ connector: c })
    } else {
      setAuthError('Wallet not available. Please install it and try again.')
    }
  }

  if (connecting || isPending) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 px-6" style={{ background: '#04030c' }}>
        <motion.div
          className="w-14 h-14 rounded-full border-4 border-valor-border border-t-valor-gold"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
        <div className="text-center">
          <p className="font-display font-black text-white text-lg mb-1">Connecting to your account…</p>
          <p className="text-slate-500 text-sm">This takes a moment on first sign-in</p>
          {slowWarning && (
            <button
              onClick={() => {
                setConnecting(false)
                setAuthChecking(false)
                setSlowWarning(false)
                setAuthError("Sign-in didn't complete. Please try again.")
              }}
              className="mt-4 text-xs text-valor-gold hover:text-valor-gold-light underline"
            >
              Taking too long? Try again
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 px-6" style={{ background: '#04030c' }}>
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-500 hover:text-white transition-colors text-2xl leading-none"
        >
          ✕
        </button>
      )}

      <div className="w-full max-w-sm">
        <p className="font-display font-black text-white text-2xl text-center mb-6">Enter Valor</p>

        {authError && (
          <div className="mb-4 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-between gap-2">
            <span className="text-xs text-red-400 leading-relaxed">{authError}</span>
            <button onClick={() => setAuthError('')} className="text-red-400 text-sm leading-none shrink-0">✕</button>
          </div>
        )}

        <motion.button
          onClick={() => triggerConnect(LOGIN_PROVIDER.GOOGLE)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-3.5 mb-2.5 rounded-xl bg-valor-surface-2 border border-valor-border text-white font-bold text-sm hover:bg-valor-border transition-colors"
        >
          Continue with Google
        </motion.button>

        <motion.button
          onClick={() => triggerConnect(LOGIN_PROVIDER.EMAIL_PASSWORDLESS)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-3.5 mb-2.5 rounded-xl bg-valor-surface-2 border border-valor-border text-white font-bold text-sm hover:bg-valor-border transition-colors"
        >
          Continue with Email
        </motion.button>

        <div>
          <button
            onClick={() => setShowWalletPicker((v) => !v)}
            className="w-full py-3.5 rounded-xl border text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
            style={{
              background: showWalletPicker ? 'rgba(234,179,8,0.08)' : undefined,
              borderColor: showWalletPicker ? 'rgba(234,179,8,0.3)' : undefined,
            }}
          >
            Connect Wallet
            <span className="text-[10px] opacity-50" style={{ transform: showWalletPicker ? 'rotate(180deg)' : undefined }}>▾</span>
          </button>
          {showWalletPicker && (
            <div className="flex flex-col gap-2 mt-2">
              {walletOptions.map((c) => (
                <button
                  key={c.id}
                  onClick={() => connectWithWallet(c.id)}
                  className="w-full py-2.5 px-4 rounded-xl bg-valor-surface-2 border border-valor-border text-white text-sm font-semibold text-left hover:bg-valor-border transition-colors"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
