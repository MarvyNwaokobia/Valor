import * as THREE from 'three';

interface TrailPoint {
  position: THREE.Vector3;
  age: number;
}

export class TrailRenderer {
  private points: TrailPoint[] = [];
  private maxPoints: number;
  private lifetime: number;
  private mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshBasicMaterial;
  private active = false;
  private posArray: Float32Array;
  private alphaArray: Float32Array;

  constructor(
    color: string = '#ffffff',
    maxPoints = 30,
    lifetime = 0.15,
    width = 0.3
  ) {
    this.maxPoints = maxPoints;
    this.lifetime = lifetime;

    const vertCount = maxPoints * 2;
    this.posArray = new Float32Array(vertCount * 3);
    this.alphaArray = new Float32Array(vertCount);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.posArray, 3));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphaArray, 1));

    const indices: number[] = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
    this.geometry.setIndex(indices);

    this.material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  get object3d(): THREE.Mesh {
    return this.mesh;
  }

  setColor(color: string) {
    this.material.color.set(color);
  }

  start() {
    this.active = true;
    this.points = [];
    this.mesh.visible = true;
  }

  stop() {
    this.active = false;
  }

  addPoint(position: THREE.Vector3, up: THREE.Vector3 = new THREE.Vector3(0, 1, 0)) {
    if (!this.active && this.points.length === 0) return;

    this.points.unshift({
      position: position.clone(),
      age: 0,
    });

    if (this.points.length > this.maxPoints) {
      this.points.pop();
    }
  }

  update(dt: number, cameraPosition?: THREE.Vector3) {
    for (let i = this.points.length - 1; i >= 0; i--) {
      this.points[i].age += dt;
      if (this.points[i].age > this.lifetime) {
        this.points.splice(i, 1);
      }
    }

    if (this.points.length < 2) {
      this.mesh.visible = false;
      if (!this.active) return;
    }

    this.mesh.visible = this.points.length >= 2;
    this.buildGeometry(cameraPosition);
  }

  private buildGeometry(cameraPosition?: THREE.Vector3) {
    const cam = cameraPosition ?? new THREE.Vector3(0, 5, 10);
    const width = 0.3;

    for (let i = 0; i < this.maxPoints; i++) {
      if (i >= this.points.length) {
        this.posArray[i * 6] = 0;
        this.posArray[i * 6 + 1] = 0;
        this.posArray[i * 6 + 2] = 0;
        this.posArray[i * 6 + 3] = 0;
        this.posArray[i * 6 + 4] = 0;
        this.posArray[i * 6 + 5] = 0;
        this.alphaArray[i * 2] = 0;
        this.alphaArray[i * 2 + 1] = 0;
        continue;
      }

      const p = this.points[i];
      const alpha = 1 - p.age / this.lifetime;

      let tangent: THREE.Vector3;
      if (i < this.points.length - 1) {
        tangent = new THREE.Vector3()
          .subVectors(this.points[i + 1].position, p.position)
          .normalize();
      } else if (i > 0) {
        tangent = new THREE.Vector3()
          .subVectors(p.position, this.points[i - 1].position)
          .normalize();
      } else {
        tangent = new THREE.Vector3(0, 0, 1);
      }

      const toCamera = new THREE.Vector3()
        .subVectors(cam, p.position)
        .normalize();
      const side = new THREE.Vector3()
        .crossVectors(tangent, toCamera)
        .normalize()
        .multiplyScalar(width * alpha);

      const p1 = p.position.clone().add(side);
      const p2 = p.position.clone().sub(side);

      this.posArray[i * 6] = p1.x;
      this.posArray[i * 6 + 1] = p1.y;
      this.posArray[i * 6 + 2] = p1.z;
      this.posArray[i * 6 + 3] = p2.x;
      this.posArray[i * 6 + 4] = p2.y;
      this.posArray[i * 6 + 5] = p2.z;

      this.alphaArray[i * 2] = alpha;
      this.alphaArray[i * 2 + 1] = alpha;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, (this.points.length - 1)) * 6);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
