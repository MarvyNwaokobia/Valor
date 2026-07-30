/**
 * @module editions/minipay/detect
 * @description Is this page running inside MiniPay's in-app browser?
 *
 * MiniPay injects an EIP-1193 provider and flags it. That flag is the whole
 * detection: the player never chooses, and there is no MiniPay-only URL that
 * can be shared into a normal browser and get it wrong.
 *
 * Lives in the minipay folder rather than in editions/index.ts so that every
 * MiniPay-specific fact stays in one place. `editions/index.ts` imports it.
 */

interface MaybeMiniPayEthereum {
  isMiniPay?: boolean
}

/**
 * SSR-safe. Returns false on the server, where there is no `window`, which is
 * correct: the server cannot know the host and must render the default edition.
 * The client re-resolves on mount.
 */
export function isMiniPayHost(): boolean {
  if (typeof window === 'undefined') return false
  const eth = (window as { ethereum?: MaybeMiniPayEthereum }).ethereum
  return eth?.isMiniPay === true
}
