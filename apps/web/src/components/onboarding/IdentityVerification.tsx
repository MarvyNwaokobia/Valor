import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useGoodDollarIdentity } from '@/hooks/useGoodDollarIdentity'
import { usePlayerStore } from '@/stores/usePlayerStore'

interface Props {
  walletAddress: `0x${string}`
  onVerified: () => void
}

export default function IdentityVerification({ walletAddress, onVerified }: Props) {
  const setVerified = usePlayerStore((s) => s.setVerified)
  const { status, faceVerifyUrl, error, check, getFaceVerifyUrl, reset } =
    useGoodDollarIdentity()

  async function handleVerify() {
    const verified = await check(walletAddress)
    if (verified) {
      setVerified(true)
      setTimeout(onVerified, 600)
    } else {
      await getFaceVerifyUrl()
    }
  }

  async function handleRecheckAfterFV() {
    const verified = await check(walletAddress)
    if (verified) {
      setVerified(true)
      setTimeout(onVerified, 600)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-display font-bold text-white">Verify Your Account</h2>
        <p className="text-slate-400 text-sm mt-2 leading-relaxed">
          One quick verification step to keep Valor fair. Free, takes under a minute,
          and your personal info stays private.
        </p>
      </div>

      {status === 'idle' && (
        <motion.button
          onClick={handleVerify}
          className="px-8 py-3 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light transition-colors"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Verify Account
        </motion.button>
      )}

      {status === 'switching_chain' && (
        <div className="flex items-center gap-3 text-slate-400 py-2">
          <motion.div
            className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
          />
          <span className="text-sm">Connecting...</span>
        </div>
      )}

      {status === 'checking' && (
        <div className="flex items-center gap-3 text-slate-400 py-2">
          <motion.div
            className="w-5 h-5 rounded-full border-2 border-valor-gold border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
          />
          <span className="text-sm">Checking your account...</span>
        </div>
      )}

      {status === 'not_whitelisted' && (
        <div className="flex flex-col gap-4">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
            <p className="text-blue-300 text-sm font-bold mb-1">One More Step</p>
            <p className="text-slate-400 text-sm leading-relaxed">
              Complete a quick face scan to confirm you're a real player — no bots allowed.
              It takes under a minute and keeps your info private.
            </p>
          </div>

          {faceVerifyUrl ? (
            <a
              href={faceVerifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 transition-colors"
            >
              <span>Start Verification</span>
              <span className="text-sm opacity-80">↗</span>
            </a>
          ) : (
            <button
              onClick={getFaceVerifyUrl}
              className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 transition-colors"
            >
              Get Verification Link
            </button>
          )}

          <button
            onClick={handleRecheckAfterFV}
            className="text-sm text-slate-400 hover:text-white transition-colors underline"
          >
            I've verified — continue
          </button>
        </div>
      )}

      {status === 'whitelisted' && (
        <motion.div
          className="flex items-center gap-3 text-green-400"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
            <span className="text-xs">✓</span>
          </div>
          <p className="font-bold">Verified! Creating your character...</p>
        </motion.div>
      )}

      {status === 'error' && (
        <div className="flex flex-col gap-3">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
          <button
            onClick={reset}
            className="text-sm text-slate-400 hover:text-white transition-colors underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
