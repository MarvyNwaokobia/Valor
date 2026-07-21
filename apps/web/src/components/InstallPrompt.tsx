'use client'

import { useEffect, useState } from 'react'

/**
 * "Install Valor" affordance.
 *
 * Two platforms behave differently:
 *  - Android/Chrome + desktop Chrome/Edge fire `beforeinstallprompt`. We capture
 *    it, show an Install button, and trigger the native prompt on tap.
 *  - iOS Safari fires NOTHING (Apple gives no programmatic install). There we
 *    show a manual hint: Share → Add to Home Screen.
 *
 * It never shows when the app is already installed (launched standalone), and a
 * dismissal is remembered so we don't nag.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'valor:install-dismissed'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's non-standard flag for home-screen apps
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ masquerades as Mac; detect a touch screen to catch it
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSHint, setShowIOSHint] = useState(false)
  // Start hidden until the client effect decides — avoids an SSR flash.
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    if (isStandalone()) return
    try {
      if (localStorage.getItem(DISMISS_KEY)) return
    } catch {
      /* private mode — just proceed */
    }
    setHidden(false)

    const onBeforeInstall = (e: Event) => {
      e.preventDefault() // stop Chrome's mini-infobar; we drive it ourselves
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => dismiss()

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    if (isIOS()) setShowIOSHint(true)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dismiss = () => {
    setHidden(true)
    setDeferred(null)
    setShowIOSHint(false)
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
    dismiss()
  }

  if (hidden) return null
  // Nothing installable to offer on this browser → render nothing.
  if (!deferred && !showIOSHint) return null

  return (
    <div style={wrap}>
      <div style={card}>
        <img src="/valor-icon-192.png" alt="" width={40} height={40} style={icon} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={title}>Install Valor</div>
          <div style={subtitle}>
            {deferred
              ? 'Add it to your home screen for a full-screen app.'
              : 'Tap Share, then "Add to Home Screen".'}
          </div>
        </div>
        {deferred ? (
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

const icon: React.CSSProperties = { borderRadius: 8, flexShrink: 0 }

const title: React.CSSProperties = { fontWeight: 700, fontSize: 14, lineHeight: 1.2 }

const subtitle: React.CSSProperties = {
  fontSize: 12,
  color: 'rgba(244, 239, 230, 0.65)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
