'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Noise, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { usePbr } from './usePbr';
import {
  FpsSim,
  xpForKill, rankForXp, xpIntoRank, rankUpsBetween, gReward, XP_REWARD, XP_PER_RANK, rayAABB, aabbOfCover, type FpsInput, type Vec3, type Rank, type Attachment,
} from '../fps';
import { RANK_COLORS } from '../../lib/constants';
import { linesFor, SPEAKER_META, type PresenceLine, type PresenceTrigger } from '../story/presence';
import { GUN_FEEL } from '../combat/GunFeel';
import type { GunId } from '../combat/GunStats';
import { FpsAudio } from '../audio';
import { computeEdgeArrow } from '../verb/threatArrow';
import { useRiflePrototype, cloneRifle } from './rifle';
import { OperatorRig, type OperatorApi } from './OperatorRig';
import { CAMPAIGN, CAMPAIGN_KEY, PROGRESS_KEY, ZONE_THEMES, SURVIVAL_MISSION, survivalWaveCount, survivalWaveHp, type Mission } from '../fps/campaign';

/**
 * Valor clone · slice 1 graybox (docs/the plan.md).
 *
 * The single verb, in isolation: a first-person gunfight that has to feel great
 * MUTED, with no art and no sound. First-person camera, viewmodel with sway +
 * bob + recoil, ADS / lean / crouch, aim decided by a camera raycast against
 * head/body hitboxes, cover that eats rounds, lethal Valor damage, static dummies
 * that fall and respawn so the feel can be hammered on.
 *
 * Isolated on purpose (Marvy's rule): this mounts at /dev/verb and touches
 * nothing in the live /fight game. It becomes /fight only when the whole Valor
 * build is done.
 *
 * Controls are KEYBOARD-FIRST (mouse clicks are unreliable for Marvy):
 *   move WASD · look mouse OR arrow keys · FIRE Space · ADS Left-Shift
 *   lean Q/E · crouch C · reload R. Mouse buttons also work as a bonus.
 */

const EYE_STAND = 1.6;
const EYE_CROUCH = 1.02;
const PLAYER_R = 0.35;

const WALK = 3.4;     // m/s base
const ADS_MOVE = 0.55;
const CROUCH_MOVE = 0.5;

const LOOK_SENS = 0.0010;       // rad per mouse pixel — fine aim (was far too fast)
const KEY_LOOK = 0.9;           // rad/s for arrow-key look — small nudges
const ADS_SENS = 0.55;          // look slows while aiming down sights (precision)
const MOUSE_MAX_STEP = 90;      // clamp per-event mouse delta — kills pointer-lock spikes
const TOUCH_LOOK_SENS = 0.0022; // rad per touch-drag pixel (mobile look)
const PITCH_LIMIT = 1.45;       // ~83°

const RECOIL_RECOVER = 12;     // per second
const BOB = 0.014;

const HIP_POS = new THREE.Vector3(0.2, -0.2, -0.5);
const ADS_POS = new THREE.Vector3(0, -0.088, -0.32);

// The tactical UI face (loaded in the route via next/font), mono for raw numbers.
const UI_FONT = 'var(--font-tactical), ui-monospace, monospace';

/** Line-drawn UI glyphs (currentColor), replacing emoji across the HUD/menus. */
function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const s = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { display: 'block', flex: 'none' as const },
  };
  switch (name) {
    case 'lock': return (<svg {...s}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></svg>);
    case 'check': return (<svg {...s}><path d="M20 6 9 17l-5-5" /></svg>);
    case 'chevron': return (<svg {...s}><path d="M9 5l7 7-7 7" /></svg>);
    case 'play': return (<svg {...s} fill="currentColor" stroke="none"><path d="M7 4.5v15l12-7.5-12-7.5z" /></svg>);
    case 'alert': return (<svg {...s}><path d="M12 3 2.5 20h19L12 3z" /><line x1="12" y1="10" x2="12" y2="14" /><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" /></svg>);
    case 'infinity': return (<svg {...s}><path d="M4 12c0-2.2 1.8-4 4-4s3.2 1.6 4 3c.8-1.4 2-3 4-3s4 1.8 4 4-1.8 4-4 4-3.2-1.6-4-3c-.8 1.4-2 3-4 3s-4-1.8-4-4z" /></svg>);
    case 'menu': return (<svg {...s}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></svg>);
    case 'refresh': return (<svg {...s}><path d="M20.5 9A8 8 0 1 0 21 14" /><path d="M21 3.5V9h-5.5" /></svg>);
    case 'swap': return (<svg {...s}><path d="M16 4l4 4-4 4" /><path d="M20 8H7" /><path d="M8 20l-4-4 4-4" /><path d="M4 16h13" /></svg>);
    case 'firemode': return (<svg {...s}><circle cx="7" cy="7" r="1.4" fill="currentColor" stroke="none" /><line x1="11" y1="7" x2="19" y2="7" /><circle cx="7" cy="12" r="1.4" fill="currentColor" stroke="none" /><line x1="11" y1="12" x2="19" y2="12" /><circle cx="7" cy="17" r="1.4" fill="currentColor" stroke="none" /><line x1="11" y1="17" x2="19" y2="17" /></svg>);
    case 'crosshair': return (<svg {...s}><circle cx="12" cy="12" r="7" /><line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></svg>);
    case 'rotate': return (<svg {...s}><rect x="8.5" y="3" width="7" height="18" rx="1.6" /><path d="M4.2 8.4A9 9 0 0 1 7 4.9" /><path d="M3 5l1 3.4 3.3-.8" /><path d="M19.8 15.6A9 9 0 0 1 17 19.1" /><path d="M21 19l-1-3.4-3.3.8" /></svg>);
    default: return null;
  }
}

/** Wrapped angular difference a-b, in (-π, π]. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** A glassy, tactile circular touch button — the shared look for the mobile HUD. */
function touchBtn(color: string, size: number, strong = false): React.CSSProperties {
  return {
    position: 'absolute', width: size, height: size, borderRadius: '50%',
    border: `1.5px solid ${color}${strong ? 'cc' : '55'}`,
    background: `radial-gradient(circle at 50% 34%, ${color}${strong ? '40' : '22'}, ${color}0f 66%, rgba(6,10,16,.42))`,
    boxShadow: `inset 0 1px 0 rgba(255,255,255,.22), inset 0 -8px 16px ${color}14, 0 6px 16px rgba(0,0,0,.5)`,
    backdropFilter: 'blur(7px)', WebkitBackdropFilter: 'blur(7px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color, fontWeight: 700, letterSpacing: 1, touchAction: 'none', userSelect: 'none', WebkitTapHighlightColor: 'transparent',
  };
}

/** A button label: an icon followed by text, vertically centred. */
function iconRow(name: string, label: string, size = 15): React.ReactNode {
  return (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name={name} size={size} />{label}</span>);
}

// Per-weapon viewmodel framing so each gun reads as a different silhouette off
// the one shared rifle model: scale = length, z/y = how it sits in the hands.
// The attachment HUD strip + which key toggles each.
const ATTACH_CHIPS: { id: Attachment; label: string; key: string; color: string }[] = [
  { id: 'nvg', label: 'NVG', key: 'N', color: '#5fe0a8' },
  { id: 'light', label: 'LIGHT', key: 'F', color: '#ffe08a' },
  { id: 'laser', label: 'LASER', key: 'L', color: '#ff6a6a' },
  { id: 'optic', label: 'OPTIC', key: 'O', color: '#8fb8d0' },
];

const WEAPON_VIEW: Record<GunId, { scale: number; z: number; y: number }> = {
  sidearm: { scale: 0.52, z: 0.14, y: -0.03 }, // a compact pistol, held in close
  smg: { scale: 0.8, z: 0.06, y: -0.01 },      // stubby, snappy
  assault_rifle: { scale: 1.0, z: 0, y: 0 },   // the baseline
  marksman: { scale: 1.3, z: -0.06, y: 0.006 },// long — pushed out front
  legendary: { scale: 1.08, z: 0, y: 0 },      // the Valor Prototype
};

// The mission compound is data now (engine/fps/campaign.ts). The scene runs ONE
// Mission at a time, loaded from CAMPAIGN[missionIndex]; completing it advances.
const FLOOR_W = 22, FLOOR_D = 38;
const REACH_RADIUS = 3.5;

// Earn loop (slice 5). Career XP persists locally in the sandbox; when this is
// attached to /fight it banks through the real rank/RewardPool path instead.
const XP_KEY = 'valor_career_xp';
const XP_POPS = 4;

/** Placeholder body, real rifle animation. Swapping the mesh is one asset change. */
const OPERATOR_GLB = '/characters/glb/operator.glb';

interface Hud {
  root: HTMLDivElement | null;
  ammo: HTMLDivElement | null;
  fireMode: HTMLDivElement | null;
  weapon: HTMLDivElement | null;
  loadout: HTMLDivElement | null;
  attachments: HTMLDivElement | null;
  nvgTint: HTMLDivElement | null;
  scope: HTMLDivElement | null;
  reload: HTMLDivElement | null;
  reloadBar: HTMLDivElement | null;
  reloadHint: HTMLDivElement | null;
  hit: HTMLDivElement | null;
  ch: { t: HTMLDivElement | null; b: HTMLDivElement | null; l: HTMLDivElement | null; r: HTMLDivElement | null };
  lock: HTMLDivElement | null;
  kills: HTMLDivElement | null;
  healthFill: HTMLDivElement | null;
  vignette: HTMLDivElement | null;
  hitDir: HTMLDivElement | null;
  down: HTMLDivElement | null;
  arrows: Array<HTMLDivElement | null>;
  objText: HTMLDivElement | null;
  survEnd: HTMLDivElement | null;
  survEndText: HTMLDivElement | null;
  objArrow: HTMLDivElement | null;
  briefing: HTMLDivElement | null;
  complete: HTMLDivElement | null;
  rankText: HTMLDivElement | null;
  xpBar: HTMLDivElement | null;
  xpPops: Array<HTMLDivElement | null>;
  rankUp: HTMLDivElement | null;
  rankUpRank: HTMLDivElement | null;
  rankUpG: HTMLDivElement | null;
  subWrap: HTMLDivElement | null;
  subName: HTMLDivElement | null;
  subText: HTMLDivElement | null;
  bossWrap: HTMLDivElement | null;
  bossName: HTMLDivElement | null;
  bossFill: HTMLDivElement | null;
}

/** Mobile/touch control state, written by the on-screen pads and read each frame. */
interface Controls {
  moveX: number; // -1..1 strafe (right +)
  moveY: number; // -1..1 forward (forward +)
  lookX: number; // accumulated touch-drag dx, consumed each frame
  lookY: number;
  fire: boolean;
  ads: boolean;
  reload: boolean;
  fireMode: boolean;
  swap: boolean;
  toggle: Attachment | null; // mobile attachment chip → toggle this
}

