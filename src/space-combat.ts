import * as THREE from "three";
import { radialGlowTexture } from "./space-shaders";

/** Laser bolt in frame coordinates (km). */
export type Bolt = { position: THREE.Vector3; velocity: THREE.Vector3; life: number; mesh: THREE.Mesh };

/** Pooled laser bolts: bright cores with additive halos, so they bloom against black space. */
export class Lasers {
  readonly group = new THREE.Group();
  readonly bolts: Bolt[] = [];
  private readonly pool: THREE.Mesh[] = [];
  private readonly geometry = new THREE.CylinderGeometry(0.00022, 0.00022, 0.012, 8, 1, true);
  private readonly material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(4, 0.6, 0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  private readonly halo = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.6, 0.18, 0.12), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  private readonly haloGeometry = new THREE.CylinderGeometry(0.0008, 0.0008, 0.014, 10, 1, true);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.group.name = "Laserskott";
  }

  fire(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, inherit: THREE.Vector3): void {
    const mesh = this.pool.pop() ?? this.makeBolt();
    mesh.visible = true;
    const velocity = direction.clone().normalize().multiplyScalar(speed).add(inherit);
    mesh.quaternion.setFromUnitVectors(this.up, direction.clone().normalize());
    mesh.position.copy(origin);
    this.group.add(mesh);
    this.bolts.push({ position: origin.clone(), velocity, life: 2.4, mesh });
  }

  private makeBolt(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.add(new THREE.Mesh(this.haloGeometry, this.halo));
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    return mesh;
  }

  /** Moves every bolt one step; `hit` decides whether a bolt's swept segment struck something. */
  update(dt: number, hit: (from: THREE.Vector3, to: THREE.Vector3) => boolean): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      const from = bolt.position.clone();
      bolt.position.addScaledVector(bolt.velocity, dt);
      bolt.life -= dt;
      bolt.mesh.position.copy(bolt.position);
      if (bolt.life <= 0 || hit(from, bolt.position)) this.release(i);
    }
  }

  private release(index: number): void {
    const [bolt] = this.bolts.splice(index, 1);
    bolt.mesh.visible = false;
    bolt.mesh.removeFromParent();
    this.pool.push(bolt.mesh);
  }

  clear(): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) this.release(i);
  }

  /** Re-expresses every bolt in a new flight frame. */
  rebase(point: (v: THREE.Vector3) => void, rotation: THREE.Quaternion): void {
    for (const bolt of this.bolts) {
      point(bolt.position);
      bolt.velocity.applyQuaternion(rotation);
      bolt.mesh.position.copy(bolt.position);
      bolt.mesh.quaternion.premultiply(rotation);
    }
  }
}

type Spark = { sprite: THREE.Sprite; velocity: THREE.Vector3; age: number; life: number; size: number };

