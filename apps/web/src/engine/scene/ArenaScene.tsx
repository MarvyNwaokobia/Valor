'use client'

/**
 * Face-Off — the real-time arena scene.
 *
 * Deliberately NOT ValorScene. ValorScene's `FpsSim` is a local, trusted
 * combat simulation against AI enemies; here the server (arena_server.rs) is
 * the sole authority over position, aim, ammo, and hits — this component's
 * only job is to capture input, send it, and render whatever the server says
 * is true. It never constructs or steps a local combat sim.
 *
 * Local player: rendered from LOCAL prediction (instant camera response),
 * softly reconciled toward the server's returned x/z on every state_update
 * rather than hard-snapped — the arena is small and open (no cover to
 * desync badly against), so this simple correction is enough without the
 * sequence-numbered replay a tighter shooter would need.
 *
 * Opponent: rendered ENTIRELY from server snapshots (never predicted — it's
 * not this client's job to guess where the other player is), smoothed with a
 * simple exponential lerp between ticks rather than buffered interpolation.
 *
 * All tuning constants below (WALK_SPEED, EYE_HEIGHT, ARENA_HALF_X/Z,
 * PITCH_LIMIT) MUST match apps/api/src/services/arena_server.rs — this is
 * cosmetic prediction of a simulation the server truly owns, not a second
 * copy of the rules.
 */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OperatorRig, type OperatorApi } from './OperatorRig'
import { makeGunMesh } from './GunMesh'
import type { ArenaInput, HitEvent, PlayerSnapshot } from '@/hooks/useArenaSocket'

const OPERATOR_GLB = '/characters/glb/operator.glb'

// Must match arena_server.rs's tuning block exactly.
const WALK_SPEED = 3.4
const EYE_HEIGHT = 1.6
const ARENA_HALF_X = 12
const ARENA_HALF_Z = 12
const PITCH_LIMIT = 1.45
const LOOK_SENS = 0.0010
const TOUCH_LOOK_SENS = 0.0022
const MOUSE_MAX_STEP = 120
/** How hard local position snaps back toward the server's truth each tick it
 *  arrives — a blend, not a hard correction, so ordinary latency jitter
 *  doesn't visibly pop the camera. */
const RECONCILE_STRENGTH = 0.25
/** How quickly the opponent's rendered position/yaw chases its latest
 *  snapshot — a simple critically-damped-ish lerp, not real interpolation. */
const OPPONENT_SMOOTH = 0.35

/** Same detection ValorScene uses (not exported from there, so mirrored here
 *  rather than pulling in the 4500-line file for one helper). */
function detectTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPod|iPad|Android|Windows Phone|IEMobile|BlackBerry/i.test(ua)) return true
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 0) return true
  if (navigator.maxTouchPoints > 0 && window.matchMedia?.('(pointer: coarse)')?.matches) return true
  return false
}

/** Shared, mutable input state — written by whichever input source is active
 *  (keyboard+mouse via pointer lock, or the touch overlay) and read once a
 *  frame by ArenaWorld's useFrame. Living outside React state on purpose:
 *  this changes every frame, and re-rendering React for it would be waste. */
interface InputRefs {
  keys: MutableRefObject<Set<string>>
  mouseDX: MutableRefObject<number>
  mouseDY: MutableRefObject<number>
  touchMoveX: MutableRefObject<number>
  touchMoveY: MutableRefObject<number>
  firing: MutableRefObject<boolean>
  wantReload: MutableRefObject<boolean>
}

function useInputRefs(): InputRefs {
  return {
    keys: useRef<Set<string>>(new Set()),
    mouseDX: useRef(0),
    mouseDY: useRef(0),
    touchMoveX: useRef(0),
    touchMoveY: useRef(0),
    firing: useRef(false),
    wantReload: useRef(false),
  }
}

export interface ArenaSceneProps {
  walletAddress: string
  opponentWallet: string
  fighting: boolean
  sendInput: (input: ArenaInput) => void
  drainHits: () => HitEvent[]
  latestPlayers: MutableRefObject<Map<string, PlayerSnapshot>>
  onLocalHp: (hp: number) => void
  onAmmo: (ammo: number, reloading: boolean) => void
  onOpponentHp: (hp: number) => void
}

