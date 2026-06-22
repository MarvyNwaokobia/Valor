import * as THREE from 'three';

export interface CameraConfig {
  followDistance: number;
  followHeight: number;
  lookAheadDistance: number;
  smoothSpeed: number;
  lockOnDistance: number;
  lockOnHeight: number;
  fovDefault: number;
  fovCombat: number;
  shakeDecay: number;
}

const DEFAULT_CONFIG: CameraConfig = {
  followDistance: 6,
  followHeight: 3,
  lookAheadDistance: 2,
  smoothSpeed: 5,
  lockOnDistance: 8,
  lockOnHeight: 3,
  fovDefault: 55,
  fovCombat: 48,
  shakeDecay: 8,
};

export class BattleCamera {
  private camera: THREE.PerspectiveCamera;
  private config: CameraConfig;

  private currentPosition = new THREE.Vector3();
  private currentLookAt = new THREE.Vector3();
  private targetPosition = new THREE.Vector3();
  private targetLookAt = new THREE.Vector3();

  private yaw = 0;
  private pitch = 0.3;
  private lockedOn = false;

  private shakeOffset = new THREE.Vector3();
  private shakeIntensity = 0;
  private shakeFrequency = 0;
  private shakeTimer = 0;

  private punchAmt = 0;

  private slowMoFov = 0;

  constructor(camera: THREE.PerspectiveCamera, config?: Partial<CameraConfig>) {
    this.camera = camera;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.camera.fov = this.config.fovDefault;
    this.camera.updateProjectionMatrix();
    this.currentPosition.set(0, this.config.lockOnHeight, this.config.lockOnDistance);
    this.currentLookAt.set(0, 1, 0);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }

  get cameraYaw(): number {
    return this.yaw;
  }

  get isLockedOn(): boolean {
    return this.lockedOn;
  }

  setLockedOn(locked: boolean) {
    this.lockedOn = locked;
  }

  toggleLockOn() {
    this.lockedOn = !this.lockedOn;
  }

  rotateMouse(dx: number, dy: number, sensitivity = 0.003) {
    if (this.lockedOn) return;
    this.yaw -= dx * sensitivity;
    this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch - dy * sensitivity));
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    targetPos?: THREE.Vector3
  ) {
    if (this.lockedOn && targetPos) {
      this.updateLockedOn(dt, playerPos, targetPos);
    } else {
      this.updateFreeFollow(dt, playerPos);
    }

    this.updateShake(dt);
    this.updatePunch(dt);

    const finalPos = this.currentPosition.clone().add(this.shakeOffset);
    this.camera.position.copy(finalPos);
    this.camera.lookAt(this.currentLookAt);

    const targetFov = this.lockedOn
      ? this.config.fovCombat
      : this.config.fovDefault;
    this.camera.fov = THREE.MathUtils.lerp(
      this.camera.fov,
      targetFov + this.slowMoFov,
      dt * 3
    );
    this.camera.updateProjectionMatrix();
  }

  shake(intensity: number, frequency = 30) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeFrequency = frequency;
  }

  punch(strength = 0.12) {
    this.punchAmt = strength;
  }

  setSlowMoFov(fovOffset: number) {
    this.slowMoFov = fovOffset;
  }

  private updateFreeFollow(dt: number, playerPos: THREE.Vector3) {
    const dist = this.config.followDistance;
    const height = this.config.followHeight;

    this.targetPosition.set(
      playerPos.x + Math.sin(this.yaw) * Math.cos(this.pitch) * dist,
      playerPos.y + height + Math.sin(this.pitch) * dist * 0.5,
      playerPos.z + Math.cos(this.yaw) * Math.cos(this.pitch) * dist
    );

    this.targetLookAt.copy(playerPos);
    this.targetLookAt.y += 1.2;

    const t = 1 - Math.exp(-this.config.smoothSpeed * dt);
    this.currentPosition.lerp(this.targetPosition, t);
    this.currentLookAt.lerp(this.targetLookAt, t);
  }

  private updateLockedOn(
    dt: number,
    playerPos: THREE.Vector3,
    targetPos: THREE.Vector3
  ) {
    const midpoint = new THREE.Vector3()
      .addVectors(playerPos, targetPos)
      .multiplyScalar(0.5);

    const separation = playerPos.distanceTo(targetPos);
    const dynamicDist = Math.max(
      this.config.lockOnDistance,
      separation * 0.8 + 3
    );

    const toPlayer = new THREE.Vector3()
      .subVectors(playerPos, targetPos)
      .setY(0)
      .normalize();

    const perpendicular = new THREE.Vector3(
      -toPlayer.z,
      0,
      toPlayer.x
    );

    const cameraDir = perpendicular.clone()
      .add(toPlayer.clone().multiplyScalar(0.3))
      .normalize();

    this.targetPosition.copy(midpoint)
      .addScaledVector(cameraDir, dynamicDist)
      .setY(midpoint.y + this.config.lockOnHeight + separation * 0.15);

    this.targetLookAt.copy(midpoint);
    this.targetLookAt.y += 0.8;

    this.yaw = Math.atan2(
      this.targetPosition.x - midpoint.x,
      this.targetPosition.z - midpoint.z
    );

    const t = 1 - Math.exp(-this.config.smoothSpeed * dt);
    this.currentPosition.lerp(this.targetPosition, t);
    this.currentLookAt.lerp(this.targetLookAt, t);
  }

  private updateShake(dt: number) {
    if (this.shakeIntensity <= 0.001) {
      this.shakeOffset.set(0, 0, 0);
      return;
    }

    this.shakeTimer += dt;
    const t = this.shakeTimer * this.shakeFrequency;

    this.shakeOffset.set(
      Math.sin(t * 1.1) * this.shakeIntensity,
      Math.cos(t * 1.3) * this.shakeIntensity * 0.7,
      Math.sin(t * 0.9) * this.shakeIntensity * 0.5
    );

    this.shakeIntensity *= 1 - this.config.shakeDecay * dt;
  }

  private updatePunch(dt: number) {
    const k = 1 - Math.exp(-12 * dt);
    this.punchAmt = THREE.MathUtils.lerp(this.punchAmt, 0, k);
    const dir = new THREE.Vector3()
      .subVectors(this.currentLookAt, this.currentPosition)
      .normalize();
    this.currentPosition.addScaledVector(
      dir, this.punchAmt * this.config.followDistance
    );
  }
}
