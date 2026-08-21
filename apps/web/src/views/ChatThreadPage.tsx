'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, X, Send, Loader2 } from 'lucide-react'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useMessages, useSendMessage, useMarkRead } from '@/hooks/useChat'
import LoadingScreen from '@/components/ui/LoadingScreen'

const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * A single friend-to-friend conversation. New messages arrive via the
 * app-wide socket in useChatSocket, which invalidates the same
 * ['chat-messages', me, other] query this reads — so there's nothing to
 * subscribe to here beyond the query itself.
 */
export default function ChatThreadPage() {
  const { status, address } = useResolvedAuth()
  const router = useRouter()
  const params = useParams<{ wallet: string }>()
  const searchParams = useSearchParams()
  const player = usePlayerStore((s) => s.player)
  const otherWallet = params.wallet
  const displayName = searchParams.get('name') || shortWallet(otherWallet)

  const { messages, loading, error } = useMessages(address, otherWallet)
  const sendMessage = useSendMessage(address)
  const markRead = useMarkRead(address)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (address) void markRead(otherWallet)
  }, [address, otherWallet, markRead])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  if (status === 'loading') return <LoadingScreen />
  if (status === 'unauthenticated' || !address) { router.replace('/'); return null }
  if (!player) { router.replace('/'); return null }

  const onSend = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    try {
      setDraft('')
      await sendMessage(otherWallet, body)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Could not send message')
      setDraft(body)
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col px-5"
      style={{
        background: '#04030c',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
      }}
    >
      <div className="max-w-lg mx-auto w-full flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-3 pb-4 border-b border-valor-border">
          <MessageCircle className="text-valor-gold" size={20} />
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-black text-white text-lg truncate">{displayName}</h1>
          </div>
          <button onClick={() => router.push('/friends')} className="text-slate-500 hover:text-white transition-colors" aria-label="Close chat">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 py-4">
          {loading && <p className="text-slate-500 text-sm">Loading…</p>}
          {error && <p className="text-red-400 text-xs font-medium">{error}</p>}
          {!loading && messages.length === 0 && (
            <p className="text-slate-500 text-sm">No messages yet — say hi.</p>
          )}
          {messages.map((m) => {
            const mine = m.sender_wallet.toLowerCase() === address.toLowerCase()
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-3.5 py-2 ${
                  mine
                    ? 'bg-valor-gold text-black'
                    : 'bg-valor-surface-2 text-white border border-valor-border'
                }`}>
                  <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`text-[10px] mt-1 ${mine ? 'text-black/50' : 'text-slate-500'}`}>
                    {formatTime(m.created_at)}
                  </p>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        <AnimatePresence>
          {sendError && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              role="alert" className="text-red-400 text-xs font-medium pb-2">{sendError}</motion.p>
          )}
        </AnimatePresence>

        <div className="flex gap-2 pb-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void onSend() }}
            placeholder="Message…"
            maxLength={2000}
            className="flex-1 min-h-11 rounded-lg border border-valor-border bg-valor-surface-2 px-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-valor-gold/50"
          />
          <button
            onClick={() => void onSend()}
            disabled={sending || !draft.trim()}
            className="shrink-0 min-h-11 px-4 rounded-lg bg-valor-gold text-black font-bold text-xs hover:bg-valor-gold-light transition-colors disabled:opacity-40 flex items-center gap-1.5"
          >
            {sending ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
