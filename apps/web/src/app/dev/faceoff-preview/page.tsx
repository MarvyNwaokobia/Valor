'use client'

import { useRef } from 'react'
import dynamic from 'next/dynamic'
import type { PlayerSnapshot } from '@/hooks/useArenaSocket'

/** Dev preview of the Face-Off arena room, bypassing real matchmaking (no
 *  auth, no /ws/arena, no stake) so the visuals can be checked without a
 *  live 2-player match. A fake opponent snapshot stands still across the
 *  room so the cover/lighting/materials are all visible at once. */
const ArenaScene = dynamic(() => import('@/engine/scene/ArenaScene').then((m) => m.ArenaScene), { ssr: false })

export default function DevFaceoffPreview() {
  const latestPlayers = useRef<Map<string, PlayerSnapshot>>(
    new Map([['0xOPPONENT', {
      wallet: '0xOPPONENT', x: 0, z: -7.3, yaw: 0, pitch: 0,
      hp: 100, ammo: 30, reloading: false, crouching: false, ads: false,
    }]]),
  )
  return (
    <ArenaScene
      walletAddress="0xLOCAL"
      opponentWallet="0xOPPONENT"
      fighting={true}
      sendInput={() => {}}
      drainHits={() => []}
      latestPlayers={latestPlayers}
      onLocalHp={() => {}}
      onAmmo={() => {}}
      onOpponentHp={() => {}}
    />
  )
}
