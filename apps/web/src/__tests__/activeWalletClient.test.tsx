import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { EIP1193Provider } from 'viem'

import {
  setBridgedProvider,
  clearBridgedProvider,
  getBridgedProviderFor,
} from '@/lib/walletBridge'

// The hook reads three sources: resolved auth, wagmi's client, and the bridge.
// Only the bridge is real here — the other two are stubbed so each test states
// exactly which session is live.
const mockAuth = vi.fn()
vi.mock('@/hooks/useResolvedAuth', () => ({
  useResolvedAuth: () => mockAuth(),
}))
vi.mock('wagmi', () => ({
  useWalletClient: () => ({ data: undefined }),
}))
const mockMagic = vi.fn()
vi.mock('@/lib/magic', () => ({
  getMagic: () => mockMagic(),
}))

const { useActiveWalletClient } = await import('@/hooks/useActiveWalletClient')

const MAGIC_ADDR = '0x1111111111111111111111111111111111111111' as const
const WALLET_ADDR = '0x2222222222222222222222222222222222222222' as const

const magicProvider = { request: vi.fn() } as unknown as EIP1193Provider

describe('useActiveWalletClient — which wallet actually signs', () => {
  beforeEach(() => {
    clearBridgedProvider('magic')
    mockMagic.mockReturnValue({ rpcProvider: magicProvider })
    mockAuth.mockReturnValue({ status: 'ready', address: MAGIC_ADDR, source: 'magic' })
  })

  it('signs with Magic when only Magic has published', () => {
    setBridgedProvider('magic', magicProvider, MAGIC_ADDR)
    const { result } = renderHook(() => useActiveWalletClient())
    expect(result.current?.account?.address).toBe(MAGIC_ADDR)
  })

  it('falls back to the Magic SDK when the bridge is empty', () => {
    expect(getBridgedProviderFor('magic')).toBeNull()
    const { result } = renderHook(() => useActiveWalletClient())
    expect(result.current?.account?.address).toBe(MAGIC_ADDR)
  })

  // The backstop. If a provider ever resolves to an address other than the one
  // the session belongs to, refusing to sign is the only safe answer: a
  // signature from the wrong wallet reverts on-chain and reads as a random bug.
  it('refuses to sign when the provider address does not match the session', () => {
    mockMagic.mockReturnValue(null) // no SDK fallback, so only the bridge can answer
    setBridgedProvider('magic', magicProvider, WALLET_ADDR) // wrong address
    const { result } = renderHook(() => useActiveWalletClient())
    expect(result.current).toBeUndefined()
  })


  it('gives nothing while auth is still loading', () => {
    mockAuth.mockReturnValue({ status: 'loading', address: undefined, source: undefined })
    setBridgedProvider('magic', magicProvider, MAGIC_ADDR)
    const { result } = renderHook(() => useActiveWalletClient())
    expect(result.current).toBeUndefined()
  })
})
