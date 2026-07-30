/**
 * @module editions
 * @description The door detector. Decides which edition of Valor is running.
 *
 * This is the ONLY module the rest of the app imports from. Call sites ask
 * `edition().features.bank` or `edition().currency.symbol`; they never import
 * `editions/minipay/config` directly. See editions/types.ts for why.
 */

import type { EditionConfig, EditionId } from './types'
import { WEB_EDITION } from './web/config'
import { MINIPAY_EDITION } from './minipay/config'
import { isMiniPayHost } from './minipay/detect'
import { AVALANCHE_EDITION } from './avalanche/config'

const EDITIONS: Record<EditionId, EditionConfig> = {
  web: WEB_EDITION,
  minipay: MINIPAY_EDITION,
  avalanche: AVALANCHE_EDITION,
}

/**
 * Avalanche has no host to sniff, so it is opt-in for now via env at build
 * time. If Avalanche later becomes a mode players switch into at runtime
 * rather than a separate deploy, this is the one function that changes.
 */
function isAvalancheBuild(): boolean {
  return process.env.NEXT_PUBLIC_EDITION === 'avalanche'
}

let cached: EditionConfig | null = null

/** Which edition is running. Resolved once, then memoised. */
export function edition(): EditionConfig {
  if (cached) return cached

  const override = process.env.NEXT_PUBLIC_EDITION as EditionId | undefined
  if (override && override in EDITIONS) {
    cached = EDITIONS[override]
    return cached
  }

  if (isAvalancheBuild()) {
    cached = EDITIONS.avalanche
  } else if (isMiniPayHost()) {
    cached = EDITIONS.minipay
  } else {
    cached = EDITIONS.web
  }
  return cached
}

/**
 * Reset the memo. Tests only — production resolves once per page load, which
 * is correct because the host cannot change under a running page.
 */
export function __resetEditionForTests(): void {
  cached = null
}

export type { EditionConfig, EditionId } from './types'
