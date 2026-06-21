'use client'

import { useState, useCallback } from 'react'
import { getAudioManager } from '@/lib/audio'

export function useAudio() {
  const mgr = getAudioManager()
  const [muted, setMutedState] = useState(false)

  const toggleMute = useCallback(() => {
    const next = !mgr.muted
    mgr.setMuted(next)
    setMutedState(next)
  }, [mgr])

  const playHit = useCallback((cls: string, dmg: number) => mgr.playHit(cls, dmg), [mgr])
  const playSpecial = useCallback((cls: string) => mgr.playSpecial(cls), [mgr])
  const playSwing = useCallback((isSpecial?: boolean) => mgr.playSwing(isSpecial), [mgr])
  const playBlock = useCallback(() => mgr.playBlock(), [mgr])
  const playVictory = useCallback(() => mgr.playVictory(), [mgr])
  const playDefeat = useCallback(() => mgr.playDefeat(), [mgr])
  const playButtonTap = useCallback(() => mgr.playButtonTap(), [mgr])
  const playButtonConfirm = useCallback(() => mgr.playButtonConfirm(), [mgr])
  const startAmbient = useCallback(() => mgr.startAmbient(), [mgr])
  const stopAmbient = useCallback(() => mgr.stopAmbient(), [mgr])

  return {
    muted,
    toggleMute,
    playHit,
    playSpecial,
    playSwing,
    playBlock,
    playVictory,
    playDefeat,
    playButtonTap,
    playButtonConfirm,
    startAmbient,
    stopAmbient,
  }
}
