import { create } from 'zustand'

export type WalletBridgeStatus = 'idle' | 'verifying' | 'retrying' | 'ready' | 'stalled'

// 'web3auth-session-empty' is the only diagnostic now: Web3Auth reports
// connected but its own provider never produces an account after every
// retry — an MPC-derivation failure, not a wagmi timing issue.
export type WalletBridgeDiagnostic = 'web3auth-session-empty' | null

interface WalletBridgeState {
  status: WalletBridgeStatus
  diagnostic: WalletBridgeDiagnostic
  address: `0x${string}` | undefined
  setState: (partial: Partial<Pick<WalletBridgeState, 'status' | 'diagnostic' | 'address'>>) => void
  reset: () => void
}

export const useWalletBridgeStore = create<WalletBridgeState>((set) => ({
  status: 'idle',
  diagnostic: null,
  address: undefined,
  setState: (partial) => set(partial),
  reset: () => set({ status: 'idle', diagnostic: null, address: undefined }),
}))
