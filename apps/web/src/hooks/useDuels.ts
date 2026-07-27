'use client'

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSurvivalRearm } from '@/hooks/useSurvivalRearm'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

/** A duel someone has opened and not yet had accepted. */
export interface OpenDuel {
  id: string
  challenger: string
  stake_g: number
  winner_takes_g: number
  created_at: string
}

/** One of the caller's own duels, in any state. */
export interface MyDuel {
  id: string
  challenger: string
  opponent: string | null
  stake_g: number
  status: 'open' | 'accepted' | 'resolved' | 'cancelled'
  winner: string | null
  challenger_score: number | null
  opponent_score: number | null
}

export interface DuelsList {
  open: OpenDuel[]
  mine: MyDuel[]
  /** The agreed stake ladder. Both sides can only pick from this, and the server
   *  enforces it — the UI renders whatever the server says rather than its own copy,
   *  so the two can never disagree about what a legal stake is. */
  stake_tiers: number[]
  min_stake_g: number
  max_stake_g: number
  /** House cut in basis points (50 = 0.5%). */
  house_cut_bps: number
}

/** Everything needed to play one side of a duel. */
export interface DuelRun {
  id: string
  seed: number
  stake_g: number
  run_token: string
  winner_takes_g: number
}

export interface DuelResult {
  resolved: boolean
  waiting_on_opponent?: boolean
  draw?: boolean
  winner?: string | null
  winnings_g?: number
  challenger_score?: number
  opponent_score?: number
}

/**
 * The score both sides are ranked on. Must be IDENTICAL for both players or the
 * duel is not a fair comparison, so it lives here rather than being computed at
 * each call site. Kept deliberately coarse: waves dominate, kills break ties.
 *
 * The server independently range-checks this against the elapsed time it measured,
 * so inflating it client-side is bounded rather than free.
 */
export function duelScore(wavesCleared: number, kills: number): number {
  return Math.max(0, Math.floor(wavesCleared) * 100 + Math.floor(kills) * 10)
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Request failed')
  return json as T
}

/**
 * Is the deployed API new enough to serve duels the way this UI describes them?
 *
 * The web app and the API deploy independently, so rather than document a deploy
 * order and hope, the entry point feature-detects. Crucially it detects the
 * CONTRACT, not just the route: an older API answers /duels perfectly happily
 * while charging a different house cut and accepting different stakes. Showing
 * the card then would put a screen in front of players that states one fee while
 * the server takes another, which is the one failure mode that must not ship.
 *
 * `stake_tiers` is the marker because it arrived with the 0.5% cut, so its
 * presence means the server agrees with every number this UI prints.
 */
export function useDuelsAvailable(): boolean {
  const q = useQuery({
    queryKey: ['duels-available'],
    queryFn: async () => {
      const res = await fetch(`${API}/duels`)
      if (!res.ok) return false
      const body = (await res.json().catch(() => null)) as Partial<DuelsList> | null
      return Array.isArray(body?.stake_tiers) && typeof body?.house_cut_bps === 'number'
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
  return q.data === true
}

export function useDuels(walletAddress: string | undefined) {
  const queryClient = useQueryClient()
  const rearm = useSurvivalRearm(walletAddress)
  const [pending, setPending] = useState(false)

  const list = useQuery({
    queryKey: ['duels', walletAddress?.toLowerCase() ?? 'anon'],
    queryFn: async (): Promise<DuelsList> => {
      const q = walletAddress ? `?wallet=${walletAddress.toLowerCase()}` : ''
      const res = await fetch(`${API}/duels${q}`)
      if (!res.ok) throw new Error('Could not load duels')
      return res.json()
    },
    staleTime: 10_000,
    // Poll so a duel resolves in the lobby without a manual refresh once the
    // opponent finishes their run.
    refetchInterval: 20_000,
    // Signed-out visitors are redirected away immediately; firing the request
    // anyway just adds a doomed round trip on every bounce.
    enabled: !!walletAddress,
  })

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['duels'] })
  }, [queryClient])

  /**
   * Staking spends against a signed allowance rather than prompting per duel.
   * `arm` is the same EIP-2612 permit the survival re-arm uses, so a player who
   * already armed this session stakes with no popup at all. We only ask for a
   * signature when the backend tells us the allowance is short (need_arm), which
   * keeps the common case one tap.
   */
  const withStake = useCallback(async <T,>(stakeG: number, call: () => Promise<T>): Promise<T> => {
    try {
      return await call()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (!/allowance/i.test(msg)) throw err
      // Arm a little over the stake so a follow-up duel doesn't re-prompt.
      await rearm.arm(stakeG * 2)
      return await call()
    }
  }, [rearm])

  const createDuel = useCallback(async (stakeG: number): Promise<DuelRun> => {
    if (!walletAddress) throw new Error('Not signed in')
    setPending(true)
    try {
      const run = await withStake(stakeG, () =>
        post<DuelRun>('/duels', { wallet: walletAddress, stake_g: stakeG }))
      refresh()
      return run
    } finally { setPending(false) }
  }, [walletAddress, withStake, refresh])

  const acceptDuel = useCallback(async (id: string, stakeG: number): Promise<DuelRun> => {
    if (!walletAddress) throw new Error('Not signed in')
    setPending(true)
    try {
      const run = await withStake(stakeG, () =>
        post<DuelRun>(`/duels/${id}/accept`, { wallet: walletAddress }))
      refresh()
      return run
    } finally { setPending(false) }
  }, [walletAddress, withStake, refresh])

  const submitScore = useCallback(async (id: string, runToken: string, score: number): Promise<DuelResult> => {
    if (!walletAddress) throw new Error('Not signed in')
    const result = await post<DuelResult>(`/duels/${id}/submit`, {
      wallet: walletAddress, run_token: runToken, score,
    })
    refresh()
    return result
  }, [walletAddress, refresh])

  const cancelDuel = useCallback(async (id: string): Promise<void> => {
    if (!walletAddress) throw new Error('Not signed in')
    setPending(true)
    try {
      await post(`/duels/${id}/cancel`, { wallet: walletAddress })
      refresh()
    } finally { setPending(false) }
  }, [walletAddress, refresh])

  return {
    duels: list.data,
    loading: list.isLoading,
    error: list.error instanceof Error ? list.error.message : null,
    pending: pending || rearm.pending,
    createDuel, acceptDuel, submitScore, cancelDuel, refresh,
  }
}