function FpsWorld({ hud, controls, audio, lowSpec, mission, onComplete, pausedRef }: {
  hud: React.MutableRefObject<Hud>; controls: React.MutableRefObject<Controls>;
  audio: FpsAudio; lowSpec: boolean; mission: Mission; onComplete: () => void;
  pausedRef: React.MutableRefObject<boolean>;
}) {
  const { camera, gl } = useThree();

  // The one mission this mount runs. The scene remounts (key=missionIndex) to
  // switch, so treating these as constants is safe. Aliased to the old names so
  // the rest of the world reads unchanged.
  const START = mission.start;
  const LEVEL_WALLS = mission.walls;
  const LEVEL_COVER = mission.cover;
  const ENEMIES = mission.enemies;
  const OBJECTIVES = mission.objectives;
  const GUN = mission.gun;
  const LOADOUT = useMemo<GunId[]>(() => [mission.gun, mission.secondary ?? 'sidearm'], [mission]);
  const COLLIDERS = useMemo(() => [...mission.walls, ...mission.cover], [mission]);
  const theme = ZONE_THEMES[mission.zone] ?? ZONE_THEMES.ASHFALL;
  const isFinale = mission.id === CAMPAIGN[CAMPAIGN.length - 1].id;
  const survival = !!mission.survival;

  const sim = useMemo(() => {
    const s = new FpsSim({ loadout: LOADOUT, attachments: mission.attachments, enemies: ENEMIES, cover: COLLIDERS, respawnEnabled: false });
    s.setAllActive(false); // rooms start dormant; breaching each one wakes it
    return s;
  }, []);

  // ── Player look / motion state (imperative — no React churn per frame) ──
  const yaw = useRef(0);
  const pitch = useRef(0);
  const recoilP = useRef(0);
  const recoilY = useRef(0);
  const pos = useRef(new THREE.Vector3(START[0], EYE_STAND, START[1]));
  const adsCur = useRef(0);
  const leanCur = useRef(0);
  const crouchCur = useRef(0);
  const bobPhase = useRef(0);
  const footstepAt = useRef(0);
  const swayT = useRef(0); // bodycam handheld drift (slice 7)

  // ── Slice 7 surfaces: Poly Haven CC0 PBR. One base per surface, because drei
  // caches textures by URL and a shared base would stomp the other's tiling.
  const floorMaps = usePbr('burned_ground_01', [12, 20]);
  const brickMaps = usePbr('broken_brick_wall', [7, 1.6]);
  const plasterMaps = usePbr('damaged_plaster', [4, 1.4]);
  const plankMaps = usePbr('black_painted_planks', [1, 1]);
  const caOffset = useMemo(() => new THREE.Vector2(lowSpec ? 0.0003 : 0.0007, lowSpec ? 0.0004 : 0.0009), [lowSpec]);
  const heartbeatAt = useRef(0);
  const downAt = useRef(-99);
  const vignetteHit = useRef(0); // decaying red damage-flash intensity
  const bossFlash = useRef(0);   // decaying pulse when a boss crosses a phase threshold
  // getting shot knocks the camera about (slice 8): stagger + shake
  const staggerP = useRef(0);
  const staggerY = useRef(0);
  const shake = useRef(0);
  const shoveX = useRef(0); // knocked off the line you were shot from
  const shoveZ = useRef(0);
  // mission flow (slice 4)
  const objective = useRef(0);
  const briefingUntil = useRef(3.5);
  const completeAt = useRef(-99);
  // ── Survival wave state ──
  const survInit = useRef(false);
  const survWave = useRef(0);              // current wave (0 before the first)
  const survState = useRef<'intermission' | 'active'>('intermission');
  const survNextAt = useRef(0);            // sim-time the next wave begins
  const survOver = useRef(false);          // the run has ended (player down)
  const advanced = useRef(false);
  const completeWallAt = useRef(0);
  const waypointRef = useRef<THREE.Group>(null);
  // earn loop (slice 5)
  const careerXp = useRef(0);
  const xpPopHead = useRef(0);
  // story presence (slice 6)
  const storyFired = useRef<Set<PresenceTrigger>>(new Set());
  const voQueue = useRef<PresenceLine[]>([]);
  const voUntil = useRef(0);
  const voStartedAt = useRef(0);
  const voCurrentId = useRef<string | null>(null);

  const keys = useRef<Set<string>>(new Set());
  const mouseBtn = useRef<Set<number>>(new Set());
  const mouseDX = useRef(0);
  const mouseDY = useRef(0);
  const wantReload = useRef(false);
  const cycleFireMode = useRef(false);
  const locked = useRef(false);

  // ── Scene objects ──
  const vmRef = useRef<THREE.Group>(null);
  const vmScaleCur = useRef(WEAPON_VIEW[LOADOUT[0]]?.scale ?? 1); // lerps between weapons
  const swapRaise = useRef(0);          // 1 → 0 dip when a weapon is raised
  const wantSlot = useRef<number | null>(null); // 1/2 keys pick a slot
  const wantSwap = useRef(false);       // the swap key cycles
  // ── Attachments (toggleable kit) ──
  const wantToggle = useRef<Attachment | null>(null);
  const nvgAmt = useRef(0);             // 0..1 night-vision blend (exposure + green)
  const flashLight = useMemo(() => new THREE.SpotLight(0xeaf2ff, 0, 34, 0.5, 0.5, 1.1), []);
  const laserLine = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd83228, transparent: true, opacity: 0.5, depthTest: false }));
    l.frustumCulled = false; l.visible = false; l.renderOrder = 998;
    return l;
  }, []);
  const laserDot = useMemo(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4030, depthTest: false }));
    m.frustumCulled = false; m.visible = false; m.renderOrder = 999;
    return m;
  }, []);
  const muzzleLight = useRef<THREE.PointLight>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const flashUntil = useRef(0);

  const dummyRefs = useRef<Array<THREE.Group | null>>([]);
  const dummyFlash = useRef<number[]>(ENEMIES.map(() => 0));
  const rigApis = useRef<Array<OperatorApi | null>>([]);

  // Rounds you can SEE. Slow enough to read (a real bullet would be invisible),
  // fast enough to feel lethal. Yours fly out; theirs come at you.
  const BULLETS = 28;
  const PLAYER_BULLET_SPEED = 95; // m/s
  const ENEMY_BULLET_SPEED = 140; // fast: it snaps to the impact, never lingers in your face
  const bulletRefs = useRef<Array<THREE.Mesh | null>>([]);
  const bulletHead = useRef(0);
  const bullets = useRef(Array.from({ length: 28 }, () => ({
    active: false, t: 0, dur: 0, hit: false,
    from: new THREE.Vector3(), to: new THREE.Vector3(),
  })));

  // The LINE of the shot: muzzle -> whatever it struck. Held briefly so a round
  // fired straight at your face still reads as a line and not a dot.
  const BEAMS = 16;
  const beamRefs = useRef<Array<THREE.Mesh | null>>([]);
  const beamUntil = useRef<number[]>(Array(16).fill(0));
  const beamHead = useRef(0);

  const IMPACTS = 14;
  const impactRefs = useRef<Array<THREE.Mesh | null>>([]);
  const impactUntil = useRef<number[]>(Array(IMPACTS).fill(0));
  const impactHead = useRef(0);

  // enemy muzzle flashes (a bright, visible "they fired" pop) + a shared light
  const EFLASH = 6;
  const eFlashRefs = useRef<Array<THREE.Mesh | null>>([]);
  const eFlashUntil = useRef<number[]>(Array(EFLASH).fill(0));
  const eFlashHead = useRef(0);
  const eLight = useRef<THREE.PointLight>(null);

  // Build the viewmodel gun once and hang it in the scene (positioned to the
  // camera each frame, so we don't depend on camera-child rendering).
  // The same real rifle the enemies carry, so first- and third-person agree.
  const rifleProto = useRiflePrototype();
  const gunMesh = useMemo(() => {
    const g = cloneRifle(rifleProto);
    // The viewmodel inherits the CAMERA's orientation, and a camera looks down
    // its own -Z. The rifle's barrel is +Z, so unturned it fires into your face.
    g.rotateY(Math.PI);
    return g;
  }, [rifleProto]);
  const muzzleLocal = useMemo(() => gunMesh.getObjectByName('muzzle') ?? gunMesh, [gunMesh]);

  useEffect(() => {
    const p = camera as THREE.PerspectiveCamera;
    p.near = 0.01;
    p.far = 320;
    p.fov = 55;
    p.rotation.order = 'YXZ';
    p.updateProjectionMatrix();
  }, [camera]);

  // ── Input ──
  useEffect(() => {
    const canvas = gl.domElement;
    // Pointer lock is OPTIONAL — only for players who want mouse-look. It is
    // requested on a deliberate click (a trusted gesture), never on keydown, so
    // keyboard-only play (arrow keys aim) never triggers a lock error.
    const wantLock = () => {
      if (locked.current || document.pointerLockElement === canvas) return;
      try {
        const p: unknown = canvas.requestPointerLock?.();
        if (p && typeof (p as { catch?: unknown }).catch === 'function') (p as Promise<void>).catch(() => {});
      } catch { /* pointer lock unavailable (headless / blocked) — arrow keys still aim */ }
    };
    const down = (e: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      keys.current.add(e.code);
      if (e.code === 'KeyR') wantReload.current = true;
      if (e.code === 'KeyB') cycleFireMode.current = true; // toggle semi/burst/auto
      if (e.code === 'Digit1') wantSlot.current = 0;       // primary
      if (e.code === 'Digit2') wantSlot.current = 1;       // sidearm slot
      if (e.code === 'KeyX') wantSwap.current = true;      // swap to the other weapon
      if (e.code === 'KeyN') wantToggle.current = 'nvg';   // night vision
      if (e.code === 'KeyF') wantToggle.current = 'light'; // flashlight
      if (e.code === 'KeyL') wantToggle.current = 'laser'; // laser sight
      if (e.code === 'KeyO') wantToggle.current = 'optic'; // optic / scope
      audio.unlock();
      // Capture the mouse on the first keypress so MOVING the mouse aims (up/down
      // included) without needing a click. Guarded, so headless never throws.
      wantLock();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const mdown = (e: MouseEvent) => { mouseBtn.current.add(e.button); audio.unlock(); wantLock(); };
    const mup = (e: MouseEvent) => mouseBtn.current.delete(e.button);
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        // clamp per event — pointer-lock recenter jumps can spike movementX/Y huge
        mouseDX.current += Math.max(-MOUSE_MAX_STEP, Math.min(MOUSE_MAX_STEP, e.movementX));
        mouseDY.current += Math.max(-MOUSE_MAX_STEP, Math.min(MOUSE_MAX_STEP, e.movementY));
      }
    };
    const lockChange = () => { locked.current = document.pointerLockElement === canvas; };
    const noMenu = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('mousedown', mdown);
    window.addEventListener('mouseup', mup);
    window.addEventListener('mousemove', move);
    document.addEventListener('pointerlockchange', lockChange);
    canvas.addEventListener('contextmenu', noMenu);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('mousedown', mdown);
      window.removeEventListener('mouseup', mup);
      window.removeEventListener('mousemove', move);
      document.removeEventListener('pointerlockchange', lockChange);
      canvas.removeEventListener('contextmenu', noMenu);
    };
  }, [gl]);

  // A fresh mount (new mission / retry) must start with no stale overlays from
  // the previous run showing through (the "MISSION COMPLETE stuck on" bug).
  useEffect(() => {
    for (const el of [hud.current.complete, hud.current.survEnd, hud.current.down]) {
      if (el) el.style.opacity = '0';
    }
    if (hud.current.survEnd) hud.current.survEnd.style.pointerEvents = 'none';
  }, [hud]);

  // ── Probe hooks (headless verification) ──
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__valorState = () => sim.snapshot();
    w.__valorKillAll = () => sim.debugKillAll();
    w.__valorAim = () => ({ pitch: pitch.current, yaw: yaw.current });
    w.__valorAudio = () => audio.stats();
    w.__valorMission = () => ({ objective: objective.current, total: OBJECTIVES.length, complete: completeAt.current > 0, briefing: sim.time < briefingUntil.current, survival, wave: survWave.current, waveState: survState.current, survOver: survOver.current });
    w.__valorWarp = (x: number, z: number) => { pos.current.set(x, EYE_STAND, z); };
    w.__valorSkipBriefing = () => { briefingUntil.current = 0; };
    w.__valorXp = () => ({ careerXp: careerXp.current, rank: rankForXp(careerXp.current), intoRank: xpIntoRank(careerXp.current) });
    w.__valorStory = () => ({ fired: [...storyFired.current], queued: voQueue.current.length });
    w.__valorRig = () => rigApis.current[0]?.debug() ?? null;
    w.__valorPlayer = () => ({ x: +pos.current.x.toFixed(3), z: +pos.current.z.toFixed(3) });
    w.__valorStagger = () => ({
      shoveX: +shoveX.current.toFixed(4), shoveZ: +shoveZ.current.toFixed(4),
      pitch: +staggerP.current.toFixed(4), yaw: +staggerY.current.toFixed(4), shake: +shake.current.toFixed(4),
    });
    w.__valorColliders = () => COLLIDERS;
    w.__valorCam = () => ({ x: +camera.position.x.toFixed(3), z: +camera.position.z.toFixed(3) });
    // audition any presence line (also lets us verify which ids have a recording)
    w.__valorVo = (id: string, speaker: 'ember' | 'valor' | 'cinder') => audio.vo(id, speaker);
    w.__valorSetXp = (n: number) => { careerXp.current = n; try { window.localStorage.setItem(XP_KEY, String(n)); } catch { /* ignore */ } };
    // headless: wound the live boss to a fraction of its health, to drive phases
    w.__valorHurtBoss = (frac: number) => {
      const b = sim.getEnemies().find((e) => e.boss && e.alive);
      if (b) (b as { hp: number }).hp = Math.max(1, Math.round(b.maxHp * frac));
      return b ? { hp: b.hp, phase: b.phase } : null;
    };
    w.__valorWakeRoom = (room: number) => sim.setRoomActive(room, true); // headless room activation
    w.__valorSwitch = (n?: number) => (typeof n === 'number' ? sim.switchGun(n) : sim.nextWeapon());
    w.__valorFire = (on: boolean) => { controls.current.fire = !!on; }; // headless: hold the trigger (aim-assist test)
    w.__valorToggle = (a: Attachment) => sim.toggleAttachment(a);
    return () => {
      delete w.__valorState; delete w.__valorKillAll; delete w.__valorAim; delete w.__valorAudio;
      delete w.__valorMission; delete w.__valorWarp; delete w.__valorSkipBriefing;
      delete w.__valorXp; delete w.__valorSetXp; delete w.__valorStory; delete w.__valorVo; delete w.__valorRig; delete w.__valorPlayer; delete w.__valorColliders; delete w.__valorCam; delete w.__valorStagger; delete w.__valorHurtBoss; delete w.__valorWakeRoom; delete w.__valorSwitch; delete w.__valorFire; delete w.__valorToggle;
    };
  }, [sim, audio]);

  // career XP persists locally across runs in the sandbox
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(XP_KEY));
      if (Number.isFinite(v) && v > 0) careerXp.current = v;
    } catch { /* private mode */ }
  }, []);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  const tmp2 = useMemo(() => new THREE.Vector3(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const arrowWp = useMemo(() => new THREE.Vector3(), []);
  const arrowCs = useMemo(() => new THREE.Vector3(), []);
  const feel = GUN_FEEL[GUN];

  useFrame((_, rawDt) => {
    // Paused for the Operations board: freeze the sim + drop any held input so
    // movement doesn't carry through the menu.
    if (pausedRef.current) { keys.current.clear(); mouseBtn.current.clear(); return; }
    const dt = Math.min(rawDt, 1 / 20);
    const k = keys.current;
    const held = (c: string) => k.has(c);
    const ct = controls.current;

    // ── Stances FIRST (look sensitivity is reduced while aiming down sights) ──
    const adsWant = held('ShiftLeft') || held('ShiftRight') || mouseBtn.current.has(2) || ct.ads ? 1 : 0;
    const crouchWant = held('KeyC') ? 1 : 0;
    const leanWant = (held('KeyE') ? 1 : 0) - (held('KeyQ') ? 1 : 0);
    adsCur.current += (adsWant - adsCur.current) * Math.min(1, dt * 12);
    crouchCur.current += (crouchWant - crouchCur.current) * Math.min(1, dt * 10);
    leanCur.current += (leanWant - leanCur.current) * Math.min(1, dt * 12);

    // ── Look: mouse (pointer-lock) + touch drag + arrow keys, slowed by ADS ──
    const adsMult = THREE.MathUtils.lerp(1, ADS_SENS, adsCur.current);
    yaw.current -= (mouseDX.current * LOOK_SENS + ct.lookX * TOUCH_LOOK_SENS) * adsMult;
    pitch.current -= (mouseDY.current * LOOK_SENS + ct.lookY * TOUCH_LOOK_SENS) * adsMult;
    mouseDX.current = 0; mouseDY.current = 0; ct.lookX = 0; ct.lookY = 0;
    const keyStep = KEY_LOOK * adsMult * dt;
    if (held('ArrowLeft')) yaw.current += keyStep;
    if (held('ArrowRight')) yaw.current -= keyStep;
    if (held('ArrowUp')) pitch.current += keyStep;
    if (held('ArrowDown')) pitch.current -= keyStep;

    // ── Mobile aim assist ──
    // On a phone you can't flick-aim, so while engaging (firing or aiming) we
    // gently magnetise the crosshair to the nearest ON-SCREEN, UNOCCLUDED enemy.
    // You still choose who by pointing roughly at them; the assist does the fine
    // targeting. Desktop keeps raw mouse aim (skill decides the hit).
    if (lowSpec && (ct.fire || adsCur.current > 0.35)) {
      const eyeApprox = THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, crouchCur.current);
      const px = pos.current.x, pz = pos.current.z;
      let bestDiff = 0.3; // ~17° acquisition cone
      let tYaw = 0, tPitch = 0, found = false;
      for (const e of sim.getEnemies()) {
        if (!e.alive || !e.active) continue;
        const dx = e.x - px, dz = e.z - pz, dyC = 1.15 - eyeApprox;
        const dh = Math.hypot(dx, dz);
        if (dh < 1.2 || dh > 42) continue;
        const len = Math.hypot(dx, dyC, dz);
        const dir: Vec3 = [dx / len, dyC / len, dz / len];
        const from: Vec3 = [px, eyeApprox, pz];
        let occluded = false;
        for (const c of COLLIDERS) {
          const tc = rayAABB(from, dir, aabbOfCover(c));
          if (tc !== null && tc < len - 0.5) { occluded = true; break; }
        }
        if (occluded) continue;
        const wantYaw = Math.atan2(-dx, -dz);
        const wantPitch = Math.atan2(dyC, dh);
        const diff = Math.hypot(angleDiff(wantYaw, yaw.current), wantPitch - pitch.current);
        if (diff < bestDiff) { bestDiff = diff; tYaw = wantYaw; tPitch = wantPitch; found = true; }
      }
      if (found) {
        const k = Math.min(0.5, (ct.fire ? 11 : 6) * dt); // stronger while firing
        yaw.current += angleDiff(tYaw, yaw.current) * k;
        pitch.current += (tPitch - pitch.current) * k;
      }
    }

    pitch.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch.current));

    // ── Movement (camera-relative on the ground plane; keyboard + touch stick) ──
    const mf = Math.max(-1, Math.min(1, (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0) + ct.moveY));
    const ms = Math.max(-1, Math.min(1, (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0) + ct.moveX));
    const moving = Math.abs(mf) > 0.02 || Math.abs(ms) > 0.02;
    let speed = WALK * (1 - 0.45 * adsCur.current) * (1 - (1 - CROUCH_MOVE) * crouchCur.current);
    if (adsCur.current > 0.5) speed = Math.min(speed, WALK * ADS_MOVE);
    const sinY = Math.sin(yaw.current), cosY = Math.cos(yaw.current);
    // forward on ground = (-sinY, 0, -cosY); right = (cosY, 0, -sinY)
    let nx = pos.current.x + (-sinY * mf + cosY * ms) * speed * dt;
    let nz = pos.current.z + (-cosY * mf - sinY * ms) * speed * dt;
    ({ x: nx, z: nz } = clampAndSlide(nx, nz));
    pos.current.x = nx; pos.current.z = nz;
    if (moving) bobPhase.current += dt * (adsCur.current > 0.5 ? 6 : 9);
    if (moving && sim.time - footstepAt.current > (adsCur.current > 0.5 ? 0.62 : 0.42)) {
      audio.footstep();
      footstepAt.current = sim.time;
    }

    // ── Drive the camera ──
    // Bodycam handheld drift — the signature of the look. Aiming down sights
    // steadies the hands, so precision is never fighting the camera.
    swayT.current += dt * (moving ? 6.2 : 1.5);
    const swayAmt = (moving ? 1 : 0.38) * (1 - adsCur.current * 0.85);
    const swayPitch = Math.sin(swayT.current * 1.07) * 0.0045 * swayAmt;
    const swayYaw = Math.sin(swayT.current * 0.63) * 0.0038 * swayAmt;
    const swayRoll = Math.sin(swayT.current * 0.51) * 0.0075 * swayAmt;

    const eyeY = THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, crouchCur.current)
      + Math.sin(swayT.current * 2.1) * 0.011 * swayAmt;
    const lean = leanCur.current;
    const cam = camera as THREE.PerspectiveCamera;
    // Lateral lean offset. Peeking must never push the camera into geometry —
    // shorten the lean until the head is clear (0 = fully blocked, don't lean).
    let leanX = lean * 0.45;
    for (let t = 1; t > 0.001; t -= 0.2) {
      const lx = leanX * t;
      if (!blocked(pos.current.x + cosY * lx, pos.current.z - sinY * lx, 0.12)) { leanX = lx; break; }
      if (t - 0.2 <= 0.001) leanX = 0;
    }
    cam.position.set(
      pos.current.x + cosY * leanX + shoveX.current,
      eyeY,
      pos.current.z - sinY * leanX + shoveZ.current,
    );
    const sh = shake.current;
    cam.rotation.set(
      pitch.current + recoilP.current + swayPitch + staggerP.current + (Math.random() - 0.5) * sh * 0.5,
      yaw.current + recoilY.current + swayYaw + staggerY.current + (Math.random() - 0.5) * sh * 0.5,
      -lean * 0.14 + swayRoll + (Math.random() - 0.5) * sh,
      'YXZ',
    );
    const adsFov = THREE.MathUtils.lerp(55, 42, adsCur.current);
    if (Math.abs(cam.fov - adsFov) > 0.05) { cam.fov = adsFov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert(); // for threat-arrow projection
    audio.setListener(pos.current.x, pos.current.z, yaw.current); // camera is the listener

    // ── Recoil recovery + damage-flash decay ──
    recoilP.current += (0 - recoilP.current) * Math.min(1, dt * RECOIL_RECOVER);
    recoilY.current += (0 - recoilY.current) * Math.min(1, dt * RECOIL_RECOVER);
    vignetteHit.current = Math.max(0, vignetteHit.current - dt * 2.5);
    bossFlash.current = Math.max(0, bossFlash.current - dt * 1.5);

    // Getting-shot stagger recovers to FULLY STABLE within a moment. The snap-to-
    // zero matters: exponential decay never quite reaches 0, and any leftover
    // `shake` jitters the view forever ("stagger through the whole game").
    const settle = (v: number) => {
      const n = v + (0 - v) * Math.min(1, dt * 7);
      return Math.abs(n) < 0.0006 ? 0 : n;
    };
    staggerP.current = settle(staggerP.current);
    staggerY.current = settle(staggerY.current);
    shake.current = settle(shake.current);
    shoveX.current = settle(shoveX.current);
    shoveZ.current = settle(shoveZ.current);

    // ── Viewmodel transform (locked to view + sway/bob/recoil + per-weapon framing) ──
    const view = WEAPON_VIEW[sim.gun.id] ?? WEAPON_VIEW.assault_rifle;
    vmScaleCur.current += (view.scale - vmScaleCur.current) * Math.min(1, dt * 12);
    gunMesh.scale.setScalar(vmScaleCur.current);
    swapRaise.current = Math.max(0, swapRaise.current - dt * 2.4);
    const vm = vmRef.current;
    if (vm) {
      const local = tmp.copy(HIP_POS).lerp(ADS_POS, adsCur.current);
      local.z += view.z; local.y += view.y;                 // where this weapon sits
      // bob: a gentle walk figure-8 on the viewmodel when moving
      local.x += Math.sin(bobPhase.current) * BOB * (moving ? 1 : 0);
      local.y += Math.abs(Math.cos(bobPhase.current)) * BOB * (moving ? 1 : 0);
      local.y -= swapRaise.current * 0.22;                  // dips down as it's raised
      local.z += recoilP.current * 2.2; // kick back toward the camera on fire
      vm.position.copy(cam.localToWorld(local));
      vm.quaternion.copy(cam.quaternion);
      vm.rotateX(-recoilP.current * 1.6);
      vm.updateMatrixWorld();
    }

    // ── Attachments: night vision, optic zoom, flashlight, laser ──
    cam.getWorldDirection(fwd);
    // NVG lifts the exposure (and the HUD tints green) so the dark reads.
    nvgAmt.current += ((sim.hasAttachment('nvg') ? 1 : 0) - nvgAmt.current) * Math.min(1, dt * 8);
    gl.toneMappingExposure = 1.32 + nvgAmt.current * 1.7; // brighter base; NVG lifts further
    // Optic deepens the ADS zoom (narrower FOV); no optic = a gentler aim zoom.
    const fovTarget = THREE.MathUtils.lerp(55, sim.hasAttachment('optic') ? 30 : 45, adsCur.current);
    if (Math.abs(cam.fov - fovTarget) > 0.02) { cam.fov = fovTarget; cam.updateProjectionMatrix(); }
    // Flashlight: a forward cone from the muzzle line.
    flashLight.intensity += ((sim.hasAttachment('light') ? 7 : 0) - flashLight.intensity) * Math.min(1, dt * 10);
    flashLight.position.copy(cam.position);
    flashLight.target.position.copy(tmp.copy(cam.position).addScaledVector(fwd, 10));
    flashLight.target.updateMatrixWorld();
    // Laser: a red line from the barrel to the first thing the aim ray meets.
    if (sim.hasAttachment('laser')) {
      const mp = muzzleLocal.getWorldPosition(tmp);
      const o: Vec3 = [mp.x, mp.y, mp.z], d: Vec3 = [fwd.x, fwd.y, fwd.z];
      let t = 50;
      for (const c of COLLIDERS) { const tc = rayAABB(o, d, aabbOfCover(c)); if (tc !== null && tc < t) t = tc; }
      if (fwd.y < -1e-3) { const tf = -mp.y / fwd.y; if (tf > 0 && tf < t) t = tf; } // floor
      tmp2.copy(mp).addScaledVector(fwd, t);
      const pa = laserLine.geometry.attributes.position as THREE.BufferAttribute;
      pa.setXYZ(0, mp.x, mp.y, mp.z); pa.setXYZ(1, tmp2.x, tmp2.y, tmp2.z); pa.needsUpdate = true;
      laserDot.position.copy(tmp2);
      laserLine.visible = true; laserDot.visible = true;
    } else { laserLine.visible = false; laserDot.visible = false; }

    // ── Fire input → sim ──
    if (ct.reload) { wantReload.current = true; ct.reload = false; }
    if (cycleFireMode.current || ct.fireMode) {
      cycleFireMode.current = false; ct.fireMode = false;
      sim.cycleFireMode();
      audio.reloadEnd(); // a crisp mechanical click on the selector
    }
    if (wantSlot.current !== null) { sim.switchGun(wantSlot.current); wantSlot.current = null; }
    if (wantSwap.current || ct.swap) { wantSwap.current = false; ct.swap = false; sim.nextWeapon(); }
    if (wantToggle.current || ct.toggle) { sim.toggleAttachment(wantToggle.current ?? ct.toggle!); wantToggle.current = null; ct.toggle = null; }
    cam.getWorldDirection(fwd);
    const input: FpsInput = {
      firing: held('Space') || mouseBtn.current.has(0) || ct.fire,
      wantReload: wantReload.current,
      origin: [cam.position.x, cam.position.y, cam.position.z] as Vec3,
      dir: [fwd.x, fwd.y, fwd.z] as Vec3,
      adsFactor: adsCur.current,
      moving,
      crouched: crouchCur.current > 0.5,
    };
    wantReload.current = false;
    sim.step(dt, input);

    // ── Consume events → VFX / HUD ──
    const now = sim.time;
    for (const ev of sim.drain()) {
      if (ev.kind === 'fire') {
        // muzzle flash + light + recoil kick
        muzzleLocal.getWorldPosition(tmp2);
        if (muzzleLight.current) { muzzleLight.current.position.copy(tmp2); muzzleLight.current.intensity = feel.lightIntensity; }
        if (flashRef.current) { flashRef.current.position.copy(tmp2); flashRef.current.visible = true; flashRef.current.scale.setScalar(0.18 * feel.flashScale * (0.8 + Math.random() * 0.5)); }
        flashUntil.current = now + 0.045;
        const kick = 0.02 * feel.kick * (1 - 0.4 * adsCur.current);
        recoilP.current += kick;
        recoilY.current += (Math.random() - 0.5) * kick * 0.5;
        audio.shot(feel.audio);
      } else if (ev.kind === 'hit' || ev.kind === 'wall' || ev.kind === 'miss') {
        muzzleLocal.getWorldPosition(tmp2);
        spawnBeam(tmp2, ev.point, false);                       // your tracer line, restored
        spawnImpact(ev.point, ev.kind === 'hit');
        if (ev.kind === 'hit') {
          audio.impact('flesh', ev.point);
          audio.hitmarker(ev.killed);
          flashHit(ev.enemyId, ev.killed);
          flashHitmarker(ev.killed);
          if (ev.killed) addXp(xpForKill(ev.part)); // earn loop: XP per kill
        } else if (ev.kind === 'wall') {
          audio.impact('wall', ev.point);
        }
      } else if (ev.kind === 'attachment') {
        audio.reloadEnd();          // a soft toggle click
      } else if (ev.kind === 'weaponSwitch') {
        swapRaise.current = 1;      // the new weapon dips in from below
        audio.reloadEnd();          // a mechanical rack/click
      } else if (ev.kind === 'reloadStart') {
        audio.reloadStart();
      } else if (ev.kind === 'reloadEnd') {
        audio.reloadEnd();
      } else if (ev.kind === 'empty') {
        audio.empty();
      } else if (ev.kind === 'enemyFire') {
        // BRIGHT muzzle flash at the shooter — the clearly-visible "they fired" cue
        const fi = eFlashHead.current = (eFlashHead.current + 1) % EFLASH;
        const fm = eFlashRefs.current[fi];
        if (fm) { fm.position.set(ev.from[0], ev.from[1], ev.from[2]); fm.visible = true; fm.scale.setScalar(0.26 * (0.85 + Math.random() * 0.5)); eFlashUntil.current[fi] = now + 0.06; }
        if (eLight.current) { eLight.current.position.set(ev.from[0], ev.from[1], ev.from[2]); eLight.current.intensity = 7; }
        const shooter = sim.getEnemies().findIndex((en) => en.id === ev.enemyId);
        if (shooter >= 0) rigApis.current[shooter]?.playOnce('fire'); // recoil the rifle
        // The sim traced this round from their barrel to whatever it struck —
        // your head, your leg, a crate. Fly it exactly along that ray.
        const from = tmp2.set(ev.from[0], ev.from[1], ev.from[2]);
        spawnBeam(from, ev.impact, true);              // the line from their gun to you
        spawnBullet(from, ev.impact, ev.hit, true);    // and the round travelling down it
        audio.enemyShot(ev.from); // spatialised: you hear the direction
      } else if (ev.kind === 'playerHit') {
        // A round landing should MOVE you: the head snaps, the view rolls, and
        // you're shoved off the axis you were shot from.
        // A rifle round is not a tap. Head snaps hard, torso rocks you, a limb
        // stings. The view kicks, rolls, AND you get physically shoved.
        // A clear nudge that tells you the direction, NOT a disorienting throw.
        // Capped so a burst can't stack into chaos.
        const partKick = ev.part === 'head' ? 1.6 : ev.part === 'torso' ? 1.0 : 0.6;
        const k = (0.02 + ev.damage * 0.0015) * partKick;
        staggerP.current = Math.min(0.05, staggerP.current + k);                          // small head bump
        staggerY.current += (ev.fromDir[0] >= 0 ? -1 : 1) * k * 0.5;
        staggerY.current = Math.max(-0.05, Math.min(0.05, staggerY.current));
        shake.current = Math.min(0.05, shake.current + k * 0.6);
        shoveX.current = Math.max(-0.10, Math.min(0.10, shoveX.current - ev.fromDir[0] * k * 0.8));
        shoveZ.current = Math.max(-0.10, Math.min(0.10, shoveZ.current - ev.fromDir[2] * k * 0.8));
        vignetteHit.current = Math.min(0.7, vignetteHit.current + 0.28 * partKick);
        audio.hurt();
        vignetteHit.current = 1;
        showHitDir(ev.fromDir);
      } else if (ev.kind === 'playerDown') {
        downAt.current = now;
        if (hud.current.down) hud.current.down.style.opacity = '1';
      } else if (ev.kind === 'bossPhase') {
        // The boss just escalated: pulse it, jolt the view, and let Valor mark it.
        bossFlash.current = 1;
        shake.current = Math.min(0.05, shake.current + 0.028);
        say(ev.phase >= 3 ? 'bossEnrage' : 'bossEscalate');
      }
    }

    // ── Decay pooled VFX ──
    if (flashRef.current && now > flashUntil.current) flashRef.current.visible = false;
    if (muzzleLight.current && muzzleLight.current.intensity > 0) {
      muzzleLight.current.intensity = Math.max(0, muzzleLight.current.intensity - dt * 120);
    }
    for (let i = 0; i < BEAMS; i++) {
      const m = beamRefs.current[i];
      if (m && m.visible && now > beamUntil.current[i]) m.visible = false;
    }
    for (let i = 0; i < BULLETS; i++) {
      const st = bullets.current[i];
      const m = bulletRefs.current[i];
      if (!st.active || !m) continue;
      st.t += dt;
      const u = Math.min(1, st.t / st.dur);
      m.position.lerpVectors(st.from, st.to, u);
      m.lookAt(st.to);
      if (u >= 1) {
        st.active = false;
        m.visible = false;
        spawnImpact([st.to.x, st.to.y, st.to.z], st.hit); // the spark lands with the round
      }
    }
    for (let i = 0; i < IMPACTS; i++) {
      const m = impactRefs.current[i];
      if (m && m.visible) {
        const life = impactUntil.current[i] - now;
        if (life <= 0) m.visible = false;
        else m.scale.setScalar(0.02 + (0.35 - life) * 0.18);
      }
    }
    for (let i = 0; i < EFLASH; i++) {
      const m = eFlashRefs.current[i];
      if (m && m.visible && now > eFlashUntil.current[i]) m.visible = false;
    }
    if (eLight.current && eLight.current.intensity > 0) {
      eLight.current.intensity = Math.max(0, eLight.current.intensity - dt * 90);
    }

    // ── Dummies: pose from snapshot (upright / falling), hit flash ──
    const snap = sim.snapshot();
    for (let i = 0; i < snap.enemies.length; i++) {
      const e = snap.enemies[i];
      const g = dummyRefs.current[i];
      if (!g) continue;
      // Bodies stay upright and un-squashed: the sim's hitboxes are fixed, so
      // moving the mesh for a crouch would break "what you see is what you hit".
      // A survival slot that's been despawned (deadAt < 0) is hidden entirely.
      g.visible = e.alive || e.deadAt >= 0;
      g.position.set(e.x, 0, e.z);
      g.rotation.set(0, e.facing, 0); // face the player
      g.scale.set(1, 1, 1);

      const rig = rigApis.current[i];
      if (rig) {
        if (!e.alive) rig.setClip('death');
        else if (e.ai === 'seek') rig.setClip('run');   // maneuvering to a new angle
        else rig.setClip('idle');                        // rifle shouldered
        // No amber "I'm shooting you" glow: the shouldered rifle, the muzzle flash
        // and the round coming at you ARE the tell. Only a hit still flashes.
        const f = Math.max(0, dummyFlash.current[i] - now);
        if (f > 0) rig.setTint(0xff5a3a, Math.min(0.7, f * 5)); // your round landed
        else if (e.boss) {
          // a boss burns hotter each phase, and pulses on the moment it escalates
          const base = 0.30 + (e.phase - 1) * 0.11;
          rig.setTint(e.phase >= 3 ? 0xff2a1e : 0x6a1414, Math.min(0.75, base + bossFlash.current * 0.35));
        } else rig.setTint(0x000000, 0);
      }
    }

    // ── low-HP heartbeat ──
    if (snap.playerAlive && snap.playerHp <= 35 && now - heartbeatAt.current > 0.45 + (snap.playerHp / 35) * 0.4) {
      audio.heartbeat();
      heartbeatAt.current = now;
    }

    // ── off-screen threat arrows for enemies telegraphing / firing at you ──
    let ai = 0;
    for (const e of snap.enemies) {
      if (ai >= hud.current.arrows.length) break;
      if (!e.alive || (e.ai !== 'aim' && e.ai !== 'fire')) continue;
      arrowWp.set(e.x, 1.4, e.z);
      arrowCs.copy(arrowWp).applyMatrix4(cam.matrixWorldInverse);
      arrowWp.project(cam); // arrowWp is now NDC
      const arrow = computeEdgeArrow({ x: arrowCs.x, y: arrowCs.y, z: arrowCs.z }, { x: arrowWp.x, y: arrowWp.y });
      const el = hud.current.arrows[ai];
      if (arrow && el) {
        el.style.opacity = '1';
        el.style.left = `${arrow.leftPct}%`;
        el.style.top = `${arrow.topPct}%`;
        el.style.transform = `translate(-50%,-50%) rotate(${arrow.deg}deg)`;
        ai++;
      }
    }
    for (let j = ai; j < hud.current.arrows.length; j++) { const el = hud.current.arrows[j]; if (el) el.style.opacity = '0'; }

    // objective off-screen arrow (cyan — where to go)
    {
      const oc = OBJECTIVES[objective.current];
      const el = hud.current.objArrow;
      if (el) {
        if (oc && completeAt.current < 0) {
          arrowWp.set(oc.pos[0], 1.4, oc.pos[1]);
          arrowCs.copy(arrowWp).applyMatrix4(cam.matrixWorldInverse);
          arrowWp.project(cam);
          const a = computeEdgeArrow({ x: arrowCs.x, y: arrowCs.y, z: arrowCs.z }, { x: arrowWp.x, y: arrowWp.y });
          if (a) { el.style.opacity = '1'; el.style.left = `${a.leftPct}%`; el.style.top = `${a.topPct}%`; el.style.transform = `translate(-50%,-50%) rotate(${a.deg}deg)`; }
          else el.style.opacity = '0';
        } else el.style.opacity = '0';
      }
    }

    // ── Survival flow: escalating waves from a fixed pool ──
    if (survival) {
      // The wave timer runs on WALL time (like the mission-complete beat), so a
      // slow frame rate doesn't stretch the intermission.
      const wall = performance.now();
      if (!survInit.current) { sim.despawnAll(); survNextAt.current = wall + 3000; survInit.current = true; }
      if (!survOver.current && snap.playerAlive) {
        if (survState.current === 'active') {
          if (sim.aliveCount() === 0) { survState.current = 'intermission'; survNextAt.current = wall + 3200; }
        } else if (wall >= survNextAt.current) {
          survWave.current += 1;
          sim.startWave(survivalWaveCount(survWave.current), survivalWaveHp(survWave.current));
          survState.current = 'active';
        }
      }
      if (!snap.playerAlive && !survOver.current) {
        survOver.current = true;
        if (hud.current.survEnd) {
          hud.current.survEnd.style.opacity = '1';
          hud.current.survEnd.style.pointerEvents = 'auto';
          if (hud.current.survEndText) hud.current.survEndText.textContent =
            `you held ${Math.max(0, survWave.current - 1)} wave${survWave.current === 2 ? '' : 's'} · ${snap.stats.kills} down`;
        }
      }
      if (waypointRef.current) waypointRef.current.visible = false;
      pumpStory(now);
      updateHud(snap);
      return;
    }

    // ── Mission flow (slice 4): breach → clear → advance → extract ──
    const obj = OBJECTIVES[objective.current];
    if (obj && snap.playerAlive && completeAt.current < 0 && now > briefingUntil.current) {
      const done = obj.kind === 'reach'
        ? Math.hypot(pos.current.x - obj.pos[0], pos.current.z - obj.pos[1]) < REACH_RADIUS
        : sim.roomAlive(obj.room ?? 0) === 0;
      if (done) {
        if (obj.activateRoom) sim.setRoomActive(obj.activateRoom, true); // breach wakes the room
        // story beats keyed to the objective just completed
        if (objective.current === 0) say('opBreach');
        else if (objective.current === 1) {
          say('troopsCleared');
          // Valor first answers the channel ONCE in the whole campaign.
          try {
            if (!window.localStorage.getItem('valor_heard')) { say('valorFirstWord'); window.localStorage.setItem('valor_heard', '1'); }
          } catch { say('valorFirstWord'); }
        } else if (objective.current === 2) {
          say(isFinale ? 'valorReveal' : 'opPushIn'); // the finale: he's finally in the room
        }
        objective.current++;
        if (objective.current >= OBJECTIVES.length) {
          completeAt.current = now;
          completeWallAt.current = performance.now();
          addXp(XP_REWARD.MISSION_COMPLETE); // completion bonus on top of the kills
          if (isFinale) { say('zoneClear'); say('zoneClearTag'); } // the payoff lands here, not every op
          else say('missionCleared');
          if (hud.current.complete) hud.current.complete.style.opacity = '1';
        }
      }
    }

    // story beats not tied to an objective, then pump one line at a time.
    // Ember opens only once the briefing card has faded, so they never overlap.
    if (now > briefingUntil.current) say('opStart');
    if (snap.playerAlive && snap.playerHp < 35) say('lowHp');
    if (!snap.playerAlive) say('opHeroDown');
    pumpStory(now);
    // waypoint beacon follows the current objective
    if (waypointRef.current) {
      const cur = OBJECTIVES[objective.current];
      if (cur && completeAt.current < 0) {
        waypointRef.current.visible = true;
        waypointRef.current.position.set(cur.pos[0], 0, cur.pos[1]);
        const beacon = waypointRef.current.children[0] as THREE.Mesh | undefined;
        if (beacon) beacon.rotation.y += dt * 2;
      } else {
        waypointRef.current.visible = false;
      }
    }
    // DOWN or COMPLETE → restart the operation after a beat
    if (!snap.playerAlive && now - downAt.current > 2.2) restartMission();
    // MISSION COMPLETE holds for a beat, then hands off to the debrief interstitial.
    if (completeAt.current > 0 && performance.now() - completeWallAt.current > 2200 && !advanced.current) { advanced.current = true; onComplete(); }

    updateHud(snap);
  });

  // ── helpers bound to refs ──
  /** True if a point (inflated by `pad`) sits inside any wall or crate. */
  function blocked(x: number, z: number, pad: number): boolean {
    for (const c of COLLIDERS) {
      if (Math.abs(x - c.x) < c.w / 2 + pad && Math.abs(z - c.z) < c.d / 2 + pad) return true;
    }
    return false;
  }

  function slideOutOfGeometry(x: number, z: number): { x: number; z: number } {
    let cx = x, cz = z;
    for (const c of COLLIDERS) {
      const hx = c.w / 2 + PLAYER_R, hz = c.d / 2 + PLAYER_R;
      const dx = cx - c.x, dz = cz - c.z;
      if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
        // push out along the smaller penetration axis
        const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
        if (px < pz) cx = c.x + Math.sign(dx || 1) * hx;
        else cz = c.z + Math.sign(dz || 1) * hz;
      }
    }
    return { x: cx, z: cz };
  }

  function clampAndSlide(x: number, z: number): { x: number; z: number } {
    let cx = Math.max(-9.4, Math.min(9.4, x));
    let cz = Math.max(-17.6, Math.min(17.4, z));
    ({ x: cx, z: cz } = slideOutOfGeometry(cx, cz));

    // You cannot walk through people either.
    const rr = PLAYER_R + 0.35;
    for (const e of sim.getEnemies()) {
      if (!e.alive) continue;
      const dx = cx - e.x, dz = cz - e.z;
      const d = Math.hypot(dx, dz);
      if (d < rr && d > 1e-4) { cx = e.x + (dx / d) * rr; cz = e.z + (dz / d) * rr; }
    }
    // being shoved off a body must not shove us into a wall
    ({ x: cx, z: cz } = slideOutOfGeometry(cx, cz));
    return { x: cx, z: cz };
  }

  /** The tracer LINE: muzzle -> impact, held for a beat so you can see it. */
  function spawnBeam(from: THREE.Vector3, to: Vec3, enemyRound: boolean) {
    const i = beamHead.current = (beamHead.current + 1) % BEAMS;
    const m = beamRefs.current[i];
    if (!m) return;
    const b = tmp.set(to[0], to[1], to[2]);
    const len = from.distanceTo(b);
    m.position.copy(from).lerp(b, 0.5);
    m.lookAt(b);
    m.scale.set(enemyRound ? 1.5 : 1, enemyRound ? 1.5 : 1, len);
    (m.material as THREE.MeshBasicMaterial).color.setHex(enemyRound ? 0xff7a44 : 0xffe6a8);
    m.visible = true;
    beamUntil.current[i] = sim.time + (enemyRound ? 0.09 : 0.05);
  }

  /** Launch a visible round from `from` to `to`. It sparks on arrival, not on fire. */
  function spawnBullet(from: THREE.Vector3, to: Vec3, isHit: boolean, enemyRound: boolean) {
    const i = bulletHead.current = (bulletHead.current + 1) % BULLETS;
    const m = bulletRefs.current[i];
    const st = bullets.current[i];
    if (!m) return;
    st.from.copy(from);
    st.to.set(to[0], to[1], to[2]);
    const speed = enemyRound ? ENEMY_BULLET_SPEED : PLAYER_BULLET_SPEED;
    st.dur = Math.max(0.02, st.from.distanceTo(st.to) / speed);
    st.t = 0; st.active = true; st.hit = isHit;
    m.scale.set(enemyRound ? 1.1 : 1, enemyRound ? 1.1 : 1, enemyRound ? 0.8 : 1);
    (m.material as THREE.MeshBasicMaterial).color.setHex(enemyRound ? 0xff6a3a : 0xffe6a8);
    m.position.copy(st.from);
    m.visible = true;
  }

  function spawnImpact(at: Vec3, isHit: boolean) {
    const i = impactHead.current = (impactHead.current + 1) % IMPACTS;
    const m = impactRefs.current[i];
    if (!m) return;
    m.position.set(at[0], at[1], at[2]);
    (m.material as THREE.MeshBasicMaterial).color.set(isHit ? 0xff5533 : 0xdcc6a0);
    m.visible = true;
    m.scale.setScalar(0.05);
    impactUntil.current[i] = sim.time + 0.35;
  }

  function flashHit(enemyId: number, killed = false) {
    const idx = sim.getEnemies().findIndex((e) => e.id === enemyId);
    if (idx >= 0) {
      dummyFlash.current[idx] = sim.time + 0.12;
      // they FLINCH when your round lands (sped up: the raw clip is ~2.4s)
      if (!killed) rigApis.current[idx]?.playOnce('hit', 2.6);
    }
  }

  function flashHitmarker(killed: boolean) {
    const el = hud.current.hit;
    if (!el) return;
    el.style.opacity = '1';
    el.style.color = killed ? '#ff4d3d' : '#ffffff';
    el.style.transform = `translate(-50%,-50%) scale(${killed ? 1.5 : 1})`;
    window.setTimeout(() => { if (el) el.style.opacity = '0'; }, killed ? 220 : 130);
  }

  function updateHud(snap: ReturnType<FpsSim['snapshot']>) {
    const h = hud.current;
    if (h.ammo) {
      h.ammo.textContent = `${snap.ammo} / ${snap.magazine}`;
      h.ammo.style.color = snap.ammo === 0 ? '#ff4d3d' : snap.ammo <= 5 ? '#ffb454' : '#e9edf2';
    }
    if (h.reload && h.reloadBar) {
      if (snap.reloading) {
        h.reload.style.opacity = '1';
        const p = 1 - snap.reloadRemaining / sim.gun.reloadTime;
        h.reloadBar.style.width = `${Math.round(p * 100)}%`;
      } else {
        h.reload.style.opacity = '0';
      }
    }
    if (h.reloadHint) {
      // the prompt hides while reloading, and brightens when you're running low
      if (snap.reloading) h.reloadHint.style.opacity = '0';
      else { h.reloadHint.style.opacity = '1'; h.reloadHint.style.color = snap.ammo <= 5 ? '#ffb454' : '#6f7d8c'; }
    }
    if (h.kills) h.kills.textContent = `KILLS ${snap.stats.kills}   ·   HS ${snap.stats.headshots}`;
    if (h.fireMode) h.fireMode.textContent = snap.fireMode.toUpperCase();
    if (h.weapon) h.weapon.textContent = snap.gunName.toUpperCase();
    if (h.loadout) {
      // two-slot readout: the active weapon's number is bright, the other dim
      h.loadout.innerHTML = snap.loadout.length < 2 ? '' :
        snap.loadout.map((_, i) => `<span style="color:${i === snap.slot ? '#37d0e0' : '#4a5763'}">${i + 1}</span>`).join('<span style="color:#39434d"> · </span>');
    }
    if (h.nvgTint) h.nvgTint.style.opacity = String(nvgAmt.current);
    if (h.scope) h.scope.style.opacity = String(snap.attachments.includes('optic') ? adsCur.current : 0);
    if (h.attachments) {
      // one chip per attachment; lit when active, dim + its key when not
      const on = new Set(snap.attachments);
      h.attachments.innerHTML = ATTACH_CHIPS.map((c) => {
        const active = on.has(c.id);
        return `<span style="font-size:10px;letter-spacing:1px;padding:3px 7px;border-radius:4px;border:1px solid ${active ? c.color : '#2a3440'};background:${active ? c.color + '22' : 'transparent'};color:${active ? c.color : '#4a5763'}">${c.label}<span style="opacity:.55"> ${c.key}</span></span>`;
      }).join('');
    }
    if (h.lock) h.lock.style.opacity = locked.current ? '0' : '1';
    // crosshair gap grows with spread + recoil
    const spread = sim.spreadFor(adsCur.current, false, crouchCur.current > 0.5);
    const gap = 5 + spread * 620 + Math.abs(recoilP.current) * 340;
    const { t, b, l, r } = h.ch;
    if (t) t.style.transform = `translate(-50%, ${-gap - 8}px)`;
    if (b) b.style.transform = `translate(-50%, ${gap}px)`;
    if (l) l.style.transform = `translate(${-gap - 8}px, -50%)`;
    if (r) r.style.transform = `translate(${gap}px, -50%)`;

    // health bar + damage vignette (red flash on hit, and a base tint when low)
    if (h.healthFill) {
      const frac = Math.max(0, snap.playerHp / snap.maxPlayerHp);
      h.healthFill.style.width = `${frac * 100}%`;
      h.healthFill.style.background = frac > 0.5 ? '#5fd08a' : frac > 0.25 ? '#ffb454' : '#ff4d3d';
    }
    if (h.vignette) {
      const lowHp = 1 - Math.min(1, snap.playerHp / 35);
      h.vignette.style.opacity = String(Math.min(0.85, Math.max(vignetteHit.current, lowHp * 0.5)));
    }

    // mission HUD: current objective + distance, and the briefing fade
    const objN = OBJECTIVES[objective.current];
    if (h.objText) {
      if (survival) {
        // wave banner: count up between waves, "left" while fighting
        if (survOver.current) h.objText.style.opacity = '0';
        else if (survState.current === 'active') {
          h.objText.style.opacity = '1';
          h.objText.textContent = `WAVE ${survWave.current}  ·  ${snap.aliveCount} LEFT`;
        } else {
          h.objText.style.opacity = '1';
          const t = Math.max(0, Math.ceil((survNextAt.current - performance.now()) / 1000));
          h.objText.textContent = survWave.current === 0 ? `FIRST WAVE IN ${t}` : `WAVE ${survWave.current + 1} IN ${t}`;
        }
      } else if (objN && completeAt.current < 0 && sim.time > briefingUntil.current - 0.5) {
        const d = Math.round(Math.hypot(pos.current.x - objN.pos[0], pos.current.z - objN.pos[1]));
        h.objText.style.opacity = '1';
        h.objText.textContent = `OBJECTIVE  ·  ${objN.text}  ·  ${d}m`;
      } else {
        h.objText.style.opacity = '0';
      }
    }
    if (h.briefing) h.briefing.style.opacity = String(Math.max(0, Math.min(1, briefingUntil.current - sim.time)));

    // boss health bar (top-centre) — only while a boss is alive on a boss op
    if (h.bossWrap && h.bossFill && h.bossName) {
      const boss = mission.boss ? snap.enemies.find((e) => e.boss && e.alive) : undefined;
      if (boss) {
        h.bossWrap.style.opacity = '1';
        // name + phase pips (I / II / III) so the escalation reads on the HUD
        h.bossName.textContent = `${mission.name}${boss.phase >= 2 ? '  ·  ' + (['', '', 'II', 'III'][boss.phase] ?? '') : ''}`;
        h.bossFill.style.width = `${Math.max(0, Math.round((boss.hp / boss.maxHp) * 100))}%`;
        // a hotter bar as it enrages, and a glow pulse on the moment it escalates
        h.bossFill.style.background = boss.phase >= 3 ? 'linear-gradient(90deg,#ff2a1e,#ff6a3d)' : 'linear-gradient(90deg,#ff4d3d,#e0455a)';
        h.bossWrap.style.filter = bossFlash.current > 0.02 ? `drop-shadow(0 0 ${Math.round(10 * bossFlash.current)}px #ff3020)` : 'none';
      } else {
        h.bossWrap.style.opacity = '0';
      }
    }

    // earn loop: rank + progress toward the next 1000 XP
    const rank = rankForXp(careerXp.current);
    const into = xpIntoRank(careerXp.current);
    if (h.rankText) {
      h.rankText.textContent = `${rank.toUpperCase()}  ·  ${into} / ${XP_PER_RANK} XP`;
      h.rankText.style.color = RANK_COLORS[rank];
    }
    if (h.xpBar) {
      h.xpBar.style.width = `${Math.round((into / XP_PER_RANK) * 100)}%`;
      h.xpBar.style.background = RANK_COLORS[rank];
    }
  }

  // ── Earn loop: XP per kill → 1000 → rank up → G$ ──
  function popXp(amount: number) {
    const i = xpPopHead.current = (xpPopHead.current + 1) % XP_POPS;
    const el = hud.current.xpPops[i];
    if (!el) return;
    el.textContent = `+${amount} XP`;
    el.style.transition = 'none';
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, 0)';
    void el.offsetHeight; // reflow so the float replays on rapid kills
    el.style.transition = 'opacity .9s ease-out, transform .9s ease-out';
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -46px)';
  }

  function showRankUp(rank: Rank) {
    audio.reward();
    if (hud.current.rankUpRank) {
      hud.current.rankUpRank.textContent = rank.toUpperCase();
      hud.current.rankUpRank.style.color = RANK_COLORS[rank];
    }
    if (hud.current.rankUpG) hud.current.rankUpG.textContent = `+${gReward(rank)} G$`;
    const el = hud.current.rankUp;
    if (el) {
      el.style.opacity = '1';
      window.setTimeout(() => { if (el) el.style.opacity = '0'; }, 3200);
    }
  }

  function addXp(amount: number) {
    const before = careerXp.current;
    const after = before + amount;
    careerXp.current = after;
    try { window.localStorage.setItem(XP_KEY, String(after)); } catch { /* private mode */ }
    popXp(amount);
    for (const r of rankUpsBetween(before, after)) showRankUp(r);
  }

  // ── Story presence: the fight is where the story arrives, never a menu ──
  /** Queue a trigger's lines. Fires at most once per operation. */
  function say(trigger: PresenceTrigger) {
    if (storyFired.current.has(trigger)) return;
    storyFired.current.add(trigger);
    for (const line of linesFor(trigger)) voQueue.current.push(line);
  }

  /** One line at a time: radio static + subtitle, held long enough to read. */
  function pumpStory(now: number) {
    const h = hud.current;
    // Hold the whole story until a gesture has unlocked audio. Otherwise the
    // opening line is dequeued into silence (autoplay blocked) and never repeats.
    if (!audio.isUnlocked()) return;
    if (voQueue.current.length && now >= voUntil.current) {
      const line = voQueue.current.shift()!;
      audio.vo(line.id, line.speaker);
      const meta = SPEAKER_META[line.speaker];
      if (h.subName) { h.subName.textContent = meta.name; h.subName.style.color = meta.color; }
      if (h.subText) h.subText.textContent = line.text;
      if (h.subWrap) h.subWrap.style.opacity = '1';
      voStartedAt.current = now;
      voCurrentId.current = line.id;
      voUntil.current = now + Math.max(2.8, line.text.length * 0.055); // read-speed guess
    } else if (now >= voUntil.current && h.subWrap) {
      h.subWrap.style.opacity = '0';
      voCurrentId.current = null;
    }
    // Once the recording's real length is known, hold the caption for all of it —
    // the text-length guess cuts Valor off (he speaks slowly).
    const id = voCurrentId.current;
    if (id) {
      const d = audio.voDuration(id);
      if (d) voUntil.current = Math.max(voUntil.current, voStartedAt.current + d + 0.45);
    }
  }

  function restartMission() {
    storyFired.current.clear();
    voQueue.current.length = 0;
    voUntil.current = 0;
    voCurrentId.current = null;
    voStartedAt.current = 0;
    if (hud.current.subWrap) hud.current.subWrap.style.opacity = '0';
    sim.resetEncounter();
    sim.setAllActive(false);
    objective.current = 0;
    briefingUntil.current = sim.time + 3.5;
    completeAt.current = -99;
    advanced.current = false;
    pos.current.set(START[0], EYE_STAND, START[1]);
    yaw.current = 0; pitch.current = 0;
    vignetteHit.current = 0;
    if (hud.current.down) hud.current.down.style.opacity = '0';
    if (hud.current.complete) hud.current.complete.style.opacity = '0';
    staggerP.current = 0; staggerY.current = 0; shake.current = 0;
    shoveX.current = 0; shoveZ.current = 0;
    // survival: clear the field and reset the wave counter for a fresh run
    if (survival) {
      sim.despawnAll();
      survWave.current = 0; survState.current = 'intermission'; survNextAt.current = performance.now() + 3000;
      survOver.current = false; survInit.current = true;
      if (hud.current.survEnd) { hud.current.survEnd.style.opacity = '0'; hud.current.survEnd.style.pointerEvents = 'none'; }
    }
  }

  // Rotate the red damage indicator to point at where the shot came from.
  function showHitDir(fromDir: Vec3) {
    const el = hud.current.hitDir;
    if (!el) return;
    const cy = Math.cos(yaw.current), sy = Math.sin(yaw.current);
    const f = fromDir[0] * -sy + fromDir[2] * -cy; // forward component
    const rr = fromDir[0] * cy + fromDir[2] * -sy; // right component
    el.style.opacity = '1';
    el.style.transform = `rotate(${Math.atan2(rr, f)}rad)`;
    window.setTimeout(() => { if (el) el.style.opacity = '0'; }, 500);
  }

  // ── Render ──
  return (
    <>
      <color attach="background" args={[theme.bg]} />
      <fog attach="fog" args={theme.fog} />

      {/* low ash-lit sun + cold fill, then restrained practicals so darkness has
          shape. Point-light intensity is in physical units: single digits, not tens. */}
      <hemisphereLight args={theme.hemi} />
      <directionalLight
        position={[9, 16, 10]} intensity={theme.sun.intensity} color={theme.sun.color} castShadow
        shadow-mapSize={[lowSpec ? 1024 : 2048, lowSpec ? 1024 : 2048]}
        shadow-camera-left={-22} shadow-camera-right={22}
        shadow-camera-top={22} shadow-camera-bottom={-22}
        shadow-camera-far={70} shadow-bias={-0.0008}
      />
      <directionalLight position={[-10, 7, -12]} intensity={theme.fill.intensity} color={theme.fill.color} />
      <ambientLight intensity={theme.ambient} />
      {/* practicals are ACCENTS, not floodlights: they shape darkness, not expose it */}
      <pointLight position={[0, 2.6, 12]} intensity={theme.practicalIntensity * 0.9} distance={9} decay={2} color={theme.practical} />
      <pointLight position={[0, 2.6, 4]} intensity={theme.practicalIntensity} distance={10} decay={2} color={theme.practical} />
      <pointLight position={[0, 2.6, -4]} intensity={theme.practicalIntensity} distance={10} decay={2} color={theme.practical} />
      <pointLight position={[-3, 2.6, -13]} intensity={theme.practicalIntensity * 0.9} distance={9} decay={2} color={theme.practical} />

      {/* burned ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_W, FLOOR_D]} />
        <meshStandardMaterial {...floorMaps} color={theme.floorTint} roughness={1} metalness={0} />
      </mesh>

      {/* compound walls: brick perimeter, plastered interior dividers */}
      {LEVEL_WALLS.map((c, i) => (
        <mesh key={`w${i}`} position={[c.x, c.h / 2, c.z]} castShadow receiveShadow>
          <boxGeometry args={[c.w, c.h, c.d]} />
          <meshStandardMaterial
            {...(i < 3 ? brickMaps : plasterMaps)}
            color={theme.wallTint}
            roughness={1} metalness={0}
          />
        </mesh>
      ))}

      {/* cover: scorched planking */}
      {LEVEL_COVER.map((c, i) => (
        <mesh key={`c${i}`} position={[c.x, c.h / 2, c.z]} castShadow receiveShadow>
          <boxGeometry args={[c.w, c.h, c.d]} />
          <meshStandardMaterial {...plankMaps} color="#6b6055" roughness={0.95} metalness={0.05} />
        </mesh>
      ))}

      {/* waypoint beacon at the current objective */}
      <group ref={waypointRef}>
        <mesh position={[0, 2.3, 0]}>
          <octahedronGeometry args={[0.34, 0]} />
          <meshBasicMaterial color="#37d0e0" transparent opacity={0.9} />
        </mesh>
        <mesh position={[0, 1.15, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 2.3, 6]} />
          <meshBasicMaterial color="#37d0e0" transparent opacity={0.32} />
        </mesh>
      </group>

      {/* enemies: rifle-carrying operator rigs. Placeholder body, real animation —
          the mesh swaps out without touching clip names or the skeleton. */}
      {ENEMIES.map((e, i) => (
        <group key={i} ref={(g) => { dummyRefs.current[i] = g; }} position={[e.pos[0], 0, e.pos[1]]}>
          <OperatorRig ref={(a) => { rigApis.current[i] = a; }} modelPath={OPERATOR_GLB} />
        </group>
      ))}

      {/* viewmodel */}
      <group ref={vmRef}>
        <primitive object={gunMesh} />
        {/* simple graybox hands so the first person reads */}
        <mesh position={[0.02, -0.03, -0.02]}>
          <boxGeometry args={[0.06, 0.06, 0.14]} />
          <meshStandardMaterial color="#6b5b4d" roughness={0.8} />
        </mesh>
      </group>

      {/* attachments: flashlight cone + laser line/dot (positioned each frame) */}
      <primitive object={flashLight} />
      <primitive object={flashLight.target} />
      <primitive object={laserLine} />
      <primitive object={laserDot} />

      {/* muzzle flash + light */}
      <pointLight ref={muzzleLight} distance={9} decay={2} intensity={0} color="#ffd39a" />
      <mesh ref={flashRef} visible={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#ffdca0" transparent opacity={0.9} />
      </mesh>

      {/* enemy muzzle flashes + shared light */}
      <pointLight ref={eLight} distance={11} decay={2} intensity={0} color="#ffd089" />
      {Array.from({ length: EFLASH }).map((_, i) => (
        <mesh key={i} ref={(m) => { eFlashRefs.current[i] = m; }} visible={false}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color="#ffe08a" transparent opacity={0.95} />
        </mesh>
      ))}

      {/* tracer lines: muzzle -> impact */}
      {Array.from({ length: BEAMS }).map((_, i) => (
        <mesh key={`b${i}`} ref={(m) => { beamRefs.current[i] = m; }} visible={false}>
          <boxGeometry args={[0.02, 0.02, 1]} />
          <meshBasicMaterial color="#ffe6a8" transparent opacity={0.85} />
        </mesh>
      ))}

      {/* bullets in flight: yours warm, theirs hot orange */}
      {Array.from({ length: BULLETS }).map((_, i) => (
        <mesh key={i} ref={(m) => { bulletRefs.current[i] = m; }} visible={false}>
          <boxGeometry args={[0.035, 0.035, 0.6]} />
          <meshBasicMaterial color="#ffe6a8" transparent opacity={0.95} />
        </mesh>
      ))}

      {/* impact pool */}
      {Array.from({ length: IMPACTS }).map((_, i) => (
        <mesh key={i} ref={(m) => { impactRefs.current[i] = m; }} visible={false}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color="#dcc6a0" />
        </mesh>
      ))}

      {/* ── bodycam post: grain, vignette, a chromatic edge, filmic curve ── */}
      <EffectComposer multisampling={0}>
        <Bloom intensity={0.18} luminanceThreshold={0.9} luminanceSmoothing={0.2} mipmapBlur />
        <ChromaticAberration offset={caOffset} radialModulation modulationOffset={0.35} blendFunction={BlendFunction.NORMAL} />
        <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={lowSpec ? 0.2 : 0.3} />
        <Vignette darkness={0.5} offset={0.3} blendFunction={BlendFunction.NORMAL} />
      </EffectComposer>
    </>
  );
}

