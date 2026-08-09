import { useState, useCallback, useRef } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export interface AgentTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Where in the app the conversation is happening. The backend uses this to decide what
 * the player is most likely stuck on, which is most of the diagnosis during onboarding:
 * "it won't let me in" means something completely different on the verify screen than
 * it does in the Bank.
 */
export type AgentContext =
  | 'onboarding:verify'
  | 'onboarding:select'
  | 'onboarding:confirm'
  | 'onboarding:tutorial'
  | 'bank'
  | 'help'

interface Options {
  walletAddress?: string
  context: AgentContext
}

/**
 * Talks to the server-side support agent. Deliberately thin: the model, the tools and
 * every rule live on the API, so nothing here needs to change when the agent gets
 * smarter, and no API key is ever in the bundle.
 */
export function useSupportAgent({ walletAddress, context }: Options) {
  const [turns, setTurns] = useState<AgentTurn[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [escalated, setEscalated] = useState(false)

  // Guards against a double-send from an impatient double-tap, which on a support chat
  // costs a duplicate model call and confuses the transcript.
  const inFlight = useRef(false)

  const send = useCallback(
    async (text: string) => {
      const message = text.trim()
      if (!message || inFlight.current) return

      inFlight.current = true
      setPending(true)
      setError(null)

      // Optimistic: the player's own words appear immediately. Captured before the await
      // so the request carries the same history the user can see.
      const next: AgentTurn[] = [...turns, { role: 'user', content: message }]
      setTurns(next)

      try {
        const res = await fetch(`${API}/agent/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: walletAddress ?? null,
            context,
            messages: next.map((t) => ({ role: t.role, content: t.content })),
          }),
        })

        if (res.status === 429) {
          setError('Slow down a moment, then try again.')
          return
        }
        if (!res.ok) {
          setError('The helper is unavailable right now. Try again shortly.')
          return
        }

        const data: { reply: string; escalated: boolean } = await res.json()
        setTurns((prev) => [...prev, { role: 'assistant', content: data.reply }])
        if (data.escalated) setEscalated(true)
      } catch {
        // Offline or the API is down. Say so rather than leaving a spinner running.
        setError('Could not reach the helper. Check your connection.')
      } finally {
        setPending(false)
        inFlight.current = false
      }
    },
    [turns, walletAddress, context],
  )

  /**
   * Seeds the conversation with an assistant message nobody asked for. Used by the
   * proactive onboarding hooks: a stuck player does not open a help panel and type, they
   * close the tab, so the agent has to speak first.
   */
  const greet = useCallback((message: string) => {
    setTurns((prev) => (prev.length > 0 ? prev : [{ role: 'assistant', content: message }]))
  }, [])

  const reset = useCallback(() => {
    setTurns([])
    setError(null)
    setEscalated(false)
  }, [])

  return { turns, pending, error, escalated, send, greet, reset }
}
