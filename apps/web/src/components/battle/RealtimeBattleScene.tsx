'use client'

import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'
import { CHARACTER_GLB } from '@/lib/classes'
import type { CharacterClass } from '@/lib/classes'

// ── Camera ───────────────────────────────────────────────────────────────────

function DynamicCamera({ playerX, botX, timeScale }: {
  playerX: number; botX: number; timeScale: number
}) {
  const { camera } = useThree()
  const targetRef = useRef(new THREE.Vector3(-0.25, 0.9, 2.1))
  const lookRef = useRef(new THREE.Vector3(-0.1, 1.05, 0))

  useFrame((_, delta) => {
    const midX = (playerX + botX) / 2
    const spread = Math.abs(botX - playerX)

    // Camera pulls back slightly when fighters are far apart, pushes in when close
    const zoom = THREE.MathUtils.lerp(2.1, 2.5, Math.max(0, spread - 1.0))
    const target = new THREE.Vector3(midX * 0.3 - 0.1, 0.9, zoom)
    const look = new THREE.Vector3(midX * 0.3, 1.05, 0)

    // Slower camera during slow-mo for dramatic effect
    const lerpFactor = Math.min(1, delta * 4 * timeScale)
    targetRef.current.lerp(target, lerpFactor)
    lookRef.current.lerp(look, lerpFactor)

    camera.position.copy(targetRef.current)
    camera.lookAt(lookRef.current)
  })

  return null
}

// ── Arena ─────────────────────────────────────────────────────────────────────

