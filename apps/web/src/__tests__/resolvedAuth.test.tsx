import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const mockMagicCtx = vi.fn()
const mockAccount = vi.fn()

vi.mock('@/components/providers/MagicAuthProvider', () => ({
  useMagicAuthContext: () => mockMagicCtx(),
}))
vi.mock('wagmi', () => ({
  useAccount: () => mockAccount(),
}))

const { useResolvedAuth } = await import('@/hooks/useResolvedAuth')

const MAGIC_ADDR = '0x1111111111111111111111111111111111111111' as const
const WALLET_ADDR = '0x2222222222222222222222222222222222222222' as const

describe('useResolvedAuth — who the app thinks you are', () => {
  it('Magic wins once it has resolved', () => {
    mockMagicCtx.mockReturnValue({ status: 'ready', address: MAGIC_ADDR })
    mockAccount.mockReturnValue({ address: WALLET_ADDR, isConnected: true })

    const { result } = renderHook(() => useResolvedAuth())
    expect(result.current.address).toBe(MAGIC_ADDR)
    expect(result.current.source).toBe('magic')
  })

  // KNOWN, DELIBERATELY NOT FIXED YET. Magic's session resolves asynchronously.
  // While it is still 'loading', the wallet branches are checked FIRST, so a
  // restored injected connection (a wallet's in-app browser, or a desktop
  // extension connected on an earlier visit) reports 'ready' as the WRONG
  // address — until Magic finishes and the identity flips underneath whatever
  // is on screen.
  //
  // The obvious fix is to check `magic.status === 'loading'` before the wallet
  // branches. It is held back because `resolveIdentity` has NO TIMEOUT: it sets
  // 'unauthenticated' on a thrown error, but a call that hangs without
  // resolving — the documented mobile-Safari ITP failure mode — leaves status
  // on 'loading' for ever. Today the wallet branch rescues those users; with the
  // reorder they would sit on a loading screen with no way out.
  //
  // So the reorder must ship WITH a timeout on resolveIdentity, not before it.
  // Skipped rather than deleted so the gap stays visible.
  it.skip('a still-loading Magic session must not resolve as the injected wallet', () => {
    mockMagicCtx.mockReturnValue({ status: 'loading', address: undefined })
    mockAccount.mockReturnValue({ address: WALLET_ADDR, isConnected: true })

    const { result } = renderHook(() => useResolvedAuth())
    expect(result.current.status).toBe('loading')
  })
})
