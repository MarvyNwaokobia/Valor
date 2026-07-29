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
const web3authProvider = { request: vi.fn() } as unknown as EIP1193Provider

describe('useActiveWalletClient — which wallet actually signs', () => {
  beforeEach(() => {
    clearBridgedProvider('magic')
    clearBridgedProvider('web3auth')
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

  // THE BUG. The bridge was a single slot shared by both SDKs, read without
  // checking WHO published. Web3Auth publishing after Magic — which happens on
  // any page load where a Web3Auth wallet session is restored — silently
  // replaced the Magic session's signer with the external wallet's.
  it('a Magic session must not sign with a Web3Auth-published provider', () => {
    setBridgedProvider('magic', magicProvider, MAGIC_ADDR)
    // Web3Auth restores its session a moment later. Both are now live.
    setBridgedProvider('web3auth', web3authProvider, WALLET_ADDR)

    const { result } = renderHook(() => useActiveWalletClient())

    // Auth says this is the Magic player, so the signer must be their Magic
    // wallet. Anything else signs as the wrong address.
    expect(result.current?.account?.address).toBe(MAGIC_ADDR)
  })

  it('publish order cannot decide who signs', () => {
    // Same two sessions, reversed order. A keyed registry makes this identical;
    // the single slot made it the difference between working and broken.
    setBridgedProvider('web3auth', web3authProvider, WALLET_ADDR)
    setBridgedProvider('magic', magicProvider, MAGIC_ADDR)

    const { result } = renderHook(() => useActiveWalletClient())
    expect(result.current?.account?.address).toBe(MAGIC_ADDR)
  })

  it('a wallet session reads Web3Auth, never Magic', () => {
    mockAuth.mockReturnValue({ status: 'ready', address: WALLET_ADDR, source: 'wallet' })
    setBridgedProvider('magic', magicProvider, MAGIC_ADDR)
    setBridgedProvider('web3auth', web3authProvider, WALLET_ADDR)

    const { result } = renderHook(() => useActiveWalletClient())
    expect(result.current?.account?.address).toBe(WALLET_ADDR)
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

  // THE REGRESSION THIS REPLACED. Selection used to run in a fixed order and
  // then reject the winner on a bad address, so a leftover entry for a DIFFERENT
  // address masked the correct provider and the session could never sign — which
  // is what "connect MetaMask, then the Bank says wallet can't sign" was.
  it('a stale entry for another address cannot mask the right provider', () => {
    mockAuth.mockReturnValue({ status: 'ready', address: WALLET_ADDR, source: 'wallet' })
    // Leftover half-finished session from the other SDK, on a different address.
    setBridgedProvider('magic', magicProvider, MAGIC_ADDR)
    // The provider that actually owns this session.
    setBridgedProvider('web3auth', web3authProvider, WALLET_ADDR)

    const { result } = renderHook(() => useActiveWalletClient())
    expect(result.current?.account?.address).toBe(WALLET_ADDR)
  })

  it('gives nothing while auth is still loading', () => {
    mockAuth.mockReturnValue({ status: 'loading', address: undefined, source: undefined })
    setBridgedProvider('magic', magicProvider, MAGIC_ADDR)
    const { result } = renderHook(() => useActiveWalletClient())
    expect(result.current).toBeUndefined()
  })
})
