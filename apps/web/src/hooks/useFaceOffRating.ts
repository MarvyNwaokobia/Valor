import { useQuery } from '@tanstack/react-query'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

/** Face-Off ELO — track + display only, no effect on matchmaking or stakes.
 *  Defaults to 1200 (unrated) for a wallet with no Face-Off history. */
export function useFaceOffRating(wallet: string | undefined) {
  return useQuery({
    queryKey: ['face-off-rating', wallet],
    queryFn: async (): Promise<number> => {
      const res = await fetch(`${API}/players/${wallet}/face-off-rating`)
      if (!res.ok) return 1200
      const data = await res.json()
      return typeof data.rating === 'number' ? data.rating : 1200
    },
    enabled: !!wallet,
    staleTime: 30_000,
  })
}
