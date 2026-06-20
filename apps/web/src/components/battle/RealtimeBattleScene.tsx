'use client'

import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'
import { CHARACTER_GLB } from '@/lib/classes'
import type { CharacterClass } from '@/lib/classes'
import type { CombatState } from '@/lib/combat/types'
import { getFighterAnim } from '@/hooks/combat/useFighterState'

// ── Camera: tracks fighters, zooms during attacks ────────────────────────────

function DynamicCamera({ stateRef }: { stateRef: React.RefObject<CombatState> }) {
  const { camera } = useThree()
  const posRef = useRef(new THREE.Vector3(0, 1.1, 3.0))
  const lookRef = useRef(new THREE.Vector3(0, 0.9, 0))

  useFrame((_, delta) => {
    const s = stateRef.current
    if (!s) return
    const playerX = s.player.positionX
    const botX = s.bot.positionX
    const midX = (playerX + botX) / 2
    const spread = Math.abs(botX - playerX)

    const pAtk = s.player.state === 'light_attack' || s.player.state === 'heavy_attack' || s.player.state === 'special'
    const bAtk = s.bot.state === 'light_attack' || s.bot.state === 'heavy_attack' || s.bot.state === 'special'

    let baseZ = 2.4 + Math.max(0, spread - 1.0) * 0.5
    let baseY = 1.0
    let lookY = 0.9

    if (pAtk || bAtk) {
      baseZ -= 0.5
      baseY = 0.85
      lookY = 0.95
    }

    if (s.timeScale < 0.5) {
      baseZ -= 0.3
      baseY = 0.75
    }

    const target = new THREE.Vector3(midX * 0.35, baseY, baseZ)
    const look = new THREE.Vector3(midX * 0.25, lookY, 0)

    const lerpSpeed = Math.min(1, delta * (s.timeScale < 0.5 ? 2 : 6))
    posRef.current.lerp(target, lerpSpeed)
    lookRef.current.lerp(look, lerpSpeed)

    camera.position.copy(posRef.current)
    camera.lookAt(lookRef.current)
  })

  return null
}

// ── Floating particles ───────────────────────────────────────────────────────

function ArenaParticles() {
  const pointsRef = useRef<THREE.Points>(null!)
  const count = 50

  const [positions, velocities] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const vel = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 8
      pos[i * 3 + 1] = Math.random() * 3.5
      pos[i * 3 + 2] = (Math.random() - 0.5) * 5
      vel[i * 3] = (Math.random() - 0.5) * 0.002
      vel[i * 3 + 1] = 0.002 + Math.random() * 0.004
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.001
    }
    return [pos, vel]
  }, [])

  useFrame(() => {
    if (!pointsRef.current) return
    const pos = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < count; i++) {
      pos.array[i * 3] += velocities[i * 3]
      pos.array[i * 3 + 1] += velocities[i * 3 + 1]
      pos.array[i * 3 + 2] += velocities[i * 3 + 2]
      if (pos.array[i * 3 + 1] > 3.5) {
        pos.array[i * 3 + 1] = 0
        pos.array[i * 3] = (Math.random() - 0.5) * 8
      }
    }
    pos.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#a78bfa" size={0.025} transparent opacity={0.35} depthWrite={false} />
    </points>
  )
}

// ── Rotating rune circle ─────────────────────────────────────────────────────

