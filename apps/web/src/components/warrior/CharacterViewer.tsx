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
  onLoaded: () => void
}

function CharacterModel({ glbPath, accentColor, animationName, onLoaded }: ModelProps) {
  const group = useRef<THREE.Group>(null!)
  const { scene, animations } = useGLTF(glbPath)
  const { actions } = useAnimations(animations, group)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onLoaded() }, [])   // mount = successful load

  useEffect(() => {
    Object.values(actions).forEach(a => a?.stop())
    const target = actions[animationName] ?? Object.values(actions)[0]
    if (target) target.reset().fadeIn(0.3).play()
    return () => { Object.values(actions).forEach(a => a?.fadeOut(0.2)) }
  }, [animationName, actions])

  return (
    <group ref={group}>
      <primitive object={scene} dispose={null} />
      {/* Rim light in class accent color */}
      <pointLight position={[-3, 2, -2]} intensity={5} color={accentColor} distance={14} />
    </group>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface CharacterViewerProps {
  glbPath: string
  accentColor: string
  animationName?: string
  /** Remounts the model when this changes (use class+gender string) */
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
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <div className={className ?? 'absolute inset-0'} style={{ position: 'relative' }}>

      {/*
        Portrait fallback — visible immediately and fades out once the 3D
        model is ready. Stays visible permanently if the GLB fails to load.
        pointer-events:none so OrbitControls still works when 3D is active.
      */}
      <div
        className="absolute inset-0"
        style={{
          opacity:       loaded && !failed ? 0 : 1,
          transition:    'opacity 0.5s ease',
          pointerEvents: loaded && !failed ? 'none' : undefined,
        }}
      >
        {fallback}
      </div>

      {/* 3D canvas — hidden until model loads, removed entirely on failure */}
      {!failed && (
        <div
          className="absolute inset-0"
          style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.5s ease' }}
        >
          <GLBErrorBoundary onError={() => setFailed(true)}>
            <Canvas
              camera={{ position: [0, 1.1, 3.4], fov: 42 }}
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
                  onLoaded={() => setLoaded(true)}
                />
              </Suspense>

              {/* Y-axis orbit — lets players inspect the character */}
              <OrbitControls
                enableZoom={false}
                enablePan={false}
                minPolarAngle={Math.PI * 0.38}
                maxPolarAngle={Math.PI * 0.52}
                target={[0, 1.0, 0]}
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
