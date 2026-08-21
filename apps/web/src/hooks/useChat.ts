'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export interface ChatMessage {
  id: string
  sender_wallet: string
  recipient_wallet: string
  body: string
  created_at: string
  read_at: string | null
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

/**
 * A thread's history is fetched once and kept fresh by the chat socket
 * (see useChatSocket) invalidating this same query key on a `new_message`
 * event — staleTime: Infinity means no redundant refetch on remount, only
 * on an explicit invalidate.
 */
export function useMessages(walletAddress: string | undefined, otherWallet: string | undefined) {
  const key = [walletAddress?.toLowerCase() ?? 'anon', otherWallet?.toLowerCase() ?? 'anon']

  const messages = useQuery({
    queryKey: ['chat-messages', ...key],
    queryFn: () => get<{ messages: ChatMessage[] }>(
      `/players/${walletAddress}/friends/${otherWallet}/messages`,
    ),
    enabled: !!walletAddress && !!otherWallet,
    staleTime: Infinity,
  })

  return {
    // API returns newest-first; the thread reads oldest-first.
    messages: [...(messages.data?.messages ?? [])].reverse(),
    loading: messages.isLoading,
    error: messages.error instanceof Error ? messages.error.message : null,
  }
}

export function useSendMessage(walletAddress: string | undefined) {
  const queryClient = useQueryClient()
  const key = walletAddress?.toLowerCase() ?? 'anon'

  return useCallback(async (otherWallet: string, body: string) => {
    if (!walletAddress) throw new Error('Not signed in')
    const message = await post<ChatMessage>(
      `/players/${walletAddress}/friends/${otherWallet}/messages`,
      { body },
    )
    void queryClient.invalidateQueries({ queryKey: ['chat-messages', key, otherWallet.toLowerCase()] })
    return message
  }, [walletAddress, key, queryClient])
}

export function useMarkRead(walletAddress: string | undefined) {
  const queryClient = useQueryClient()
  const key = walletAddress?.toLowerCase() ?? 'anon'

  return useCallback(async (otherWallet: string) => {
    if (!walletAddress) return
    await post(`/players/${walletAddress}/friends/${otherWallet}/messages/read`)
    void queryClient.invalidateQueries({ queryKey: ['chat-unread', key] })
  }, [walletAddress, key, queryClient])
}

/**
 * Per-friend unread counts, e.g. { "0xabc...": 3 }. Polled every 30s as a
 * fallback (matches useFriends's requests poll) in case a socket push is
 * missed while backgrounded; the socket keeps it live the rest of the time.
 */
export function useUnreadCounts(walletAddress: string | undefined) {
  const key = walletAddress?.toLowerCase() ?? 'anon'

  const counts = useQuery({
    queryKey: ['chat-unread', key],
    queryFn: () => get<{ counts: Record<string, number> }>(
      `/players/${walletAddress}/messages/unread-counts`,
    ),
    enabled: !!walletAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const byWallet = counts.data?.counts ?? {}
  const total = Object.values(byWallet).reduce((sum, n) => sum + n, 0)

  return { byWallet, total, loading: counts.isLoading }
}
