import { create } from 'zustand'

export type WalletBridgeStatus = 'idle' | 'verifying' | 'retrying' | 'stalled'

// 'web3auth-session-empty': Web3Auth itself reports connected but its own
// provider never produces an account — not the wagmi race, something deeper
// (MPC key reconstruction) failed.
// 'wagmi-bridge-desync': Web3Auth has an account but wagmi never picked it up
// even after manually re-running Web3Auth's own bridge sequence.
export type WalletBridgeDiagnostic = 'web3auth-session-empty' | 'wagmi-bridge-desync' | null

interface WalletBridgeState {
  status: WalletBridgeStatus
  diagnostic: WalletBridgeDiagnostic
  setStatus: (status: WalletBridgeStatus, diagnostic?: WalletBridgeDiagnostic) => void
  reset: () => void
}

export const useWalletBridgeStore = create<WalletBridgeState>((set) => ({
  status: 'idle',
  diagnostic: null,
  setStatus: (status, diagnostic = null) => set({ status, diagnostic }),
  reset: () => set({ status: 'idle', diagnostic: null }),
}))