function RuneCircle({ color, side, stateRef }: {
  color: string; side: 'player' | 'bot'; stateRef: React.RefObject<CombatState>
}) {
  const ref = useRef<THREE.Mesh>(null!)

  useFrame((state) => {
    if (!ref.current || !stateRef.current) return
    const fighter = side === 'player' ? stateRef.current.player : stateRef.current.bot
    ref.current.position.x = fighter.positionX
    ref.current.rotation.z = state.clock.elapsedTime * 0.2
  })

  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[0, 0.003, 0]}>
      <ringGeometry args={[0.55, 0.6, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

// ── Arena ─────────────────────────────────────────────────────────────────────

function Arena({ playerColor, botColor, stateRef }: {
  playerColor: string; botColor: string; stateRef: React.RefObject<CombatState>
}) {
  const pColor = useMemo(() => new THREE.Color(playerColor), [playerColor])
  const bColor = useMemo(() => new THREE.Color(botColor), [botColor])

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.005, 0]}>
        <planeGeometry args={[24, 14]} />
        <meshStandardMaterial color="#060410" roughness={0.85} metalness={0.15} />
      </mesh>

      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]}>
        <planeGeometry args={[0.008, 3.5]} />
        <meshBasicMaterial color="#eab308" transparent opacity={0.25} depthWrite={false} />
      </mesh>

      {([-2.8, 2.8] as const).map((x, i) => (
        <mesh key={`edge-${i}`} rotation-x={-Math.PI / 2} position={[x, 0.003, 0]}>
          <planeGeometry args={[0.008, 4]} />
          <meshBasicMaterial color={x < 0 ? pColor : bColor} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}

      <mesh position={[0, 3, -6]}>
        <planeGeometry args={[40, 12]} />
        <meshStandardMaterial color="#020108" roughness={1} metalness={0} />
      </mesh>

      {([-4.5, 4.5] as const).map((x, i) => (
        <group key={`pillar-${i}`} position={[x, 2, -4]}>
          <mesh>
            <boxGeometry args={[0.28, 5, 0.28]} />
            <meshStandardMaterial color="#0d0b1e" roughness={0.9} metalness={0.1} />
          </mesh>
          <pointLight position={[0, -1, 0.3]} intensity={0.6} color={x < 0 ? playerColor : botColor} distance={3} decay={2} />
        </group>
      ))}

      {([-3, 3] as const).map((x, i) => (
        <group key={`mid-${i}`} position={[x, 1.8, -2.5]}>
          <mesh>
            <boxGeometry args={[0.16, 4, 0.16]} />
            <meshStandardMaterial color="#0a0818" roughness={0.9} metalness={0.1} />
          </mesh>
        </group>
      ))}

      <RuneCircle color={playerColor} side="player" stateRef={stateRef} />
      <RuneCircle color={botColor} side="bot" stateRef={stateRef} />
      <ArenaParticles />
    </group>
  )
}

// ── Fighter: reads position + animation from stateRef every frame ────────────

interface FighterProps {
  glbPath: string
  accentColor: string
  rotationY: number
  side: 'player' | 'bot'
  stateRef: React.RefObject<CombatState>
}

