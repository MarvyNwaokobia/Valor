'use client'

import { useWeb3Auth, useWeb3AuthDisconnect } from '@web3auth/modal/react'

// `useWeb3Auth().web3Auth` is typed as the base `Web3AuthNoModal`, but
// `Web3AuthProvider` always constructs the modal-capable `Web3Auth` subclass
// under the hood, which adds a zero-arg `connect()` that opens the full login
// modal — not exposed in the public types (see ConnectButton.tsx).
interface ModalCapableWeb3Auth {
  connect(): Promise<unknown>
}

// A stalled sign-in (Web3Auth's own session never derived a wallet) can't be
// fixed by waiting longer — the only real recovery is a full disconnect
// followed by a fresh login attempt.
export function useAuthRetry() {
  const { web3Auth } = useWeb3Auth()
  const { disconnect } = useWeb3AuthDisconnect()

  return async function retry() {
    try {
      await disconnect({ cleanup: true })
    } catch {
      // proceed to reconnect regardless
    }
    void (web3Auth as unknown as ModalCapableWeb3Auth)?.connect()
  }
}
