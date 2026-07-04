'use client'

import { useEffect, useState } from 'react'
import { useAccount, useConfig } from 'wagmi'
import { useWeb3Auth } from '@web3auth/modal/react'
import { CHAIN_NAMESPACES } from '@web3auth/modal'
import { connectWeb3AuthWithWagmi, resetConnectorState, setupConnector } from '@web3auth/no-modal/react/wagmi'
import { useWalletBridgeStore } from '@/stores/useWalletBridgeStore'

// Web3Auth's own wagmi bridge (Web3AuthWagmiProvider, shipped inside
// @web3auth/modal/react/wagmi) calls connector.getAccounts() the instant
// isConnected flips true, with no wait for the MPC-derived wallet to
// actually be ready. For social/email/SMS logins that can leave wagmi's
// address permanently empty — confirmed by reading the installed v11.3.0
// source, and confirmed in production even with uxMode: 'redirect'.
//
// Root-cause fix: don't route the app's "do we know the address yet"
// decision through wagmi's bridge at all. Ask Web3Auth's own provider
// directly (ground truth, one hop from the source) and publish that address
// to useWalletBridgeStore the moment it's found — every page gates on THAT,
// via useResolvedAuth, not on wagmi. Wagmi's own bridge is still resynced in
// the background (best-effort) purely so the contract-interaction hooks
// that are genuinely built on wagmi (useMarketplace, useGBalance, useRankPool,
// useResale) eventually get a working connection too — but nothing user-facing
// waits on that succeeding.
const RETRY_DELAYS_MS = [0, 800, 1500, 3000, 5000, 5000]
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length

export function useWalletBridgeGuard() {
  const { isInitialized, isConnected, connection, chainNamespace } = useWeb3Auth()
  const { address: wagmiAddress, status: wagmiStatus } = useAccount()
  const wagmiConfig = useConfig()
  const setState = useWalletBridgeStore((s) => s.setState)
  const reset = useWalletBridgeStore((s) => s.reset)
  const resolvedAddress = useWalletBridgeStore((s) => s.address)
  const [attempt, setAttempt] = useState(0)

  const ethProvider = connection?.ethereumProvider
  const isEvm = chainNamespace === CHAIN_NAMESPACES.EIP155

  // Logged out (or SDK not ready yet) — nothing to guard, clear stale state.
  useEffect(() => {
    if (!isInitialized) return
    if (!isConnected) {
      setAttempt(0)
      reset()
    }
  }, [isInitialized, isConnected, reset])

  // Already resolved for this connection — nothing left to do.
  const done = Boolean(resolvedAddress) || !isInitialized || !isConnected || !isEvm || !ethProvider

  useEffect(() => {
    if (done || attempt >= MAX_ATTEMPTS) return

    setState({ status: attempt === 0 ? 'verifying' : 'retrying', diagnostic: null })
    let cancelled = false

    const timer = setTimeout(async () => {
      if (cancelled) return

      let rawAccounts: string[] = []
      try {
        rawAccounts = (await ethProvider!.request({ method: 'eth_accounts', params: [] })) as string[]
      } catch (err) {
        console.warn('[auth] wallet-bridge-guard: eth_accounts probe failed', err)
      }
      if (cancelled) return

      const resolved = rawAccounts?.[0] as `0x${string}` | undefined

      if (resolved) {
        // Ground truth confirmed — this is now the address the rest of the
        // app gates on, regardless of whether wagmi has caught up.
        setState({ status: 'ready', address: resolved, diagnostic: null })

        // Best-effort background resync so wagmi-based contract hooks work
        // too. Failure here does NOT affect the resolved address above.
        const wagmiHasIt = wagmiAddress?.toLowerCase() === resolved.toLowerCase() && wagmiStatus === 'connected'
        if (!wagmiHasIt) {
          try {
            resetConnectorState(wagmiConfig)
            const connector = setupConnector(ethProvider, wagmiConfig)
            await connectWeb3AuthWithWagmi(connector, wagmiConfig)
          } catch (err) {
            console.warn('[auth] wallet-bridge-guard: background wagmi resync failed (non-blocking)', err)
          }
        }
        return
      }

      if (attempt >= MAX_ATTEMPTS - 1) {
        setState({ status: 'stalled', diagnostic: 'web3auth-session-empty' })
        console.error(
          `[auth] wallet-bridge-guard: stalled — Web3Auth produced no account after ${MAX_ATTEMPTS} checks over ~${RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) / 1000}s.`,
        )
        return
      }
      setAttempt((a) => a + 1)
    }, RETRY_DELAYS_MS[attempt])

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [done, attempt, ethProvider, wagmiAddress, wagmiStatus, wagmiConfig, setState])
}
