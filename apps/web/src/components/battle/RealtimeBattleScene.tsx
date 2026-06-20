'use client'

import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'
import { CHARACTER_GLB } from '@/lib/classes'
import type { CharacterClass } from '@/lib/classes'

// ── Camera: tracks fighters, zooms on close combat, dramatic angles ──────────

function DynamicCamera({ playerX, botX, timeScale, playerAttacking, botAttacking }: {
  playerX: number; botX: number; timeScale: number
  playerAttacking: boolean; botAttacking: boolean
}) {
  const { camera } = useThree()
  const posRef = useRef(new THREE.Vector3(0, 1.1, 3.0))
  const lookRef = useRef(new THREE.Vector3(0, 0.9, 0))

  useFrame((_, delta) => {
    const midX = (playerX + botX) / 2
    const spread = Math.abs(botX - playerX)

    // Base distance scales with fighter spread
    let baseZ = 2.4 + Math.max(0, spread - 1.0) * 0.6
    let baseY = 1.0
    let lookY = 0.9

    // Zoom in during attacks for visceral close-up feel
    if (playerAttacking || botAttacking) {
      baseZ -= 0.4
      baseY = 0.85
      lookY = 0.95
    }

    // During slow-mo, pull camera slightly to the side for dramatic angle
    if (timeScale < 0.5) {
      baseZ -= 0.3
      baseY = 0.75
    }

    const target = new THREE.Vector3(midX * 0.35, baseY, baseZ)
    const look = new THREE.Vector3(midX * 0.25, lookY, 0)

    const lerpSpeed = Math.min(1, delta * (timeScale < 0.5 ? 2 : 6))
    posRef.current.lerp(target, lerpSpeed)
    lookRef.current.lerp(look, lerpSpeed)

    camera.position.copy(posRef.current)
    camera.lookAt(lookRef.current)
  })

  return null
}

// ── Floating arena particles ─────────────────────────────────────────────────

function ArenaParticles({ color }: { color: string }) {
  const pointsRef = useRef<THREE.Points>(null!)
  const count = 60

  const [positions, velocities] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const vel = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 8
      pos[i * 3 + 1] = Math.random() * 4
      pos[i * 3 + 2] = (Math.random() - 0.5) * 6
      vel[i * 3] = (Math.random() - 0.5) * 0.003
      vel[i * 3 + 1] = 0.002 + Math.random() * 0.005
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.002
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
      if (pos.array[i * 3 + 1] > 4) {
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
      <pointsMaterial color={color} size={0.03} transparent opacity={0.4} depthWrite={false} />
    </points>
  )
}

// ── Ground rune circle ───────────────────────────────────────────────────────

