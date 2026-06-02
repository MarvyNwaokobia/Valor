import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useConnection } from 'wagmi'
import IdentityVerification from '@/components/onboarding/IdentityVerification'
import CharacterCreation from '@/components/onboarding/CharacterCreation'

type Step = 'verify' | 'create'

export default function OnboardingPage() {
  const { address } = useConnection()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('verify')

  if (!address) {
    navigate('/')
    return null
  }

  return (
    <div className="max-w-xl mx-auto py-8">
      <div className="flex items-center gap-3 mb-8">
        <StepDot active={step === 'verify'} done={step === 'create'} label="1" />
        <div className="flex-1 h-px bg-valor-border" />
        <StepDot active={step === 'create'} done={false} label="2" />
      </div>

      <AnimatePresence mode="wait">
        {step === 'verify' && (
          <motion.div
            key="verify"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
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
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <CharacterCreation walletAddress={address} onCreated={() => navigate('/')} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
        done
          ? 'bg-valor-gold text-black'
          : active
            ? 'bg-valor-gold/20 border-2 border-valor-gold text-valor-gold'
            : 'bg-valor-surface border-2 border-valor-border text-slate-500'
      }`}
    >
      {done ? '✓' : label}
    </div>
  )
}
