'use client'

import { Suspense, useEffect, useRef, Component, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGLTF, useAnimations, OrbitControls } from '@react-three/drei'
import type * as THREE from 'three'

// ── Error boundary — falls back gracefully if GLB doesn't exist yet ───────────

interface BoundaryProps { fallback: ReactNode; children: ReactNode }
interface BoundaryState { error: boolean }

class GLBBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() {
    return this.state.error ? this.props.fallback : this.props.children
  }
}

// ── 3D model (runs inside Canvas context) ────────────────────────────────────

interface ModelProps {
  glbPath: string
  accentColor: string
  animationName: string
}

function CharacterModel({ glbPath, accentColor, animationName }: ModelProps) {
  const group = useRef<THREE.Group>(null!)
  const { scene, animations } = useGLTF(glbPath)
  const { actions } = useAnimations(animations, group)

  useEffect(() => {
    Object.values(actions).forEach(a => a?.stop())
    const target = actions[animationName] ?? Object.values(actions)[0]
    if (target) target.reset().fadeIn(0.3).play()
    return () => { Object.values(actions).forEach(a => a?.fadeOut(0.2)) }
  }, [animationName, actions])

  return (
    <group ref={group}>
      <primitive object={scene} dispose={null} />
      {/* Rim light in class accent color — gives the characteristic glow */}
      <pointLight position={[-3, 2, -2]} intensity={5} color={accentColor} distance={14} />
    </group>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface CharacterViewerProps {
  glbPath: string
  accentColor: string
  animationName?: string
  /** Change this to remount the model (use class+gender string) */
  modelKey: string
  fallback?: ReactNode
  className?: string
}

export default function CharacterViewer({
  glbPath,
  accentColor,
  animationName = 'idle',
  modelKey,
  fallback = null,
  className,
}: CharacterViewerProps) {
  return (
    <GLBBoundary fallback={fallback}>
      <div className={className ?? 'absolute inset-0'}>
        <Canvas
          camera={{ position: [0, 1.1, 3.4], fov: 42 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}
          performance={{ min: 0.5 }}
        >
          {/* Ambient — dark purple tint matches the game atmosphere */}
          <ambientLight intensity={0.55} color="#18142e" />
          {/* Key light — front, slightly above */}
          <directionalLight position={[1, 4, 3]} intensity={2.4} color="#ffffff" />
          {/* Fill light — subtle cool from below */}
          <pointLight position={[0, -0.5, 2]} intensity={0.7} color="#0a0820" />

          <Suspense fallback={null}>
            <CharacterModel
              key={modelKey}
              glbPath={glbPath}
              accentColor={accentColor}
              animationName={animationName}
            />
          </Suspense>

          {/* Y-axis only orbit — lets players rotate to inspect the character */}
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            minPolarAngle={Math.PI * 0.38}
            maxPolarAngle={Math.PI * 0.52}
            target={[0, 1.0, 0]}
          />
        </Canvas>
      </div>
    </GLBBoundary>
  )
}

/** Call before navigating to a screen to preload the model silently */
CharacterViewer.preload = (path: string) => useGLTF.preload(path)