/** Small impact flashes, molten sparks and rock dust where lasers hit (frame coordinates, km). */
export class Impacts {
  readonly group = new THREE.Group();
  private readonly sparks: Spark[] = [];
  private readonly glow = radialGlowTexture([[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,200,140,0.7)"], [1, "rgba(0,0,0,0)"]]);
  private readonly dust: THREE.Texture;

  constructor(dust: THREE.Texture) {
    this.dust = dust;
    this.group.name = "Träffar";
  }

  private spawn(map: THREE.Texture, color: THREE.Color, additive: boolean, position: THREE.Vector3,
    velocity: THREE.Vector3, life: number, size: number): void {
    const reuse = this.sparks.find(s => s.age >= s.life && s.sprite.material.map === map);
    const sprite = reuse?.sprite ?? new THREE.Sprite(new THREE.SpriteMaterial({
      map, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    sprite.material.color.copy(color);
    sprite.position.copy(position);
    sprite.visible = true;
    this.group.add(sprite);
    if (reuse) Object.assign(reuse, { velocity, age: 0, life, size });
    else this.sparks.push({ sprite, velocity, age: 0, life, size });
  }

  /** Small hit: a flash, a few sparks and a puff of dust. `big` is a shattering rock or destroyed satellite. */
  burst(position: THREE.Vector3, normal: THREE.Vector3, scale: number, big = false): void {
    const flash = new THREE.Color(big ? 9 : 5, big ? 6.5 : 3.6, big ? 4 : 2.2);
    this.spawn(this.glow, flash, true, position, new THREE.Vector3(), big ? 0.5 : 0.18, scale * (big ? 3 : 1.2));
    for (let i = 0; i < (big ? 26 : 8); i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().add(normal).normalize();
      this.spawn(this.glow, new THREE.Color(4, 1.8, 0.6), true, position,
        dir.multiplyScalar(scale * (2 + Math.random() * 6)), 0.4 + Math.random() * 0.6, scale * 0.12);
    }
    for (let i = 0; i < (big ? 14 : 4); i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().add(normal).normalize();
      this.spawn(this.dust, new THREE.Color(0.32, 0.3, 0.28), false, position,
        dir.multiplyScalar(scale * (0.4 + Math.random() * 1.2)), 1.6 + Math.random(), scale * (big ? 1.4 : 0.6));
    }
  }

  update(dt: number): void {
    for (const s of this.sparks) {
      if (s.age >= s.life) continue;
      s.age += dt;
      s.sprite.position.addScaledVector(s.velocity, dt);
      const t = Math.min(1, s.age / s.life);
      s.sprite.scale.setScalar(s.size * (s.sprite.material.blending === THREE.AdditiveBlending ? 1 - t * 0.5 : 1 + t * 2));
      s.sprite.material.opacity = (1 - t) * (s.sprite.material.blending === THREE.AdditiveBlending ? 1 : 0.6);
      if (s.age >= s.life) s.sprite.visible = false;
    }
  }

  clear(): void {
    for (const s of this.sparks) { s.age = s.life; s.sprite.visible = false; }
  }

  rebase(point: (v: THREE.Vector3) => void, rotation: THREE.Quaternion): void {
    for (const s of this.sparks) {
      if (s.age >= s.life) continue;
      point(s.sprite.position);
      s.velocity.applyQuaternion(rotation);
    }
  }
}

function panelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#101a33";
  ctx.fillRect(0, 0, 256, 512);
  for (let y = 0; y < 512; y += 32) for (let x = 0; x < 256; x += 32) {
    ctx.fillStyle = `rgb(${20 + Math.random() * 10},${36 + Math.random() * 12},${90 + Math.random() * 30})`;
    ctx.fillRect(x + 2, y + 2, 28, 28);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Communication / weather satellite: gold-foil bus, two solar wings, a dish and a blinking beacon (metres). */
export function createSatellite(variant: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "Satellit";
  const foil = new THREE.MeshStandardMaterial({ color: variant % 2 ? 0xc9962f : 0xd8d8d2, metalness: 0.9, roughness: 0.32 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe6e7ea, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.5, metalness: 0.5 });
  const cells = new THREE.MeshStandardMaterial({ map: panelTexture(), metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 2.2), foil);
  group.add(body);
  for (const side of [-1, 1]) {
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8), dark);
    boom.rotation.z = Math.PI / 2;
    boom.position.x = side * 1.8;
    group.add(boom);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.06, 2), cells);
    wing.position.x = side * (2.5 + 2.75);
    group.add(wing);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.32), white);
  dish.material.side = THREE.DoubleSide;
  dish.position.set(0, 1.3, 1.6);
  dish.rotation.x = -Math.PI / 2.6;
  group.add(dish);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), dark);
  feed.position.set(0, 1.7, 2.1);
  feed.rotation.x = -Math.PI / 2.6;
  group.add(feed);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.4, 0.3) }));
  beacon.position.set(0, -1.4, 0);
  beacon.name = "Ljusfyr";
  group.add(beacon);
  group.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true; });
  group.scale.setScalar(0.0018);
  return group;
}

/** A drifting, slowly tumbling target satellite in frame coordinates (km). */
export type Satellite = { object: THREE.Group; velocity: THREE.Vector3; spin: THREE.Vector3; health: number; radius: number };

export function spawnSatellites(count: number, center: THREE.Vector3, spread: number, seed: number): Satellite[] {
  let s = seed;
  const random = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return Array.from({ length: count }, (_, i) => {
    const object = createSatellite(i);
    object.position.set(center.x + (random() - 0.5) * spread, center.y + (random() - 0.5) * spread * 0.4, center.z + (random() - 0.2) * spread);
    object.rotation.set(random() * 6, random() * 6, random() * 6);
    return {
      object,
      velocity: new THREE.Vector3(random() - 0.5, (random() - 0.5) * 0.3, random() - 0.5).multiplyScalar(0.004),
      spin: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(0.3),
      health: 3,
      radius: 0.011,
    };
  });
}
