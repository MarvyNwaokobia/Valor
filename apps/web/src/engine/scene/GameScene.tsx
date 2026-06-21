'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FighterModel } from './FighterModel';
import { ArenaStage, type StageId } from './ArenaStage';
import { BattleCamera } from '../camera';
import { CharacterController } from '../character';
import { AnimationStateMachine, AnimState, CLASS_ANIMATIONS } from '../animation';
import { Action, getInputSystem } from '../input';
import { TouchControls } from '../input/TouchControls';

type ClassId = 'berserker' | 'sentinel' | 'phantom';

interface GameSceneProps {
  playerClass: ClassId;
  enemyClass: ClassId;
  stageId?: StageId;
}

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.4} color="#b8c4ff" />
      <directionalLight
        position={[8, 12, 5]}
        intensity={2.5}
        color="#fff5e6"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <directionalLight
        position={[-5, 8, -3]}
        intensity={0.8}
        color="#4466ff"
      />
      <pointLight
        position={[0, 0.5, 0]}
        intensity={0.5}
        color="#ff8844"
        distance={20}
      />
    </>
  );
}

function BattleWorld({
  playerClass,
  enemyClass,
  stageId,
}: GameSceneProps) {
  const { camera } = useThree();
  const perspCamera = camera as THREE.PerspectiveCamera;

  const input = useMemo(() => getInputSystem(), []);

  const battleCamera = useMemo(
    () => new BattleCamera(perspCamera),
    [perspCamera]
  );

  const playerController = useMemo(
    () => new CharacterController(new THREE.Vector3(-3, 0, 0)),
    []
  );

  const enemyController = useMemo(
    () => new CharacterController(new THREE.Vector3(3, 0, 0)),
    []
  );

  const playerAnimMachine = useMemo(
    () => new AnimationStateMachine(CLASS_ANIMATIONS[playerClass]),
    [playerClass]
  );

  const enemyAnimMachine = useMemo(
    () => new AnimationStateMachine(CLASS_ANIMATIONS[enemyClass]),
    [enemyClass]
  );

  useEffect(() => {
    playerController.setLockOnTarget(enemyController);
    battleCamera.setLockedOn(true);
  }, [playerController, enemyController, battleCamera]);

  useFrame((_, dt) => {
    const clampedDt = Math.min(dt, 0.05);

    const lockOn = input.getAction(Action.LockOn);
    if (lockOn.justPressed) {
      battleCamera.toggleLockOn();
    }

    const look = input.lookDelta;
    battleCamera.rotateMouse(look.x, look.y);

    playerController.update(clampedDt, input, battleCamera.cameraYaw);

    const move = input.moveAxis;
    const isMoving = Math.abs(move.x) > 0.1 || Math.abs(move.y) > 0.1;
    const ps = playerController.state;

    if (ps.isDead) {
      playerAnimMachine.transition(AnimState.Death, true);
    } else if (ps.isStaggered) {
      // handled by combat system
    } else if (ps.isDodging) {
      playerAnimMachine.transition(AnimState.Dodge);
    } else if (ps.isBlocking) {
      playerAnimMachine.transition(AnimState.Block);
    } else if (ps.isAttacking) {
      // handled by combat system
    } else if (isMoving) {
      playerAnimMachine.transition(AnimState.Walk);
    } else {
      playerAnimMachine.transition(AnimState.Idle);
    }

    const lightAtk = input.getAction(Action.LightAttack);
    const heavyAtk = input.getAction(Action.HeavyAttack);
    const special = input.getAction(Action.Special);

    if (lightAtk.justPressed && !ps.isAttacking && !ps.isDodging && !ps.isStaggered) {
      playerAnimMachine.transition(AnimState.LightAttack, true);
      ps.isAttacking = true;
      playerAnimMachine.setOnStateChange((_from, to) => {
        if (to === AnimState.Idle) ps.isAttacking = false;
      });
    }
    if (heavyAtk.justPressed && !ps.isAttacking && !ps.isDodging && !ps.isStaggered) {
      playerAnimMachine.transition(AnimState.HeavyAttack, true);
      ps.isAttacking = true;
      playerAnimMachine.setOnStateChange((_from, to) => {
        if (to === AnimState.Idle) ps.isAttacking = false;
      });
    }
    if (special.justPressed && !ps.isAttacking && !ps.isDodging && !ps.isStaggered) {
      playerAnimMachine.transition(AnimState.Special, true);
      ps.isAttacking = true;
      playerAnimMachine.setOnStateChange((_from, to) => {
        if (to === AnimState.Idle) ps.isAttacking = false;
      });
    }

    enemyAnimMachine.transition(AnimState.Idle);

    battleCamera.update(
      clampedDt,
      playerController.state.position,
      enemyController.state.position
    );

    input.update();
  });

  const CLASS_ACCENTS: Record<string, string> = {
    berserker: '#ff4422',
    sentinel: '#4488ff',
    phantom: '#aa44ff',
  };

  return (
    <>
      <Lighting />

      <ArenaStage stageId={stageId ?? 'lava_arena'} />

      <FighterModel
        classId={playerClass}
        state={playerController.state}
        animMachine={playerAnimMachine}
        accent={CLASS_ACCENTS[playerClass]}
      />

      <FighterModel
        classId={enemyClass}
        state={enemyController.state}
        animMachine={enemyAnimMachine}
        accent={CLASS_ACCENTS[enemyClass]}
      />

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[30, 30]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
    </>
  );
}

function LoadingScreen() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#333" wireframe />
    </mesh>
  );
}

export function GameScene(props: GameSceneProps) {
  return (
    <div className="w-full h-full relative">
      <Canvas
        shadows
        camera={{ fov: 55, near: 0.1, far: 200, position: [0, 3.5, 6] }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        className="w-full h-full"
      >
        <color attach="background" args={['#0a0a0f']} />
        <fog attach="fog" args={['#0a0a0f', 20, 50]} />
        <Suspense fallback={<LoadingScreen />}>
          <BattleWorld {...props} />
        </Suspense>
      </Canvas>
      <TouchControls />
    </div>
  );
}
