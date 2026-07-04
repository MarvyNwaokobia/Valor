'use client'

export type ResolvedAuthStatus = 'unauthenticated' | 'ready'

// Placeholder: login is being rebuilt from scratch (Web3Auth removed
// 2026-07-04). Every page reads auth through this hook, so wiring up a real
// provider later only means changing what's returned here.
export function useResolvedAuth() {
  return {
    status: 'unauthenticated' as ResolvedAuthStatus,
    address: undefined as `0x${string}` | undefined,
  }
}
