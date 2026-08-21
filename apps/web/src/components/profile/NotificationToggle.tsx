'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { edition } from '@/editions'
import {
  detectBrowserCtx,
  INSTALL_COPY,
  isStandalone,
  resolveInstallMode,
  type BrowserCtx,
} from '@/lib/pwaInstall'
import { usePwaStore } from '@/stores/usePwaStore'
import {
  getPushSubscriptionState,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push'

interface Props {
  walletAddress: string
}

type PushState = 'loading' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'

const boxStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  borderColor: 'rgba(42,42,58,0.8)',
}

/** Duolingo-style opt-in: "come back and play" reminder pushes. Lives in Profile
 * rather than as a landing-page interruption (unlike InstallPrompt) because it's an
 * account preference, not a one-time acquisition nudge.
 *
 * iOS only allows Web Push to a home-screen install, and even off iOS we gate
 * notifications behind install for a consistent story across every browser — so a
 * player who hasn't installed sees a compact, browser-specific "here's how" instead
 * of a permission prompt that would silently fail (iOS) or a toggle whose promise
 * ("daily reminders") the browser can't actually keep yet. Detection is shared with
 * the landing page's InstallPrompt via lib/pwaInstall + stores/usePwaStore. */
export default function NotificationToggle({ walletAddress }: Props) {
  const deferred = usePwaStore((s) => s.deferred)
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [ctx, setCtx] = useState<BrowserCtx | null>(null)
  const [pushState, setPushState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setInstalled(isStandalone())
    setCtx(detectBrowserCtx())
    // Installing via the native prompt below flips this without a reload.
    const onInstalled = () => setInstalled(true)
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  useEffect(() => {
    if (!installed) return
    if (!isPushSupported()) {
      setPushState('unsupported')
      return
    }
    getPushSubscriptionState().then(setPushState)
  }, [installed])

  // Waiting on the client-only checks above, or nothing to say (MiniPay's WebView
  // has no home screen route at all — the request would be unactionable there).
  if (installed === null || !ctx || edition().id === 'minipay') return null

  // ── Not installed yet: show how, per browser, instead of a toggle ───────────
  if (!installed) {
    // `late: true` — unlike the landing banner this isn't racing a 2.5s window for
    // beforeinstallprompt to arrive, so always fall back to the manual hint rather
    // than showing nothing.
    const mode = resolveInstallMode(ctx, !!deferred, true)
    const copy = mode ? INSTALL_COPY[mode] : null

    const install = async () => {
      if (!deferred) return
      await deferred.prompt()
      await deferred.userChoice
    }

    return (
      <div className="flex flex-col gap-2 px-4 py-3 rounded-xl border" style={boxStyle}>
        <div className="flex items-center gap-2">
          <BellOff size={16} className="text-slate-500" />
          <span className="font-bold text-slate-300 text-sm">Daily reminders</span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          {copy
            ? copy.body
            : 'Install Valor first — that unlocks notifications. Look for an install icon in your browser’s address bar or menu.'}
        </p>
        {mode === 'native' && (
          <button
            onClick={install}
            className="self-start text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ background: 'linear-gradient(180deg, #e6c877, #d9b25a)', color: '#1a1204' }}
          >
            Install Valor
          </button>
        )}
      </div>
    )
  }

  // ── Installed, but this browser still has no Push API (old iOS Safari, etc) ──
  if (pushState === 'unsupported') {
    return (
      <div className="flex items-center justify-between px-4 py-3 rounded-xl border" style={boxStyle}>
        <div className="flex items-center gap-2">
          <BellOff size={16} className="text-slate-500" />
          <span className="font-bold text-slate-400 text-sm">Daily reminders</span>
        </div>
        <span className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">
          Not supported here
        </span>
      </div>
    )
  }

  if (pushState === 'loading') return null

  async function handleToggle() {
    setBusy(true)
    if (pushState === 'subscribed') {
      await unsubscribeFromPush(walletAddress)
      setPushState('unsubscribed')
    } else {
      const ok = await subscribeToPush(walletAddress)
      setPushState(ok ? 'subscribed' : Notification.permission === 'denied' ? 'denied' : 'unsubscribed')
    }
    setBusy(false)
  }

  const on = pushState === 'subscribed'

  return (
    <button
      onClick={handleToggle}
      disabled={busy || pushState === 'denied'}
      className="w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors disabled:opacity-60"
      style={
        on
          ? { background: 'rgba(234,179,8,0.08)', borderColor: 'rgba(234,179,8,0.35)' }
          : boxStyle
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
        {pushState === 'denied'
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
