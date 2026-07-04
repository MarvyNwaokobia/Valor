'use client'

import { useEffect, useState } from 'react'
import { useAccount, useConfig } from 'wagmi'
import { useWeb3Auth } from '@web3auth/modal/react'
import { CHAIN_NAMESPACES } from '@web3auth/modal'
import { connectWeb3AuthWithWagmi, resetConnectorState, setupConnector } from '@web3auth/no-modal/react/wagmi'
import { useWalletBridgeStore } from '@/stores/useWalletBridgeStore'

// Web3Auth's own wagmi bridge (Web3AuthWagmiProvider, shipped inside
// @web3auth/modal/react/wagmi) calls connector.getAccounts() the instant
// isConnected flips true, with no wait for the MPC-derived wallet to actually
// be ready. For social/email logins that can leave wagmi's address
// permanently empty — confirmed still present by reading the installed
// v11.3.0 source, and confirmed in production even with uxMode: 'redirect'.
//
// This hook detects that stall against Web3Auth's own raw provider (ground
// truth, bypassing wagmi) and retries the exact bridge sequence Web3Auth runs
// internally, since account derivation usually finishes a few seconds after
// isConnected fires. If Web3Auth's own provider never produces an account
// either, that's a different, deeper failure — not fixable by retrying the
// wagmi bridge — so it's reported separately via the diagnostic field.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 6000, 8000]
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length

export function useWalletBridgeGuard() {
  const { isConnected, connection, chainNamespace } = useWeb3Auth()
  const { address, status: wagmiStatus } = useAccount()
  const wagmiConfig = useConfig()
  const setStatus = useWalletBridgeStore((s) => s.setStatus)
  const reset = useWalletBridgeStore((s) => s.reset)
  const [attempt, setAttempt] = useState(0)

  const ethProvider = connection?.ethereumProvider
  const isEvm = chainNamespace === CHAIN_NAMESPACES.EIP155
  const wagmiHasAddress = Boolean(address) && wagmiStatus === 'connected'
  const isStalledCandidate = isConnected && isEvm && Boolean(ethProvider) && !wagmiHasAddress

  // Not in a stall candidate state: freshly connected with an address already,
  // or logged out. Clear the retry counter and any reported status.
  useEffect(() => {
    if (!isStalledCandidate) {
      setAttempt(0)
      reset()
    }
  }, [isStalledCandidate, reset])

  useEffect(() => {
    if (!isStalledCandidate || attempt >= MAX_ATTEMPTS) return

    setStatus(attempt === 0 ? 'verifying' : 'retrying')
    let cancelled = false
    const delay = RETRY_DELAYS_MS[attempt]

    const timer = setTimeout(async () => {
      if (cancelled) return

      let rawAccounts: string[] = []
      try {
        rawAccounts = (await ethProvider!.request({ method: 'eth_accounts', params: [] })) as string[]
      } catch (err) {
        console.warn('[auth] wallet-bridge-guard: eth_accounts probe failed', err)
      }
      if (cancelled) return

      if (!rawAccounts?.[0]) {
        // Web3Auth's own session has no account yet.
        if (attempt === MAX_ATTEMPTS - 1) {
          setStatus('stalled', 'web3auth-session-empty')
          console.error(
            `[auth] wallet-bridge-guard: stalled — Web3Auth produced no account after ${MAX_ATTEMPTS} checks (~${RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) / 1000}s). This is not the wagmi bridge race; the session itself never derived a wallet.`,
          )
          return
        }
        setAttempt((a) => a + 1)
        return
      }

      // Web3Auth has an account but wagmi doesn't — re-run Web3Auth's own
      // wagmi-bridge sequence, since the first run likely fired too early.
      try {
        resetConnectorState(wagmiConfig)
        const connector = setupConnector(ethProvider, wagmiConfig)
        await connectWeb3AuthWithWagmi(connector, wagmiConfig)
        console.warn(`[auth] wallet-bridge-guard: resynced wagmi manually on attempt ${attempt + 1}`)
      } catch (err) {
        console.warn('[auth] wallet-bridge-guard: manual wagmi resync threw', err)
      }

      if (cancelled) return

      if (attempt === MAX_ATTEMPTS - 1) {
        setStatus('stalled', 'wagmi-bridge-desync')
        console.error(
          `[auth] wallet-bridge-guard: stalled — Web3Auth has an account but wagmi never reflected it after ${MAX_ATTEMPTS} resync attempts.`,
        )
        return
      }
      setAttempt((a) => a + 1)
    }, delay)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isStalledCandidate, attempt, ethProvider, wagmiConfig, setStatus])
}
