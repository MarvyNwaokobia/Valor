'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

const RECONNECT_DELAY_MS = 3000

interface NewMessageEvent {
  type: 'new_message'
  from: string
  to: string
}

/**
 * Keeps one `/ws/chat` connection open for the whole app (mounted in
 * components/layout/Layout.tsx) so a new message shows up — thread and
 * unread badge alike — no matter what page the recipient is on. Same
 * "hello then just listen" shape as the REST-driven design in
 * handlers/chat_ws.rs: this socket never sends a message body, only the one
 * registration frame; actual sends go through useSendMessage (REST).
 */
export function useChatSocket(walletAddress: string | undefined) {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const closedByUsRef = useRef(false)

  useEffect(() => {
    if (!walletAddress) return
    closedByUsRef.current = false

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
      const wsUrl = apiUrl.replace(/^http/, 'ws')
      const socket = new WebSocket(`${wsUrl}/ws/chat`)
      wsRef.current = socket

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'hello', wallet: walletAddress }))
      }

      socket.onmessage = (e) => {
        let msg: NewMessageEvent
        try { msg = JSON.parse(e.data as string) }
        catch { return }
        if (msg.type !== 'new_message') return

        const me = walletAddress.toLowerCase()
        const other = (msg.from.toLowerCase() === me ? msg.to : msg.from).toLowerCase()
        void queryClient.invalidateQueries({ queryKey: ['chat-messages', me, other] })
        void queryClient.invalidateQueries({ queryKey: ['chat-unread', me] })
      }

      socket.onclose = () => {
        if (closedByUsRef.current) return
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
      }

      socket.onerror = () => {
        socket.close()
      }
    }

    connect()

    return () => {
      closedByUsRef.current = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [walletAddress, queryClient])
}
