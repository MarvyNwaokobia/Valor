import { useState } from 'react'
import { motion } from 'framer-motion'
import { Users, Search, Trophy, HeartCrack } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props {
  walletAddress: string
  onBack: () => void
}

interface ChallengeResult {
  winner: string
  xp_challenger: number
  xp_opponent: number
  battle_id: string
}

export default function ChallengeBattle({ walletAddress, onBack }: Props) {
  const [input, setInput] = useState('')
  const [resolvedOpponent, setResolvedOpponent] = useState<string | null>(null)
  const [resolvedName, setResolvedName] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [fighting, setFighting] = useState(false)
  const [result, setResult] = useState<ChallengeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isAddress = input.startsWith('0x') && input.length === 42

  async function handleLookup() {
    setError(null)
    setResolvedOpponent(null)

    if (!input.trim()) return

    if (isAddress) {
      // Validate the address has a character
      setSearching(true)
      const { data } = await supabase
        .from('players')
        .select('wallet_address, character_name')
        .eq('wallet_address', input.toLowerCase())
        .single()
      setSearching(false)

      if (!data) {
        setError('No warrior found at that address.')
        return
      }
      setResolvedOpponent(data.wallet_address)
      setResolvedName(data.character_name)
    } else {
      // Search by username or character name
      setSearching(true)
      const { data } = await supabase
        .from('players')
        .select('wallet_address, character_name, username')
        .or(`character_name.ilike.${input},username.ilike.${input}`)
        .neq('wallet_address', walletAddress)
        .limit(1)
        .maybeSingle()
      setSearching(false)

      if (!data) {
        setError(`No warrior named "${input}" found.`)
        return
      }
      setResolvedOpponent(data.wallet_address)
      setResolvedName(data.character_name)
    }
  }

  async function handleChallenge() {
    if (!resolvedOpponent) return
    if (resolvedOpponent === walletAddress) {
      setError("You can't challenge yourself.")
      return
    }

    setFighting(true)
    setError(null)

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/battles/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenger_wallet: walletAddress,
          opponent_wallet: resolvedOpponent,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Challenge failed' }))
        throw new Error(body.error ?? 'Challenge failed')
      }

      const data: ChallengeResult = await res.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Challenge failed')
    } finally {
      setFighting(false)
    }
  }

  const won = result?.winner.toLowerCase() === walletAddress.toLowerCase()

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-500 hover:text-white transition-colors text-sm">
          ← Back
        </button>
        <h2 className="font-display font-bold text-white text-lg">Challenge a Warrior</h2>
      </div>

      {result ? (
        <motion.div
          className="flex flex-col items-center gap-5 py-4"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          {won
            ? <Trophy size={56} className="text-valor-gold" strokeWidth={1.2} />
            : <HeartCrack size={56} className="text-red-500" strokeWidth={1.2} />
          }
          <div className="text-center">
            <p className="text-2xl font-display font-bold text-white">
              {won ? 'Victory!' : 'Defeated'}
            </p>
            <p className="text-valor-gold font-bold mt-1">+{won ? result.xp_challenger : result.xp_opponent} XP</p>
          </div>
          <p className="text-xs text-slate-500">
            vs {resolvedName} · Both player cards update in real-time
          </p>
          <button
            onClick={() => { setResult(null); setInput(''); setResolvedOpponent(null); setResolvedName(null) }}
            className="w-full py-3 bg-valor-gold text-black font-bold rounded-xl hover:bg-valor-gold-light transition-colors"
          >
            Challenge Again
          </button>
        </motion.div>
      ) : (
        <>
          <p className="text-sm text-slate-400 leading-relaxed">
            Enter a wallet address or player name. The fight is simulated instantly based on stats —
            both players' XP updates via real-time.
          </p>

          {/* Input */}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); setResolvedOpponent(null); setError(null) }}
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
              placeholder="0x... or player name"
              className="flex-1 bg-valor-surface-2 border border-valor-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-valor-gold/60 transition-colors"
            />
            <motion.button
              onClick={handleLookup}
              disabled={searching || !input.trim()}
              whileTap={{ scale: 0.97 }}
              className="px-4 py-2.5 bg-valor-surface-2 border border-valor-border rounded-xl hover:border-valor-gold/50 disabled:opacity-40 transition-colors"
            >
              {searching
                ? <motion.span className="w-4 h-4 rounded-full border-2 border-valor-gold border-t-transparent inline-block" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
                : <Search size={16} className="text-slate-400" />
              }
            </motion.button>
          </div>

          {/* Resolved player preview */}
          {resolvedOpponent && resolvedName && (
            <motion.div
              className="flex items-center gap-3 p-4 bg-valor-surface-2 border border-valor-gold/30 rounded-xl"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Users size={20} className="text-valor-gold shrink-0" strokeWidth={1.5} />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white text-sm">{resolvedName}</p>
                <p className="text-xs text-slate-500 truncate">{resolvedOpponent}</p>
              </div>
              <span className="text-xs text-green-400 font-bold">Found</span>
            </motion.div>
          )}

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <motion.button
            onClick={handleChallenge}
            disabled={!resolvedOpponent || fighting}
            whileHover={resolvedOpponent ? { scale: 1.01 } : {}}
            whileTap={resolvedOpponent ? { scale: 0.98 } : {}}
            className="w-full py-3.5 bg-valor-gold text-black font-bold rounded-xl hover:bg-valor-gold-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {fighting ? (
              <span className="flex items-center justify-center gap-2">
                <motion.span className="w-4 h-4 rounded-full border-2 border-black border-t-transparent inline-block" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
                Simulating...
              </span>
            ) : (
              'Send Challenge'
            )}
          </motion.button>
        </>
      )}
    </div>
  )
}
