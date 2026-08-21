'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export interface FriendEntry {
  wallet: string
  username: string | null
  character_name: string
  rank: string
}

export interface FriendRequestEntry extends FriendEntry {
  created_at: string
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error('Request failed')
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Request failed')
  return json as T
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${API}${path}`, { method: 'DELETE' })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error((json as { error?: string }).error ?? 'Request failed')
  }
}

/**
 * Friends — separate from referrals on purpose. A referral pays out once for
 * bringing in a new player; it says nothing about who anyone wants to stay
 * connected to, so nothing here is auto-populated from it.
 */
export function useFriends(walletAddress: string | undefined) {
  const queryClient = useQueryClient()
  const key = walletAddress?.toLowerCase() ?? 'anon'

  const friends = useQuery({
    queryKey: ['friends', key],
    queryFn: () => get<{ friends: FriendEntry[] }>(`/players/${walletAddress}/friends`),
    enabled: !!walletAddress,
    staleTime: 15_000,
  })

  const requests = useQuery({
    queryKey: ['friend-requests', key],
    queryFn: () => get<{ incoming: FriendRequestEntry[]; outgoing: FriendRequestEntry[] }>(
      `/players/${walletAddress}/friends/requests`,
    ),
    enabled: !!walletAddress,
    staleTime: 15_000,
    // Poll gently so an incoming request shows up without a manual refresh.
    refetchInterval: 30_000,
  })

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['friends', key] })
    void queryClient.invalidateQueries({ queryKey: ['friend-requests', key] })
  }, [queryClient, key])

  /** `identifier` is either a wallet address or a username — the caller decides
   *  which by what they typed; the server tells them apart automatically. */
  const sendRequest = useCallback(async (identifier: string) => {
    if (!walletAddress) throw new Error('Not signed in')
    const result = await post<{ status: string; auto_accepted?: boolean }>(
      `/players/${walletAddress}/friends/request`,
      { identifier },
    )
    refresh()
    return result
  }, [walletAddress, refresh])

  const acceptRequest = useCallback(async (fromWallet: string) => {
    if (!walletAddress) throw new Error('Not signed in')
    await post(`/players/${walletAddress}/friends/${fromWallet}/accept`)
    refresh()
  }, [walletAddress, refresh])

  /** Declining an incoming request, cancelling an outgoing one, and unfriending
   *  an accepted one are all the same call — see remove_friend on the API. */
  const removeFriend = useCallback(async (otherWallet: string) => {
    if (!walletAddress) throw new Error('Not signed in')
    await del(`/players/${walletAddress}/friends/${otherWallet}`)
    refresh()
  }, [walletAddress, refresh])

  return {
    friends: friends.data?.friends ?? [],
    incoming: requests.data?.incoming ?? [],
    outgoing: requests.data?.outgoing ?? [],
    loading: friends.isLoading || requests.isLoading,
    error: friends.error instanceof Error ? friends.error.message : null,
    sendRequest, acceptRequest, removeFriend, refresh,
  }
}
