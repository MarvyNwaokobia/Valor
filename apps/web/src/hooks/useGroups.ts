'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useActiveWalletClient } from '@/hooks/useActiveWalletClient'
import { authedFetch } from '@/lib/playerAuth'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export interface GroupInfo {
  slug: string
  name: string
}

export interface GroupPublic extends GroupInfo {
  description: string
  members: number
}

/** The group a join link points at. Public, so the page can render before sign-in. */
export function useGroup(slug: string | undefined) {
  return useQuery({
    queryKey: ['group', slug],
    queryFn: async (): Promise<GroupPublic | null> => {
      const res = await fetch(`${API}/groups/${encodeURIComponent(slug!)}`)
      if (res.status === 404) return null
      if (!res.ok) throw new Error('Could not load group')
      return res.json()
    },
    enabled: !!slug,
    staleTime: 30_000,
  })
}

/** The group this wallet belongs to (or null), plus join/leave. */
export function useMyGroup(wallet: string | undefined) {
  const queryClient = useQueryClient()
  const walletClient = useActiveWalletClient()
  const key = ['my-group', wallet?.toLowerCase() ?? 'anon']

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<GroupInfo | null> => {
      const res = await fetch(`${API}/players/${wallet}/group`)
      if (!res.ok) throw new Error('Could not load group')
      return (await res.json()).group ?? null
    },
    enabled: !!wallet,
    staleTime: 30_000,
  })

  const join = useCallback(async (slug: string) => {
    if (!wallet) throw new Error('Sign in first')
    const res = await authedFetch(`/players/${wallet}/group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }, wallet, walletClient)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Could not join')
    await queryClient.invalidateQueries({ queryKey: key })
    await queryClient.invalidateQueries({ queryKey: ['group'] })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, walletClient, queryClient])

  const leave = useCallback(async () => {
    if (!wallet) return
    const res = await authedFetch(`/players/${wallet}/group`, { method: 'DELETE' }, wallet, walletClient)
    if (!res.ok) throw new Error('Could not leave')
    await queryClient.invalidateQueries({ queryKey: key })
    await queryClient.invalidateQueries({ queryKey: ['group'] })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, walletClient, queryClient])

  return { group: query.data ?? null, loading: query.isLoading, join, leave }
}

// A join link followed before the player has a profile has to survive sign-in and
// onboarding, so the slug is parked here and offered again once they are ready.
const PENDING_KEY = 'valor_pending_group'

export function rememberPendingGroup(slug: string): void {
  try { localStorage.setItem(PENDING_KEY, slug) } catch { /* private mode: the link still works */ }
}
export function getPendingGroup(): string | null {
  try { return localStorage.getItem(PENDING_KEY) } catch { return null }
}
export function clearPendingGroup(): void {
  try { localStorage.removeItem(PENDING_KEY) } catch { /* ignore */ }
}
