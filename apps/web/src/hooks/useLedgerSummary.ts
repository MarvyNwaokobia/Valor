import { useQuery } from '@tanstack/react-query'
import { useActiveWalletClient } from '@/hooks/useActiveWalletClient'
import { authedFetch } from '@/lib/playerAuth'

export interface LedgerSummary {
  ubi_earned: number
  gameplay_earned: number
  marketplace_spent: number
  transferred_out: number
  /** Earned G$ whose on-chain transfer hasn't landed yet. Settles by itself. */
  pending_payout: number
}

export function useLedgerSummary(walletAddress: string | undefined) {
  const walletClient = useActiveWalletClient()
  return useQuery({
    queryKey: ['ledger-summary', walletAddress],
    queryFn: async (): Promise<LedgerSummary> => {
      const res = await authedFetch(`/players/${walletAddress}/ledger-summary`, {}, walletAddress!, walletClient)
      if (!res.ok) throw new Error('Failed to fetch ledger summary')
      return res.json()
    },
    enabled: !!walletAddress,
    staleTime: 30_000,
    // A pending payout resolves on its own (the settle task, or the reconcile sweep
    // behind it). Poll while the Bank is open so it flips to a real balance without
    // the player having to reload and wonder.
    refetchInterval: (query) => (query.state.data?.pending_payout ? 15_000 : false),
  })
}