function RuneCircle({ color, positionX }: { color: string; positionX: number }) {
  const ref = useRef<THREE.Mesh>(null!)

  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.z = state.clock.elapsedTime * 0.15
    ref.current.position.x = positionX
  })

  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[positionX, 0.003, 0]}>
      <ringGeometry args={[0.6, 0.65, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

// ── Impact flash — placed at hit position in 3D space ────────────────────────

// ── Arena environment ────────────────────────────────────────────────────────

function Arena({ playerColor, botColor }: { playerColor: string; botColor: string }) {
  const pColor = useMemo(() => new THREE.Color(playerColor), [playerColor])
  const bColor = useMemo(() => new THREE.Color(botColor), [botColor])

  return (
    <group>
      {/* Main floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.005, 0]}>
        <planeGeometry args={[24, 14]} />
        <meshStandardMaterial color="#060410" roughness={0.85} metalness={0.15} />
      </mesh>

      {/* Floor center glow line */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]}>
        <planeGeometry args={[0.01, 3.5]} />
        <meshBasicMaterial color="#eab308" transparent opacity={0.3} depthWrite={false} />
      </mesh>

      {/* Player ground glow */}
      <mesh rotation-x={-Math.PI / 2} position={[-1.0, 0.001, 0]}>
        <circleGeometry args={[1.2, 32]} />
        <meshBasicMaterial color={pColor} transparent opacity={0.06} depthWrite={false} />
      </mesh>

      {/* Bot ground glow */}
      <mesh rotation-x={-Math.PI / 2} position={[1.0, 0.001, 0]}>
        <circleGeometry args={[1.2, 32]} />
        <meshBasicMaterial color={bColor} transparent opacity={0.06} depthWrite={false} />
      </mesh>

      {/* Edge trim lines */}
      {([-2.8, 2.8] as const).map((x, i) => (
        <mesh key={`edge-${i}`} rotation-x={-Math.PI / 2} position={[x, 0.003, 0]}>
          <planeGeometry args={[0.01, 4]} />
          <meshBasicMaterial color={x < 0 ? pColor : bColor} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ))}

      {/* Back wall */}
      <mesh position={[0, 3, -6]}>
        <planeGeometry args={[40, 12]} />
        <meshStandardMaterial color="#020108" roughness={1} metalness={0} />
      </mesh>

      {/* Pillars */}
      {([-4.5, 4.5] as const).map((x, i) => (
        <group key={`pillar-${i}`} position={[x, 2, -4]}>
          <mesh>
            <boxGeometry args={[0.3, 5, 0.3]} />
            <meshStandardMaterial color="#0d0b1e" roughness={0.9} metalness={0.1} />
          </mesh>
          <mesh position={[0, 2.6, 0]}>
            <boxGeometry args={[0.45, 0.15, 0.45]} />
            <meshStandardMaterial color="#161228" roughness={0.85} metalness={0.15} />
          </mesh>
          {/* Pillar glow */}
          <pointLight
            position={[0, -1, 0.3]}
            intensity={0.8}
            color={x < 0 ? playerColor : botColor}
            distance={3}
            decay={2}
          />
        </group>
      ))}

      {/* Mid pillars */}
      {([-3, 3] as const).map((x, i) => (
        <group key={`mid-${i}`} position={[x, 1.8, -2.5]}>
          <mesh>
            <boxGeometry args={[0.18, 4, 0.18]} />
            <meshStandardMaterial color="#0a0818" roughness={0.9} metalness={0.1} />
          </mesh>
        </group>
      ))}

      {/* Rune circles under fighters */}
      <RuneCircle color={playerColor} positionX={-1.0} />
      <RuneCircle color={botColor} positionX={1.0} />

      {/* Atmospheric particles */}
      <ArenaParticles color="#8b5cf620" />
    </group>
  )
}

// ── Fighter with hit flash and attack glow ───────────────────────────────────

interface RealtimeFighterProps {
  glbPath: string
  accentColor: string
  animClip: string
  animSpeed: number
  positionX: number
  rotationY: number
  timeScale: number
  isBlocking: boolean
  isDead: boolean
  isAttacking: boolean
  isHit: boolean
}

function RealtimeFighter({
  glbPath, accentColor, animClip, animSpeed, positionX, rotationY,
  timeScale, isBlocking, isAttacking, isHit,
}: RealtimeFighterProps) {
  const group = useRef<THREE.Group>(null!)
  const xRef = useRef(positionX)
  const prevClip = useRef(animClip)
  const hitFlashRef = useRef(0)
  const attackGlowRef = useRef(0)
  const glowLightRef = useRef<THREE.PointLight>(null!)
  const { scene: rawScene, animations } = useGLTF(glbPath)

  const scene = useMemo(() => SkeletonUtils.clone(rawScene), [rawScene])
  const { actions, mixer } = useAnimations(animations, group)

  useEffect(() => {
    const target = actions[animClip] ?? Object.values(actions)[0]
    if (!target) return

    if (prevClip.current !== animClip) {
      Object.values(actions).forEach(a => { if (a !== target) a?.fadeOut(0.12) })
      target.reset().fadeIn(0.1).play()
      prevClip.current = animClip
    } else if (!target.isRunning()) {
      target.reset().fadeIn(0.1).play()
    }
  }, [animClip, actions])

  useEffect(() => {
    if (!mixer) return
    mixer.timeScale = animSpeed * timeScale
  }, [animSpeed, timeScale, mixer])

  // Trigger flash on hit
  useEffect(() => {
    if (isHit) hitFlashRef.current = 1
  }, [isHit])

  useFrame((_, delta) => {
    if (!group.current) return

    // Smooth position with faster tracking for responsiveness
    const lerpSpeed = Math.min(1, delta * 16)
    xRef.current += (positionX - xRef.current) * lerpSpeed
    group.current.position.x = xRef.current

    // Blocking lean
    const leanTarget = isBlocking ? -0.12 * Math.sign(rotationY) : 0
    group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, leanTarget, lerpSpeed)

    // Hit flash — make character flash white briefly
    if (hitFlashRef.current > 0) {
      hitFlashRef.current = Math.max(0, hitFlashRef.current - delta * 6)
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial
          if (mat.emissive) {
            mat.emissive.setScalar(hitFlashRef.current * 0.8)
          }
        }
      })
    }

    // Attack glow — intensify accent light during attacks
    attackGlowRef.current += ((isAttacking ? 1 : 0) - attackGlowRef.current) * Math.min(1, delta * 12)
    if (glowLightRef.current) {
      glowLightRef.current.intensity = 6 + attackGlowRef.current * 12
    }
  })

  return (
    <group ref={group} position={[positionX, 0, 0]} rotation={[0, rotationY, 0]}>
      <primitive object={scene} dispose={null} />
      <pointLight ref={glowLightRef} position={[0, 1.5, 1.0]} intensity={6} color={accentColor} distance={9} decay={2} />
      <pointLight position={[0, 2.5, 0]} intensity={2.5} color="#ffffff" distance={6} decay={2} />
      {/* Ground accent light — stronger during attacks */}
      <pointLight position={[0, 0.1, 0.5]} intensity={3} color={accentColor} distance={3} decay={2} />
    </group>
  )
}