/**
 * The Operations board (mission select). Soft-gated: every op up to your
 * furthest-unlocked is replayable; the rest are locked. Grouped by zone so the
 * three theatres of the campaign read at a glance.
 */
function MissionSelect({ current, progress, onPick, onSurvival, onClose }: {
  current: number; progress: number; onPick: (i: number) => void; onSurvival: () => void; onClose: () => void;
}) {
  const zones = CAMPAIGN.reduce<Record<string, { m: Mission; i: number }[]>>((acc, m, i) => {
    (acc[m.zone] ??= []).push({ m, i });
    return acc;
  }, {});
  const zoneOrder = Array.from(new Set(CAMPAIGN.map((m) => m.zone)));

  return (
    <div
      style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(3,6,10,.985)', color: '#e9edf2', fontFamily: UI_FONT, cursor: 'auto', pointerEvents: 'auto', overflowY: 'auto', padding: '30px 24px 40px' }}
      onClick={onClose}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 8, color: '#37d0e0' }}>Valor · CAMPAIGN</div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 4 }}>OPERATIONS</div>
          </div>
          <button
            onClick={onClose}
            style={{ pointerEvents: 'auto', cursor: 'pointer', background: 'transparent', border: '1px solid #37d0e0', color: '#37d0e0', fontFamily: 'inherit', fontSize: 13, letterSpacing: 2, padding: '8px 14px', borderRadius: 5 }}
          >
            {iconRow('chevron', 'RESUME', 14)}
          </button>
        </div>

        {zoneOrder.map((zone) => {
          const theme = ZONE_THEMES[zone];
          return (
            <div key={zone} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, letterSpacing: 5, color: theme?.practical ?? '#9fb4c8', marginBottom: 10, borderBottom: `1px solid ${theme?.practical ?? '#2a3440'}55`, paddingBottom: 6 }}>
                {zone}
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {zones[zone].map(({ m, i }) => {
                  const locked = i > progress;
                  const cleared = i < progress;
                  const isCurrent = i === current;
                  const accent = m.boss ? '#e0455a' : '#37d0e0';
                  return (
                    <button
                      key={m.id}
                      disabled={locked}
                      onClick={() => !locked && onPick(i)}
                      style={{
                        pointerEvents: 'auto', textAlign: 'left', font: 'inherit',
                        cursor: locked ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '12px 16px', borderRadius: 7,
                        border: `1px solid ${isCurrent ? accent : locked ? '#1a2028' : '#2a3440'}`,
                        background: locked ? 'rgba(255,255,255,.015)' : isCurrent ? `${accent}14` : 'rgba(255,255,255,.04)',
                        opacity: locked ? 0.45 : 1, color: 'inherit',
                      }}
                    >
                      <div style={{ width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}>
                        <Icon name={locked ? 'lock' : m.boss ? 'alert' : cleared ? 'check' : 'chevron'} size={18} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                          <span style={{ fontSize: 11, letterSpacing: 2, color: '#6f7d8c' }}>OP {i + 1}</span>
                          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1, color: m.boss ? accent : '#e9edf2' }}>{m.name}</span>
                          {m.boss && <span style={{ fontSize: 10, letterSpacing: 2, color: accent, border: `1px solid ${accent}66`, padding: '1px 6px', borderRadius: 3 }}>BOSS</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#9fb4c8', marginTop: 3 }}>{locked ? 'clear the previous operation to unlock' : m.brief}</div>
                      </div>
                      <div style={{ fontSize: 10, letterSpacing: 2, color: isCurrent ? accent : cleared ? '#5fe0a8' : '#6f7d8c' }}>
                        {isCurrent ? 'CURRENT' : cleared ? 'CLEARED' : locked ? 'LOCKED' : 'READY'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Survival — always available, sits apart from the campaign */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, letterSpacing: 5, color: '#ff5a52', marginBottom: 10, borderBottom: '1px solid #ff5a5255', paddingBottom: 6 }}>ENDLESS</div>
          <button
            onClick={onSurvival}
            style={{ pointerEvents: 'auto', textAlign: 'left', font: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '12px 16px', borderRadius: 7, border: '1px solid #ff5a5255', background: 'rgba(255,90,82,.08)', color: 'inherit' }}
          >
            <div style={{ width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff5a52' }}><Icon name="infinity" size={20} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1, color: '#ff8a7a' }}>SURVIVAL</span>
                <span style={{ fontSize: 10, letterSpacing: 2, color: '#ff5a52', border: '1px solid #ff5a5266', padding: '1px 6px', borderRadius: 3 }}>THE KILL-HOUSE</span>
              </div>
              <div style={{ fontSize: 12, color: '#9fb4c8', marginTop: 3 }}>endless waves · every kill still pays XP · how long can you hold?</div>
            </div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: '#ff5a52' }}>OPEN</div>
          </button>
        </div>

        <div style={{ fontSize: 11, color: '#4a5763', letterSpacing: 1, textAlign: 'center', marginTop: 8 }}>
          selecting an operation restarts it from the breach · press M to toggle this board
        </div>
      </div>
    </div>
  );
}

/**
 * The between-mission debrief. After an op is cleared this takes over: it shows
 * the story lead-in for what's next and lets the player DEPLOY into it, RETRY the
 * op they just finished, or EXIT to the Operations board. On the last op it
 * becomes the campaign's ending instead.
 */
function MissionDebrief({ mode, cleared, next, onDeploy, onRetry, onExit }: {
  mode: 'next' | 'finale'; cleared: Mission; next: Mission | null;
  onDeploy: () => void; onRetry: () => void; onExit: () => void;
}) {
  const btn = (color: string): React.CSSProperties => ({
    pointerEvents: 'auto', cursor: 'pointer', background: 'transparent', border: `1px solid ${color}`,
    color, fontFamily: 'inherit', fontSize: 12, letterSpacing: 3, padding: '11px 22px', borderRadius: 5,
  });
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(3,6,10,.97)', color: '#e9edf2', fontFamily: UI_FONT, cursor: 'auto', pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 24px' }}>
      <div style={{ maxWidth: 620, textAlign: 'center' }}>
        {mode === 'finale' ? (
          <>
            <div style={{ fontSize: 13, letterSpacing: 8, color: '#9fb4c8' }}>THE FIRE IS OUT</div>
            <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: 5, margin: '10px 0', color: '#ff5a47' }}>VALOR IS DEAD</div>
            <div style={{ fontSize: 14, color: '#c6b4ae', letterSpacing: 1, lineHeight: 1.6 }}>You walked all the way into the dark and out the other side. The radio is quiet now. Ashfall can begin again.</div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 30 }}>
              <button onClick={onRetry} style={btn('#ff8a7a')}>{iconRow('refresh', 'REPLAY FINALE', 14)}</button>
              <button onClick={onExit} style={btn('#9fb4c8')}>{iconRow('menu', 'OPERATIONS', 14)}</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, letterSpacing: 6, color: '#5fe0a8' }}>{cleared.name} · CLEARED</div>
            <div style={{ width: 60, height: 1, background: '#2a3440', margin: '18px auto' }} />
            <div style={{ fontSize: 12, letterSpacing: 6, color: '#37d0e0' }}>{next?.op}</div>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 3, margin: '8px 0 14px' }}>{next?.name}</div>
            <div style={{ fontSize: 15, color: '#c7d2dc', letterSpacing: 0.3, lineHeight: 1.7 }}>{next?.story ?? next?.brief}</div>
            <div style={{ fontSize: 12, color: '#7f8c99', letterSpacing: 1, marginTop: 12 }}>{next?.brief}</div>
            <div style={{ fontSize: 13, letterSpacing: 3, color: '#9fb4c8', marginTop: 26 }}>ready?</div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 12 }}>
              <button onClick={onDeploy} style={{ ...btn('#37d0e0'), background: 'rgba(55,208,224,.12)', fontWeight: 700 }}>{iconRow('play', 'DEPLOY', 13)}</button>
              <button onClick={onRetry} style={btn('#9fb4c8')}>{iconRow('refresh', 'RETRY', 14)}</button>
              <button onClick={onExit} style={btn('#6f7d8c')}>{iconRow('menu', 'EXIT', 14)}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ValorScene({ onOpCleared, startOnBoard }: {
  /** Fires when a campaign op is cleared — `/fight` uses it to record the real,
   *  server-authoritative reward (XP → rank → G$). Omitted at `/dev/verb`, which
   *  stays a self-contained sandbox. */
  onOpCleared?: (level: number, durationSecs: number) => void;
  /** Open on the Operations board (the campaign entry from the app), so the
   *  player picks an operation instead of dropping straight into one. */
  startOnBoard?: boolean;
} = {}) {
  const hud = useRef<Hud>({
    root: null, ammo: null, fireMode: null, weapon: null, loadout: null, attachments: null, nvgTint: null, scope: null, reload: null, reloadBar: null, reloadHint: null, hit: null,
    ch: { t: null, b: null, l: null, r: null }, lock: null, kills: null,
    healthFill: null, vignette: null, hitDir: null, down: null, arrows: [],
    objText: null, survEnd: null, survEndText: null, objArrow: null, briefing: null, complete: null,
    rankText: null, xpBar: null, xpPops: [], rankUp: null, rankUpRank: null, rankUpG: null,
    subWrap: null, subName: null, subText: null,
    bossWrap: null, bossName: null, bossFill: null,
  });

  // Mobile is a first-class target (Marvy's note): a left move-stick, a right
  // look-pad, and fire/ADS/reload buttons write into this, read by FpsWorld.
  const controls = useRef<Controls>({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, ads: false, reload: false, fireMode: false, swap: false, toggle: null });
  const audio = useMemo(() => new FpsAudio(), []);
  useEffect(() => () => audio.dispose(), [audio]);

  // ── Mission campaign (slice 8): run CAMPAIGN[missionIndex]; complete → next ──
  const [missionIndex, setMissionIndex] = useState(() => {
    try { const v = Number(window.localStorage.getItem(CAMPAIGN_KEY)); if (Number.isFinite(v) && v >= 0 && v < CAMPAIGN.length) return v; } catch { /* private mode */ }
    return 0;
  });
  const [campaignDone, setCampaignDone] = useState(false);
  // How far you've unlocked (soft gating). Seed from stored progress, but never
  // behind the op you were last on, so older saves aren't locked out.
  const [progress, setProgress] = useState(() => {
    try {
      const p = Number(window.localStorage.getItem(PROGRESS_KEY));
      const m = Number(window.localStorage.getItem(CAMPAIGN_KEY));
      return Math.min(CAMPAIGN.length, Math.max(Number.isFinite(p) ? p : 0, Number.isFinite(m) ? m : 0, 0));
    } catch { return 0; }
  });
  const [runNonce, setRunNonce] = useState(0); // bump to remount = restart the op
  const [selectOpen, setSelectOpen] = useState(!!startOnBoard);
  const menuOpenRef = useRef(!!startOnBoard); // read by FpsWorld's frame loop to pause
  const setSelect = (v: boolean) => {
    menuOpenRef.current = v; setSelectOpen(v);
    if (v) { try { document.exitPointerLock?.(); } catch { /* ignore */ } }
  };
  const [mode, setMode] = useState<'campaign' | 'survival'>('campaign');
  const [debrief, setDebrief] = useState<null | 'next' | 'finale'>(null);
  const missionStartWall = useRef(performance.now()); // for the op's clear time
  useEffect(() => { missionStartWall.current = performance.now(); }, [missionIndex, runNonce, mode]);
  const mission = mode === 'survival' ? SURVIVAL_MISSION : CAMPAIGN[Math.min(missionIndex, CAMPAIGN.length - 1)];

  const unlock = (upto: number) => setProgress((pr) => {
    const np = Math.min(CAMPAIGN.length, Math.max(pr, upto));
    try { window.localStorage.setItem(PROGRESS_KEY, String(np)); } catch { /* ignore */ }
    return np;
  });
  const advance = () => {
    unlock(missionIndex + 1); // clearing an op unlocks the next
    if (missionIndex + 1 >= CAMPAIGN.length) { setCampaignDone(true); return; }
    const next = missionIndex + 1;
    try { window.localStorage.setItem(CAMPAIGN_KEY, String(next)); } catch { /* ignore */ }
    setMissionIndex(next);
  };
  const pickMission = (i: number) => {
    if (i < 0 || i >= CAMPAIGN.length || i > progress) return;
    try { window.localStorage.setItem(CAMPAIGN_KEY, String(i)); } catch { /* ignore */ }
    setMode('campaign');
    setCampaignDone(false);
    setSelect(false);
    setMissionIndex(i);
    setRunNonce((n) => n + 1); // force a fresh mount even if it's the same op
  };
  const pickSurvival = () => {
    setMode('survival');
    setCampaignDone(false);
    setDebrief(null);
    setSelect(false);
    setRunNonce((n) => n + 1);
  };

  // ── Between-mission debrief: clear an op → story of the next → deploy/retry/exit ──
  const clearComplete = () => { if (hud.current.complete) hud.current.complete.style.opacity = '0'; };
  const handleComplete = () => {
    unlock(missionIndex + 1); // the next op is unlocked the moment this one is cleared
    // Record the real reward (server-authoritative) for this op, by 1-based level.
    onOpCleared?.(missionIndex + 1, Math.max(1, Math.round((performance.now() - missionStartWall.current) / 1000)));
    const last = missionIndex >= CAMPAIGN.length - 1;
    if (last) setCampaignDone(true);
    setDebrief(last ? 'finale' : 'next');
    menuOpenRef.current = true;                 // freeze the scene behind the debrief
    try { document.exitPointerLock?.(); } catch { /* ignore */ }
  };
  const deployNext = () => {
    const next = Math.min(CAMPAIGN.length - 1, missionIndex + 1);
    try { window.localStorage.setItem(CAMPAIGN_KEY, String(next)); } catch { /* ignore */ }
    clearComplete(); setDebrief(null); menuOpenRef.current = false;
    setMissionIndex(next); setRunNonce((n) => n + 1);
  };
  const retryMission = () => {
    clearComplete(); setDebrief(null); menuOpenRef.current = false;
    setRunNonce((n) => n + 1); // remount the same op fresh
  };
  const exitHome = () => {
    clearComplete(); setCampaignDone(false); setDebrief(null);
    setSelect(true); // straight to the Operations board (stays paused)
  };
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__valorCampaign = () => ({ index: missionIndex, total: CAMPAIGN.length, name: mission.name, zone: mission.zone, done: campaignDone, progress, selectOpen });
    w.__valorNextMission = () => advance();
    w.__valorResetCampaign = () => {
      try { window.localStorage.removeItem(CAMPAIGN_KEY); window.localStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
      setCampaignDone(false); setSelect(false); setProgress(0); setMissionIndex(0); setRunNonce((n) => n + 1);
    };
    w.__valorOpenSelect = (v = true) => setSelect(!!v);
    w.__valorPickMission = (i: number) => pickMission(i);
    w.__valorSurvival = () => pickSurvival();
    w.__valorProgress = () => progress;
    return () => {
      delete w.__valorCampaign; delete w.__valorNextMission; delete w.__valorResetCampaign;
      delete w.__valorOpenSelect; delete w.__valorPickMission; delete w.__valorSurvival; delete w.__valorProgress;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionIndex, campaignDone, progress, selectOpen]);

  // M toggles the Operations board (Esc closes it). Kept at the page level so it
  // works even while the pointer is unlocked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyM') { e.preventDefault(); setSelect(!menuOpenRef.current); }
      else if (e.code === 'Escape' && menuOpenRef.current) setSelect(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [isTouch] = useState(() =>
    typeof window !== 'undefined' &&
    (('ontouchstart' in window) || navigator.maxTouchPoints > 0 ||
      new URLSearchParams(window.location.search).has('touch')));

  // VALOR is a landscape game. On a phone held upright, block play with a rotate
  // prompt (and try a best-effort orientation lock once we're in landscape).
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    if (!isTouch) return;
    const check = () => setPortrait(window.innerHeight > window.innerWidth);
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => { window.removeEventListener('resize', check); window.removeEventListener('orientationchange', check); };
  }, [isTouch]);
  // Single source of truth for the pause flag: any full-screen overlay freezes play.
  useEffect(() => { menuOpenRef.current = portrait || selectOpen || debrief !== null; }, [portrait, selectOpen, debrief]);

  const JOY_R = 46;
  const joyId = useRef<number | null>(null);
  const joyCenter = useRef({ x: 0, y: 0 });
  const joyKnob = useRef<HTMLDivElement>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });

  const updateJoy = (x: number, y: number) => {
    let dx = x - joyCenter.current.x, dy = y - joyCenter.current.y;
    const len = Math.hypot(dx, dy) || 1;
    if (len > JOY_R) { dx = (dx / len) * JOY_R; dy = (dy / len) * JOY_R; }
    controls.current.moveX = dx / JOY_R;
    controls.current.moveY = -dy / JOY_R; // screen-down = backward
    if (joyKnob.current) joyKnob.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const joyStart = (e: React.TouchEvent) => {
    audio.unlock();
    const t = e.changedTouches[0];
    joyId.current = t.identifier;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    joyCenter.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    updateJoy(t.clientX, t.clientY);
  };
  const joyMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === joyId.current) updateJoy(t.clientX, t.clientY);
  };
  const joyEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === joyId.current) {
      joyId.current = null;
      controls.current.moveX = 0; controls.current.moveY = 0;
      if (joyKnob.current) joyKnob.current.style.transform = 'translate(0,0)';
    }
  };
  const lookStart = (e: React.TouchEvent) => {
    audio.unlock();
    const t = e.changedTouches[0];
    lookId.current = t.identifier;
    lookLast.current = { x: t.clientX, y: t.clientY };
  };
  const lookMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId.current) {
      controls.current.lookX += t.clientX - lookLast.current.x;
      controls.current.lookY += t.clientY - lookLast.current.y;
      lookLast.current = { x: t.clientX, y: t.clientY };
    }
  };
  const lookEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId.current) lookId.current = null;
  };

  // The fire button doubles as an aim pad: press to shoot, and SLIDE your thumb to
  // steer the crosshair (with aim-assist doing the fine lock). Target and shoot in
  // one thumb — no need to aim on one side and fire on the other.
  const fireId = useRef<number | null>(null);
  const fireLast = useRef({ x: 0, y: 0 });
  const fireStart = (e: React.TouchEvent) => {
    audio.unlock();
    const t = e.changedTouches[0];
    fireId.current = t.identifier;
    fireLast.current = { x: t.clientX, y: t.clientY };
    controls.current.fire = true;
  };
  const fireMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === fireId.current) {
      controls.current.lookX += t.clientX - fireLast.current.x;
      controls.current.lookY += t.clientY - fireLast.current.y;
      fireLast.current = { x: t.clientX, y: t.clientY };
    }
  };
  const fireEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === fireId.current) {
      fireId.current = null;
      controls.current.fire = false;
    }
  };

  const tick = 'position:absolute;left:50%;top:50%;background:#e9edf2;box-shadow:0 0 2px #000;';
  return (
    <div ref={(r) => { hud.current.root = r; }} style={{ position: 'fixed', inset: 0, background: '#000', cursor: 'none', touchAction: 'none' }}>
      {/* The RENDERER owns the filmic curve (R3F's ACES default). The composer
          must NOT tone-map again, or the image washes out. */}
      <Canvas
        shadows
        gl={{ antialias: false }}
        camera={{ position: [mission.start[0], 1.6, mission.start[1]], fov: 55, near: 0.01, far: 320 }}
      >
        <Suspense fallback={null}>
          <FpsWorld key={`${mode}-${missionIndex}-${runNonce}`} hud={hud} controls={controls} audio={audio} lowSpec={isTouch} mission={mission} onComplete={handleComplete} pausedRef={menuOpenRef} />
        </Suspense>
      </Canvas>

      {/* ── HUD overlay ── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: UI_FONT, color: '#e9edf2', userSelect: 'none' }}>
        {/* crosshair */}
        <div ref={(r) => { hud.current.ch.t = r; }} style={{ ...s(tick), width: 2, height: 8, transform: 'translate(-50%,-16px)' }} />
        <div ref={(r) => { hud.current.ch.b = r; }} style={{ ...s(tick), width: 2, height: 8, transform: 'translate(-50%,8px)' }} />
        <div ref={(r) => { hud.current.ch.l = r; }} style={{ ...s(tick), width: 8, height: 2, transform: 'translate(-16px,-50%)' }} />
        <div ref={(r) => { hud.current.ch.r = r; }} style={{ ...s(tick), width: 8, height: 2, transform: 'translate(8px,-50%)' }} />
        <div style={{ ...s(tick), width: 2, height: 2, transform: 'translate(-50%,-50%)' }} />

        {/* hitmarker */}
        <div ref={(r) => { hud.current.hit = r; }} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontSize: 26, fontWeight: 700, opacity: 0, transition: 'opacity .08s', textShadow: '0 0 3px #000' }}>✕</div>

        {/* ammo + weapon + reload (lifted clear of the thumb cluster on touch) */}
        <div style={{ position: 'absolute', right: 26, textAlign: 'right', ...(isTouch ? { top: 78 } : { bottom: 22 }) }}>
          <div ref={(r) => { hud.current.weapon = r; }} style={{ fontSize: 13, letterSpacing: 2, fontWeight: 700, color: '#e9edf2', marginBottom: 1 }}>ASSAULT RIFLE</div>
          <div ref={(r) => { hud.current.loadout = r; }} style={{ fontSize: 10, letterSpacing: 2, color: '#6f7d8c', marginBottom: 3 }}>1 · 2</div>
          <div ref={(r) => { hud.current.fireMode = r; }} style={{ fontSize: 12, letterSpacing: 3, fontWeight: 700, color: '#8fb8d0', marginBottom: 2 }}>AUTO</div>
          <div ref={(r) => { hud.current.ammo = r; }} style={{ fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>24 / 24</div>
          <div ref={(r) => { hud.current.reload = r; }} style={{ opacity: 0, marginTop: 4, fontSize: 12, color: '#ffb454' }}>
            RELOADING
            <div style={{ width: 120, height: 3, background: '#333', marginTop: 3, marginLeft: 'auto' }}>
              <div ref={(r) => { hud.current.reloadBar = r; }} style={{ width: '0%', height: '100%', background: '#ffb454' }} />
            </div>
          </div>
          <div ref={(r) => { hud.current.reloadHint = r; }} style={{ marginTop: 4, fontSize: 11, letterSpacing: 1, color: '#6f7d8c' }}>{isTouch ? 'TAP TO RELOAD' : 'PRESS [R] TO RELOAD'}</div>
        </div>

        {/* attachment strip (toggleable kit) */}
        <div ref={(r) => { hud.current.attachments = r; }} style={{ position: 'absolute', right: 26, bottom: 150, display: isTouch ? 'none' : 'flex', gap: 6, justifyContent: 'flex-end' }} />

        {/* kills */}
        <div ref={(r) => { hud.current.kills = r; }} style={{ position: 'absolute', left: 26, bottom: 22, fontSize: 13, color: '#9fb4c8' }}>KILLS 0   ·   HS 0</div>

        {/* rank + XP toward the next 1000 (the earn loop) */}
        <div style={{ position: 'absolute', left: 26, bottom: 48, width: 210 }}>
          <div ref={(r) => { hud.current.rankText = r; }} style={{ fontSize: 12, letterSpacing: 1.5, fontWeight: 700, color: '#cd7f32' }}>BRONZE · 0 / 1000 XP</div>
          <div style={{ width: 210, height: 4, background: '#2b3138', marginTop: 4, borderRadius: 2 }}>
            <div ref={(r) => { hud.current.xpBar = r; }} style={{ width: '0%', height: '100%', background: '#cd7f32', borderRadius: 2 }} />
          </div>
        </div>

        {/* floating +XP on each kill */}
        {Array.from({ length: XP_POPS }).map((_, i) => (
          <div key={i} ref={(r) => { hud.current.xpPops[i] = r; }}
            style={{ position: 'absolute', left: `calc(50% + ${(i - 1.5) * 30}px)`, top: '57%', transform: 'translate(-50%,0)', opacity: 0, fontSize: 15, fontWeight: 700, color: '#5fe0a8', textShadow: '0 0 6px #000', pointerEvents: 'none' }}>+0 XP</div>
        ))}

        {/* radio subtitle — the story arrives over the fight, never in a menu */}
        <div ref={(r) => { hud.current.subWrap = r; }} style={{ position: 'absolute', left: '50%', bottom: 104, transform: 'translateX(-50%)', maxWidth: '64%', textAlign: 'center', opacity: 0, transition: 'opacity .25s', pointerEvents: 'none' }}>
          <div ref={(r) => { hud.current.subName = r; }} style={{ fontSize: 11, letterSpacing: 3, fontWeight: 700, color: '#ffb38a', marginBottom: 5 }}>EMBER</div>
          <div ref={(r) => { hud.current.subText = r; }} style={{ fontSize: 15, lineHeight: 1.55, color: '#e9edf2', textShadow: '0 0 8px #000' }} />
        </div>

        {/* RANK UP beat */}
        <div ref={(r) => { hud.current.rankUp = r; }} style={{ position: 'absolute', left: '50%', top: '28%', transform: 'translate(-50%,-50%)', opacity: 0, transition: 'opacity .4s', pointerEvents: 'none', textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: 6, color: '#9fb4c8' }}>RANK UP</div>
          <div ref={(r) => { hud.current.rankUpRank = r; }} style={{ fontSize: 38, fontWeight: 800, letterSpacing: 4, margin: '4px 0' }}>SILVER</div>
          <div ref={(r) => { hud.current.rankUpG = r; }} style={{ fontSize: 16, fontWeight: 700, color: '#5fe0a8' }}>+20 G$</div>
        </div>

        {/* health bar */}
        <div style={{ position: 'absolute', left: 26, bottom: 46, width: 220, height: 9, background: 'rgba(0,0,0,.55)', border: '1px solid rgba(255,255,255,.15)' }}>
          <div ref={(r) => { hud.current.healthFill = r; }} style={{ width: '100%', height: '100%', background: '#5fd08a', transition: 'width .12s, background .2s' }} />
        </div>

        {/* damage vignette (red edges on hit / when low) */}
        <div ref={(r) => { hud.current.vignette = r; }} style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 150px 44px rgba(200,20,10,.85)', transition: 'opacity .09s' }} />

        {/* NVG green wash (opacity tracks the night-vision blend) */}
        <div ref={(r) => { hud.current.nvgTint = r; }} style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(70,255,150,.16) 0%, rgba(10,40,20,.34) 78%, rgba(2,12,6,.62) 100%)', mixBlendMode: 'screen' }} />

        {/* optic scope mask (only while aiming with an optic fitted) */}
        <div ref={(r) => { hud.current.scope = r; }} style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 0 2000px rgba(0,0,0,0)', background: 'radial-gradient(circle at center, transparent 30%, rgba(0,0,0,.55) 33%, #000 40%)' }} />

        {/* directional damage indicator */}
        <div ref={(r) => { hud.current.hitDir = r; }} style={{ position: 'absolute', left: '50%', top: '50%', width: 64, height: 300, marginLeft: -32, marginTop: -150, opacity: 0, pointerEvents: 'none', transformOrigin: '50% 50%', background: 'linear-gradient(to top, transparent 62%, rgba(255,64,44,.9) 100%)', transition: 'opacity .1s' }} />

        {/* off-screen threat arrows */}
        {[0, 1, 2, 3].map((i) => (
          <div key={i} ref={(r) => { hud.current.arrows[i] = r; }} style={{ position: 'absolute', opacity: 0, color: '#ff5a3a', fontSize: 24, pointerEvents: 'none', textShadow: '0 0 5px #000', transition: 'opacity .12s' }}>▲</div>
        ))}

        {/* DOWN */}
        <div ref={(r) => { hud.current.down = r; }} style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(24,0,0,.5)', color: '#ff5a47', fontSize: 46, fontWeight: 800, letterSpacing: 8 }}>DOWN</div>

        {/* objective banner (top-centre) */}
        <div ref={(r) => { hud.current.objText = r; }} style={{ position: 'absolute', left: '50%', top: 66, transform: 'translateX(-50%)', fontSize: 14, letterSpacing: 2, color: '#37d0e0', textShadow: '0 0 6px #000', opacity: 0, whiteSpace: 'nowrap' }}>OBJECTIVE</div>

        {/* boss health bar */}
        <div ref={(r) => { hud.current.bossWrap = r; }} style={{ position: 'absolute', left: '50%', top: 96, transform: 'translateX(-50%)', width: 360, opacity: 0, transition: 'opacity .3s', textAlign: 'center' }}>
          <div ref={(r) => { hud.current.bossName = r; }} style={{ fontSize: 13, letterSpacing: 4, fontWeight: 700, color: '#e0455a', textShadow: '0 0 6px #000', marginBottom: 4 }}>VALOR</div>
          <div style={{ width: 360, height: 6, background: '#2a1114', border: '1px solid rgba(224,69,90,.4)' }}>
            <div ref={(r) => { hud.current.bossFill = r; }} style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg,#ff4d3d,#e0455a)' }} />
          </div>
        </div>

        {/* objective off-screen arrow (cyan) */}
        <div ref={(r) => { hud.current.objArrow = r; }} style={{ position: 'absolute', opacity: 0, color: '#37d0e0', fontSize: 24, pointerEvents: 'none', textShadow: '0 0 6px #000', transition: 'opacity .12s' }}>▲</div>

        {/* briefing */}
        <div ref={(r) => { hud.current.briefing = r; }} style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(6,10,14,.72)', color: '#e9edf2', textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: 6, color: '#37d0e0' }}>{mission.op}</div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 3, margin: '10px 0' }}>{mission.name}</div>
          <div style={{ fontSize: 13, color: '#9fb4c8', letterSpacing: 1 }}>{mission.brief}</div>
        </div>

        {/* mission complete */}
        <div ref={(r) => { hud.current.complete = r; }} style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,12,10,.6)', color: '#5fe0a8', fontSize: 40, fontWeight: 800, letterSpacing: 6 }}>MISSION COMPLETE</div>

        {/* survival: run-over summary */}
        <div ref={(r) => { hud.current.survEnd = r; }} style={{ position: 'absolute', inset: 0, zIndex: 40, opacity: 0, pointerEvents: 'none', transition: 'opacity .4s', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(16,2,2,.92)', color: '#ff8a7a', textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: 8, color: '#c98' }}>THE KILL-HOUSE</div>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 4, margin: '8px 0', color: '#ff5a47' }}>OVERRUN</div>
          <div ref={(r) => { hud.current.survEndText = r; }} style={{ fontSize: 14, color: '#e6c2bc', letterSpacing: 1 }}>you held 0 waves</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
            <button onClick={() => { if (hud.current.survEnd) { hud.current.survEnd.style.opacity = '0'; hud.current.survEnd.style.pointerEvents = 'none'; } setRunNonce((n) => n + 1); }} style={{ pointerEvents: 'auto', cursor: 'pointer', background: 'transparent', border: '1px solid #ff8a7a', color: '#ff8a7a', fontFamily: 'inherit', fontSize: 13, letterSpacing: 3, padding: '10px 20px', borderRadius: 5 }}>{iconRow('refresh', 'AGAIN', 14)}</button>
            <button onClick={() => { if (hud.current.survEnd) { hud.current.survEnd.style.opacity = '0'; hud.current.survEnd.style.pointerEvents = 'none'; } setSelect(true); }} style={{ pointerEvents: 'auto', cursor: 'pointer', background: 'transparent', border: '1px solid #9fb4c8', color: '#9fb4c8', fontFamily: 'inherit', fontSize: 13, letterSpacing: 3, padding: '10px 20px', borderRadius: 5 }}>{iconRow('menu', 'OPERATIONS', 14)}</button>
          </div>
        </div>
        {debrief && !selectOpen && (
          <MissionDebrief
            mode={debrief}
            cleared={CAMPAIGN[Math.min(missionIndex, CAMPAIGN.length - 1)]}
            next={debrief === 'next' ? CAMPAIGN[missionIndex + 1] : null}
            onDeploy={deployNext}
            onRetry={retryMission}
            onExit={exitHome}
          />
        )}

        {selectOpen && (
          <MissionSelect current={mode === 'survival' ? -1 : missionIndex} progress={progress} onPick={pickMission} onSurvival={pickSurvival} onClose={() => setSelect(false)} />
        )}

        {/* slice label + an entry point to the Operations board */}
        <div style={{ position: 'absolute', left: 26, top: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, letterSpacing: 2, color: '#6f7d8c' }}>{mode === 'survival' ? 'Valor · SURVIVAL · THE KILL-HOUSE' : `Valor · ${mission.zone} · OP ${missionIndex + 1}/${CAMPAIGN.length}`}</span>
          <button
            onClick={() => setSelect(true)}
            style={{ pointerEvents: 'auto', cursor: 'pointer', background: 'rgba(55,208,224,.1)', border: '1px solid #37d0e055', color: '#37d0e0', fontFamily: 'inherit', fontSize: 12, letterSpacing: 2, padding: '4px 9px', borderRadius: 4 }}
          >
            {iconRow('menu', `OPS${!isTouch ? ' · M' : ''}`, 12)}
          </button>
        </div>
        {!isTouch && (
          <div style={{ position: 'absolute', right: 26, top: 20, fontSize: 11, lineHeight: 1.7, textAlign: 'right', color: '#6f7d8c' }}>
            WASD move · MOUSE / ARROWS look<br />SPACE fire · SHIFT ads · Q/E lean · C crouch · R reload · B fire-mode<br />1 / 2 or X swap weapon · N nvg · F light · L laser · O optic · M ops
          </div>
        )}

        {/* aim hint — desktop only (mobile has visible controls) */}
        {!isTouch && (
          <div ref={(r) => { hud.current.lock = r; }} style={{ position: 'absolute', left: '50%', top: '44%', transform: 'translate(-50%,0)', fontSize: 13, color: '#9fb4c8', background: 'rgba(0,0,0,.45)', padding: '8px 14px', borderRadius: 6 }}>
            AIM UP/DOWN: move the mouse (captures on your first keypress) · or use the ARROW KEYS · Esc releases the mouse
          </div>
        )}
      </div>

      {/* ── Mobile touch controls — glassy, tucked to the corners ── */}
      {isTouch && !selectOpen && !portrait && (
        <>
          {/* right thumb: drag to aim (aim-assist does the fine targeting) */}
          <div onTouchStart={lookStart} onTouchMove={lookMove} onTouchEnd={lookEnd} onTouchCancel={lookEnd}
            style={{ position: 'absolute', right: 0, top: 52, width: '54%', bottom: 0, touchAction: 'none' }} />

          {/* left thumb: movement stick */}
          <div onTouchStart={joyStart} onTouchMove={joyMove} onTouchEnd={joyEnd} onTouchCancel={joyEnd}
            style={{ ...touchBtn('#cfe0ea', 108), left: 24, bottom: 24, background: 'radial-gradient(circle at 50% 40%, rgba(255,255,255,.10), rgba(6,10,16,.4))', border: '1.5px solid rgba(255,255,255,.22)' }}>
            <div ref={joyKnob} style={{ position: 'absolute', left: '50%', top: '50%', width: 46, height: 46, marginLeft: -23, marginTop: -23, borderRadius: '50%', background: 'radial-gradient(circle at 50% 35%, rgba(255,255,255,.5), rgba(255,255,255,.16))', boxShadow: '0 3px 8px rgba(0,0,0,.5)' }} />
          </div>

          {/* fire (primary) — also an aim pad: press to shoot, slide to steer */}
          <div onTouchStart={fireStart} onTouchMove={fireMove} onTouchEnd={fireEnd} onTouchCancel={fireEnd}
            style={{ ...touchBtn('#ff6a4d', 82, true), right: 24, bottom: 28 }}><Icon name="crosshair" size={34} /></div>
          {/* ADS (hold) */}
          <div onTouchStart={() => { controls.current.ads = true; }} onTouchEnd={() => { controls.current.ads = false; }} onTouchCancel={() => { controls.current.ads = false; }}
            style={{ ...touchBtn('#cfe0ea', 56), right: 116, bottom: 40, fontSize: 11 }}>ADS</div>
          {/* reload */}
          <div onTouchStart={() => { controls.current.reload = true; }}
            style={{ ...touchBtn('#ffb454', 46), right: 36, bottom: 118 }}><Icon name="refresh" size={20} /></div>
          {/* swap weapon */}
          <div onTouchStart={() => { controls.current.swap = true; }}
            style={{ ...touchBtn('#5fe0a8', 46), right: 100, bottom: 124 }}><Icon name="swap" size={20} /></div>
          {/* fire mode */}
          <div onTouchStart={() => { controls.current.fireMode = true; }}
            style={{ ...touchBtn('#8fb8d0', 42), right: 162, bottom: 104 }}><Icon name="firemode" size={18} /></div>

          {/* attachment toggles — a compact row, top-left under OPS */}
          <div style={{ position: 'absolute', left: 24, top: 84, display: 'flex', gap: 7 }}>
            {ATTACH_CHIPS.map((c) => (
              <div key={c.id} onTouchStart={() => { controls.current.toggle = c.id; }}
                style={{ width: 46, height: 30, borderRadius: 8, border: `1px solid ${c.color}77`, background: `linear-gradient(180deg, ${c.color}1f, ${c.color}0a)`, boxShadow: `inset 0 1px 0 ${c.color}33`, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, letterSpacing: 1, fontWeight: 700, color: c.color, touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}>{c.label}</div>
            ))}
          </div>
        </>
      )}

      {/* ── Landscape gate: a phone held upright can't play VALOR ── */}
      {isTouch && portrait && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'radial-gradient(circle at 50% 40%, #0b1018, #05070b)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cfe0ea', textAlign: 'center', fontFamily: UI_FONT, pointerEvents: 'auto' }}>
          <div style={{ color: '#37d0e0', animation: 'none' }}><Icon name="rotate" size={64} /></div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 5, marginTop: 22 }}>ROTATE YOUR DEVICE</div>
          <div style={{ fontSize: 13, color: '#7f8c99', letterSpacing: 3, marginTop: 10 }}>VALOR IS PLAYED IN LANDSCAPE</div>
        </div>
      )}
    </div>
  );
}

function s(css: string): React.CSSProperties {
  const o: Record<string, string> = {};
  for (const rule of css.split(';')) {
    const [key, val] = rule.split(':');
    if (!key || !val) continue;
    const camel = key.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[camel] = val.trim();
  }
  return o as React.CSSProperties;
}
