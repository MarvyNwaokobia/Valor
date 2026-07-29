'use client'

import { useValorAuth } from '@/hooks/useValorAuth'
import { usePlayerSync } from '@/hooks/usePlayerSync'
import { useRealtimePlayer } from '@/hooks/useRealtimePlayer'
import { useDecayMonitor } from '@/hooks/useDecayMonitor'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useWalletBrowserConnect } from '@/hooks/useWalletBrowserConnect'
import { useGLTF } from '@react-three/drei'
import { CHARACTER_GLB } from '@/lib/classes'

// Fire-and-forget: preload all 3 character GLBs immediately so they're
// ready by the time the player reaches character select or battle screens.
Object.values(CHARACTER_GLB).forEach(path => useGLTF.preload(path))

// NOTE: the heavy first-person scene chunk is NOT warmed here. Doing it for every
// visitor cost mobile data + a parse hitch for people who never fight. It's now
// warmed on intent from the pre-fight screens (see warmFightScene()).

export default function AppInit() {
  useValorAuth()
  // Mounted app-wide because the deep link re-opens whatever page the player was
  // on, not just the landing page.
  useWalletBrowserConnect()
  const { address } = useResolvedAuth()
  usePlayerSync(address)
  useRealtimePlayer(address)
  useDecayMonitor()
  return null
}
