'use client'

/**
 * Face-Off — the real-time arena scene.
 *
 * Deliberately NOT ValorScene's SIMULATION — ValorScene's `FpsSim` is a
 * local, trusted combat sim against AI enemies; here the server
 * (arena_server.rs) is the sole authority over position, aim, ammo, and
 * hits, and this component's job is to capture input, send it, and render
 * whatever the server says is true. It never constructs or steps a local
 * combat sim.
 *
 * Everything else — room, weapon, controls, sound — is the SAME machinery
 * real Operations use, reused rather than reinvented:
 *   - Room: one frozen room straight out of the Operation room generator
 *     (`generateRoom` in `engine/fps/endless.ts`, seed "valor-faceoff",
 *     CRATE_LINE archetype), rendered with the same triplanar materials/zone
 *     lighting/IBL ValorScene uses. Geometry comes from `faceoffArena.json`
 *     in this same folder — `arena_server.rs` embeds that exact file at
 *     compile time too, so there is one source of truth, not two hand-copied
 *     arrays that could silently drift apart.
 *   - Weapon viewmodel: same `makeGunMesh` + `buildViewmodelHands` +
 *     `WEAPON_VIEW`/`VIEWMODEL_HIP`/`VIEWMODEL_ADS` framing ValorScene uses —
 *     cosmetic only, the server's combat stats never vary by loadout.
 *   - Touch controls: the same look-zone/joystick/fire-pad/ADS-toggle/
 *     crouch-toggle layout and interaction model as ValorScene's mobile HUD
 *     (see `touchBtn`/`pressFx` below, copied rather than imported — they're
 *     unexported locals in a 4500-line file).
 *   - Sound: the real `FpsAudio` director — shots, impacts, hitmarkers,
 *     reload, footsteps, and a spatialised cue for the opponent's shots.
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
 * Movement speed is NOT reduced while crouching/ADS, unlike real Operations —
 * the server (arena_server.rs) doesn't model that in v1 either, and slowing
 * down here while the authoritative server doesn't would just fight the
 * soft-reconcile every tick.
 */

import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OperatorRig, type OperatorApi } from './OperatorRig'
import { makeGunMesh } from './GunMesh'
import { buildViewmodelHands, VIEWMODEL_HIP, VIEWMODEL_ADS, WEAPON_VIEW } from './viewmodelHands'
import { GUN_LENGTH } from './gunModels'
import { usePbr } from './usePbr'
import { makeTriplanarMaterial } from './triplanar'
import { buildZoneEnvironment, ENV_INTENSITY } from './zoneEnvironment'
import { ZONE_THEMES } from '@/engine/fps/campaign'
import { slideMove, rayAABB, aabbOfCover, type CoverBox } from '@/engine/fps/FpsSim'
import arenaGeometry from './faceoffArena.json'
import { GUN_FEEL } from '@/engine/combat/GunFeel'
import { FpsAudio } from '@/engine/audio/FpsAudio'
import type { GunId } from '@/engine/combat'
import type { ArenaInput, HitEvent, PlayerSnapshot } from '@/hooks/useArenaSocket'

const OPERATOR_GLB = '/characters/glb/operator.glb'

/** Ashfall — daytime, warm, the flagship zone. Picked as Face-Off's one fixed
 *  look for v1; a small rotation of zones/rooms is a natural, easy follow-up
 *  once this is proven, not something to build ahead of need. */
const THEME = ZONE_THEMES.ASHFALL
const ZONE_ID = 'ASHFALL'

// ── Room geometry — frozen output of generateRoom(0, 0, seedFromString(
// "valor-faceoff")) in engine/fps/endless.ts, recentred so the room's
// midpoint sits at world origin. Loaded from faceoffArena.json, the single
// source of truth arena_server.rs also embeds — see this file's module doc.
// ─────────────────────────────────────────────────────────────────────────