export function ArenaScene(props: ArenaSceneProps) {
  const input = useInputRefs()
  const [isTouch] = useState(detectTouchDevice)

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0c12', cursor: isTouch ? 'default' : 'none' }}>
      <Canvas
        shadows
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        camera={{ position: [-ARENA_HALF_X * 0.6, EYE_HEIGHT, 0], fov: 60, near: 0.01, far: 200 }}
      >
        <ArenaWorld {...props} input={input} isTouch={isTouch} />
      </Canvas>
      <ArenaHud />
      {isTouch && <TouchControls input={input} />}
    </div>
  )
}

// ── HUD (crosshair only — HP/ammo/timer chrome lives in FaceOffPage) ────────

function ArenaHud() {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', left: '50%', top: '50%', width: 6, height: 6,
        transform: 'translate(-50%,-50%)', borderRadius: '50%',
        background: 'rgba(255,255,255,0.85)', boxShadow: '0 0 3px rgba(0,0,0,0.8)',
      }} />
    </div>
  )
}

// ── Touch controls (mobile) ──────────────────────────────────────────────
//
// Two zones, matching the split ValorScene's own touch layer uses: a
// floating joystick bottom-left for movement, and the whole right half of
// the screen doubles as look-drag + hold-to-fire (one thumb aims and shoots,
// same as ValorScene's fire pad) so a phone player isn't hunting for a
// separate aim surface. A reload button sits above the fire zone.

function TouchControls({ input }: { input: InputRefs }) {
  const joyRef = useRef<HTMLDivElement>(null)
  const joyKnobRef = useRef<HTMLDivElement>(null)
  const joyId = useRef<number | null>(null)
  const joyCenter = useRef({ x: 0, y: 0 })
  const JOY_R = 52

  const updateJoy = (x: number, y: number) => {
    const c = joyCenter.current
    let dx = x - c.x, dy = y - c.y
    const len = Math.hypot(dx, dy) || 1
    if (len > JOY_R) { dx = (dx / len) * JOY_R; dy = (dy / len) * JOY_R }
    input.touchMoveX.current = dx / JOY_R
    input.touchMoveY.current = -dy / JOY_R // screen-down is backward
    if (joyKnobRef.current) joyKnobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
  }

  const joyStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0]
    joyId.current = t.identifier
    const r = joyRef.current!.getBoundingClientRect()
    joyCenter.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    updateJoy(t.clientX, t.clientY)
  }
  const joyMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === joyId.current) updateJoy(t.clientX, t.clientY)
  }
  const joyEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === joyId.current) {
      joyId.current = null
      input.touchMoveX.current = 0
      input.touchMoveY.current = 0
      if (joyKnobRef.current) joyKnobRef.current.style.transform = 'translate(0,0)'
    }
  }

  const lookId = useRef<number | null>(null)
  const lookLast = useRef({ x: 0, y: 0 })
  const lookStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0]
    lookId.current = t.identifier
    lookLast.current = { x: t.clientX, y: t.clientY }
    input.firing.current = true
  }
  const lookMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId.current) {
      input.mouseDX.current += t.clientX - lookLast.current.x
      input.mouseDY.current += t.clientY - lookLast.current.y
      lookLast.current = { x: t.clientX, y: t.clientY }
    }
  }
  const lookEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId.current) {
      lookId.current = null
      input.firing.current = false
    }
  }

  return (
    <div className="fixed inset-0 z-50" style={{ touchAction: 'none' }}>
      {/* Right half — look + fire, one thumb */}
      <div
        onTouchStart={lookStart} onTouchMove={lookMove} onTouchEnd={lookEnd} onTouchCancel={lookEnd}
        style={{ position: 'absolute', right: 0, top: 0, width: '55%', height: '100%' }}
      />
      {/* Movement joystick — bottom left */}
      <div
        ref={joyRef}
        onTouchStart={joyStart} onTouchMove={joyMove} onTouchEnd={joyEnd} onTouchCancel={joyEnd}
        style={{
          position: 'absolute', left: 28, bottom: 90, width: 112, height: 112, borderRadius: '50%',
          background: 'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.06), rgba(8,8,14,0.55))',
          border: '1px solid rgba(255,255,255,0.18)',
        }}
      >
        <div ref={joyKnobRef} style={{
          position: 'absolute', left: '50%', top: '50%', width: 40, height: 40, marginLeft: -20, marginTop: -20,
          borderRadius: '50%', background: 'rgba(255,255,255,0.75)', boxShadow: '0 0 10px rgba(0,0,0,0.4)',
        }} />
      </div>
      {/* Reload — small tap target above the fire zone */}
      <button
        onTouchStart={(e) => { e.preventDefault(); input.wantReload.current = true }}
        style={{
          position: 'absolute', right: 28, bottom: 90, width: 64, height: 64, borderRadius: '50%',
          background: 'rgba(234,179,8,0.18)', border: '1px solid rgba(234,179,8,0.4)',
          color: '#eab308', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        }}
      >
        Reload
      </button>
    </div>
  )
}

