// Registry for the EIP-1193 provider of whichever embedded-wallet SDK is live.
//
// Embedded-wallet SDKs (Magic today; a second provider later) each expose their
// own EIP-1193 provider and their own async "am I logged in yet" state. Wiring
// one of those into a wagmi connector means a shim has to guess when the SDK's
// state is settled, and guessing wrong is what broke the old Web3Auth bridge.
//
// So we don't. Each SDK publishes its provider here once it has genuinely
// resolved an address, and `useActiveWalletClient` builds a plain viem
// WalletClient straight off it. wagmi stays in charge of exactly one thing:
// externally-connected wallets through its own first-party connectors.
//
// Adding a second SDK means calling `setBridgedProvider` from its provider
// component. Nothing downstream changes.

import type { EIP1193Provider } from 'viem'

/** Which SDK published the provider. Only Magic publishes now — Web3Auth was
 * removed because its bundled WalletConnect hardcodes a relay host that some
 * ISP resolvers sinkhole, with no way to override it. The keyed shape stays so
 * a future embedded SDK cannot reintroduce last-writer-wins. */
export type BridgeSource = 'magic'

export interface BridgeEntry {
  source: BridgeSource
  provider: EIP1193Provider
  address: `0x${string}`
}

// KEYED BY SOURCE, not a single slot.
//
// This was one `current` variable holding one entry for two independent SDKs,
// so publishing was last-writer-wins: a Magic player whose Web3Auth wallet
// session restored on page load had their signer silently replaced by the
// external wallet's provider AND address. Every signing path reads this
// registry, so that one overwrite broke all eleven of them at once, and it only
// reproduced when Web3Auth happened to publish second — which is why it looked
// random.
//
// Two live sessions is a legitimate state (a player can hold a Magic wallet and
// have connected an external one), so the fix is to stop pretending only one can
// exist. Callers now ask for the source they mean and cannot be handed the other.
const entries = new Map<BridgeSource, BridgeEntry>()

/**
 * Publish the active wallet for one SDK. Call only once the SDK has resolved a
 * real address — publishing early is the race the old bridge died on.
 */
export function setBridgedProvider(
  source: BridgeSource,
  provider: EIP1193Provider,
  address: `0x${string}`,
): void {
  entries.set(source, { source, provider, address })
}

/**
 * Retract a provider. Scoped to the publisher so that with two SDKs mounted,
 * one signing out can never clear the other's live session.
 */
export function clearBridgedProvider(source: BridgeSource): void {
  entries.delete(source)
}

/**
 * The provider published by a SPECIFIC SDK. Callers must name the source they
 * mean, so a Magic session can never be handed Web3Auth's signer.
 */
export function getBridgedProviderFor(source: BridgeSource): BridgeEntry | null {
  return entries.get(source) ?? null
}
