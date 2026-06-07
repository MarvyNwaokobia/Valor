'use client'

interface ChainBadgeProps {
  txHash: string
  className?: string
}

export function ChainBadge({ txHash, className = '' }: ChainBadgeProps) {
  return (
    <a
      href={`https://celoscan.io/tx/${txHash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-500 hover:text-emerald-400 transition-colors ${className}`}
      title={`View on Celoscan: ${txHash}`}
    >
      ✦ verified
    </a>
  )
}
