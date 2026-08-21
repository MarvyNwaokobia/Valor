// Web Push opt-in: subscribes the browser to the API's VAPID key and registers
// the subscription against a wallet so the daily reminder sweep
// (POST /notifications/daily-run, apps/api/src/handlers/push.rs) can reach it.
//
// Chrome/Edge/Brave/Firefox support this without installing the PWA first —
// only iOS Safari requires "Add to Home Screen" before push works at all.

function apiBase(): string | undefined {
  return process.env.NEXT_PUBLIC_API_URL
}

// PushManager.subscribe wants the VAPID key as a raw Uint8Array, but the API
// hands it back base64url-encoded (see PushService::public_key_base64).
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Registers with the API's VAPID key and starts the browser subscription. Call
 * only after the user has opted in — this triggers the native permission prompt. */
export async function subscribeToPush(wallet: string): Promise<boolean> {
  if (!isPushSupported()) return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const api = apiBase()
  if (!api) return false

  const keyRes = await fetch(`${api}/push/vapid-public-key`).catch(() => null)
  if (!keyRes?.ok) return false
  const { key } = (await keyRes.json()) as { key: string }

  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }))

  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false

  const saved = await fetch(`${api}/players/${wallet}/push-subscription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    }),
  }).catch(() => null)

  return !!saved?.ok
}

/** Current opt-in state without prompting — used to decide whether to show the
 * enable-notifications UI at all. */
export async function getPushSubscriptionState(): Promise<'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'> {
  if (!isPushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  return subscription ? 'subscribed' : 'unsubscribed'
}

export async function unsubscribeFromPush(wallet: string): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe().catch(() => {})

  const api = apiBase()
  if (!api) return
  await fetch(`${api}/players/${wallet}/push-subscription`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {})
}