// ── World ─────────────────────────────────────────────────────────────────

function ArenaWorld(props: ArenaSceneProps & { input: InputRefs; isTouch: boolean }) {
  const { walletAddress, opponentWallet, fighting, sendInput, drainHits, latestPlayers, onLocalHp, onAmmo, onOpponentHp, input, isTouch } = props
  const { camera, gl } = useThree()
  const { keys, mouseDX, mouseDY, touchMoveX, touchMoveY, firing, wantReload } = input

  const locked = useRef(false)
  // Face the opponent's spawn side on mount: local player spawns at -X facing
  // +X if the wallet sorts first alphabetically among the pair (arbitrary but
  // deterministic — the server itself decides real spawn sides by join order,
  // this is only the starting camera direction, corrected within one
  // reconcile tick regardless).
  const yaw = useRef(walletAddress.toLowerCase() < opponentWallet.toLowerCase() ? Math.PI / 2 : -Math.PI / 2)
  const pitch = useRef(0)

  const localPos = useRef({
    x: walletAddress.toLowerCase() < opponentWallet.toLowerCase() ? -ARENA_HALF_X * 0.6 : ARENA_HALF_X * 0.6,
    z: 0,
  })

  // Desktop input — pointer lock + WASD + mouse. Skipped on touch devices
  // (no pointer lock support on mobile Safari, and it would just fight the
  // TouchControls overlay for the same refs).
  useEffect(() => {
    if (isTouch) return
    const canvas = gl.domElement
    const wantLock = () => {
      if (locked.current || document.pointerLockElement === canvas) return
      try {
        const p: unknown = canvas.requestPointerLock?.()
        if (p && typeof (p as { catch?: unknown }).catch === 'function') (p as Promise<void>).catch(() => {})
      } catch { /* headless / blocked — arrow keys still steer via keys set below */ }
    }
    const down = (e: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      keys.current.add(e.code)
      if (e.code === 'KeyR') wantReload.current = true
      wantLock()
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.code)
    const mdown = (e: MouseEvent) => { if (e.button === 0) firing.current = true; wantLock() }
    const mup = (e: MouseEvent) => { if (e.button === 0) firing.current = false }
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        mouseDX.current += Math.max(-MOUSE_MAX_STEP, Math.min(MOUSE_MAX_STEP, e.movementX))
        mouseDY.current += Math.max(-MOUSE_MAX_STEP, Math.min(MOUSE_MAX_STEP, e.movementY))
      }
    }
    const lockChange = () => { locked.current = document.pointerLockElement === canvas }
    const noMenu = (e: Event) => e.preventDefault()

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousedown', mdown)
    window.addEventListener('mouseup', mup)
    window.addEventListener('mousemove', move)
    document.addEventListener('pointerlockchange', lockChange)
    canvas.addEventListener('contextmenu', noMenu)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousedown', mdown)
      window.removeEventListener('mouseup', mup)
      window.removeEventListener('mousemove', move)
      document.removeEventListener('pointerlockchange', lockChange)
      canvas.removeEventListener('contextmenu', noMenu)
    }
  }, [gl, isTouch, keys, mouseDX, mouseDY, firing, wantReload])

  useEffect(() => {
    const p = camera as THREE.PerspectiveCamera
    p.rotation.order = 'YXZ'
  }, [camera])

  // ── Local weapon viewmodel — cosmetic only, the server doesn't know or
  // care what this looks like. One fixed gun, matching the arena's one fixed
  // server-side loadout.
  const gunMesh = useMemo(() => {
    const g = makeGunMesh('assault_rifle')
    g.scale.setScalar(0.9)
    return g
  }, [])
  const vmRef = useRef<THREE.Group>(null)
  const recoilKick = useRef(0)

  // ── Opponent rig ──
  const opponentApi = useRef<OperatorApi | null>(null)
  const opponentGroup = useRef<THREE.Group>(null)
  const opponentRendered = useRef(new THREE.Vector3(ARENA_HALF_X * 0.6, 0, 0))
  const opponentRenderedYaw = useRef(0)
  const lastOpponentAmmo = useRef<number | null>(null)
  const lastOpponentHp = useRef<number | null>(null)

  useFrame((_state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const lookSens = isTouch ? TOUCH_LOOK_SENS : LOOK_SENS

    // Aim — accumulate mouse/touch-drag delta into yaw/pitch, exactly like
    // ValorScene does for both input sources.
    yaw.current -= mouseDX.current * lookSens
    pitch.current -= mouseDY.current * lookSens
    pitch.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch.current))
    mouseDX.current = 0
    mouseDY.current = 0

    // Movement — camera-relative WASD (or touch stick), clamped to a unit
    // disk before scaling, then rotated by yaw. MUST match arena_server.rs's
    // integrate_movement_and_aim.
    const held = (c: string) => keys.current.has(c)
    let mx = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0) + touchMoveX.current
    let my = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0) + touchMoveY.current
    const rawLen = Math.hypot(mx, my)
    if (rawLen > 1) { mx /= rawLen; my /= rawLen }

    if (fighting) {
      const sy = Math.sin(yaw.current)
      const cy = Math.cos(yaw.current)
      const dirX = sy * my + cy * mx
      const dirZ = cy * my + (-sy) * mx
      localPos.current.x = clamp(localPos.current.x + dirX * WALK_SPEED * dt, -ARENA_HALF_X, ARENA_HALF_X)
      localPos.current.z = clamp(localPos.current.z + dirZ * WALK_SPEED * dt, -ARENA_HALF_Z, ARENA_HALF_Z)

      // Soft-reconcile toward the server's last-known truth for this wallet.
      const mine = latestPlayers.current.get(walletAddress)
      if (mine) {
        localPos.current.x += (mine.x - localPos.current.x) * RECONCILE_STRENGTH * (dt * 20)
        localPos.current.z += (mine.z - localPos.current.z) * RECONCILE_STRENGTH * (dt * 20)
        onLocalHp(mine.hp)
        onAmmo(mine.ammo, mine.reloading)
      }

      const sentReload = wantReload.current
      wantReload.current = false
      sendInput({
        moveX: mx, moveY: my, yaw: yaw.current, pitch: pitch.current,
        firing: firing.current, wantReload: sentReload,
      })
    }

    camera.position.set(localPos.current.x, EYE_HEIGHT, localPos.current.z)
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ')

    // Viewmodel — a static hip-hold offset with a light recoil kick, glued to
    // the camera. No ADS/sway system here; that's cosmetic polish, not
    // correctness, and the server has no ADS state to reflect anyway.
    if (vmRef.current) {
      recoilKick.current = Math.max(0, recoilKick.current - dt * 6)
      const local = new THREE.Vector3(0.16, -0.14 - recoilKick.current * 0.02, -0.32 + recoilKick.current * 0.03)
      const world = camera.localToWorld(local.clone())
      vmRef.current.position.copy(world)
      vmRef.current.quaternion.copy(camera.quaternion)
    }

    // Hits — drive the viewmodel recoil kick on OUR OWN shots and hitmarker
    // feedback; damage-taken feedback lives in FaceOffPage's HUD state.
    for (const hit of drainHits()) {
      if (hit.shooter === walletAddress) recoilKick.current = 1
    }

    // Opponent — smoothly chase the latest snapshot, never predicted.
    const opp = latestPlayers.current.get(opponentWallet)
    if (opp) {
      onOpponentHp(opp.hp)
      const t = Math.min(1, OPPONENT_SMOOTH * (dt * 20))
      opponentRendered.current.x += (opp.x - opponentRendered.current.x) * t
      opponentRendered.current.z += (opp.z - opponentRendered.current.z) * t
      opponentRenderedYaw.current = lerpAngle(opponentRenderedYaw.current, opp.yaw, t)
      if (opponentGroup.current) {
        opponentGroup.current.position.set(opponentRendered.current.x, 0, opponentRendered.current.z)
        opponentGroup.current.rotation.y = opponentRenderedYaw.current
      }

      const api = opponentApi.current
      if (api) {
        if (lastOpponentHp.current !== null && opp.hp < lastOpponentHp.current) {
          if (opp.hp <= 0) api.setClip('death')
          else api.playOnce('hit')
        } else if (opp.hp > 0) {
          if (lastOpponentAmmo.current !== null && opp.ammo < lastOpponentAmmo.current) {
            api.playOnce('fire', 1.4)
          } else {
            const moved = Math.hypot(opp.x - opponentRendered.current.x, opp.z - opponentRendered.current.z) > 0.01
            api.setClip(moved ? 'walk' : 'idle')
          }
        }
      }
      lastOpponentAmmo.current = opp.ammo
      lastOpponentHp.current = opp.hp
    }
  })

  return (
    <>
      {/* Bright enough to actually see by — a small enclosed arena has no sun
          or sky doing lighting's job for free the way an outdoor op does. */}
      <hemisphereLight args={['#6b7a94', '#1a1c22', 1.1]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[8, 14, 6]} intensity={1.6} castShadow />
      <directionalLight position={[-8, 10, -6]} intensity={0.5} />
      <fog attach="fog" args={['#0a0c12', 34, 70]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ARENA_HALF_X * 2, ARENA_HALF_Z * 2]} />
        <meshStandardMaterial color="#3a3f4a" roughness={0.92} />
      </mesh>
      {/* Grid lines — the arena has no texture/prop variety yet (v1), and a
          featureless flat plane gives the eye nothing to read movement
          against. A grid is the cheapest possible fix (no asset, one draw
          call) and is worth keeping even once real dressing lands. */}
      <gridHelper args={[ARENA_HALF_X * 2, 24, '#5a6577', '#4a5262']} position={[0, 0.01, 0]} />

      {/* Boundary walls — the arena has no interior cover in v1, just a
          visible edge so the invisible position clamp isn't a mystery. */}
      {[
        [0, ARENA_HALF_Z] as const, [0, -ARENA_HALF_Z] as const,
        [ARENA_HALF_X, 0] as const, [-ARENA_HALF_X, 0] as const,
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.75, z]} rotation={[0, x !== 0 ? Math.PI / 2 : 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[ARENA_HALF_X * 2, 1.5, 0.2]} />
          <meshStandardMaterial color="#565f70" roughness={0.75} />
        </mesh>
      ))}

      <group ref={opponentGroup}>
        <OperatorRig ref={(a) => { opponentApi.current = a }} modelPath={OPERATOR_GLB} />
      </group>

      <primitive ref={vmRef} object={gunMesh} />
    </>
  )
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function lerpAngle(from: number, to: number, t: number): number {
  let diff = (to - from) % (Math.PI * 2)
  if (diff > Math.PI) diff -= Math.PI * 2
  if (diff < -Math.PI) diff += Math.PI * 2
  return from + diff * t
}
