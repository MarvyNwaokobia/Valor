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
 * The ROOM ITSELF, though, is the real thing: one frozen room straight out of
 * the Operation room generator (`generateRoom` in `engine/fps/endless.ts`,
 * seed "valor-faceoff", CRATE_LINE archetype), rendered with the same
 * triplanar materials/zone lighting/IBL ValorScene uses, not a placeholder
 * box. `ROOM_WALLS`/`ROOM_COVER` below MUST match `arena_server.rs`'s copy of
 * the same boxes exactly — same mirroring discipline as WALK_SPEED/
 * ARENA_HALF_X/PITCH_LIMIT already need between these two files.
 *
 * Local player: rendered from LOCAL prediction (instant camera response),
 * collide-and-slide against the room's real geometry (`slideMove`, the same
 * function FpsSim.ts uses for Operations) so it doesn't walk through walls
 * even before the server's next snapshot arrives, then softly reconciled
 * toward the server's returned x/z on every state_update rather than
 * hard-snapped.
 *
 * Opponent: rendered ENTIRELY from server snapshots (never predicted — it's
 * not this client's job to guess where the other player is), smoothed with a
 * simple exponential lerp between ticks rather than buffered interpolation.
 *
 * Movement speed is NOT reduced while crouching/ADS, unlike ValorScene's real
 * Operations — the server (arena_server.rs) doesn't model that in v1 either,
 * and slowing down here while the authoritative server doesn't would just
 * fight the soft-reconcile every tick. Crouch/ADS still narrow the server's
 * hit spread and change hitbox height; here they're eye-height + cosmetic
 * viewmodel/FOV feedback so it reads the same either way.
 */

import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OperatorRig, type OperatorApi } from './OperatorRig'
import { makeGunMesh } from './GunMesh'
import { usePbr } from './usePbr'
import { makeTriplanarMaterial } from './triplanar'
import { buildZoneEnvironment, ENV_INTENSITY } from './zoneEnvironment'
import { ZONE_THEMES } from '@/engine/fps/campaign'
import { slideMove, type CoverBox } from '@/engine/fps/FpsSim'
import type { GunId } from '@/engine/combat'
import type { ArenaInput, HitEvent, PlayerSnapshot } from '@/hooks/useArenaSocket'

const OPERATOR_GLB = '/characters/glb/operator.glb'

/** Ashfall — daytime, warm, the flagship zone. Picked as Face-Off's one fixed
 *  look for v1; a small rotation of zones/rooms is a natural, easy follow-up
 *  once this is proven, not something to build ahead of need. */
const THEME = ZONE_THEMES.ASHFALL

// ── Room geometry — frozen output of generateRoom(0, 0, seedFromString(
// "valor-faceoff")) in engine/fps/endless.ts, recentred so the room's
// midpoint sits at world origin. MUST match arena_server.rs's ROOM_WALLS/
// ROOM_COVER exactly. ──────────────────────────────────────────────────────

const ROOM_WALLS: CoverBox[] = [
  { x: -9.3, z: 0, w: 0.6, d: 17, h: 4 },   // west wall
  { x: 9.3, z: 0, w: 0.6, d: 17, h: 4 },    // east wall
  { x: 0, z: 8.8, w: 19.2, d: 0.6, h: 4 },  // north cap (sealed — no chain doorway)
  { x: 0, z: -8.8, w: 19.2, d: 0.6, h: 4 }, // south cap (sealed)
]

const ROOM_COVER: CoverBox[] = [
  { x: -6, z: 0, w: 2.4, d: 1.6, h: 1.15 },
  { x: -1.5, z: 1.2, w: 2.4, d: 1.6, h: 1.15 },
  { x: 3, z: 0, w: 2.4, d: 1.6, h: 1.15 },
  { x: 6.8, z: -1.4, w: 1.8, d: 1.6, h: 1.15 },
]

const ROOM_OBSTACLES: CoverBox[] = [...ROOM_WALLS, ...ROOM_COVER]

// Interior floor footprint: 18m wide (ROOM_W) x 17m deep.
const FLOOR_W = 18
const FLOOR_D = 17

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)

// Must match arena_server.rs's tuning block exactly.
const WALK_SPEED = 3.4
const EYE_HEIGHT = 1.6
const EYE_HEIGHT_CROUCH = 1.02
const ARENA_HALF_X = 8.6
const ARENA_HALF_Z = 8.1
/** Collision radius against ROOM_OBSTACLES — matches PLAYER_RADIUS server-side. */
const PLAYER_RADIUS = 0.35
const PITCH_LIMIT = 1.45
const LOOK_SENS = 0.0010
const TOUCH_LOOK_SENS = 0.0022
const MOUSE_MAX_STEP = 120
/** Matches ValorScene's ADS_SENS — look slows while aiming down sights. */
const ADS_LOOK_SENS_MULT = 0.55
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
  rightMouseDown: MutableRefObject<boolean>
  wantReload: MutableRefObject<boolean>
  /** Touch-only toggles — desktop reads crouch/ADS off `keys`/mouse buttons
   *  directly instead (see ArenaWorld's useFrame), same split ValorScene's
   *  own touch crouch toggle uses ("a hold-to-crouch button is a button you
   *  cannot use while playing"). */
  touchCrouch: MutableRefObject<boolean>
  touchAds: MutableRefObject<boolean>
}

