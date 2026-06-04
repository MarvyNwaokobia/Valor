'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useConnection } from 'wagmi'
import { usePlayerStore } from '@/stores/usePlayerStore'
import IdentityVerification from '@/components/onboarding/IdentityVerification'
import CharacterCreation from '@/components/onboarding/CharacterCreation'
import CharacterSelectScreen, { type Gender } from '@/components/onboarding/CharacterSelectScreen'
import type { CharacterClass } from '@/lib/classes'

type Step = 'verify' | 'select' | 'create'

export default function OnboardingPage() {
  const { address } = useConnection()
  const router = useRouter()
  const player = usePlayerStore((s) => s.player)
  // DEV BYPASS: skip GoodDollar verify for testing — restore to 'verify' before launch
  const [step, setStep] = useState<Step>('select')
  const [selectedClass, setSelectedClass] = useState<CharacterClass>('Berserker')
  const [selectedGender, setSelectedGender] = useState<Gender>('male')

  useEffect(() => {
    if (player) router.replace('/')
  }, [player, router])

  if (!address) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <p className="text-white font-display text-xl font-bold">Sign In to Play</p>
        <p className="text-slate-400 text-sm mt-2">Use the button in the top right to sign in and begin.</p>
      </div>
    )
  }

  if (step === 'select') {
    return (
      <CharacterSelectScreen
        onSelect={(cls, gen) => {
          setSelectedClass(cls)
          setSelectedGender(gen)
          setStep('create')
        }}
      />
    )
  }

  if (step === 'create') {
    return (
      <CharacterCreation
        walletAddress={address}
        initialClass={selectedClass}
        initialGender={selectedGender}
        onCreated={() => router.replace('/')}
      />
    )
  }

  // Verify step still uses the contained layout
  return (
    <div className="max-w-xl mx-auto py-8">
      <div className="flex items-center gap-3 mb-10">
        <StepDot active={step === 'verify'} done={false} label="1" title="Verify" />
        <div className="flex-1 h-px bg-valor-border" />
        <StepDot active={false} done={false} label="2" title="Create" />
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
            <IdentityVerification walletAddress={address} onVerified={() => setStep('create')} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StepDot({ active, done, label, title }: { active: boolean; done: boolean; label: string; title: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
        done ? 'bg-valor-gold text-black' : active ? 'bg-valor-gold/20 border-2 border-valor-gold text-valor-gold' : 'bg-valor-surface border-2 border-valor-border text-slate-500'
      }`}>
        {done ? '✓' : label}
      </div>
      <p className={`text-xs ${active ? 'text-valor-gold' : 'text-slate-500'}`}>{title}</p>
    </div>
  )
}
