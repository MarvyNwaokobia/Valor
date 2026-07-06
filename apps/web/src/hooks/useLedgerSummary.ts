import { useQuery } from '@tanstack/react-query'

const API = process.env.NEXT_PUBLIC_API_URL ?? ''

export interface LedgerSummary {
  ubi_earned: number
  gameplay_earned: number
  marketplace_spent: number
  transferred_out: number
}

export function useLedgerSummary(walletAddress: string | undefined) {
  return useQuery({
    queryKey: ['ledger-summary', walletAddress],
    queryFn: async (): Promise<LedgerSummary> => {
      const res = await fetch(`${API}/players/${walletAddress}/ledger-summary`)
      if (!res.ok) throw new Error('Failed to fetch ledger summary')
      return res.json()
    },
    enabled: !!walletAddress,
    staleTime: 30_000,
  })
}
