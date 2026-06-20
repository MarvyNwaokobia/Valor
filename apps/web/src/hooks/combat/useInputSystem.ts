'use client'

import { useEffect, useRef, useCallback } from 'react'
import type { CombatAction } from '@/lib/combat/types'

export interface InputState {
  /** Queued action to be consumed by the combat engine */
  pending: CombatAction | null
  /** Whether block is currently held */
  blocking: boolean
}

/**
 * Maps keyboard and touch events to combat actions.
 *
 * Keyboard:
 *   J / Left Click  → light_attack
 *   K / Right Click  → heavy_attack
 *   L (hold)         → block
 *   Space / Shift    → dodge
 *   Q               → special
 *
 * Touch (on the battle container):
 *   Tap             → light_attack
 *   Long press      → heavy_attack
 *   Two-finger tap  → dodge
 *   Swipe down      → block (hold)
 *   Swipe up        → special
 */
export function useInputSystem(enabled: boolean) {
  const state = useRef<InputState>({ pending: null, blocking: false })
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const wasLongPress = useRef(false)

  const emit = useCallback((action: CombatAction) => {
    state.current.pending = action
  }, [])

  const consume = useCallback((): CombatAction | null => {
    const action = state.current.pending
    state.current.pending = null
    return action
  }, [])

  const isBlocking = useCallback((): boolean => {
    return state.current.blocking
  }, [])

  // ── Keyboard ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      switch (e.code) {
        case 'KeyJ':
          emit('light_attack'); break
        case 'KeyK':
          emit('heavy_attack'); break
        case 'KeyL':
          state.current.blocking = true
          emit('block_start')
          break
        case 'Space':
        case 'ShiftLeft':
        case 'ShiftRight':
          e.preventDefault()
          emit('dodge')
          break
        case 'KeyQ':
          emit('special'); break
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'KeyL') {
        state.current.blocking = false
        emit('block_end')
      }
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button === 0) emit('light_attack')
      if (e.button === 2) emit('heavy_attack')
      if (e.button === 1) {
        state.current.blocking = true
        emit('block_start')
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (e.button === 1) {
        state.current.blocking = false
        emit('block_end')
      }
    }

    function onContextMenu(e: Event) { e.preventDefault() }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('contextmenu', onContextMenu)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [enabled, emit])

  // ── Touch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length >= 2) {
        emit('dodge')
        return
      }

      const touch = e.touches[0]
      touchStartY.current = touch.clientY
      touchStartTime.current = performance.now()
      wasLongPress.current = false

      longPressTimer.current = setTimeout(() => {
        wasLongPress.current = true
        emit('heavy_attack')
      }, 300)
    }

    function onTouchEnd(e: TouchEvent) {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }

      if (state.current.blocking) {
        state.current.blocking = false
        emit('block_end')
        return
      }

      if (wasLongPress.current) return

      const duration = performance.now() - touchStartTime.current
      if (duration < 300) {
        const touch = e.changedTouches[0]
        const deltaY = touch.clientY - touchStartY.current

        if (deltaY > 40) {
          state.current.blocking = true
          emit('block_start')
        } else if (deltaY < -40) {
          emit('special')
        } else {
          emit('light_attack')
        }
      }
    }

    function onTouchCancel() {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
      if (state.current.blocking) {
        state.current.blocking = false
        emit('block_end')
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchCancel)
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
    }
  }, [enabled, emit])

  return { consume, isBlocking, emit }
}