const ROOM_WALLS: CoverBox[] = arenaGeometry.walls
const ROOM_COVER: CoverBox[] = arenaGeometry.cover
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
/** Metres between footfalls — matches ValorScene's STRIDE. */
const STRIDE = 0.95

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

/** A glassy, tactile circular touch button — copied from ValorScene's
 *  (unexported) `touchBtn`, the shared look for the real mobile HUD. */
function touchBtn(color: string, size: number, strong = false): React.CSSProperties {
  return {
    position: 'absolute', width: size, height: size, borderRadius: '50%',
    border: `1.5px solid ${color}${strong ? 'cc' : '55'}`,
    background: `radial-gradient(circle at 50% 34%, ${color}${strong ? '40' : '22'}, ${color}0f 66%, rgba(6,10,16,.74))`,
    boxShadow: `inset 0 1px 0 rgba(255,255,255,.22), inset 0 -8px 16px ${color}14, 0 6px 16px rgba(0,0,0,.5)`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color, fontWeight: 700, letterSpacing: 1, touchAction: 'none', userSelect: 'none', WebkitTapHighlightColor: 'transparent',
    transition: 'transform .11s cubic-bezier(.34,1.56,.64,1), box-shadow .11s, filter .11s', willChange: 'transform',
  }
}

/** Momentary press feedback for a touch button — copied from ValorScene's
 *  `pressFx`. */
function pressFx(el: HTMLElement | null, down: boolean, color: string) {
  if (!el) return
  el.style.transform = down ? 'scale(0.86)' : 'scale(1)'
  el.style.filter = down ? 'brightness(1.5)' : 'brightness(1)'
  el.style.boxShadow = down
    ? `inset 0 1px 0 rgba(255,255,255,.3), 0 0 0 3px ${color}44, 0 8px 20px rgba(0,0,0,.5)`
    : `inset 0 1px 0 rgba(255,255,255,.22), inset 0 -8px 16px ${color}14, 0 6px 16px rgba(0,0,0,.5)`
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
  /** Desktop mouse-button-driven fire state; touch's dedicated fire button
   *  writes `touchFiring` instead — see ArenaWorld's useFrame for how the
   *  two combine (mirrors ValorScene's `held('Space') || mouseBtn.has(0)`). */
  firing: MutableRefObject<boolean>
  touchFiring: MutableRefObject<boolean>
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
    touchFiring: useRef(false),
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
  /** OUR OWN shot landing on the opponent — drives FaceOffPage's on-screen
   *  hitmarker/headshot chrome. Not called for shots we took. */
  onHit?: (hit: HitEvent) => void
  /** Cosmetic only — the server's combat stats never vary by loadout (see
   *  arena_server.rs's module doc). Defaults to the standard-issue rifle. */
  equippedGun?: GunId
}

