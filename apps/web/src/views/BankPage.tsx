'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Copy, Check, LogOut, ArrowUpRight, ArrowLeft } from 'lucide-react'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useSignOut } from '@/hooks/useSignOut'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useGBalance } from '@/hooks/useGBalance'
import { useLedgerSummary } from '@/hooks/useLedgerSummary'
import { useTransferOut } from '@/hooks/useTransferOut'
import DailyClaimButton from '@/components/player-card/DailyClaimButton'
import RankPoolPanel from '@/components/profile/RankPoolPanel'
import { formatGDollarNumber } from '@/utils/format'
import LoadingScreen from '@/components/ui/LoadingScreen'

function truncate(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-4 flex flex-col gap-1">
      <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className="font-display font-black text-white text-xl leading-none">{value}</p>
      {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function BankPage() {
  const { status, address } = useResolvedAuth()
  const router = useRouter()
  const signOut = useSignOut()
  const player = usePlayerStore((s) => s.player)
  const playerSynced = usePlayerStore((s) => s.playerSynced)

  const [copied, setCopied] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [destination, setDestination] = useState('')
  const [amount, setAmount] = useState('')
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null)

  const { formatted: gBalanceFormatted, refetch: refetchBalance } = useGBalance(address as `0x${string}` | undefined)
  const { data: ledger } = useLedgerSummary(address)
  const { transfer, pending: transferring } = useTransferOut(address)

  if (status === 'loading') return <LoadingScreen />
  if (status === 'unauthenticated' || !address) { router.replace('/'); return null }
  if (!player && !playerSynced) return <LoadingScreen />
  if (!player) { router.replace('/'); return null }

  async function handleCopy() {
    await navigator.clipboard.writeText(address as string)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function handleTransfer() {
    setTransferError(null)
    setTransferSuccess(null)
    try {
      const hash = await transfer(destination, parseFloat(amount))
      setTransferSuccess(hash)
      setDestination('')
      setAmount('')
      refetchBalance()
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Transfer failed')
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col gap-2"
      >
        <Link
          href="/profile"
          className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-white transition-colors w-fit"
        >
          <ArrowLeft size={14} /> Profile
        </Link>
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-amber-500">Bank</p>
          <h1 className="font-display font-black text-white text-2xl tracking-wide">Your G$</h1>
        </div>
      </motion.div>

      {/* Wallet + sign out */}
      <div className="bg-valor-surface border border-valor-border rounded-xl p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm text-slate-300 truncate">{truncate(address)}</span>
          <button onClick={handleCopy} className="text-slate-500 hover:text-white transition-colors shrink-0" title="Copy address">
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
        </div>
        <button
          onClick={() => signOut()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition-colors shrink-0"
          style={{ background: 'rgba(255,255,255,0.04)' }}
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>

      {/* Balance */}
      <div className="flex items-center justify-between px-4 py-3 rounded-xl border"
        style={{ background: 'rgba(234,179,8,0.08)', borderColor: 'rgba(234,179,8,0.35)' }}>
        <div>
          <p className="text-[9px] uppercase tracking-widest text-amber-500/70 font-bold">G$ Balance</p>
          <p className="font-black text-amber-400 text-2xl">{gBalanceFormatted ? `${gBalanceFormatted} G$` : '—'}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">Spendable</p>
          <p className="text-[9px] text-slate-500 mt-0.5">Use in Marketplace</p>
        </div>
      </div>

      {/* Earned / spent breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Earned · UBI" value={`${formatGDollarNumber(ledger?.ubi_earned ?? 0)} G$`} />
        <StatTile label="Earned · Gameplay" value={`${formatGDollarNumber(ledger?.gameplay_earned ?? 0)} G$`} />
        <StatTile label="Spent · Market" value={`${formatGDollarNumber(ledger?.marketplace_spent ?? 0)} G$`} />
        <StatTile label="Transferred Out" value={`${formatGDollarNumber(ledger?.transferred_out ?? 0)} G$`} />
      </div>

      {/* Daily claim + rank pool */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DailyClaimButton walletAddress={address as `0x${string}`} />
        <RankPoolPanel rank={player.rank} walletAddress={address as `0x${string}`} />
      </div>

      {/* Transfer out */}
      <div className="bg-valor-surface border border-valor-border rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-white text-sm">Transfer G$ Out</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Send to any wallet — cash out your winnings</p>
          </div>
          <ArrowUpRight size={18} className="text-slate-500" />
        </div>

        {!showTransfer ? (
          <button
            onClick={() => setShowTransfer(true)}
            className="w-full py-2.5 font-black text-sm rounded-lg border text-slate-300 hover:text-white transition-colors"
            style={{ borderColor: '#2a2a3a' }}
          >
            Send G$
          </button>
        ) : (
          <div className="flex flex-col gap-2.5">
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value.trim())}
              placeholder="Destination wallet (0x...)"
              className="w-full px-3 py-2.5 rounded-lg bg-black/30 border border-valor-border text-sm text-white font-mono placeholder:text-slate-600 focus:outline-none"
            />
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (G$)"
              min="0"
              step="any"
              className="w-full px-3 py-2.5 rounded-lg bg-black/30 border border-valor-border text-sm text-white placeholder:text-slate-600 focus:outline-none"
            />

            {transferError && <p className="text-red-400 text-xs">{transferError}</p>}
            {transferSuccess && <p className="text-green-400 text-xs">Sent! tx {transferSuccess.slice(0, 10)}…</p>}

            <div className="flex gap-2">
              <button
                onClick={() => { setShowTransfer(false); setTransferError(null); setTransferSuccess(null) }}
                disabled={transferring}
                className="flex-1 py-2.5 text-sm font-bold rounded-lg border text-slate-400 hover:text-white transition-colors disabled:opacity-40"
                style={{ borderColor: '#2a2a3a' }}
              >
                Cancel
              </button>
              <motion.button
                onClick={handleTransfer}
                disabled={transferring || !destination || !amount}
                whileTap={{ scale: 0.97 }}
                className="flex-1 py-2.5 text-sm font-black rounded-lg text-black transition-opacity disabled:opacity-50"
                style={{ background: '#eab308' }}
              >
                {transferring ? 'Sending…' : `Confirm sending ${amount || '0'} G$`}
              </motion.button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
