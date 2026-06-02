import { useState } from 'react'
import { motion } from 'framer-motion'
import { usePlayerStore } from '@/stores/usePlayerStore'

interface Props {
  walletAddress: string
  onVerified: () => void
}

type VerifyState = 'idle' | 'checking' | 'face-required' | 'verified' | 'error'

export default function IdentityVerification({ walletAddress, onVerified }: Props) {
  const setVerified = usePlayerStore((s) => s.setVerified)
  const [state, setState] = useState<VerifyState>('idle')
  const [faceVerifyUrl, setFaceVerifyUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleVerify() {
    setState('checking')
    setErrorMsg(null)

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/identity/verify/${walletAddress}`,
      )
      const data = await res.json() as { verified: boolean; faceVerifyUrl?: string; error?: string }

      if (data.verified) {
        setState('verified')
        setVerified(true)
        setTimeout(onVerified, 800)
      } else if (data.faceVerifyUrl) {
        setFaceVerifyUrl(data.faceVerifyUrl)
        setState('face-required')
      } else {
        setState('error')
        setErrorMsg(data.error ?? 'Verification failed')
      }
    } catch {
      setState('error')
      setErrorMsg('Network error — please retry')
    }
  }

  async function handleFaceVerifyDone() {
    setState('checking')
    // Re-check whitelist after user completes face verification
    await handleVerify()
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-display font-bold text-white">Prove You're Human</h2>
        <p className="text-slate-400 text-sm mt-2">
          Valor requires GoodDollar identity verification. One real human, one character — no bots.
        </p>
      </div>

      {state === 'idle' && (
        <button
          onClick={handleVerify}
          className="px-8 py-3 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light transition-colors"
        >
          Verify with GoodDollar
        </button>
      )}

      {state === 'checking' && (
        <div className="flex items-center gap-3 text-slate-400">
          <motion.div
            className="w-5 h-5 rounded-full border-2 border-valor-gold border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          Checking whitelist...
        </div>
      )}

      {state === 'face-required' && faceVerifyUrl && (
        <div className="flex flex-col gap-4">
          <p className="text-slate-300 text-sm">
            Your wallet isn't verified yet. Complete face verification on GoodDollar — it takes under a minute.
          </p>
          <a
            href={faceVerifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 transition-colors text-center"
          >
            Open GoodDollar Verification →
          </a>
          <button
            onClick={handleFaceVerifyDone}
            className="text-sm text-slate-400 hover:text-white underline"
          >
            I've completed verification — check again
          </button>
        </div>
      )}

      {state === 'verified' && (
        <motion.p
          className="text-green-400 font-bold text-lg"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          ✓ Verified! Creating your character...
        </motion.p>
      )}

      {state === 'error' && (
        <div className="flex flex-col gap-3">
          <p className="text-red-400 text-sm">{errorMsg}</p>
          <button
            onClick={() => setState('idle')}
            className="text-sm text-slate-400 hover:text-white underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