function RealtimeFighter({ glbPath, accentColor, rotationY, side, stateRef }: FighterProps) {
  const group = useRef<THREE.Group>(null!)
  const xRef = useRef(side === 'player' ? -1.0 : 1.0)
  const currentClip = useRef('idle')
  const hitFlashRef = useRef(0)
  const prevState = useRef('idle')
  const attackGlowRef = useRef(0)
  const glowLightRef = useRef<THREE.PointLight>(null!)
  const { scene: rawScene, animations } = useGLTF(glbPath)

  const scene = useMemo(() => SkeletonUtils.clone(rawScene), [rawScene])
  const { actions, mixer } = useAnimations(animations, group)

  function playClip(clipName: string) {
    if (currentClip.current === clipName) return
    const target = actions[clipName] ?? actions['idle'] ?? Object.values(actions)[0]
    if (!target) return
    Object.values(actions).forEach(a => { if (a !== target) a?.fadeOut(0.1) })
    target.reset().fadeIn(0.08).play()
    currentClip.current = clipName
  }

  useFrame((_, delta) => {
    if (!group.current || !stateRef.current) return
    const fighter = side === 'player' ? stateRef.current.player : stateRef.current.bot
    const timeScale = stateRef.current.timeScale

    // Read animation directly from fighter state — every frame, no React delay
    const anim = getFighterAnim(fighter)
    playClip(anim.clip)

    if (mixer) mixer.timeScale = anim.speed * timeScale

    // Smooth position tracking at 60fps
    const lerpSpeed = Math.min(1, delta * 14)
    xRef.current += (fighter.positionX - xRef.current) * lerpSpeed
    group.current.position.x = xRef.current

    // Blocking lean
    const isBlocking = fighter.state === 'blocking'
    const leanTarget = isBlocking ? -0.1 * Math.sign(rotationY) : 0
    group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, leanTarget, lerpSpeed)

    // Hit flash — white emissive burst
    const isHit = fighter.state === 'hit_stun'
    if (isHit && prevState.current !== 'hit_stun') {
      hitFlashRef.current = 1.0
    }
    prevState.current = fighter.state

    if (hitFlashRef.current > 0) {
      hitFlashRef.current = Math.max(0, hitFlashRef.current - delta * 8)
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial
          if (mat.emissive) mat.emissive.setScalar(hitFlashRef.current * 0.6)
        }
      })
    }

    // Attack glow
    const isAttacking = fighter.state === 'light_attack' || fighter.state === 'heavy_attack' || fighter.state === 'special'
    attackGlowRef.current += ((isAttacking ? 1 : 0) - attackGlowRef.current) * Math.min(1, delta * 12)
    if (glowLightRef.current) {
      glowLightRef.current.intensity = 5 + attackGlowRef.current * 14
    }
  })

  return (
    <group ref={group} position={[side === 'player' ? -1.0 : 1.0, 0, 0]} rotation={[0, rotationY, 0]}>
      <primitive object={scene} dispose={null} />
      <pointLight ref={glowLightRef} position={[0, 1.5, 1.0]} intensity={5} color={accentColor} distance={9} decay={2} />
      <pointLight position={[0, 2.5, 0]} intensity={2} color="#ffffff" distance={6} decay={2} />
      <pointLight position={[0, 0.1, 0.5]} intensity={2.5} color={accentColor} distance={3} decay={2} />
    </group>
  )
}

// ── Public component ─────────────────────────────────────────────────────────

export interface RealtimeBattleSceneProps {
  playerClass: CharacterClass
  playerAccentColor: string
  botClass: CharacterClass
  botAccentColor: string
  stateRef: React.RefObject<CombatState>
}

export default function RealtimeBattleScene({
  playerClass, playerAccentColor,
  botClass, botAccentColor,
  stateRef,
}: RealtimeBattleSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 1.1, 3.0], fov: 50 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#04030c', width: '100%', height: '100%' }}
      performance={{ min: 0.5 }}
    >
      <DynamicCamera stateRef={stateRef} />

      <fog attach="fog" args={['#04030c', 6, 16]} />

      <ambientLight intensity={0.35} color="#0d0820" />
      <directionalLight position={[0, 3, 5]} intensity={3.5} color="#f5f0ff" />
      <directionalLight position={[2, 6, 3]} intensity={1.8} color="#ffffff" />
      <directionalLight position={[-4, 2, 1]} intensity={0.6} color="#ffe4c0" />
      <directionalLight position={[0, 3, -5]} intensity={1.8} color="#2a18ff" />
      <pointLight position={[0, 0.05, 0.5]} intensity={1.2} color="#18083a" distance={5} decay={2} />

      <Arena playerColor={playerAccentColor} botColor={botAccentColor} stateRef={stateRef} />

      <Suspense fallback={null}>
        <RealtimeFighter
          key={`player-${playerClass}`}
          glbPath={CHARACTER_GLB[playerClass]}
          accentColor={playerAccentColor}
          rotationY={Math.PI / 2}
          side="player"
          stateRef={stateRef}
        />
        <RealtimeFighter
          key={`bot-${botClass}`}
          glbPath={CHARACTER_GLB[botClass]}
          accentColor={botAccentColor}
          rotationY={-Math.PI / 2}
          side="bot"
          stateRef={stateRef}
        />
      </Suspense>
    </Canvas>
  )
}
