'use client'

import { motion } from 'framer-motion'
import { CELO_CHAIN_ID } from '@/lib/constants'
import {
  AVALANCHE_CHAIN_ID,
  useShopCurrencyStore,
  useScripBalance,
} from '@/hooks/useShopCurrency'
import { formatGDollarNumber } from '@/utils/format'

/**
 * Choose which currency the shop charges in.
 *
 * RENDERS NOTHING UNTIL THE PLAYER HOLDS SCRIP. Every player would otherwise see
 * a toggle for a currency they have never heard of and hold none of, on a page
 * whose job is spending the currency they DO have. It appears the moment they
 * claim their first Scrip in the Bank, which is where they learn it exists.
 *
 * The balance shown is the on-chain ERC-20 balance, not the accrued figure from
 * the Bank. Accrued Scrip is a number in our database that no contract knows
 * about; offering to spend it would build a permit for tokens the buyer does not
 * hold. Claiming is what turns one into the other.
 */
export default function CurrencyToggle({ walletAddress }: { walletAddress: string | undefined }) {
  const chainId = useShopCurrencyStore((s) => s.chainId)
  const setChainId = useShopCurrencyStore((s) => s.setChainId)
  const { data: scrip = 0 } = useScripBalance(walletAddress)

  if (scrip <= 0) return null

  const options = [
    { id: CELO_CHAIN_ID, label: 'G$', hint: 'Earned on Celo' },
    { id: AVALANCHE_CHAIN_ID, label: 'SCRP', hint: `${formatGDollarNumber(scrip)} available` },
  ]

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Pay with</p>
      <div className="flex gap-2">
        {options.map((o) => {
          const active = chainId === o.id
          return (
            <motion.button
              key={o.id}
              onClick={() => setChainId(o.id)}
              whileTap={{ scale: 0.97 }}
              className="flex-1 px-3 py-2 rounded-lg border text-left transition-colors"
              style={{
                background: active ? 'rgba(234,179,8,0.12)' : 'rgba(8,10,16,0.9)',
                borderColor: active ? 'rgba(234,179,8,0.6)' : 'rgba(42,42,58,0.8)',
              }}
            >
              <span
                className="block text-sm font-black"
                style={{ color: active ? '#eab308' : '#94a3b8' }}
              >
                {o.label}
              </span>
              <span className="block text-[10px] text-slate-500 mt-0.5">{o.hint}</span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
