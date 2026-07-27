'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { EIP1193Provider } from 'viem'
import { getMagic, AUTH_CALLBACK_PATH } from '@/lib/magic'
import { setBridgedProvider, clearBridgedProvider } from '@/lib/walletBridge'

const API = process.env.NEXT_PUBLIC_API_URL ?? ''

export type ResolvedAuthStatus = 'loading' | 'unauthenticated' | 'ready'

interface MagicAuthState {
  status: ResolvedAuthStatus
  address: `0x${string}` | undefined
  // Login identity — same person can hold >1 wallet (email vs Google, Safari-ITP),
  // so we surface these to store per-wallet and detect multi-account cases.
  email: string | undefined
  issuer: string | undefined
}

interface MagicAuthContextValue extends MagicAuthState {
  loginWithEmailOTP: (email: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const MagicAuthContext = createContext<MagicAuthContextValue | null>(null)

export function useMagicAuthContext() {
  const ctx = useContext(MagicAuthContext)
  if (!ctx) throw new Error('useMagicAuthContext must be used within MagicAuthProvider')
  return ctx
}

interface ResolvedIdentity {
  address: `0x${string}` | undefined
  email: string | undefined
  issuer: string | undefined
}

async function resolveIdentity(): Promise<ResolvedIdentity> {
  const magic = getMagic()
  if (!magic) return { address: undefined, email: undefined, issuer: undefined }
  const loggedIn = await magic.user.isLoggedIn()
  if (!loggedIn) return { address: undefined, email: undefined, issuer: undefined }

  // isLoggedIn() is not the same question as "can this session sign".
  //
  // On mobile Safari and in an installed PWA, ITP evicts Magic's storage while
  // leaving enough behind to report a live session. The app then looked signed
  // in and failed at the first signature with Magic's own
  // "-32603 User denied account access" — which reads as though the player
  // refused a prompt that never appeared, and which they only discovered at the
  // moment they tried to spend money.
  //
  // Asking the provider for an account is the cheap proof. A session that cannot
  // produce one is treated as signed OUT, so the player is asked to sign in
  // again up front instead of hitting a wall at checkout.
  try {
    const accounts = (await (magic.rpcProvider as unknown as {
      request: (a: { method: string }) => Promise<string[]>
    }).request({ method: 'eth_accounts' })) ?? []
    if (!accounts.length) {
      await magic.user.logout().catch(() => {})
      return { address: undefined, email: undefined, issuer: undefined }
    }
  } catch {
    await magic.user.logout().catch(() => {})
    return { address: undefined, email: undefined, issuer: undefined }
  }

  const info = await magic.user.getInfo()
  const address = info.wallets?.ethereum?.publicAddress
  return {
    address: address ? (address as `0x${string}`) : undefined,
    email: info.email ?? undefined,
    issuer: info.issuer ?? undefined,
  }
}

export function MagicAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MagicAuthState>({ status: 'loading', address: undefined, email: undefined, issuer: undefined })

  const refresh = useCallback(async () => {
    try {
      const { address, email, issuer } = await resolveIdentity()
      // Publish to the bridge only now that Magic has actually resolved an
      // address. Everything that signs reads the provider from there, so
      // publishing any earlier would hand out a client for a session that
      // isn't real yet.
      const magic = getMagic()
      if (address && magic) {
        setBridgedProvider('magic', magic.rpcProvider as unknown as EIP1193Provider, address)
      } else {
        clearBridgedProvider('magic')
      }
      setState({ status: address ? 'ready' : 'unauthenticated', address, email, issuer })
      // Best-effort backfill so returning users' login identity is captured too. The
      // endpoint only UPDATEs an existing row, so it's a no-op until onboarding creates one.
      if (address && (email || issuer)) {
        void fetch(`${API}/players/${address.toLowerCase()}/identity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, issuer }),
        }).catch(() => {})
      }
    } catch {
      clearBridgedProvider('magic')
      setState({ status: 'unauthenticated', address: undefined, email: undefined, issuer: undefined })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const loginWithEmailOTP = useCallback(async (email: string) => {
    const magic = getMagic()
    if (!magic) return
    await magic.auth.loginWithEmailOTP({ email, showUI: true })
    await refresh()
  }, [refresh])

  const loginWithGoogle = useCallback(async () => {
    const magic = getMagic()
    if (!magic) return
    // Redirects away from the page — resolution happens on AUTH_CALLBACK_PATH.
    await magic.oauth2.loginWithRedirect({
      provider: 'google',
      redirectURI: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
    })
  }, [])

  const logout = useCallback(async () => {
    const magic = getMagic()
    if (!magic) return
    await magic.user.logout()
    // Scoped to 'magic' so signing out of Magic can never retract a provider
    // published by another SDK.
    clearBridgedProvider('magic')
    setState({ status: 'unauthenticated', address: undefined, email: undefined, issuer: undefined })
  }, [])

  return (
    <MagicAuthContext.Provider value={{ ...state, loginWithEmailOTP, loginWithGoogle, logout, refresh }}>
      {children}
    </MagicAuthContext.Provider>
  )
}
