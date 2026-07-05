import { Magic } from 'magic-sdk'
import { OAuthExtension } from '@magic-ext/oauth2'

// Valor runs on Celo mainnet in production (see NEXT_PUBLIC_GOODDOLLAR_ENV) —
// Magic's embedded wallet only ever talks to this one RPC, so there's no
// "wrong network" state to handle like with a bring-your-own-wallet flow.
export const CELO_CHAIN_ID = 42220
const CELO_RPC_URL = 'https://forno.celo.org'

// Must match the path registered in Google Cloud Console's authorized
// redirect URIs and Magic dashboard's "Allowed Origins & Redirects".
export const AUTH_CALLBACK_PATH = '/auth/callback'

function createMagic() {
  const apiKey = process.env.NEXT_PUBLIC_MAGIC_API_KEY
  if (!apiKey) throw new Error('NEXT_PUBLIC_MAGIC_API_KEY is not set')
  return new Magic(apiKey, {
    network: { rpcUrl: CELO_RPC_URL, chainId: CELO_CHAIN_ID },
    extensions: [new OAuthExtension()],
  })
}

let instance: ReturnType<typeof createMagic> | null = null

// Magic's SDK reaches for `window` at construction time, so it can only be
// built client-side — every call site must already be inside 'use client'.
export function getMagic() {
  if (typeof window === 'undefined') return null
  if (!instance) instance = createMagic()
  return instance
}
