'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getMagic, AUTH_CALLBACK_PATH } from '@/lib/magic'

export type ResolvedAuthStatus = 'loading' | 'unauthenticated' | 'ready'

interface MagicAuthState {
  status: ResolvedAuthStatus
  address: `0x${string}` | undefined
}

interface MagicAuthContextValue extends MagicAuthState {
  loginWithEmailOTP: (email: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
}

const MagicAuthContext = createContext<MagicAuthContextValue | null>(null)

export function useMagicAuthContext() {
  const ctx = useContext(MagicAuthContext)
  if (!ctx) throw new Error('useMagicAuthContext must be used within MagicAuthProvider')
  return ctx
}

async function resolveAddress(): Promise<`0x${string}` | undefined> {
  const magic = getMagic()
  if (!magic) return undefined
  const loggedIn = await magic.user.isLoggedIn()
  if (!loggedIn) return undefined
  const info = await magic.user.getInfo()
  const address = info.wallets?.ethereum?.publicAddress
  return address ? (address as `0x${string}`) : undefined
}

export function MagicAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MagicAuthState>({ status: 'loading', address: undefined })

  const refresh = useCallback(async () => {
    try {
      const address = await resolveAddress()
      setState({ status: address ? 'ready' : 'unauthenticated', address })
    } catch {
      setState({ status: 'unauthenticated', address: undefined })
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
    setState({ status: 'unauthenticated', address: undefined })
  }, [])

  return (
    <MagicAuthContext.Provider value={{ ...state, loginWithEmailOTP, loginWithGoogle, logout }}>
      {children}
    </MagicAuthContext.Provider>
  )
}
