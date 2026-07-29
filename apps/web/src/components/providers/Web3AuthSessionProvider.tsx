'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { EIP1193Provider } from 'viem'
import { Web3AuthProvider, useWeb3Auth, useWeb3AuthConnect, useWeb3AuthDisconnect } from '@web3auth/modal/react'
import { web3AuthContextConfig, isWeb3AuthConfigured } from '@/lib/web3authConfig'
import { setBridgedProvider, clearBridgedProvider } from '@/lib/walletBridge'

interface Web3AuthWalletValue {
  /** Address of the external wallet connected through Web3Auth, if any. */
  address: `0x${string}` | undefined
  /** False until the SDK has booted; opening the modal before then is queued. */
  isReady: boolean
  /**
   * Opens Web3Auth's wallet chooser. Socials are hidden (see web3authConfig).
   * REJECTS when no wallet ends up connected, which the SDK itself will not do
   * — see the note on `connect` below.
   */
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

/**
 * How long to wait for a wallet to answer before giving up.
 *
 * Nothing in the stack ever times out. Web3Auth starts the WalletConnect pairing
 * in the background to mint a URI, and if that pairing never completes (a relay
 * host the network can't resolve, a wallet that never returns) the promise sits
 * unresolved for ever and the player is left staring at a spinner with no way to
 * tell whether it is slow or dead.
 */
const CONNECT_TIMEOUT_MS = 30_000

const EMPTY: Web3AuthWalletValue = {
  address: undefined,
  isReady: false,
  connect: async () => {},
  disconnect: async () => {},
}

const Web3AuthWalletContext = createContext<Web3AuthWalletValue>(EMPTY)

export function useWeb3AuthWallet() {
  return useContext(Web3AuthWalletContext)
}

// Inner half — must sit under Web3AuthProvider to use its hooks.
function Web3AuthWallet({ children }: { children: ReactNode }) {
  const { isConnected, isInitialized, web3Auth, initError } = useWeb3Auth()
  // `error` is the SDK's captured failure. It is already exposed and was simply
  // never read, which is half of why connect failures were invisible.
  const { connect: web3authConnect, error: connectError } = useWeb3AuthConnect()
  const { disconnect: web3authDisconnect } = useWeb3AuthDisconnect()

  const [address, setAddress] = useState<`0x${string}` | undefined>()

  useEffect(() => {
    if (initError) console.error('[web3auth] init error:', initError)
  }, [initError])

  // Resolve the account first, publish second. The bridge is what every signing
  // path reads, so it must never hold a provider whose address we haven't
  // confirmed — publishing on `isConnected` alone is the race the old Web3Auth
  // integration lost, and why it was pulled out in the first place.
  useEffect(() => {
    const provider = web3Auth?.provider as EIP1193Provider | undefined
    if (!isConnected || !provider) {
      clearBridgedProvider('web3auth')
      setAddress(undefined)
      return
    }
    let active = true
    provider
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (!active) return
        const found = (accounts as string[])?.[0] as `0x${string}` | undefined
        if (!found) {
          clearBridgedProvider('web3auth')
          setAddress(undefined)
          return
        }
        setBridgedProvider('web3auth', provider, found)
        setAddress(found)
      })
      .catch((err) => {
        if (!active) return
        console.error('[web3auth] eth_accounts failed:', err)
        clearBridgedProvider('web3auth')
        setAddress(undefined)
      })
    return () => {
      active = false
    }
  }, [isConnected, web3Auth])

  // Turn Web3Auth's silent failure into a real rejection.
  //
  // `useWeb3AuthConnect().connect()` NEVER throws: it catches internally, parks
  // the error in its own state, and resolves with `null`. So an awaited call
  // that failed is indistinguishable from one that succeeded, and every caller's
  // try/catch is dead code. That is why picking MetaMask, watching it hang, and
  // returning to Valor left the sign-in modal closed with no error and nothing
  // connected — the caller had been told it worked.
  //
  // Three things are fixed here: the null return is treated as failure, the
  // hook's own `connectError` is used for the message when it has one, and the
  // whole thing races a timeout so a pairing that never completes still ends.
  const connect = useCallback(async () => {
    if (!isInitialized) throw new Error('Wallet connect is still loading — give it a moment.')

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(
          "Your wallet didn't respond. Close it, come back, and pick it again — or sign " +
          'in with email or Google, which needs no wallet app at all.',
        )),
        CONNECT_TIMEOUT_MS,
      )
    })

    try {
      const connection = await Promise.race([web3authConnect(), timeout])
      // `null` is the SDK's way of saying it failed. Prefer its own error text
      // when it captured one, since that names the actual cause.
      if (!connection) {
        throw new Error(
          connectError?.message
            ?? 'Could not connect that wallet. Try again, or pick a different one from the list.',
        )
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }, [web3authConnect, isInitialized, connectError])

  const disconnect = useCallback(async () => {
    try {
      await web3authDisconnect()
    } catch (err) {
      console.error('[web3auth] disconnect error:', err)
    }
    // Scoped clear: disconnecting a wallet must not retract a Magic session.
    clearBridgedProvider('web3auth')
    setAddress(undefined)
  }, [web3authDisconnect])

  return (
    <Web3AuthWalletContext.Provider value={{ address, isReady: isInitialized, connect, disconnect }}>
      {children}
    </Web3AuthWalletContext.Provider>
  )
}

// Outer half. With no client id configured the SDK is skipped entirely and the
// context reports "no wallet", so a missing env var costs the connect-a-wallet
// button and nothing else — email and Google sign-in are untouched.
export function Web3AuthSessionProvider({ children }: { children: ReactNode }) {
  if (!isWeb3AuthConfigured) return <>{children}</>
  return (
    <Web3AuthProvider config={web3AuthContextConfig}>
      <Web3AuthWallet>{children}</Web3AuthWallet>
    </Web3AuthProvider>
  )
}