function useInputRefs(): InputRefs {
  return {
    keys: useRef<Set<string>>(new Set()),
    mouseDX: useRef(0),
    mouseDY: useRef(0),
    touchMoveX: useRef(0),
    touchMoveY: useRef(0),
    firing: useRef(false),
    rightMouseDown: useRef(false),
    wantReload: useRef(false),
    touchCrouch: useRef(false),
    touchAds: useRef(false),
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
  /** Cosmetic only — the server's combat stats never vary by loadout (see
   *  arena_server.rs's module doc). Defaults to the standard-issue rifle. */
  equippedGun?: GunId
}

export function ArenaScene(props: ArenaSceneProps) {
  const input = useInputRefs()
  const [isTouch] = useState(detectTouchDevice)

  return (
    <div style={{ position: 'fixed', inset: 0, background: THEME.fog[0], cursor: isTouch ? 'default' : 'none' }}>
      <Canvas
        shadows
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        camera={{ position: [0, EYE_HEIGHT, ARENA_HALF_Z * 0.85], fov: 60, near: 0.01, far: 200 }}
      >
        <Suspense fallback={null}>
          <ArenaWorld {...props} input={input} isTouch={isTouch} />
        </Suspense>
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
// Movement joystick bottom-left, look-drag + hold-to-fire on the right half
// (matching ValorScene's own touch split), plus three small toggle/tap
// buttons above the fire zone: reload, crouch, and ADS. Crouch and ADS are
// TOGGLES rather than holds — the stick and the fire pad already own both
// thumbs, same reasoning ValorScene's own mobile crouch button uses.

function TouchControls({ input }: { input: InputRefs }) {
  const joyRef = useRef<HTMLDivElement>(null)
  const joyKnobRef = useRef<HTMLDivElement>(null)
  const joyId = useRef<number | null>(null)
  const joyCenter = useRef({ x: 0, y: 0 })
  const JOY_R = 52

  const [crouchOn, setCrouchOn] = useState(false)
  const [adsOn, setAdsOn] = useState(false)

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
      {/* Crouch / ADS toggles — lit while active, same idiom as ValorScene's
          mobile crouch/ADS buttons. */}
      <button
        onTouchStart={(e) => {
          e.preventDefault()
          const next = !input.touchCrouch.current
          input.touchCrouch.current = next
          setCrouchOn(next)
        }}
        style={{
          position: 'absolute', right: 106, bottom: 168, width: 56, height: 56, borderRadius: '50%',
          background: crouchOn ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.08)',
          border: `1px solid ${crouchOn ? 'rgba(34,197,94,0.7)' : 'rgba(255,255,255,0.2)'}`,
          color: crouchOn ? '#4ade80' : '#cbd5e1', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        }}
      >
        Crouch
      </button>
      <button
        onTouchStart={(e) => {
          e.preventDefault()
          const next = !input.touchAds.current
          input.touchAds.current = next
          setAdsOn(next)
        }}
        style={{
          position: 'absolute', right: 28, bottom: 168, width: 56, height: 56, borderRadius: '50%',
          background: adsOn ? 'rgba(56,189,248,0.35)' : 'rgba(255,255,255,0.08)',
          border: `1px solid ${adsOn ? 'rgba(56,189,248,0.7)' : 'rgba(255,255,255,0.2)'}`,
          color: adsOn ? '#7dd3fc' : '#cbd5e1', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        }}
      >
        ADS
      </button>
    </div>
  )
}

// ── World ─────────────────────────────────────────────────────────────────

function ArenaWorld(props: ArenaSceneProps & { input: InputRefs; isTouch: boolean }) {
  const {
    walletAddress, opponentWallet, fighting, sendInput, drainHits, latestPlayers,
    onLocalHp, onAmmo, onOpponentHp, input, isTouch, equippedGun,
  } = props
  const { camera, gl, scene } = useThree()
  const { keys, mouseDX, mouseDY, touchMoveX, touchMoveY, firing, rightMouseDown, wantReload, touchCrouch, touchAds } = input

  const locked = useRef(false)
  // Face the opponent's spawn side on mount: local player spawns at the near
  // cap (z > 0) facing -Z if the wallet sorts first alphabetically among the
  // pair (arbitrary but deterministic — the server itself decides real spawn
  // sides by JOIN ORDER, not wallet sort, so this is only the starting camera
  // guess, corrected within one reconcile tick regardless).
  const nearSide = walletAddress.toLowerCase() < opponentWallet.toLowerCase()
  const yaw = useRef(nearSide ? 0 : Math.PI)
  const pitch = useRef(0)

  const localPos = useRef({ x: 0, z: nearSide ? 7.3 : -7.3 })
  const crouchCur = useRef(0)
  const adsCur = useRef(0)

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
    const mdown = (e: MouseEvent) => {
      if (e.button === 0) firing.current = true
      if (e.button === 2) rightMouseDown.current = true
      wantLock()
    }
    const mup = (e: MouseEvent) => {
      if (e.button === 0) firing.current = false
      if (e.button === 2) rightMouseDown.current = false
    }
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
  }, [gl, isTouch, keys, mouseDX, mouseDY, firing, rightMouseDown, wantReload])

  useEffect(() => {
    const p = camera as THREE.PerspectiveCamera
    p.rotation.order = 'YXZ'
  }, [camera])

  // ── Room materials — same triplanar system + zone theme ValorScene's real
  // Operations use, not a flat-color placeholder. usePbr suspends while
  // loading (this component sits under the Canvas's own implicit Suspense
  // via ArenaScene's dynamic import boundary — see below for the explicit
  // Suspense wrapper).
  const floorMaps = usePbr('burned_ground_01', [6, 6])
  const brickMaps = usePbr('broken_brick_wall', [7, 1.6])
  const plasterMaps = usePbr('damaged_plaster', [4, 1.4])

  const shellMaterials = useMemo(() => ({
    floor: makeTriplanarMaterial(floorMaps, { color: THEME.floorTint, roughness: 1, metalness: 0 }, { metresPerTile: 1.9, detail: 9.7, detailAmount: 0.6, macro: 0.11, macroAmount: 0.4 }),
    brick: makeTriplanarMaterial(brickMaps, { color: THEME.wallTint, roughness: 1, metalness: 0 }, { metresPerTile: 1.7, detail: 9.3, detailAmount: 0.62, macro: 0.13, macroAmount: 0.3 }),
    // Plaster tinted brown, NOT the actual plank texture — matches ValorScene's
    // cover material exactly (see its comment: the plank set's near-black
    // albedo renders as a flat black slab under a color tint, plaster doesn't).
    plank: makeTriplanarMaterial(plasterMaps, { color: '#8a6f4e', roughness: 0.95, metalness: 0.05 }, { metresPerTile: 0.6, blend: true, detail: 8.3, detailAmount: 0.85, detailFade: [9, 20], macro: 0.16, macroAmount: 0.26 }),
  }), [floorMaps, brickMaps, plasterMaps])

  useEffect(() => () => {
    for (const m of Object.values(shellMaterials)) m.dispose()
  }, [shellMaterials])

  // ── Image-based lighting — generated from this zone's own sky, same reason
  // ValorScene does this: without it every envMapIntensity on the viewmodel
  // multiplies a black environment and reads as grey plastic instead of steel.
  useEffect(() => {
    const target = buildZoneEnvironment(gl, {
      skyTop: THEME.sky.top, skyBottom: THEME.sky.bottom,
      sunColor: THEME.sun.color, sunIntensity: THEME.sun.intensity,
      groundColor: THEME.hemi[1], floorTint: THEME.floorTint,
    })
    scene.environment = target.texture
    scene.environmentIntensity = ENV_INTENSITY
    return () => {
      scene.environment = null
      target.dispose()
    }
  }, [gl, scene])

  // ── Local weapon viewmodel — cosmetic only, the server doesn't know or
  // care what this looks like or what it's called. Reskinned to the
  // player's actual equipped gun if given; combat stats never vary (see
  // arena_server.rs's module doc — real money is staked on this fight).
  const gunMesh = useMemo(() => {
    const g = makeGunMesh(equippedGun ?? 'assault_rifle')
    g.scale.setScalar(0.9)
    return g
  }, [equippedGun])
  const vmRef = useRef<THREE.Group>(null)
  const recoilKick = useRef(0)

  // ── Opponent rig ──
  const opponentApi = useRef<OperatorApi | null>(null)
  const opponentGroup = useRef<THREE.Group>(null)
  const opponentRendered = useRef(new THREE.Vector3(0, 0, nearSide ? -7.3 : 7.3))
  const opponentRenderedYaw = useRef(0)
  const lastOpponentAmmo = useRef<number | null>(null)
  const lastOpponentHp = useRef<number | null>(null)

  useFrame((_state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)

    const crouchWant = isTouch ? touchCrouch.current : keys.current.has('KeyC')
    const adsWant = isTouch ? touchAds.current : (rightMouseDown.current || keys.current.has('ShiftLeft') || keys.current.has('ShiftRight'))
    crouchCur.current += ((crouchWant ? 1 : 0) - crouchCur.current) * Math.min(1, dt * 10)
    adsCur.current += ((adsWant ? 1 : 0) - adsCur.current) * Math.min(1, dt * 10)

    const lookSens = (isTouch ? TOUCH_LOOK_SENS : LOOK_SENS) * THREE.MathUtils.lerp(1, ADS_LOOK_SENS_MULT, adsCur.current)

    // Aim — accumulate mouse/touch-drag delta into yaw/pitch, exactly like
    // ValorScene does for both input sources.
    yaw.current -= mouseDX.current * lookSens
    pitch.current -= mouseDY.current * lookSens
    pitch.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch.current))
    mouseDX.current = 0
    mouseDY.current = 0

    // Movement — camera-relative WASD (or touch stick), clamped to a unit
    // disk before scaling, then rotated by yaw. Speed MUST match
    // arena_server.rs's WALK_SPEED (no crouch/ADS slowdown — see module doc).
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
      const targetX = localPos.current.x + dirX * WALK_SPEED * dt
      const targetZ = localPos.current.z + dirZ * WALK_SPEED * dt
      const [nx, nz] = slideMove(localPos.current.x, localPos.current.z, targetX, targetZ, PLAYER_RADIUS, ROOM_OBSTACLES)
      localPos.current.x = clamp(nx, -ARENA_HALF_X, ARENA_HALF_X)
      localPos.current.z = clamp(nz, -ARENA_HALF_Z, ARENA_HALF_Z)

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
        crouching: crouchWant, ads: adsWant,
      })
    }

    const eyeY = THREE.MathUtils.lerp(EYE_HEIGHT, EYE_HEIGHT_CROUCH, crouchCur.current)
    camera.position.set(localPos.current.x, eyeY, localPos.current.z)
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ')

    // Cosmetic ADS zoom — the server has no FOV state to reflect, this is
    // purely a feel cue matching ValorScene's own aim-down-sights zoom.
    const p = camera as THREE.PerspectiveCamera
    const targetFov = THREE.MathUtils.lerp(60, 48, adsCur.current)
    if (Math.abs(p.fov - targetFov) > 0.01) {
      p.fov = targetFov
      p.updateProjectionMatrix()
    }

    // Viewmodel — a static hip-hold offset with a light recoil kick, glued to
    // the camera, lerping toward a centred ADS offset. No sway system here;
    // that's cosmetic polish, not correctness, and the server has no ADS
    // pose to reflect anyway.
    if (vmRef.current) {
      recoilKick.current = Math.max(0, recoilKick.current - dt * 6)
      const hip = new THREE.Vector3(0.16, -0.14 - recoilKick.current * 0.02, -0.32 + recoilKick.current * 0.03)
      const ads = new THREE.Vector3(0.0, -0.16 - recoilKick.current * 0.01, -0.22)
      const local = hip.lerp(ads, adsCur.current)
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
      <fog attach="fog" args={[THEME.fog[0], THEME.fog[1], THEME.fog[2]]} />
      <hemisphereLight args={[THEME.hemi[0], THEME.hemi[1], THEME.hemi[2]]} />
      <ambientLight intensity={THEME.ambient} />
      <directionalLight position={[9, 16, 10]} color={THEME.sun.color} intensity={THEME.sun.intensity} castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024}
        shadow-camera-near={0.5} shadow-camera-far={40}
        shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12}
        shadow-bias={-0.001}
      />
      <directionalLight position={[-8, 10, -6]} color={THEME.fill.color} intensity={THEME.fill.intensity} />
      {/* A couple of warm practicals so the room doesn't read as flat-lit —
          same zone practical color/intensity Operations use. */}
      <pointLight position={[0, 2.6, 4]} color={THEME.practical} intensity={THEME.practicalIntensity} distance={10} decay={2} />
      <pointLight position={[0, 2.6, -4]} color={THEME.practical} intensity={THEME.practicalIntensity} distance={10} decay={2} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_W, FLOOR_D]} />
        <primitive object={shellMaterials.floor} attach="material" />
      </mesh>

      {ROOM_WALLS.map((w) => (
        <mesh key={`w${w.x}_${w.z}`} geometry={UNIT_BOX} position={[w.x, w.h / 2, w.z]} scale={[w.w, w.h, w.d]} castShadow receiveShadow>
          <primitive object={shellMaterials.brick} attach="material" />
        </mesh>
      ))}

      {ROOM_COVER.map((c) => (
        <mesh key={`c${c.x}_${c.z}`} geometry={UNIT_BOX} position={[c.x, c.h / 2, c.z]} scale={[c.w, c.h, c.d]} castShadow receiveShadow>
          <primitive object={shellMaterials.plank} attach="material" />
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
