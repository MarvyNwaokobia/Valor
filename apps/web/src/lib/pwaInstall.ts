// Shared PWA-install detection + copy, used by both the landing-page InstallPrompt
// and the Profile notification toggle. Extracted so the "which browser needs which
// instructions" logic exists in exactly one place — a second copy would drift out of
// sync with the first the next time a browser quirk is added.
//
// The iPhone trap this all exists for: on iOS there's no `beforeinstallprompt`, so
// installing means the user taps the native Share icon and picks "Add to Home
// Screen" — and that's a system-level share action, available from **any** iOS
// browser that exposes the real Share icon (Safari, Chrome, Firefox, Edge all do),
// not just Safari. Only a genuine in-app WebView (Instagram, WhatsApp, Telegram, X,
// Facebook…) is actually stuck, because its in-app "share" button opens that app's
// own share sheet instead of iOS's — those get told to open the page in a real
// browser first. A real third-party iOS browser needs the exact same instructions
// as Safari, not a redirect to Safari.

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Major in-app browsers (their WebViews can't make a standalone iOS PWA, and don't
// fire beforeinstallprompt on Android). `; wv)` is the generic Android WebView tell.
const IN_APP_RE =
  /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WhatsApp|Telegram|TikTok|musical_ly|Snapchat|LinkedInApp|Pinterest|GSA\/|Twitter|; ?wv\)/i

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ masquerades as Mac; detect a touch screen to catch it
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export type BrowserCtx = { ios: boolean; android: boolean; inApp: boolean }

export function detectBrowserCtx(): BrowserCtx {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  return {
    ios: isIOS(),
    android: /Android/i.test(ua),
    inApp: IN_APP_RE.test(ua),
  }
}

export type InstallMode =
  | 'native'
  | 'ios-safari'
  | 'ios-in-app-open-in-safari'
  | 'android-open-in-chrome'
  | 'android-manual'

/** `hasNativePrompt` = a captured `beforeinstallprompt` event is available.
 * `late` = enough time has passed that Chrome's own auto-prompt heuristics are
 * unlikely to fire, so an Android context with nothing else to show falls back
 * to a manual hint rather than showing nothing at all. */
export function resolveInstallMode(ctx: BrowserCtx, hasNativePrompt: boolean, late: boolean): InstallMode | null {
  if (hasNativePrompt) return 'native'
  if (ctx.ios && ctx.inApp) return 'ios-in-app-open-in-safari'
  // A real third-party iOS browser (Chrome/Firefox/Edge) gets Safari's own
  // instructions — its Share icon → Add to Home Screen works identically.
  if (ctx.ios) return 'ios-safari'
  if (ctx.android && ctx.inApp) return 'android-open-in-chrome'
  if (ctx.android && late) return 'android-manual'
  return null
}

export const INSTALL_COPY: Record<InstallMode, { title: string; body: string }> = {
  native: {
    title: 'Install Valor',
    body: 'Add it to your home screen for a full-screen app.',
  },
  'ios-safari': {
    title: 'Install Valor',
    body: 'Tap the Share icon, then “Add to Home Screen”.',
  },
  'ios-in-app-open-in-safari': {
    title: 'Open in Safari to install',
    body: 'You’re in an in-app browser. Tap ••• (or the share icon) → “Open in Safari”, then Share → Add to Home Screen.',
  },
  'android-open-in-chrome': {
    title: 'Open in Chrome to install',
    body: 'You’re in an in-app browser. Tap ⋮ → “Open in Chrome” to install Valor.',
  },
  'android-manual': {
    title: 'Install Valor',
    body: 'Tap ⋮ (top-right), then “Install app” or “Add to home screen”.',
  },
}
