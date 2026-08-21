'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { edition } from '@/editions'
import {
  detectBrowserCtx,
  INSTALL_COPY,
  isStandalone,
  resolveInstallMode,
  type BeforeInstallPromptEvent,
  type BrowserCtx,
} from '@/lib/pwaInstall'
import { usePwaStore } from '@/stores/usePwaStore'

/**
 * "Install Valor" affordance — and, crucially, guidance so users don't create a
 * BROKEN install. See apps/web/src/lib/pwaInstall.ts for the per-browser detection
 * this is built on (shared with the Profile notification toggle).
 *
 * Never shows when already installed (standalone), and a dismissal is remembered.
 */

const DISMISS_KEY = 'valor:install-dismissed'

export function InstallPrompt() {
  const pathname = usePathname()
  const setDeferred = usePwaStore((s) => s.setDeferred)
  const setStandalone = usePwaStore((s) => s.setStandalone)
  const deferred = usePwaStore((s) => s.deferred)
  const [ctx, setCtx] = useState<BrowserCtx | null>(null)
  // Start hidden until the client effect decides — avoids an SSR flash.
  const [hidden, setHidden] = useState(true)
  // Android Chrome fires `beforeinstallprompt` on its own schedule (engagement
  // heuristics) — often not at all on first visit. Give it a moment, then fall
  // back to a manual "tap ⋮ → Install app" hint so guidance ALWAYS shows.
  const [late, setLate] = useState(false)

  useEffect(() => {
    setStandalone(isStandalone())
    if (isStandalone()) return
    // Inside a wallet's Mini App there is nothing to install. MiniPay runs the
    // page in its own WebView with its own chrome — no Share icon, no "Add to
    // Home Screen", no route to a standalone app. Showing the hint there gives
    // an instruction that cannot be followed, on the smallest screen we target.
    //
    // Detected from the edition rather than the user-agent because MiniPay's
    // WebView is not reliably identifiable from the UA string on iOS, whereas
    // its injected provider always announces itself. The in-app-browser regex
    // in pwaInstall.ts still covers the UA-identifiable ones (Instagram, WhatsApp, Telegram, …).
    if (edition().id === 'minipay') return
    try {
      if (localStorage.getItem(DISMISS_KEY)) return
    } catch {
      /* private mode — just proceed */
    }
    setHidden(false)
    setCtx(detectBrowserCtx())

    const onBeforeInstall = (e: Event) => {
      e.preventDefault() // stop Chrome's mini-infobar; we drive it ourselves
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setStandalone(true)
      dismiss()
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    const t = setTimeout(() => setLate(true), 2500)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
    dismiss()
  }

  // Landing page only — never over the hub sub-pages or mid-fight.
  if (pathname !== '/') return null
  if (hidden || !ctx) return null

  const mode = resolveInstallMode(ctx, !!deferred, late)
  if (!mode) return null

  const { title: cardTitle, body } = INSTALL_COPY[mode]

  return (
    <div style={wrap}>
      <div style={card}>
        {/* Transparent variant, not the PWA manifest icon: that one is deliberately opaque
            (OS home-screen icons expect a filled background), but embedded inline here on
            the card's own dark background an opaque square read as a stray black box. */}
        <img src="/valor-icon-transparent.png" alt="" width={40} height={40} style={icon} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={title}>{cardTitle}</div>
          <div style={subtitle}>{body}</div>
        </div>
        {mode === 'native' ? (
          <button onClick={install} style={cta}>
            Install
          </button>
        ) : null}
        <button onClick={dismiss} aria-label="Dismiss" style={closeBtn}>
          ×
        </button>
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 'max(16px, env(safe-area-inset-bottom))',
  display: 'flex',
  justifyContent: 'center',
  padding: '0 12px',
  zIndex: 9999,
  pointerEvents: 'none',
}

const card: React.CSSProperties = {
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  maxWidth: 420,
  padding: '10px 12px',
  borderRadius: 14,
  background: 'rgba(10, 8, 20, 0.92)',
  border: '1px solid rgba(217, 178, 90, 0.35)',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
  backdropFilter: 'blur(8px)',
  color: '#f4efe6',
  fontFamily: 'Inter, system-ui, sans-serif',
}

const icon: React.CSSProperties = { borderRadius: 8, flexShrink: 0, alignSelf: 'flex-start' }

const title: React.CSSProperties = { fontWeight: 700, fontSize: 14, lineHeight: 1.25 }

const subtitle: React.CSSProperties = {
  fontSize: 12,
  color: 'rgba(244, 239, 230, 0.7)',
  lineHeight: 1.35,
  marginTop: 2,
}

const cta: React.CSSProperties = {
  flexShrink: 0,
  padding: '8px 14px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(180deg, #e6c877, #d9b25a)',
  color: '#1a1204',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
}

const closeBtn: React.CSSProperties = {
  flexShrink: 0,
  alignSelf: 'flex-start',
  width: 28,
  height: 28,
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: 'rgba(244, 239, 230, 0.55)',
  fontSize: 20,
  lineHeight: 1,
  cursor: 'pointer',
}
