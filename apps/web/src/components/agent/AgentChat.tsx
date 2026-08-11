'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSupportAgent, type AgentContext } from '@/hooks/useSupportAgent'

interface Props {
  walletAddress?: string
  context: AgentContext
  /** Shown as the agent's opening line. Used by the proactive hooks. */
  greeting?: string
  onClose: () => void
  /** Rendered above the input as one-tap starters, so a stuck player never faces a blank box. */
  suggestions?: string[]
}

/**
 * The support agent's chat surface.
 *
 * Sized and worded for someone who is ALREADY stuck rather than browsing: it opens with
 * the agent talking, offers tappable starters, and keeps the transcript short. A blank
 * input box asking "how can I help?" is what people close.
 */
export default function AgentChat({
  walletAddress,
  context,
  greeting,
  onClose,
  suggestions = [],
}: Props) {
  const { turns, pending, error, escalated, send, greet } = useSupportAgent({
    walletAddress,
    context,
  })
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (greeting) greet(greeting)
  }, [greeting, greet])

  // Keep the newest message in view. Support answers arrive after a pause, so without
  // this the reply lands below the fold and reads as nothing having happened.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, pending])

  function submit(text: string) {
    setDraft('')
    void send(text)
  }

  const showSuggestions = suggestions.length > 0 && turns.length <= 1 && !pending

  return (
    <motion.div
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-3 sm:px-6 sm:pb-6"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ duration: 0.25 }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: '#0a0813',
          border: '1px solid rgba(59,130,246,0.25)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
          maxHeight: 'min(70vh, 560px)',
        }}
      >
        <header
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: '#3b82f6', boxShadow: '0 0 8px #3b82f6' }}
            />
            <span className="font-display font-black uppercase tracking-widest text-xs text-white">
              Valor Help
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors text-sm px-2 -mr-2"
            aria-label="Close help"
          >
            Close
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <AnimatePresence initial={false}>
            {turns.map((turn, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className="max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap"
                  style={
                    turn.role === 'user'
                      ? { background: 'rgba(59,130,246,0.18)', color: '#e2e8f0' }
                      : { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }
                  }
                >
                  {turn.content}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {pending && (
            <div className="flex justify-start">
              <div
                className="px-3 py-2 rounded-xl flex gap-1.5 items-center"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: '#64748b' }}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                  />
                ))}
              </div>
            </div>
          )}

          {escalated && (
            <div
              className="text-xs px-3 py-2 rounded-lg"
              style={{
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.25)',
                color: '#86efac',
              }}
            >
              Passed to the team with your wallet address. You do not need to repeat any of this.
            </div>
          )}

          {error && (
            <div
              className="text-xs px-3 py-2 rounded-lg"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: '#fca5a5',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {showSuggestions && (
          <div className="px-4 pb-2 flex flex-wrap gap-2 shrink-0">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="text-xs px-3 py-1.5 rounded-full transition-colors"
                style={{
                  background: 'rgba(59,130,246,0.1)',
                  border: '1px solid rgba(59,130,246,0.25)',
                  color: '#93c5fd',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <form
          className="flex gap-2 px-4 py-3 shrink-0"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          onSubmit={(e) => {
            e.preventDefault()
            submit(draft)
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask anything"
            disabled={pending}
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#e2e8f0',
            }}
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="px-4 rounded-lg font-display font-black uppercase tracking-wider text-xs disabled:opacity-40 transition-opacity"
            style={{ background: '#3b82f6', color: '#fff' }}
          >
            Send
          </button>
        </form>
      </div>
    </motion.div>
  )
}
