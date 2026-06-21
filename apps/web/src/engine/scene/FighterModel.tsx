'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { AnimationStateMachine, AnimState, CLASS_ANIMATIONS } from '../animation';
import type { CharacterState } from '../character';

interface FighterModelProps {
  classId: 'berserker' | 'sentinel' | 'phantom';
  state: CharacterState;
  animMachine: AnimationStateMachine;
  accent?: string;
}

const MODEL_PATH = '/models/characters/berserker/scene.gltf';
const MODEL_SCALE = 1.8;

const CLASS_COLORS: Record<string, string> = {
  berserker: '#ff4422',
  sentinel: '#4488ff',
  phantom: '#aa44ff',
};

function FallbackFighter({ state, accent }: { state: CharacterState; accent: string }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.lerp(state.position, 0.15);
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), state.rotation
    );
    groupRef.current.quaternion.slerp(targetQuat, 0.12);
  });

  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.3, 1, 8, 16]} />
        <meshStandardMaterial color={accent} roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.2, 0]} castShadow>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color={accent} roughness={0.5} />
      </mesh>
      <pointLight color={accent} intensity={1.5} distance={4} position={[0, 1.5, 0]} />
    </group>
  );
}

function GLTFModel({
  classId,
  state,
  animMachine,
  accent = '#ff4444',
}: FighterModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(MODEL_PATH);

  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          const mat = (child.material as THREE.Material).clone();
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.color.set(CLASS_COLORS[classId] ?? '#ffffff');
            mat.roughness = 0.4;
            mat.emissive.set(CLASS_COLORS[classId] ?? '#000000');
            mat.emissiveIntensity = 0.15;
          }
          child.material = mat;
        }
      }
    });
    return clone;
  }, [scene, classId]);

  const { mixer } = useAnimations(animations, groupRef);

  useEffect(() => {
    if (!mixer || animations.length === 0) return;
    animMachine.init(mixer, animations);
  }, [mixer, animations, animMachine]);

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    groupRef.current.position.lerp(state.position, 0.15);
    groupRef.current.scale.setScalar(MODEL_SCALE);
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), state.rotation
    );
    groupRef.current.quaternion.slerp(targetQuat, 0.12);
    animMachine.update(dt);
  });

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} />
      <pointLight color={accent} intensity={1.5} distance={4} position={[0, 1.5, 0]} />
    </group>
  );
}

export function FighterModel(props: FighterModelProps) {
  const [failed, setFailed] = useState(false);
  const accent = props.accent ?? CLASS_COLORS[props.classId] ?? '#ff4444';

  if (failed) {
    return <FallbackFighter state={props.state} accent={accent} />;
  }

  return (
    <ErrorCatcher onError={() => setFailed(true)}>
      <GLTFModel {...props} accent={accent} />
    </ErrorCatcher>
  );
}

import React from 'react';

class ErrorCatcher extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