export function ArenaScene(props: ArenaSceneProps) {
  const input = useInputRefs()
  const [isTouch] = useState(detectTouchDevice)
  // Owned here, not inside ArenaWorld (which only mounts under the Canvas) —
  // TouchControls needs the SAME instance to call `unlock()` from a touch
  // gesture. WebAudio requires unlock from a real user gesture per platform,
  // and on a touch device that gesture is a tap on the joystick/fire/look
  // layer, never a desktop mousedown/keydown — an audio director that only
  // desktop ever unlocks is an audio director that never makes a sound on
  // the phone it was actually tested on.
  const audio = useMemo(() => new FpsAudio(), [])
  useEffect(() => () => audio.dispose(), [audio])
  useEffect(() => { audio.setZone(ZONE_ID) }, [audio])

  return (
    <div style={{ position: 'fixed', inset: 0, background: THEME.fog[0], cursor: isTouch ? 'default' : 'none' }}>
      <Canvas
        shadows
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        camera={{ position: [0, EYE_HEIGHT, ARENA_HALF_Z * 0.85], fov: 60, near: 0.01, far: 200 }}
      >
        <Suspense fallback={null}>
          <ArenaWorld {...props} input={input} isTouch={isTouch} audio={audio} />
        </Suspense>
      </Canvas>
      <ArenaHud />
      {isTouch && <TouchControls input={input} audio={audio} />}
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
// The SAME layout and interaction model as ValorScene's real mobile HUD:
// a full-screen look-drag zone underneath everything, a movement joystick
// bottom-left, a dedicated visible FIRE button bottom-right (press to shoot,
// slide to steer — one thumb aims and shoots together), and ADS/CROUCH as
// lit toggle buttons beside it. Face-Off has no weapon-swap or target-lock
// (one fixed weapon, no AI to lock onto), so those two real-HUD buttons are
// the only ones NOT reproduced here.

function TouchControls({ input, audio }: { input: InputRefs; audio: FpsAudio }) {
  const joyRef = useRef<HTMLDivElement>(null)
  const joyKnobRef = useRef<HTMLDivElement>(null)
  const joyId = useRef<number | null>(null)
  const joyCenter = useRef({ x: 0, y: 0 })
  const JOY_R = 58

  const adsBtnRef = useRef<HTMLDivElement>(null)
  const crouchBtnRef = useRef<HTMLDivElement>(null)

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
    audio.unlock()
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

  // Look — drag ANYWHERE to aim, matching ValorScene's full-screen look zone.
  // Rendered first (see JSX below) so the joystick/buttons, added after it in
  // DOM order, sit on top and capture their own touches instead.
  const lookId = useRef<number | null>(null)
  const lookLast = useRef({ x: 0, y: 0 })
  const lookStart = (e: React.TouchEvent) => {
    audio.unlock()
    const t = e.changedTouches[0]
    lookId.current = t.identifier
    lookLast.current = { x: t.clientX, y: t.clientY }
  }
  const lookMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId.current) {
      input.mouseDX.current += t.clientX - lookLast.current.x
      input.mouseDY.current += t.clientY - lookLast.current.y
      lookLast.current = { x: t.clientX, y: t.clientY }
    }
  }
  const lookEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId.current) lookId.current = null
  }

  // Fire — a dedicated visible button (not folded into the look zone): press
  // to shoot, slide to also steer the aim, exactly like ValorScene's real
  // fire pad.
  const fireId = useRef<number | null>(null)
  const fireLast = useRef({ x: 0, y: 0 })
  const fireStart = (e: React.TouchEvent) => {
    audio.unlock()
    const t = e.changedTouches[0]
    fireId.current = t.identifier
    fireLast.current = { x: t.clientX, y: t.clientY }
    input.touchFiring.current = true
    pressFx(e.currentTarget as HTMLElement, true, '#ff6a4d')
  }
  const fireMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === fireId.current) {
      input.mouseDX.current += t.clientX - fireLast.current.x
      input.mouseDY.current += t.clientY - fireLast.current.y
      fireLast.current = { x: t.clientX, y: t.clientY }
    }
  }
  const fireEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === fireId.current) {
      fireId.current = null
      input.touchFiring.current = false
      pressFx(e.currentTarget as HTMLElement, false, '#ff6a4d')
    }
  }

  const paintToggle = (el: HTMLElement | null, on: boolean, color: string) => {
    if (!el) return
    el.style.background = on ? `radial-gradient(circle at 50% 40%, ${color}66, ${color}38)` : ''
    el.style.borderColor = on ? `${color}f2` : ''
    el.style.color = on ? '#04141a' : ''
    el.style.fontWeight = on ? '800' : ''
  }

  const tap = (color: string, run: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); pressFx(e.currentTarget as HTMLElement, true, color); run() },
    onPointerUp: (e: React.PointerEvent) => pressFx(e.currentTarget as HTMLElement, false, color),
    onPointerLeave: (e: React.PointerEvent) => pressFx(e.currentTarget as HTMLElement, false, color),
    onPointerCancel: (e: React.PointerEvent) => pressFx(e.currentTarget as HTMLElement, false, color),
  })

  return (
    <div className="fixed inset-0 z-50" style={{ touchAction: 'none' }}>
      {/* Look — full-screen drag, underneath everything else. */}
      <div
        onTouchStart={lookStart} onTouchMove={lookMove} onTouchEnd={lookEnd} onTouchCancel={lookEnd}
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      />

      {/* Movement joystick — bottom left, same position/size as the real HUD. */}
      <div
        ref={joyRef}
        onTouchStart={joyStart} onTouchMove={joyMove} onTouchEnd={joyEnd} onTouchCancel={joyEnd}
        style={{ ...touchBtn('#eab308', 116), left: 24, bottom: 24, background: 'radial-gradient(circle at 50% 45%, rgba(234,179,8,.07), rgba(6,10,16,.45))', border: '1px solid rgba(234,179,8,.28)' }}
      >
        <div ref={joyKnobRef} style={{
          position: 'absolute', left: '50%', top: '50%', width: 44, height: 44, marginLeft: -22, marginTop: -22,
          borderRadius: '50%', background: 'radial-gradient(circle at 40% 35%, rgba(234,179,8,.9), rgba(180,120,8,.7))',
          border: '1px solid rgba(255,255,255,.35)', boxShadow: '0 0 12px rgba(234,179,8,.45), 0 3px 8px rgba(0,0,0,.5)',
        }} />
      </div>

      {/* Fire — the button that was missing: visible, red, a crosshair icon,
          bottom-right, same spot the real fire pad sits. */}
      <div
        onTouchStart={fireStart} onTouchMove={fireMove} onTouchEnd={fireEnd} onTouchCancel={fireEnd}
        style={{ ...touchBtn('#ff6a4d', 78, true), right: 20, bottom: 24 }}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="7" />
          <path d="M12 1v4M12 19v4M1 12h4M19 12h4" strokeLinecap="round" />
        </svg>
      </div>

      {/* ADS — toggle, lit while active, left of fire. */}
      <div
        ref={adsBtnRef}
        {...tap('#cfe0ea', () => {
          const next = !input.touchAds.current
          input.touchAds.current = next
          paintToggle(adsBtnRef.current, next, '#cfe0ea')
        })}
        style={{ ...touchBtn('#cfe0ea', 52), right: 108, bottom: 30, fontSize: 11 }}
      >
        ADS
      </div>

      {/* CROUCH — toggle, lit while active, left of ADS. */}
      <div
        ref={crouchBtnRef}
        {...tap('#8fb8d0', () => {
          const next = !input.touchCrouch.current
          input.touchCrouch.current = next
          paintToggle(crouchBtnRef.current, next, '#8fb8d0')
        })}
        style={{ ...touchBtn('#8fb8d0', 52), right: 170, bottom: 30, fontSize: 9, letterSpacing: 0 }}
      >
        CROUCH
      </div>

      {/* Reload — icon button, secondary column above the gun. */}
      <div
        {...tap('#ffb454', () => { input.wantReload.current = true })}
        style={{ ...touchBtn('#ffb454', 44), right: 22, bottom: 116 }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 11-3-6.7" strokeLinecap="round" />
          <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  )
}