// ── Public component ─────────────────────────────────────────────────────────

export interface RealtimeBattleSceneProps {
  playerClass: CharacterClass
  playerAccentColor: string
  playerPositionX: number
  playerAnimClip: string
  playerAnimSpeed: number
  playerBlocking: boolean
  playerDead: boolean
  playerAttacking: boolean
  playerHit: boolean
  botClass: CharacterClass
  botAccentColor: string
  botPositionX: number
  botAnimClip: string
  botAnimSpeed: number
  botBlocking: boolean
  botDead: boolean
  botAttacking: boolean
  botHit: boolean
  timeScale: number
}

export default function RealtimeBattleScene({
  playerClass, playerAccentColor, playerPositionX, playerAnimClip, playerAnimSpeed,
  playerBlocking, playerDead, playerAttacking, playerHit,
  botClass, botAccentColor, botPositionX, botAnimClip, botAnimSpeed,
  botBlocking, botDead, botAttacking, botHit,
  timeScale,
}: RealtimeBattleSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 1.1, 3.0], fov: 50 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#04030c', width: '100%', height: '100%' }}
      performance={{ min: 0.5 }}
    >
      <DynamicCamera
        playerX={playerPositionX}
        botX={botPositionX}
        timeScale={timeScale}
        playerAttacking={playerAttacking}
        botAttacking={botAttacking}
      />

      <fog attach="fog" args={['#04030c', 6, 16]} />

      {/* Lighting — more dramatic, higher contrast */}
      <ambientLight intensity={0.35} color="#0d0820" />
      <directionalLight position={[0, 3, 5]} intensity={3.5} color="#f5f0ff" />
      <directionalLight position={[2, 6, 3]} intensity={1.8} color="#ffffff" />
      <directionalLight position={[-4, 2, 1]} intensity={0.6} color="#ffe4c0" />
      <directionalLight position={[0, 3, -5]} intensity={1.8} color="#2a18ff" />
      <pointLight position={[0, 0.05, 0.5]} intensity={1.2} color="#18083a" distance={5} decay={2} />

      <Arena playerColor={playerAccentColor} botColor={botAccentColor} />

      <Suspense fallback={null}>
        <RealtimeFighter
          key={`player-${playerClass}`}
          glbPath={CHARACTER_GLB[playerClass]}
          accentColor={playerAccentColor}
          animClip={playerAnimClip}
          animSpeed={playerAnimSpeed}
          positionX={playerPositionX}
          rotationY={Math.PI / 2}
          timeScale={timeScale}
          isBlocking={playerBlocking}
          isDead={playerDead}
          isAttacking={playerAttacking}
          isHit={playerHit}
        />
        <RealtimeFighter
          key={`bot-${botClass}`}
          glbPath={CHARACTER_GLB[botClass]}
          accentColor={botAccentColor}
          animClip={botAnimClip}
          animSpeed={botAnimSpeed}
          positionX={botPositionX}
          rotationY={-Math.PI / 2}
          timeScale={timeScale}
          isBlocking={botBlocking}
          isDead={botDead}
          isAttacking={botAttacking}
          isHit={botHit}
        />
      </Suspense>
    </Canvas>
  )
}
