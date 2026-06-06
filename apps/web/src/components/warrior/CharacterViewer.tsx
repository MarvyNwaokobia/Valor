'use client'

import { Suspense, useEffect, useRef, useState, Component, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGLTF, useAnimations, OrbitControls } from '@react-three/drei'
import type * as THREE from 'three'

// ── Error boundary — catches errors thrown inside the R3F Canvas tree ─────────

class GLBErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { errored: boolean }
> {
  state = { errored: false }
  static getDerivedStateFromError() { return { errored: true } }
  componentDidCatch() { this.props.onError() }
  render() { return this.state.errored ? null : this.props.children }
}

// ── 3D model (runs inside Canvas context) ────────────────────────────────────

interface ModelProps {
  glbPath: string
  accentColor: string
  animationName: string
  paused: boolean
  onLoaded: () => void
}

function CharacterModel({ glbPath, accentColor, animationName, paused, onLoaded }: ModelProps) {
  const group = useRef<THREE.Group>(null!)
  const { scene, animations } = useGLTF(glbPath)
  const { actions, mixer } = useAnimations(animations, group)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onLoaded() }, [])

  useEffect(() => {
    Object.values(actions).forEach(a => a?.stop())
    const target = actions[animationName] ?? Object.values(actions)[0]
    if (target) target.reset().fadeIn(0.3).play()
    return () => { Object.values(actions).forEach(a => a?.fadeOut(0.2)) }
  }, [animationName, actions])

  // Hitstop: freeze the mixer for the duration
  useEffect(() => {
    if (!mixer) return
    mixer.timeScale = paused ? 0 : 1
  }, [paused, mixer])

  return (
    <group ref={group}>
      <primitive object={scene} dispose={null} scale={[0.01, 0.01, 0.01]} />
      <pointLight position={[-3, 2, -2]} intensity={5} color={accentColor} distance={14} />
    </group>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface CharacterViewerProps {
  glbPath: string
  accentColor: string
  animationName?: string
  paused?: boolean
  /** Remounts the model when this changes (use class+gender string) */
  modelKey: string
  fallback?: ReactNode
  className?: string
}

export default function CharacterViewer({
  glbPath,
  accentColor,
  animationName = 'idle',
  paused = false,
  modelKey,
  fallback = null,
  className,
}: CharacterViewerProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <div className={className ?? 'absolute inset-0'}>

      {/*
        Portrait — always visible as background. The 3D canvas renders on top
        with a transparent background, so if the GLB loads correctly the 3D
        model naturally obscures the portrait. If WebGL fails or the model is
        invisible the portrait stays visible.
      */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: loaded && !failed ? 'none' : undefined }}
      >
        {fallback}
      </div>

      {/* 3D canvas — hidden until model loads, removed entirely on failure */}
      {!failed && (
        <div
          className="absolute inset-0"
          style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.5s ease', pointerEvents: loaded ? undefined : 'none' }}
        >
          <GLBErrorBoundary onError={() => setFailed(true)}>
            <Canvas
              camera={{ position: [0, 0.9, 3.2], fov: 46 }}
              dpr={[1, 2]}
              gl={{ antialias: true, alpha: true }}
              style={{ background: 'transparent' }}
              performance={{ min: 0.5 }}
            >
              <ambientLight intensity={0.55} color="#18142e" />
              <directionalLight position={[1, 4, 3]} intensity={2.4} color="#ffffff" />
              <pointLight position={[0, -0.5, 2]} intensity={0.7} color="#0a0820" />

              <Suspense fallback={null}>
                <CharacterModel
                  key={modelKey}
                  glbPath={glbPath}
                  accentColor={accentColor}
                  animationName={animationName}
                  paused={paused}
                  onLoaded={() => setLoaded(true)}
                />
              </Suspense>

              {/* Y-axis orbit — lets players inspect the character */}
              <OrbitControls
                enableZoom={false}
                enablePan={false}
                minPolarAngle={Math.PI * 0.38}
                maxPolarAngle={Math.PI * 0.52}
                target={[0, 0.85, 0]}
              />
            </Canvas>
          </GLBErrorBoundary>
        </div>
      )}
    </div>
  )
}

/** Call before navigating to a screen to preload the model silently */
CharacterViewer.preload = (path: string) => useGLTF.preload(path)
