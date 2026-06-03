'use client'

import { useAccount } from 'wagmi'
import { useValorAuth } from '@/hooks/useValorAuth'
import { usePlayerSync } from '@/hooks/usePlayerSync'
import { useRealtimePlayer } from '@/hooks/useRealtimePlayer'
import { useDecayMonitor } from '@/hooks/useDecayMonitor'

export default function AppInit() {
  const { address } = useAccount()
  useValorAuth()
  usePlayerSync(address)
  useRealtimePlayer(address)
  useDecayMonitor()
  return null
}
