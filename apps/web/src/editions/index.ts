/**
 * @module editions
 * @description The door detector. Decides which edition of Valor is running.
 *
 * This is the ONLY module the rest of the app imports from. Call sites ask
 * `edition().currency.symbol` or `edition().chain.id`; they never import
 * `editions/web/config` directly. See editions/types.ts for why.
 */

import type { EditionConfig, EditionId } from './types'
import { WEB_EDITION } from './web/config'

const EDITIONS: Record<EditionId, EditionConfig> = {
  web: WEB_EDITION,
}

let cached: EditionConfig | null = null

/** Which edition is running. Resolved once, then memoised. */
export function edition(): EditionConfig {
  if (cached) return cached

  cached = EDITIONS.web
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
