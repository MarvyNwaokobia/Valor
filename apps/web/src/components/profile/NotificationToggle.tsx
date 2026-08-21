'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import {
  getPushSubscriptionState,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push'

interface Props {
  walletAddress: string
}

type State = 'loading' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'

/** Duolingo-style opt-in: "come back and play" reminder pushes. Lives in Profile
 * rather than as a landing-page interruption (unlike InstallPrompt) because it's an
 * account preference, not a one-time acquisition nudge — a player toggles it once
 * and never needs to see it again unless they change their mind. */
export default function NotificationToggle({ walletAddress }: Props) {
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isPushSupported()) {
      setState('unsupported')
      return
    }
    getPushSubscriptionState().then(setState)
  }, [])

  if (state === 'loading') return null

  // iOS Safari (or any unsupported browser) — nothing to toggle, but say why
  // rather than just disappearing, since the request itself will keep coming up.
  if (state === 'unsupported') {
    return (
      <div className="flex items-center justify-between px-4 py-3 rounded-xl border"
        style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(42,42,58,0.8)' }}>
        <div className="flex items-center gap-2">
          <BellOff size={16} className="text-slate-500" />
          <span className="font-bold text-slate-400 text-sm">Daily reminders</span>
        </div>
        <span className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">
          Install the app first
        </span>
      </div>
    )
  }

  async function handleToggle() {
    setBusy(true)
    if (state === 'subscribed') {
      await unsubscribeFromPush(walletAddress)
      setState('unsubscribed')
    } else {
      const ok = await subscribeToPush(walletAddress)
      setState(ok ? 'subscribed' : Notification.permission === 'denied' ? 'denied' : 'unsubscribed')
    }
    setBusy(false)
  }

  const on = state === 'subscribed'

  return (
    <button
      onClick={handleToggle}
      disabled={busy || state === 'denied'}
      className="w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors disabled:opacity-60"
      style={
        on
          ? { background: 'rgba(234,179,8,0.08)', borderColor: 'rgba(234,179,8,0.35)' }
          : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(42,42,58,0.8)' }
      }
    >
      <div className="flex items-center gap-2">
        {on ? <Bell size={16} className="text-amber-400" /> : <BellOff size={16} className="text-slate-400" />}
        <span className={`font-bold text-sm ${on ? 'text-white' : 'text-slate-300'}`}>Daily reminders</span>
      </div>
      <span
        className="text-[9px] uppercase tracking-widest font-bold"
        style={{ color: on ? 'rgba(234,179,8,0.75)' : 'rgba(100,116,139,0.8)' }}
      >
        {state === 'denied'
          ? 'Blocked in browser settings'
          : busy
            ? '...'
            : on
              ? 'On — tap to turn off'
              : 'Off — tap to enable'}
      </span>
    </button>
  )
}
