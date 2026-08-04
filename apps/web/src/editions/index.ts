/**
 * @module editions
 * @description The door detector. Decides which edition of Valor is running.
 *
 * This is the ONLY module the rest of the app imports from. Call sites ask
 * `edition().features.bank` or `edition().currency.symbol`; they never import
 * `editions/minipay/config` directly. See editions/types.ts for why.
 *
 * `NEXT_PUBLIC_EDITION` forces one at build time. It exists for testing the
 * MiniPay edition in a normal browser, where there is no host to sniff.
 */

import type { EditionConfig, EditionId } from './types'
import { WEB_EDITION } from './web/config'
import { MINIPAY_EDITION } from './minipay/config'
import { isMiniPayHost } from './minipay/detect'

const EDITIONS: Record<EditionId, EditionConfig> = {
  web: WEB_EDITION,
  minipay: MINIPAY_EDITION,
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

  cached = isMiniPayHost() ? EDITIONS.minipay : EDITIONS.web
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
