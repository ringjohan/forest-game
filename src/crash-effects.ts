import * as THREE from "three";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";

export type AircraftImpact = {
  position: THREE.Vector3;
  contact: THREE.Vector3;
  ground: boolean;
};

type Particle = {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  smoke: boolean;
};
type Burst = { group: THREE.Group; particles: Particle[]; light: THREE.PointLight; age: number };

export class CrashEffects {
  readonly group = new THREE.Group();
  private readonly bursts: Burst[] = [];
  private readonly scars: THREE.Group[] = [];
  private readonly soot = this.makeSoot(false);
  private readonly damage = this.makeSoot(true);
  private readonly cloud = this.makeCloud();

  constructor() {
    this.group.name = "Flygkrascher";
  }

  private makeCloud(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Kunde inte skapa texturen för eld och rök.");
    const image = ctx.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const radius = Math.hypot(x - 64, y - 64) / 61;
      const turbulence = noise(x / 13, y / 13) * 0.65 + noise(x / 5, y / 5) * 0.35;
      const density = Math.max(0, 1 - radius + (turbulence - 0.5) * 0.55);
      const index = (y * 128 + x) * 4;
      const shade = 100 + turbulence * 155;
      image.data[index] = image.data[index + 1] = image.data[index + 2] = shade;
      image.data[index + 3] = Math.min(255, density ** 1.6 * 255);
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private makeSoot(cracks: boolean): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Kunde inte skapa texturen för brandskador.");
    const gradient = ctx.createRadialGradient(128, 128, 12, 128, 128, 124);
    gradient.addColorStop(0, "rgba(9,7,5,0.98)");
    gradient.addColorStop(0.4, "rgba(22,17,13,0.9)");
    gradient.addColorStop(0.75, "rgba(35,29,23,0.5)");
    gradient.addColorStop(1, "rgba(35,29,23,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    const image = ctx.getImageData(0, 0, 256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      image.data[(y * 256 + x) * 4 + 3] *= 0.35 + noise(x / 17, y / 17) * 0.65;
    }
    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = "#211c17";
    for (let i = 0; cracks && i < 11; i++) {
      const angle = i * 2.399;
      ctx.lineWidth = 0.6 + i % 3 * 0.35;
      ctx.beginPath();
      ctx.moveTo(128 + Math.cos(angle) * 22, 128 + Math.sin(angle) * 22);
      const length = 60 + i % 4 * 14;
      for (let r = 30; r <= length; r += 10) {
        const bend = angle + (noise(i, r * 0.1) - 0.5) * 0.5;
        ctx.lineTo(128 + Math.cos(bend) * r, 128 + Math.sin(bend) * r);
      }
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  impact(impact: AircraftImpact, scene: THREE.Scene, excluded: THREE.Object3D[],
    groundHeight: (x: number, z: number) => number): void {
    const scar = new THREE.Group();
    scar.name = "Bestående brandskada";
    if (impact.ground) {
      const geometry = new THREE.PlaneGeometry(17, 17, 16, 16);
      geometry.rotateX(-Math.PI / 2);
      const points = geometry.attributes.position;
      for (let i = 0; i < points.count; i++) {
        const x = points.getX(i) + impact.contact.x, z = points.getZ(i) + impact.contact.z;
        points.setXYZ(i, x, groundHeight(x, z) + 0.085, z);
      }
      geometry.computeVertexNormals();
      scar.add(new THREE.Mesh(geometry, this.scarMaterial()));
    } else {
      this.surfaceDamage(scar, impact.contact, scene, [...excluded, this.group]);
    }
    this.group.add(scar);
    this.scars.push(scar);
    if (this.scars.length > 16) this.dispose(this.scars.shift()!);

    const group = new THREE.Group();
    group.name = "Eldklot och rök";
    group.position.copy(impact.position);
    const particles: Particle[] = [];
    for (let i = 0; i < 38; i++) {
      const smoke = i >= 18;
      const mat = new THREE.SpriteMaterial({
        map: this.cloud,
        color: smoke ? 0x34312e : i % 3 === 0 ? 0xffe29a : i % 3 === 1 ? 0xff8b18 : 0xe63c08,
        transparent: true, opacity: smoke ? 0 : 0.95, depthWrite: false,
        blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
        rotation: i * 2.399,
      });
      const sprite = new THREE.Sprite(mat);
      const angle = i * 2.399;
      const velocity = new THREE.Vector3(Math.cos(angle) * (2 + i % 4), 2 + i % 5, Math.sin(angle) * (2 + i % 4));
      sprite.position.copy(velocity).multiplyScalar(0.18);
      sprite.scale.setScalar(smoke ? 3 : 5);
      sprite.renderOrder = smoke ? 2 : 1;
      group.add(sprite);
      particles.push({ sprite, velocity, smoke });
    }
    const light = new THREE.PointLight(0xff8c24, 800, 65, 2);
    group.add(light);
    this.group.add(group);
    this.bursts.push({ group, particles, light, age: 0 });
  }

  private scarMaterial(cracks = false): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map: cracks ? this.damage : this.soot, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide,
    });
  }

  private surfaceDamage(scar: THREE.Group, point: THREE.Vector3, scene: THREE.Scene, excluded: THREE.Object3D[]): void {
    scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    const collect = (object: THREE.Object3D): void => {
      if (excluded.includes(object) || !object.visible) return;
      if (object instanceof THREE.Mesh) meshes.push(object);
      for (const child of object.children) collect(child);
    };
    collect(scene);
    const ray = new THREE.Raycaster();
    let closest: THREE.Intersection | undefined;
    // Collision probes stop just outside geometry; look in every direction, including wing-tip impacts.
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (x === 0 && y === 0 && z === 0) continue;
      const direction = new THREE.Vector3(x, y, z).normalize();
      ray.set(point.clone().addScaledVector(direction, 2.5), direction.negate());
      ray.far = 5;
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) hit.distance = hit.point.distanceTo(point);
      if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
    }
    if (!closest || !(closest.object instanceof THREE.Mesh) || !closest.face) {
      console.warn("Kraschens kollisionsvolym saknar en närliggande synlig yta för brandskada.", point);
      return;
    }
    const source = closest.object;
    const projectionMaterial = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(source.geometry, projectionMaterial);
    mesh.matrixWorld.copy(source.matrixWorld);
    if (source instanceof THREE.InstancedMesh && closest.instanceId !== undefined) {
      const instance = new THREE.Matrix4();
      source.getMatrixAt(closest.instanceId, instance);
      mesh.matrixWorld.multiply(instance);
    }
    const normal = closest.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
    const orientation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal));
    const geometry = new DecalGeometry(mesh, closest.point, orientation, new THREE.Vector3(12, 12, 3));
    projectionMaterial.dispose();
    scar.add(new THREE.Mesh(geometry, this.scarMaterial(true)));
    for (let i = 0; i < 14; i++) {
      const debris = new THREE.Mesh(new THREE.TetrahedronGeometry(0.15 + i % 4 * 0.12),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x51483e : 0x292622, roughness: 1 }));
      debris.position.copy(closest.point).addScaledVector(normal, 0.2 + i % 3 * 0.15);
      const offset = new THREE.Vector3(Math.cos(i * 2.399), Math.sin(i * 2.399), 0)
        .applyEuler(orientation).multiplyScalar(0.6 + i % 5 * 0.45);
      debris.position.add(offset);
      debris.rotation.set(i, i * 0.7, i * 0.3);
      scar.add(debris);
    }
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.age += dt;
      for (const { sprite, velocity, smoke } of burst.particles) {
        sprite.position.addScaledVector(velocity, dt * (smoke ? 0.5 : Math.exp(-burst.age)));
        if (smoke) sprite.position.y += dt * 1.2;
        sprite.scale.setScalar(smoke ? 4 + burst.age * 1.3 : 5 + Math.min(burst.age, 1.5) * 4);
        sprite.material.rotation += dt * (smoke ? 0.12 : 0.3);
        sprite.material.opacity = smoke
          ? Math.min(0.85, burst.age * 0.5) * Math.max(0, 1 - burst.age / 12)
          : Math.max(0, 1 - burst.age / 3);
      }
      burst.light.intensity = 800 * Math.max(0, 1 - burst.age / 2.5);
      if (burst.age >= 12) {
        this.dispose(burst.group);
        this.bursts.splice(i, 1);
      }
    }
  }

  private dispose(group: THREE.Group): void {
    group.removeFromParent();
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite)) return;
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) mat.dispose();
    });
  }

}

function noise(x: number, y: number): number {
  const hash = (a: number, b: number): number => {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), sx),
    THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx), sy,
  );
}
