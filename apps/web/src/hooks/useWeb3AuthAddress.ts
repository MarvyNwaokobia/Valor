'use client'

import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { useWeb3Auth } from '@web3auth/modal/react'

export type Web3AuthAddressStatus = 'unauthenticated' | 'resolving' | 'ready' | 'failed'

export interface UseWeb3AuthAddressReturn {
  address: `0x${string}` | undefined
  status: Web3AuthAddressStatus
  retry: () => void
}

const MAX_ATTEMPTS = 8
const RETRY_DELAY_MS = 400

/**
 * wagmi's Web3Auth bridge resolves `useAccount().address` in a single,
 * non-retrying snapshot the instant `isConnected` flips true. For social
 * logins (Google/email) the MPC-derived wallet can still be arriving at
 * that exact moment, so the snapshot lands empty and never retries —
 * `useAccount().address` then stays `undefined` forever even though
 * Web3Auth itself is connected. Fall back to polling `eth_accounts`
 * directly off Web3Auth's own provider (`connection.ethereumProvider`)
 * until the address shows up.
 */
export function useWeb3AuthAddress(): UseWeb3AuthAddressReturn {
  const { isConnected: authenticated, connection } = useWeb3Auth()
  const { address: wagmiAddress } = useAccount()

  const [fallbackAddress, setFallbackAddress] = useState<`0x${string}` | undefined>()
  const [failed, setFailed] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const epochRef = useRef(0)

  useEffect(() => {
    const epoch = ++epochRef.current
    setFailed(false)

    if (!authenticated) {
      setFallbackAddress(undefined)
      return
    }
    if (wagmiAddress) return

    const provider = connection?.ethereumProvider
    if (!provider) return

    let cancelled = false

    const poll = async (attempt: number) => {
      try {
        const accounts = await provider.request<unknown, string[]>({ method: 'eth_accounts', params: [] })
        if (cancelled || epochRef.current !== epoch) return
        const account = accounts?.[0]
        if (account) {
          setFallbackAddress(account as `0x${string}`)
          return
        }
      } catch {
        if (cancelled || epochRef.current !== epoch) return
      }
      if (attempt >= MAX_ATTEMPTS) {
        if (!cancelled && epochRef.current === epoch) setFailed(true)
        return
      }
      setTimeout(() => {
        if (!cancelled) void poll(attempt + 1)
      }, RETRY_DELAY_MS)
    }

    void poll(1)

    return () => {
      cancelled = true
    }
  }, [authenticated, wagmiAddress, connection, retryNonce])

  const address = wagmiAddress ?? fallbackAddress

  let status: Web3AuthAddressStatus
  if (!authenticated) status = 'unauthenticated'
  else if (address) status = 'ready'
  else if (failed) status = 'failed'
  else status = 'resolving'

  return { address, status, retry: () => setRetryNonce(n => n + 1) }
}
