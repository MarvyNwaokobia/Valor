'use client'

import { explorerTxUrl } from '@/editions/chain'
import { CELO_CHAIN_ID } from '@/lib/constants'

interface ChainBadgeProps {
  txHash: string
  /**
   * Which chain this transaction was mined on.
   *
   * Defaults to Celo because every transaction recorded before the multichain
   * work was on Celo, and the API only started attributing chains with the
   * `battle_chain_records` migration. The default is for those historical rows
   * ONLY — anything reading a chain-attributed row should pass the real value,
   * since a wrong explorer link looks exactly like a lost transaction.
   */
  chainId?: number
  className?: string
}

export function ChainBadge({ txHash, chainId = CELO_CHAIN_ID, className = '' }: ChainBadgeProps) {
  const href = explorerTxUrl(chainId, txHash)

  // No explorer for this chain means no honest link to offer. A badge that goes
  // nowhere is worse than no badge.
  if (!href) return null

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-500 hover:text-emerald-400 transition-colors ${className}`}
      title={`View transaction: ${txHash}`}
    >
      ✦ verified
    </a>
  )
}