// ── World ─────────────────────────────────────────────────────────────────

function ArenaWorld(props: ArenaSceneProps & { input: InputRefs; isTouch: boolean; audio: FpsAudio }) {
  const {
    walletAddress, opponentWallet, fighting, sendInput, drainHits, latestPlayers,
    onLocalHp, onAmmo, onOpponentHp, onHit, input, isTouch, equippedGun, audio,
  } = props
  const { camera, gl, scene } = useThree()
  const { keys, mouseDX, mouseDY, touchMoveX, touchMoveY, firing, touchFiring, rightMouseDown, wantReload, touchCrouch, touchAds } = input
  const gunId = equippedGun ?? 'assault_rifle'

  const locked = useRef(false)
  // Placeholder pose for the brief window before the first real
  // state_update arrives (the server doesn't tick — and so never reports a
  // position — until FightStart, a few seconds after this component mounts).
  // Wallet-sort is NOT a reliable guess at which side we're actually on: the
  // server assigns spawn sides by JOIN ORDER, which has no relationship to
  // wallet string comparison, so this is right only by chance. It used to be
  // treated as "corrected within one reconcile tick regardless" — false in
  // practice, since the reconcile below only ever pulled POSITION toward the
  // server, never yaw, so a wrong guess left the camera staring at a wall for
  // the entire match while position silently slid out from under it. See
  // `hasSnapped` below for the actual fix.
  const nearSide = walletAddress.toLowerCase() < opponentWallet.toLowerCase()
  const yaw = useRef(nearSide ? 0 : Math.PI)
  const pitch = useRef(0)

  const localPos = useRef({ x: 0, z: nearSide ? 7.3 : -7.3 })
  // Flips true the first time a real server snapshot for US arrives, at
  // which point position/yaw/pitch are HARD-set to it (not the soft pull
  // below) — that's the one moment the guess above gets corrected, facing
  // included. After that, the player's own look input owns yaw/pitch and
  // only position keeps softly reconciling (ordinary latency jitter, not a
  // wrong-guess correction).
  const hasSnapped = useRef(false)
  const crouchCur = useRef(0)
  const adsCur = useRef(0)

  // ── Audio — `audio` is owned by ArenaScene (the parent) and passed down,
  // not created here: TouchControls needs the SAME instance to call
  // `unlock()` from a touch gesture, since this component only mounts
  // inside the Canvas and never sees a raw DOM touch event.
  const prevAmmo = useRef<number | null>(null)
  const prevReloading = useRef(false)
  const strideDist = useRef(0)

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
      audio.unlock()
      wantLock()
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.code)
    const mdown = (e: MouseEvent) => {
      if (e.button === 0) firing.current = true
      if (e.button === 2) rightMouseDown.current = true
      audio.unlock()
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
  }, [gl, isTouch, keys, mouseDX, mouseDY, firing, rightMouseDown, wantReload, audio])

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

  // ── Local weapon viewmodel — the REAL gun rig: same mesh, same hands
  // (`buildViewmodelHands`), same per-weapon framing (`WEAPON_VIEW`) real
  // Operations use. Cosmetic only — the server doesn't know or care what
  // this looks like; combat stats never vary by loadout (see
  // arena_server.rs's module doc — real money is staked on this fight).
  const gunMesh = useMemo(() => {
    const g = makeGunMesh(gunId)
    // The viewmodel inherits the camera's orientation, and a camera looks
    // down its own -Z; the barrel is +Z, so unturned it fires into your
    // face — same fix ValorScene applies.
    g.rotateY(Math.PI)
    const view = WEAPON_VIEW[gunId] ?? WEAPON_VIEW.assault_rifle
    g.scale.setScalar(view.scale)
    const hands = buildViewmodelHands(gunId, g, GUN_LENGTH[gunId] ?? GUN_LENGTH.assault_rifle)
    g.add(hands)
    return g
  }, [gunId])
  const gunView = WEAPON_VIEW[gunId] ?? WEAPON_VIEW.assault_rifle
  const gunAudio = GUN_FEEL[gunId]?.audio ?? GUN_FEEL.assault_rifle.audio
  const vmRef = useRef<THREE.Group>(null)
  const vmTmp = useRef(new THREE.Vector3())
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
    // Fire: Space OR left mouse on desktop (matches ValorScene's real
    // binding — `held('Space') || mouseBtn.has(0)`), the dedicated fire
    // button on touch.
    const firingNow = isTouch ? touchFiring.current : (firing.current || keys.current.has('Space'))
    crouchCur.current += ((crouchWant ? 1 : 0) - crouchCur.current) * Math.min(1, dt * 10)
    adsCur.current += ((adsWant ? 1 : 0) - adsCur.current) * Math.min(1, dt * 10)
    const eyeY = THREE.MathUtils.lerp(EYE_HEIGHT, EYE_HEIGHT_CROUCH, crouchCur.current)

    const lookSens = (isTouch ? TOUCH_LOOK_SENS : LOOK_SENS) * THREE.MathUtils.lerp(1, ADS_LOOK_SENS_MULT, adsCur.current)

    // Aim — accumulate mouse/touch-drag delta into yaw/pitch, exactly like
    // ValorScene does for both input sources.
    yaw.current -= mouseDX.current * lookSens
    pitch.current -= mouseDY.current * lookSens
    mouseDX.current = 0
    mouseDY.current = 0

    // ── Touch aim-assist ── gentle magnetism toward the opponent while
    // engaging (firing or ADS) — matching ValorScene's real "mobile aim
    // assist": desktop keeps raw mouse aim (skill decides the hit), touch
    // gets the same accessibility nudge the rest of the game gives it, so
    // touch-vs-touch and touch-vs-desktop feel consistent with everywhere
    // else instead of uniquely disadvantaged in Face-Off specifically.
    // Occlusion-aware (never pulls aim through a wall) and only nudges
    // within a real cone — it helps the fine aim, it doesn't aim for you,
    // and there's no hard lock-on (that would trivialize 1v1 combat).
    if (isTouch && fighting && (firingNow || adsCur.current > 0.35)) {
      const opp = latestPlayers.current.get(opponentWallet)
      if (opp && opp.hp > 0) {
        const px = localPos.current.x, pz = localPos.current.z
        const dx = opp.x - px, dz = opp.z - pz
        const dyC = 1.15 - eyeY // aim toward roughly chest height
        const dh = Math.hypot(dx, dz)
        if (dh > 0.8) {
          const len = Math.hypot(dx, dyC, dz)
          const origin: [number, number, number] = [px, eyeY, pz]
          const dir: [number, number, number] = [dx / len, dyC / len, dz / len]
          let occluded = false
          for (const c of ROOM_OBSTACLES) {
            const tc = rayAABB(origin, dir, aabbOfCover(c))
            if (tc !== null && tc < len - 0.5) { occluded = true; break }
          }
          if (!occluded) {
            const wantYaw = Math.atan2(-dx, -dz)
            const wantPitch = Math.atan2(dyC, dh)
            const diff = Math.hypot(angleDelta(wantYaw, yaw.current), wantPitch - pitch.current)
            if (diff < 0.3) { // ~17° acquisition cone
              const k = Math.min(0.22, (firingNow ? 6 : 3.5) * dt)
              yaw.current = lerpAngle(yaw.current, wantYaw, k)
              pitch.current += (wantPitch - pitch.current) * k
            }
          }
        }
      }
    }

    pitch.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch.current))

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
      const movedDist = Math.hypot(nx - localPos.current.x, nz - localPos.current.z)
      localPos.current.x = clamp(nx, -ARENA_HALF_X, ARENA_HALF_X)
      localPos.current.z = clamp(nz, -ARENA_HALF_Z, ARENA_HALF_Z)

      strideDist.current += movedDist
      if (strideDist.current >= STRIDE) {
        strideDist.current = 0
        audio.footstep()
      }

      // The FIRST real snapshot is a hard snap, not a soft pull — this is
      // what actually corrects a wrong near/far-side guess (position AND
      // facing), instead of leaving the camera aimed at whatever wall the
      // guess happened to be wrong about while position quietly slides
      // elsewhere underneath it. Every snapshot after that is a gentle
      // reconcile toward the server's truth — by then the guess is long
      // since resolved, so this is purely smoothing over ordinary latency
      // jitter, and must NOT touch yaw/pitch (the player's own look input
      // owns those from here on; server-pulling them would fight aiming).
      const mine = latestPlayers.current.get(walletAddress)
      if (mine) {
        if (!hasSnapped.current) {
          hasSnapped.current = true
          localPos.current.x = mine.x
          localPos.current.z = mine.z
          yaw.current = mine.yaw
          pitch.current = mine.pitch
        } else {
          localPos.current.x += (mine.x - localPos.current.x) * RECONCILE_STRENGTH * (dt * 20)
          localPos.current.z += (mine.z - localPos.current.z) * RECONCILE_STRENGTH * (dt * 20)
        }
        onLocalHp(mine.hp)
        onAmmo(mine.ammo, mine.reloading)

        // A dropped ammo count between snapshots is a real fired shot
        // (server-confirmed, whether it hit or missed) — the actual cue to
        // play the gun's own sound, not the raw "firing held" input.
        if (prevAmmo.current !== null && mine.ammo < prevAmmo.current) audio.shot(gunAudio)
        prevAmmo.current = mine.ammo
        if (mine.reloading && !prevReloading.current) audio.reloadStart()
        if (!mine.reloading && prevReloading.current) audio.reloadDone()
        prevReloading.current = mine.reloading
      }

      const sentReload = wantReload.current
      wantReload.current = false
      sendInput({
        moveX: mx, moveY: my, yaw: yaw.current, pitch: pitch.current,
        firing: firingNow, wantReload: sentReload,
        crouching: crouchWant, ads: adsWant,
      })
    }

    camera.position.set(localPos.current.x, eyeY, localPos.current.z)
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ')
    audio.setListener(localPos.current.x, localPos.current.z, yaw.current)

    // Cosmetic ADS zoom — the server has no FOV state to reflect, this is
    // purely a feel cue matching ValorScene's own aim-down-sights zoom.
    const p = camera as THREE.PerspectiveCamera
    const targetFov = THREE.MathUtils.lerp(60, 48, adsCur.current)
    if (Math.abs(p.fov - targetFov) > 0.01) {
      p.fov = targetFov
      p.updateProjectionMatrix()
    }

    // Viewmodel — the real hip/ADS framing (VIEWMODEL_HIP/VIEWMODEL_ADS +
    // this weapon's own z/y offset from WEAPON_VIEW), plus a light recoil
    // kick. Hands are for the hip pose only — same reasoning ValorScene
    // documents: at full ADS the grip sits mid-screen and a hand there would
    // cover the target.
    if (vmRef.current) {
      recoilKick.current = Math.max(0, recoilKick.current - dt * 6)
      const local = vmTmp.current.copy(VIEWMODEL_HIP).lerp(VIEWMODEL_ADS, adsCur.current)
      local.z += gunView.z; local.y += gunView.y
      local.y -= recoilKick.current * 0.02
      local.z += recoilKick.current * 0.03
      const world = camera.localToWorld(local.clone())
      vmRef.current.position.copy(world)
      vmRef.current.quaternion.copy(camera.quaternion)
      const hands = gunMesh.getObjectByName('hands')
      if (hands) hands.visible = adsCur.current < 0.45
    }

    // Hits — recoil kick + audio on OUR OWN shots landing, hurt cue on shots
    // WE took; damage-taken HUD feedback lives in FaceOffPage's HUD state.
    for (const hit of drainHits()) {
      if (hit.shooter === walletAddress) {
        recoilKick.current = 1
        audio.impact('flesh', [opponentRendered.current.x, 1.2, opponentRendered.current.z])
        audio.hitmarker(hit.target_hp <= 0)
        onHit?.(hit)
      } else if (hit.target === walletAddress) {
        audio.hurt()
      }
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
            // Spatialised — you hear which side an incoming shot came from,
            // same as ValorScene's enemyShot cue.
            audio.enemyShot([opp.x, EYE_HEIGHT, opp.z])
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

/** Shortest signed distance from `a` to `b` around the circle. */
function angleDelta(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}
