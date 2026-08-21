// Shared PWA-install detection + copy, used by both the landing-page InstallPrompt
// and the Profile notification toggle. Extracted so the "which browser needs which
// instructions" logic exists in exactly one place — a second copy would drift out of
// sync with the first the next time a browser quirk is added.
//
// The iPhone trap this all exists for: on iOS, only **Safari** turns "Add to Home
// Screen" into a real full-screen app (and only a home-screen install can ever use
// Web Push there). Opening the link in an in-app browser (Instagram, WhatsApp,
// Telegram, X, Facebook…) or in Chrome/Firefox for iOS makes "Add to Home Screen"
// save a plain bookmark instead — so those contexts get told to open Safari first,
// while everyone else gets instructions that never mention it.

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Major in-app browsers (their WebViews can't make a standalone iOS PWA, and don't
// fire beforeinstallprompt on Android). `; wv)` is the generic Android WebView tell.
const IN_APP_RE =
  /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WhatsApp|Telegram|TikTok|musical_ly|Snapchat|LinkedInApp|Pinterest|GSA\/|Twitter|; ?wv\)/i
// Non-Safari browsers on iOS (Chrome, Firefox, Edge, Opera) — also can't make a PWA.
const IOS_OTHER_BROWSER_RE = /CriOS|FxiOS|EdgiOS|OPiOS|Opera Touch/i

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

export type BrowserCtx = { ios: boolean; android: boolean; inApp: boolean; iosOther: boolean }

export function detectBrowserCtx(): BrowserCtx {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  return {
    ios: isIOS(),
    android: /Android/i.test(ua),
    inApp: IN_APP_RE.test(ua),
    iosOther: IOS_OTHER_BROWSER_RE.test(ua),
  }
}

export type InstallMode =
  | 'native'
  | 'ios-safari'
  | 'ios-open-in-safari'
  | 'android-open-in-chrome'
  | 'android-manual'

/** `hasNativePrompt` = a captured `beforeinstallprompt` event is available.
 * `late` = enough time has passed that Chrome's own auto-prompt heuristics are
 * unlikely to fire, so an Android context with nothing else to show falls back
 * to a manual hint rather than showing nothing at all. */
export function resolveInstallMode(ctx: BrowserCtx, hasNativePrompt: boolean, late: boolean): InstallMode | null {
  if (hasNativePrompt) return 'native'
  if (ctx.ios && (ctx.inApp || ctx.iosOther)) return 'ios-open-in-safari'
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
  'ios-open-in-safari': {
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
