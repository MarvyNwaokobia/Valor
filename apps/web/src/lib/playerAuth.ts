import type { WalletClient } from 'viem'

// Player session — proves ownership of a wallet to the backend (see
// apps/api/src/auth.rs). Mirrors the admin session in AdminPage.tsx, one
// level down: any wallet can get one for itself, not just an allowlisted one.
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
const SESSION_KEY = 'valor-player-session'

export interface PlayerSession {
  token: string
  wallet: string
  expires_at: number
}

export function getPlayerSession(): PlayerSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed: PlayerSession = JSON.parse(raw)
    if (parsed.expires_at * 1000 <= Date.now()) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function storePlayerSession(session: PlayerSession) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Best effort — a failed write just means the next call signs again.
  }
}

export function clearPlayerSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // no-op
  }
}

// De-duped across callers: several components can discover at once that they
// have no session (e.g. every gated query on first load) — without this they
// would each trigger their own signature prompt back to back.
let pending: Promise<PlayerSession | null> | null = null

export async function ensurePlayerSession(
  address: string,
  walletClient: WalletClient | undefined,
): Promise<PlayerSession | null> {
  const wallet = address.toLowerCase()
  const existing = getPlayerSession()
  if (existing && existing.wallet === wallet) return existing
  if (!walletClient?.account) return null

  if (!pending) {
    pending = (async () => {
      try {
        const message = `Valor Player Login\ntimestamp:${Math.floor(Date.now() / 1000)}`
        const signature = await walletClient.signMessage({ account: walletClient.account!, message })
        const res = await fetch(`${API}/players/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet, message, signature }),
        })
        if (!res.ok) return null
        const session: PlayerSession = await res.json()
        storePlayerSession(session)
        return session
      } catch {
        return null
      } finally {
        pending = null
      }
    })()
  }
  return pending
}

/**
 * Drop-in for the raw `fetch(`${API}/players/...`)` calls scattered across the
 * app, for the routes that now require proof of wallet ownership (see the
 * gated handler list in apps/api/src/handlers/*.rs). Attaches the player
 * session token, signing in first if there isn't one yet, and retries once
 * after a fresh sign-in if the backend rejects the token with a 401.
 */
export async function authedFetch(
  path: string,
  opts: RequestInit,
  address: string,
  walletClient: WalletClient | undefined,
): Promise<Response> {
  let session = getPlayerSession()
  if (!session || session.wallet !== address.toLowerCase()) {
    session = await ensurePlayerSession(address, walletClient)
  }

  const withAuth = (token: string | undefined) => {
    const headers = new Headers(opts.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return headers
  }

  const res = await fetch(`${API}${path}`, { ...opts, headers: withAuth(session?.token) })
  if (res.status !== 401) return res

  clearPlayerSession()
  const retried = await ensurePlayerSession(address, walletClient)
  if (!retried) return res
  return fetch(`${API}${path}`, { ...opts, headers: withAuth(retried.token) })
}
