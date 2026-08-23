'use client'

import { useValorAuth } from '@/hooks/useValorAuth'
import { usePlayerSync } from '@/hooks/usePlayerSync'
import { useRealtimePlayer } from '@/hooks/useRealtimePlayer'
import { useDecayMonitor } from '@/hooks/useDecayMonitor'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useEnsureActiveChain } from '@/hooks/useEnsureActiveChain'

// NOTE: the heavy first-person scene chunk is NOT warmed here. Doing it for every
// visitor cost mobile data + a parse hitch for people who never fight. It's now
// warmed on intent from the pre-fight screens (see warmFightScene()).
//
// The three character GLBs were preloaded here too, at module scope, and they broke
// that same rule twice over. AppInit is mounted by the ROOT layout, so this ran on
// every route for every visitor, signed out ones included:
//
//   • it fetched ~6 MB of avatars (berserker 1.4 MB + phantom 1.3 MB + sentinel
//     3.3 MB) before the visitor had done anything. Someone landing on `/` and
//     tapping straight into a fight paid for all three and used none — the fight
//     renders operator.glb, a fourth model entirely;
//   • and importing `useGLTF` from @react-three/drei HERE put drei (and three) in
//     the root bundle, so every page shipped the 3D stack whether or not it drew
//     anything. That is the parse hitch the note above was written to avoid.
//
// Nothing regresses by dropping it: the screens that actually show an avatar load
// it on mount, and character select already warms the neighbouring classes on
// intent (CharacterSelectScreen calls CharacterViewer.preload as you scroll).

export default function AppInit() {
  useValorAuth()
  const { address } = useResolvedAuth()
  usePlayerSync(address)
  useRealtimePlayer(address)
  useDecayMonitor()
  useEnsureActiveChain()
  return null
}