function Arena({ playerColor, botColor }: { playerColor: string; botColor: string }) {
  const pColor = useMemo(() => new THREE.Color(playerColor), [playerColor])
  const bColor = useMemo(() => new THREE.Color(botColor), [botColor])

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.005, 0]}>
        <planeGeometry args={[20, 12]} />
        <meshStandardMaterial color="#060410" roughness={0.88} metalness={0.12} />
      </mesh>

      <mesh rotation-x={-Math.PI / 2} position={[-0.7, 0.001, 0]}>
        <planeGeometry args={[2.2, 1.4]} />
        <meshBasicMaterial color={pColor} transparent opacity={0.08} depthWrite={false} />
      </mesh>

      <mesh rotation-x={-Math.PI / 2} position={[0.7, 0.001, 0]}>
        <planeGeometry args={[2.2, 1.4]} />
        <meshBasicMaterial color={bColor} transparent opacity={0.08} depthWrite={false} />
      </mesh>

      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]}>
        <planeGeometry args={[0.006, 2.8]} />
        <meshBasicMaterial color="#eab308" transparent opacity={0.22} depthWrite={false} />
      </mesh>

      {([-1.8, 1.8] as const).map((x, i) => (
        <mesh key={`edge-${i}`} rotation-x={-Math.PI / 2} position={[x, 0.003, 0]}>
          <planeGeometry args={[0.008, 3]} />
          <meshBasicMaterial
            color={x < 0 ? pColor : bColor}
            transparent opacity={0.4} depthWrite={false}
          />
        </mesh>
      ))}

      <mesh position={[0, 2.5, -5]}>
        <planeGeometry args={[30, 10]} />
        <meshStandardMaterial color="#030108" roughness={1} metalness={0} />
      </mesh>
      <mesh position={[0, 3, -10]}>
        <planeGeometry args={[50, 16]} />
        <meshStandardMaterial color="#020106" roughness={1} metalness={0} />
      </mesh>

      {([-3.8, 3.8] as const).map((x, i) => (
        <group key={`pillar-${i}`} position={[x, 1.8, -3.8]}>
          <mesh>
            <boxGeometry args={[0.24, 4.5, 0.24]} />
            <meshStandardMaterial color="#0d0b1e" roughness={0.9} metalness={0.1} />
          </mesh>
          <mesh position={[0, 2.3, 0]}>
            <boxGeometry args={[0.38, 0.14, 0.38]} />
            <meshStandardMaterial color="#161228" roughness={0.85} metalness={0.15} />
          </mesh>
          <mesh position={[0, -2.3, 0]}>
            <boxGeometry args={[0.38, 0.14, 0.38]} />
            <meshStandardMaterial color="#161228" roughness={0.85} metalness={0.15} />
          </mesh>
        </group>
      ))}

      {([-2.2, 2.2] as const).map((x, i) => (
        <group key={`mid-${i}`} position={[x, 1.5, -2.2]}>
          <mesh>
            <boxGeometry args={[0.16, 3.5, 0.16]} />
            <meshStandardMaterial color="#0a0818" roughness={0.9} metalness={0.1} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ── Real-time fighter ────────────────────────────────────────────────────────

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
}

function RealtimeFighter({
  glbPath, accentColor, animClip, animSpeed, positionX, rotationY,
  timeScale, isBlocking,
}: RealtimeFighterProps) {
  const group = useRef<THREE.Group>(null!)
  const xRef = useRef(positionX)
  const prevClip = useRef(animClip)
  const { scene: rawScene, animations } = useGLTF(glbPath)

  const scene = useMemo(() => SkeletonUtils.clone(rawScene), [rawScene])
  const { actions, mixer } = useAnimations(animations, group)

  // Animation transitions
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

  // Playback speed + time scale
  useEffect(() => {
    if (!mixer) return
    mixer.timeScale = animSpeed * timeScale
  }, [animSpeed, timeScale, mixer])

  // Smooth position tracking
  useFrame((_, delta) => {
    if (!group.current) return
    const lerpSpeed = Math.min(1, delta * 14)
    xRef.current += (positionX - xRef.current) * lerpSpeed
    group.current.position.x = xRef.current

    // Slight lean when blocking
    if (isBlocking) {
      group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, -0.08 * Math.sign(rotationY), lerpSpeed)
    } else {
      group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, 0, lerpSpeed)
    }
  })

  return (
    <group ref={group} position={[positionX, 0, 0]} rotation={[0, rotationY, 0]}>
      <primitive object={scene} dispose={null} />
      <pointLight position={[0, 1.5, 1.0]} intensity={6} color={accentColor} distance={9} decay={2} />
      <pointLight position={[0, 2.5, 0]} intensity={2.5} color="#ffffff" distance={6} decay={2} />
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
  botClass: CharacterClass
  botAccentColor: string
  botPositionX: number
  botAnimClip: string
  botAnimSpeed: number
  botBlocking: boolean
  botDead: boolean
  timeScale: number
}

export default function RealtimeBattleScene({
  playerClass, playerAccentColor, playerPositionX, playerAnimClip, playerAnimSpeed,
  playerBlocking, playerDead,
  botClass, botAccentColor, botPositionX, botAnimClip, botAnimSpeed,
  botBlocking, botDead,
  timeScale,
}: RealtimeBattleSceneProps) {
  return (
    <Canvas
      camera={{ position: [-0.25, 0.9, 2.1], fov: 55 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#04030c', width: '100%', height: '100%' }}
      performance={{ min: 0.5 }}
    >
      <DynamicCamera playerX={playerPositionX} botX={botPositionX} timeScale={timeScale} />

      <fog attach="fog" args={['#04030c', 8, 20]} />

      <ambientLight intensity={0.5} color="#0d0820" />
      <directionalLight position={[0, 2.5, 5]} intensity={3.2} color="#f5f0ff" />
      <directionalLight position={[1, 5, 3]} intensity={2.0} color="#ffffff" />
      <directionalLight position={[-4, 2, 1]} intensity={0.7} color="#ffe4c0" />
      <directionalLight position={[0, 3, -5]} intensity={1.4} color="#2a18ff" />
      <pointLight position={[0, 0.05, 0.5]} intensity={0.9} color="#18083a" distance={5} decay={2} />

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
        />
      </Suspense>
    </Canvas>
  )
}
