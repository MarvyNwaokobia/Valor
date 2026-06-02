import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useConnection } from 'wagmi'
import { usePlayerStore } from '@/stores/usePlayerStore'
import IdentityVerification from '@/components/onboarding/IdentityVerification'
import CharacterCreation from '@/components/onboarding/CharacterCreation'

type Step = 'verify' | 'create'

export default function OnboardingPage() {
  const { address } = useConnection()
  const navigate = useNavigate()
  const player = usePlayerStore((s) => s.player)
  const [step, setStep] = useState<Step>('verify')

  // Already has a character — skip onboarding
  useEffect(() => {
    if (player) navigate('/')
  }, [player, navigate])

  if (!address) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <p className="text-2xl mb-4">👋</p>
        <p className="text-white font-display text-xl font-bold">Connect Your Wallet</p>
        <p className="text-slate-400 text-sm mt-2">
          Use the button in the top right to connect and begin.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto py-8">
      {/* Progress indicator */}
      <div className="flex items-center gap-3 mb-10">
        <StepDot active={step === 'verify'} done={step === 'create'} label="1" title="Verify" />
        <div className="flex-1 h-px bg-valor-border" />
        <StepDot active={step === 'create'} done={false} label="2" title="Create" />
      </div>

      <AnimatePresence mode="wait">
        {step === 'verify' && (
          <motion.div
            key="verify"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25 }}
          >
            <IdentityVerification
              walletAddress={address}
              onVerified={() => setStep('create')}
            />
          </motion.div>
        )}
        {step === 'create' && (
          <motion.div
            key="create"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25 }}
          >
            <CharacterCreation walletAddress={address} onCreated={() => navigate('/')} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StepDot({
  active,
  done,
  label,
  title,
}: {
  active: boolean
  done: boolean
  label: string
  title: string
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
          done
            ? 'bg-valor-gold text-black'
            : active
              ? 'bg-valor-gold/20 border-2 border-valor-gold text-valor-gold shadow-[0_0_12px_rgba(234,179,8,0.3)]'
              : 'bg-valor-surface border-2 border-valor-border text-slate-500'
        }`}
      >
        {done ? '✓' : label}
      </div>
      <p className={`text-xs ${active ? 'text-valor-gold' : 'text-slate-500'}`}>{title}</p>
    </div>
  )
}
