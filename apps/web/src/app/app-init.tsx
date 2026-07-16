'use client'

import { useValorAuth } from '@/hooks/useValorAuth'
import { usePlayerSync } from '@/hooks/usePlayerSync'
import { useRealtimePlayer } from '@/hooks/useRealtimePlayer'
import { useDecayMonitor } from '@/hooks/useDecayMonitor'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useGLTF } from '@react-three/drei'
import { CHARACTER_GLB } from '@/lib/classes'

// Fire-and-forget: preload all 3 character GLBs immediately so they're
// ready by the time the player reaches character select or battle screens.
Object.values(CHARACTER_GLB).forEach(path => useGLTF.preload(path))

// Warm the heavy first-person scene chunk during idle time. Entering a fight
// pulls a large three.js + postprocessing bundle; fetching it here (in the
// background, while the player is still in menus) means it's usually cached by
// the time they hit /fight — instead of a cold, blocking multi-MB download that
// can stall past webpack's timeout on weak connections (the ChunkLoadError).
if (typeof window !== 'undefined') {
  const warmScene = () => { import('@/engine/scene/ValorScene').catch(() => {}) }
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  }).requestIdleCallback
  if (ric) ric(warmScene, { timeout: 4000 })
  else setTimeout(warmScene, 2500)
}

export default function AppInit() {
  useValorAuth()
  const { address } = useResolvedAuth()
  usePlayerSync(address)
  useRealtimePlayer(address)
  useDecayMonitor()
  return null
}
