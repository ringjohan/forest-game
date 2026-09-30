import * as THREE from 'three';
import { CITY_TRAIL, LANDMARKS, LAKE, SPAWN, WORLD_LIMIT, WORLD_SIZE } from './world-types';
import type { House } from './world-types';
import { onForestApproach } from './geography';
import { TREEHOUSE, Treehouse } from './treehouse';
export type { House } from './world-types';

type Point = { x: number; z: number };
type Circle = Point & { radius: number };
type Building = Point & { halfX: number; halfZ: number; rotation: number };
type Instance = { matrix: THREE.Matrix4; color: THREE.Color };
type Batch = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  instances: Instance[];
  shadow: boolean;
};

const GRID = 280;
const STEP = WORLD_SIZE / GRID;
const HALF = WORLD_SIZE / 2;
const WATER_LEVEL = -0.85;
const UP = new THREE.Vector3(0, 1, 0);
const VILLAGE_LAYOUTS = [
  [[-14, 8], [14, 8], [-5, -19], [19, -14]],
  [[-7, -16], [13, -6], [16, 13]],
  [[-15, 5], [13, -8], [1, 17], [3, -18]],
  [[-14, 8], [14, 8], [-9, -16], [11, -17]],
];

export const PATHS: readonly (readonly { x: number; z: number }[])[] = [
  [{ x: 0, z: 67 }, SPAWN, { x: 0, z: 0 }],
  CITY_TRAIL,
  [{ x: 0, z: 67 }, { x: TREEHOUSE.x - 3, z: TREEHOUSE.z + 1.5 }],
  [
    { x: 0, z: 0 }, { x: -23, z: -15 }, { x: -52, z: -39 },
    { x: -73, z: -67 }, { x: -99, z: -85 },
  ],
  [
    { x: 0, z: 0 }, { x: 10, z: -23 }, { x: 29, z: -52 },
    { x: 43, z: -70 }, { x: 69, z: -79 }, { x: 91, z: -77 },
    { x: 99, z: -60 },
  ],
  [{ x: 99, z: -60 }, { x: 118, z: -41 }, { x: 126, z: -12 }],
  [{ x: -99, z: -85 }, { x: -119, z: -112 }, { x: -140, z: -135 }],
  [{ x: 0, z: 45 }, { x: -25, z: 50 }, { x: -51, z: 74 }, { x: -87, z: 85 }],
  // Reserve and paint each approach before terrain and vegetation are generated.
  ...LANDMARKS.flatMap((village, index) =>
    VILLAGE_LAYOUTS[index % VILLAGE_LAYOUTS.length].map(([dx, dz]) => {
      const length = Math.hypot(dx, dz);
      return [
        { x: village.x, z: village.z },
        { x: village.x + dx * (1 - 5.5 / length), z: village.z + dz * (1 - 5.5 / length) },
      ];
    })),
];

function smooth(a: number, b: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(0, 1, x - ix);
  const fz = smooth(0, 1, z - iz);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), fx),
    THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx),
    fz,
  );
}

/** A deterministic landscape. Collision and placement use the rendered terrain triangles. */
export class World {
  readonly treehouse: Treehouse;
  private readonly houseList: House[] = [];
  readonly houses: readonly House[] = this.houseList;
  private readonly scene: THREE.Scene;
  private seed = 19051987;
  private readonly heights = new Float32Array((GRID + 1) * (GRID + 1));
  private readonly circles: Circle[] = [];
  private readonly treeVolumes: (Circle & { bottom: number; top: number; trunkRadius: number })[] = [];
  private readonly buildings: Building[] = [];
  private readonly collisionCells = new Map<string, Circle[]>();
  private readonly batches = new Map<string, Batch>();
  private readonly dummy = new THREE.Object3D();
  private readonly waterTime = { value: 0 };
  private readonly breezeTime = { value: 0 };
  private readonly smoke: THREE.Sprite[] = [];
  private readonly smokeHomes: THREE.Vector3[] = [];
  private readonly birds: THREE.Group[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.makeTerrain();
    this.prepareBatches();
    this.makeVillages();
    this.makeForest();
    this.makeGroundCover();
    this.treehouse = new Treehouse(scene, (x, z) => this.heightAt(x, z));
    this.obstacle(TREEHOUSE.x - 3, TREEHOUSE.z, 0.9);
    this.makeLake();
    this.makeMountains();
    this.makeCityTrailSigns();
    this.makeBirds();
    this.finishBatches();
  }

  heightAt(x: number, z: number): number {
    const gx = THREE.MathUtils.clamp((x + HALF) / STEP, 0, GRID - 0.000001);
    const gz = THREE.MathUtils.clamp((z + HALF) / STEP, 0, GRID - 0.000001);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const a = iz * (GRID + 1) + ix;
    const h00 = this.heights[a];
    const h10 = this.heights[a + 1];
    const h01 = this.heights[a + GRID + 1];
    const h11 = this.heights[a + GRID + 2];
    return fx + fz <= 1
      ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
      : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  nearHouse(x: number, z: number): House | undefined {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
    let nearest: House | undefined;
    let distance = 3;
    for (const house of this.houses) {
      const candidate = Math.hypot(x - house.entrance.x, z - house.entrance.z);
      if (candidate <= distance) {
        nearest = house;
        distance = candidate;
      }
    }
    return nearest;
  }

  flightBlocked(x: number, y: number, z: number, radius: number): boolean {
    if (this.treehouse.solidAt(x, y, z, radius)) return true;
    if (Math.abs(x) > HALF + radius + 8 || Math.abs(z) > HALF + radius + 8) return false;
    if (this.treeVolumes.some(tree => y + radius > tree.bottom && y - radius < tree.top
      && Math.hypot(x - tree.x, z - tree.z) < tree.radius + radius)) return true;
    return this.buildings.some(building => {
      if (y - radius > this.heightAt(building.x, building.z) + 10) return false;
      const dx = x - building.x;
      const dz = z - building.z;
      const c = Math.cos(building.rotation);
      const s = Math.sin(building.rotation);
      return Math.abs(dx * c - dz * s) < building.halfX + radius
        && Math.abs(dx * s + dz * c) < building.halfZ + radius;
    });
  }

  projectileBlocked(point: THREE.Vector3): boolean {
    if (point.y <= this.heightAt(point.x, point.z) || this.treehouse.solidAt(point.x, point.y, point.z, 0.04)) return true;
    for (const tree of this.treeVolumes) {
      if (point.y < tree.bottom || point.y > tree.top) continue;
      const radius = point.y < tree.bottom + (tree.top - tree.bottom) * 0.52 ? tree.trunkRadius : tree.radius;
      if (Math.hypot(point.x - tree.x, point.z - tree.z) < radius + 0.04) return true;
    }
    return this.buildings.some(building => {
      if (point.y > this.heightAt(building.x, building.z) + 10) return false;
      const dx = point.x - building.x;
      const dz = point.z - building.z;
      const c = Math.cos(building.rotation);
      const s = Math.sin(building.rotation);
      return Math.abs(dx * c - dz * s) < building.halfX + 0.04
        && Math.abs(dx * s + dz * c) < building.halfZ + 0.04;
    });
  }

  blocked(x: number, z: number, radius = 0.45): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius)) return true;
    radius = Math.max(0, radius);
    if ((Math.abs(x) + radius > WORLD_LIMIT || Math.abs(z) + radius > WORLD_LIMIT)
      && !onForestApproach(x, z, radius)) return true;
    // A conservative offset ellipse keeps the capsule safely clear of the waterline.
    if (this.lakeDistance(x, z, radius + 1.5) < 1) return true;
    for (const building of this.buildings) {
      const dx = x - building.x;
      const dz = z - building.z;
      const c = Math.cos(building.rotation);
      const s = Math.sin(building.rotation);
      const localX = dx * c - dz * s;
      const localZ = dx * s + dz * c;
      const ex = Math.max(Math.abs(localX) - building.halfX, 0);
      const ez = Math.max(Math.abs(localZ) - building.halfZ, 0);
      if (ex * ex + ez * ez <= radius * radius) return true;
    }
    const minX = Math.floor((x - radius - 3) / 12);
    const maxX = Math.floor((x + radius + 3) / 12);
    const minZ = Math.floor((z - radius - 3) / 12);
    const maxZ = Math.floor((z + radius + 3) / 12);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const obstacles = this.collisionCells.get(`${cx},${cz}`);
        if (!obstacles) continue;
        for (const obstacle of obstacles) {
          if (Math.hypot(x - obstacle.x, z - obstacle.z) < radius + obstacle.radius) return true;
        }
      }
    }
    return false;
  }

  update(elapsed: number, dt: number): void {
    this.waterTime.value = elapsed;
    this.breezeTime.value = elapsed;
    for (let i = 0; i < this.smoke.length; i++) {
      const phase = (elapsed * 0.055 + i * 0.237) % 1;
      const sprite = this.smoke[i];
      const home = this.smokeHomes[i];
      sprite.position.set(
        home.x + phase * 2.7 + Math.sin(elapsed * 0.3 + i) * phase * 0.3,
        home.y + phase * 6,
        home.z + phase * 0.7,
      );
      sprite.scale.setScalar(0.7 + phase * 2.6);
      (sprite.material as THREE.SpriteMaterial).opacity = Math.sin(phase * Math.PI) * 0.14;
    }
    for (let i = 0; i < this.birds.length; i++) {
      const bird = this.birds[i];
      const angle = elapsed * (0.055 + i * 0.004) + i * 1.3;
      bird.position.set(28 + Math.cos(angle) * (42 + i * 5), 33 + Math.sin(angle * 2) * 3 + i, -25 + Math.sin(angle) * 42);
      bird.rotation.y = -angle;
      const flap = Math.sin(elapsed * 4.5 + i) * 0.3;
      bird.children[0].rotation.z = flap;
      bird.children[1].rotation.z = -flap;
    }
    // The absolute clock drives animations, so pause/resume never accumulates integration drift.
    void dt;
  }

  private random(): number {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private range(min: number, max: number): number {
    return min + this.random() * (max - min);
  }

  private lakeDistance(x: number, z: number, padding = 0): number {
    return Math.hypot((x - LAKE.x) / (LAKE.rx + padding), (z - LAKE.z) / (LAKE.rz + padding));
  }

  private pathDistance(x: number, z: number): number {
    let distance = Infinity;
    for (const path of PATHS) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
        distance = Math.min(distance, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
      }
    }
    return distance;
  }

  private naturalHeight(x: number, z: number): number {
    return 2.7 + Math.sin(x * 0.019 + z * 0.012) * 3.1
      + Math.cos(z * 0.027 - x * 0.009) * 2.1
      + (noise(x * 0.025, z * 0.025) - 0.5) * 4.5
      + (noise(x * 0.08, z * 0.08) - 0.5) * 0.85
      + smooth(118, 210, Math.hypot(x * 0.7, z)) * 9;
  }

  private sampleHeight(x: number, z: number): number {
    let height = this.naturalHeight(x, z);
    for (const village of LANDMARKS) {
      const weight = 1 - smooth(village.radius - 1, village.radius + 15, Math.hypot(x - village.x, z - village.z));
      height = THREE.MathUtils.lerp(height, this.naturalHeight(village.x, village.z), weight);
    }
    const lake = this.lakeDistance(x, z);
    const bed = -5.8 + Math.min(lake * lake, 1) * 3.7;
    height = THREE.MathUtils.lerp(bed, height, smooth(0.94, 1.19, lake));
    return height * (1 - smooth(125, 205, z));
  }

  private makeTerrain(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const grassDark = new THREE.Color('#435b30');
    const grassLight = new THREE.Color('#7d8746');
    const soil = new THREE.Color('#a49570');
    const shore = new THREE.Color('#a89e78');
    const color = new THREE.Color();
    for (let iz = 0; iz <= GRID; iz++) {
      for (let ix = 0; ix <= GRID; ix++) {
        const x = ix * STEP - HALF;
        const z = iz * STEP - HALF;
        const y = this.sampleHeight(x, z);
        this.heights[iz * (GRID + 1) + ix] = y;
        positions.push(x, y, z);
        uvs.push(x / 11, z / 11);
        const variation = noise(x * 0.045, z * 0.045) * 0.8 + noise(x * 0.29, z * 0.29) * 0.2;
        color.copy(grassDark).lerp(grassLight, variation);
        const path = this.pathDistance(x, z);
        const ragged = (noise(x * 0.9, z * 0.9) - 0.5) * 0.65;
        let dirt = 1 - smooth(1.3, 2.5, path + ragged);
        for (const village of LANDMARKS) {
          dirt = Math.max(dirt, (1 - smooth(4, 11, Math.hypot(x - village.x, z - village.z))) * 0.88);
        }
        color.lerp(soil, dirt);
        const lake = this.lakeDistance(x, z);
        color.lerp(shore, (1 - smooth(1.02, 1.19, lake)) * 0.9);
        color.multiplyScalar(0.89 + noise(x * 1.7, z * 1.7) * 0.2);
        colors.push(color.r, color.g, color.b);
        if (ix < GRID && iz < GRID) {
          const a = iz * (GRID + 1) + ix;
          indices.push(a, a + GRID + 1, a + 1, a + 1, a + GRID + 1, a + GRID + 2);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const texture = this.groundTexture();
    const material = new THREE.MeshStandardMaterial({
      map: texture, bumpMap: texture, bumpScale: 0.12, vertexColors: true, roughness: 1,
    });
    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    this.scene.add(terrain);
  }

  private groundTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#b6b2a0';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 13000; i++) {
      const value = Math.floor(this.range(100, 215));
      ctx.fillStyle = `rgba(${value},${value},${Math.floor(value * 0.93)},${this.range(0.1, 0.45)})`;
      const x = this.random() * 256;
      const y = this.random() * 256;
      ctx.fillRect(x, y, this.range(0.5, 2), this.range(0.5, 3));
    }
    for (let i = 0; i < 160; i++) {
      ctx.strokeStyle = 'rgba(67,64,45,0.14)';
      ctx.beginPath();
      const x = this.random() * 256;
      const y = this.random() * 256;
      ctx.moveTo(x, y);
      ctx.lineTo(x + this.range(-4, 4), y + this.range(2, 8));
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  }

  private barkTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#b2a28a';
    ctx.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 240; i++) {
      const x = this.random() * 128;
      const y = this.random() * 256;
      ctx.strokeStyle = `rgba(43,33,24,${this.range(0.06, 0.4)})`;
      ctx.lineWidth = this.range(0.5, 2.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 2, y + 10, x - 3, y + 24, x + 1, y + this.range(20, 80));
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  private prepareBatches(): void {
    const bark = this.barkTexture();
    const standard = (color: string, options: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.94, ...options });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const trunk = new THREE.CylinderGeometry(0.7, 1, 1, 7, 2);
    const branch = new THREE.CylinderGeometry(0.45, 1, 1, 5);
    const crown = new THREE.IcosahedronGeometry(1, 2);
    const crownPositions = crown.getAttribute('position');
    for (let i = 0; i < crownPositions.count; i++) {
      const x = crownPositions.getX(i);
      const y = crownPositions.getY(i);
      const z = crownPositions.getZ(i);
      const factor = 0.87 + noise(x * 5 + y, z * 5) * 0.25;
      crownPositions.setXYZ(i, x * factor, y * factor, z * factor);
    }
    crown.computeVertexNormals();
    const leafTexture = this.leafTexture();
    const foliage = standard('#ffffff', { map: leafTexture, bumpMap: leafTexture, bumpScale: 0.09, roughness: 1 });
    this.wind(foliage, 0.12);
    this.batch('trunk', trunk, standard('#ffffff', { map: bark, bumpMap: bark, bumpScale: 0.16 }));
    this.batch('branch', branch, standard('#ffffff', { map: bark }));
    this.batch('crown', crown, foliage);
    const pine = new THREE.ConeGeometry(1, 1, 11, 4, true);
    const pinePositions = pine.getAttribute('position');
    for (let i = 0; i < pinePositions.count; i++) {
      const x = pinePositions.getX(i);
      const y = pinePositions.getY(i);
      const z = pinePositions.getZ(i);
      const jitter = 0.84 + noise(x * 14, z * 14 + y * 7) * 0.35;
      pinePositions.setXYZ(i, x * jitter, y + (Math.abs(x) + Math.abs(z)) * Math.sin(x * 13 + z * 7) * 0.07, z * jitter);
    }
    pine.computeVertexNormals();
    this.batch('pine', pine, foliage);
    this.batch('rock', new THREE.DodecahedronGeometry(1, 1), standard('#ffffff'));
    this.batch('plaster', box, standard('#ffffff'));
    this.batch('wood', box, standard('#ffffff', { map: bark, bumpMap: bark, bumpScale: 0.035 }));
    this.batch('roof', box, standard('#ffffff', { map: this.roofTexture(), bumpScale: 0.1 }));
    this.batch('stone', box, standard('#ffffff', { map: this.groundTexture() }));
    this.batch('window', box, standard('#efd095', { emissive: '#d09345', emissiveIntensity: 0.32, roughness: 0.38 }));
    this.batch('metal', box, standard('#373e36', { metalness: 0.4, roughness: 0.6 }));
    this.batch('gable', this.gableGeometry(), standard('#ffffff'));
    this.batch('barrel', new THREE.CylinderGeometry(0.48, 0.43, 1, 10), standard('#796044', { map: bark }));
    this.batch('pot', new THREE.CylinderGeometry(0.43, 0.3, 0.65, 9), standard('#a16f50'));
    this.batch('flower', new THREE.IcosahedronGeometry(1, 0), standard('#ffffff'), false);
    const grass = standard('#ffffff', { side: THREE.DoubleSide, vertexColors: true });
    this.wind(grass, 0.22);
    this.batch('grass', this.grassGeometry(), grass, false);
    const reeds = standard('#ffffff', { side: THREE.DoubleSide, vertexColors: true });
    this.wind(reeds, 0.11);
    this.batch('reed', this.grassGeometry(), reeds, false);
    this.batch('pebble', new THREE.IcosahedronGeometry(1, 0), standard('#ffffff'), false);
  }

  private wind(material: THREE.MeshStandardMaterial, strength: number): void {
    material.onBeforeCompile = shader => {
      shader.uniforms.uBreezeTime = this.breezeTime;
      shader.vertexShader = `uniform float uBreezeTime;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 origin = instanceMatrix[3].xyz;
          float wave = sin(uBreezeTime * 1.25 + origin.x * 0.14 + origin.z * 0.09);
          transformed.x += wave * ${strength.toFixed(2)} * max(0.0, position.y + 0.4);
          transformed.z += cos(uBreezeTime * 0.85 + origin.x * 0.08) * ${strength.toFixed(2)} * 0.35 * max(0.0, position.y);
        #endif
      `);
    };
    material.customProgramCacheKey = () => `forest-wind-${strength}`;
  }

  private roofTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#b7aaa0';
    ctx.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 16; row++) {
      for (let col = -1; col < 12; col++) {
        const brightness = Math.floor(this.range(120, 185));
        ctx.fillStyle = `rgb(${brightness},${brightness - 6},${brightness - 12})`;
        ctx.fillRect(col * 12 + (row % 2) * 6, row * 8, 11, 7);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 2);
    return texture;
  }

  private leafTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#dde0ce';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1100; i++) {
      const brightness = Math.floor(this.range(165, 249));
      ctx.fillStyle = `rgba(${brightness},${brightness},${Math.floor(brightness * 0.94)},0.48)`;
      ctx.beginPath();
      ctx.ellipse(this.random() * 128, this.random() * 128, this.range(1, 2.5), this.range(2, 4.5),
        this.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.anisotropy = 4;
    return texture;
  }

  private gableGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5,
      0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5,
      -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5,
      -0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
      0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -0.5,
      0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
    ], 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  private grassGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (let blade = 0; blade < 5; blade++) {
      const angle = blade * 2.4;
      const x = Math.cos(angle) * 0.22;
      const z = Math.sin(angle) * 0.22;
      const dx = Math.cos(angle + 1) * 0.055;
      const dz = Math.sin(angle + 1) * 0.055;
      const h = 0.55 + blade % 3 * 0.19;
      const base = positions.length / 3;
      positions.push(
        x - dx, 0, z - dz, x + dx, 0, z + dz,
        x + dx + x * 0.35, h * 0.56, z + dz + z * 0.35,
        x - dx + x * 0.35, h * 0.56, z - dz + z * 0.35,
        x * 2.1, h, z * 2.1,
      );
      colors.push(0.43, 0.49, 0.29, 0.43, 0.49, 0.29, 0.8, 0.85, 0.57, 0.8, 0.85, 0.57, 1, 1, 0.78);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3, base + 3, base + 2, base + 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, shadow = true): void {
    this.batches.set(name, { geometry, material, instances: [], shadow });
  }

  private add(
    name: string, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, color: THREE.ColorRepresentation,
    ry = 0, rx = 0, rz = 0,
  ): void {
    this.dummy.position.set(x, y, z);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.rotation.set(rx, ry, rz);
    this.dummy.updateMatrix();
    this.batches.get(name)!.instances.push({ matrix: this.dummy.matrix.clone(), color: new THREE.Color(color) });
  }

  private beam(name: string, from: THREE.Vector3, to: THREE.Vector3, thickness: number, color: string): void {
    const direction = to.clone().sub(from);
    this.dummy.position.copy(from).add(to).multiplyScalar(0.5);
    this.dummy.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
    this.dummy.scale.set(thickness, direction.length(), thickness);
    this.dummy.updateMatrix();
    this.batches.get(name)!.instances.push({ matrix: this.dummy.matrix.clone(), color: new THREE.Color(color) });
  }

  private obstacle(x: number, z: number, radius: number): void {
    const obstacle = { x, z, radius };
    this.circles.push(obstacle);
    const key = `${Math.floor(x / 12)},${Math.floor(z / 12)}`;
    let cell = this.collisionCells.get(key);
    if (!cell) {
      cell = [];
      this.collisionCells.set(key, cell);
    }
    cell.push(obstacle);
  }

  private makeVillages(): void {
    LANDMARKS.forEach((village, index) => {
      VILLAGE_LAYOUTS[index % VILLAGE_LAYOUTS.length].forEach(([dx, dz], houseIndex) => {
        const x = village.x + dx;
        const z = village.z + dz;
        // The front (+Z) looks back into the common, leaving its central five metres empty.
        const rotation = Math.atan2(-dx, -dz);
        this.house(x, z, rotation, index, houseIndex);
      });
      const bench = [
        { x: 6, z: 3 }, { x: -6, z: -3 }, { x: 3, z: -6 }, { x: -3, z: 6 },
        { x: 8, z: 0 }, { x: -8, z: 0 }, { x: 0, z: 8 }, { x: 0, z: -8 },
      ].map(p => ({ x: village.x + p.x, z: village.z + p.z }))
        .find(p => this.pathDistance(p.x, p.z) > 2.4 && !this.blocked(p.x, p.z, 2));
      if (bench) {
        const y = this.heightAt(bench.x, bench.z);
        this.add('wood', bench.x, y + 0.55, bench.z, 2.5, 0.16, 0.65, '#716044', 0.25);
        for (const side of [-0.85, 0.85]) {
          this.add('wood', bench.x + side, y + 0.25, bench.z, 0.18, 0.5, 0.55, '#5e4a34');
        }
        this.obstacle(bench.x, bench.z, 1.2);
      }
      // The lakeside hamlet is approached from the north, above the shoreline.
      const signX = village.x - 4.1;
      const signZ = village.z + (index === 1 ? -19 : 19);
      const signY = this.heightAt(signX, signZ);
      this.add('wood', signX, signY + 1.25, signZ, 0.16, 2.5, 0.16, '#685039');
      this.add('wood', signX + 0.1, signY + 2.15, signZ, 1.7, 0.38, 0.13, '#b7a278', 0.15);
      this.add('wood', signX - 0.05, signY + 1.7, signZ, 1.25, 0.32, 0.13, '#928263', -0.2);
      this.obstacle(signX, signZ, 0.15);
    });
  }

  private house(x: number, z: number, rotation: number, village: number, index: number): void {
    const width = this.range(5, 6.6);
    const depth = this.range(5.2, 7);
    const wall = this.range(3, 3.6);
    const roofHeight = this.range(2.9, 3.8);
    const y = this.heightAt(x, z);
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const point = (lx: number, ly: number, lz: number) => new THREE.Vector3(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
    const part = (name: string, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: string, rz = 0) => {
      const position = point(lx, ly, lz);
      // YXZ keeps the roof's local slope under the cottage's world-facing yaw.
      this.dummy.position.copy(position);
      this.dummy.rotation.set(0, rotation, rz, 'YXZ');
      this.dummy.scale.set(sx, sy, sz);
      this.dummy.updateMatrix();
      this.batches.get(name)!.instances.push({ matrix: this.dummy.matrix.clone(), color: new THREE.Color(color) });
    };
    const plaster = ['#e0cfaa', '#d5ceb8', '#dcc5a1', '#c6c5aa'][(village + index) % 4];
    const timberColors = ['#584232', '#634937', '#514536', '#66513b'];
    const timber = timberColors[village % timberColors.length];
    const roofColor = ['#85564b', '#677071', '#735950'][(village + index) % 3];
    part('stone', 0, 0.28, 0, width + 0.35, 0.65, depth + 0.3, '#99988a');
    part('plaster', 0, wall / 2 + 0.45, 0, width, wall, depth, plaster);
    part('gable', 0, wall + 0.45, 0, width, roofHeight, depth, plaster);
    const slope = Math.atan2(roofHeight, width / 2);
    const slopeLength = (width / 2 + 0.55) / Math.cos(slope);
    const roofCenterY = wall + 0.45 + roofHeight - (width / 4 + 0.275) * Math.tan(slope);
    for (const side of [-1, 1]) {
      part('roof', side * (width / 4 + 0.275), roofCenterY, 0,
        slopeLength + 0.2, 0.22, depth + 1.15, roofColor, -side * slope);
      part('wood', side * width / 2, wall / 2 + 0.45, depth / 2 + 0.045, 0.2, wall, 0.16, timber);
      part('wood', side * width / 2, wall / 2 + 0.45, -depth / 2 - 0.045, 0.2, wall, 0.16, timber);
      part('wood', side * (width / 2 + 0.04), wall / 2 + 0.45, 0, 0.18, wall, 0.2, timber);
      for (const end of [-1, 1]) {
        this.beam('wood', point(0, wall + roofHeight + 0.48, end * (depth / 2 + 0.13)),
          point(side * (width / 2 + 0.4), wall + 0.45 - 0.4 * Math.tan(slope), end * (depth / 2 + 0.13)), 0.18, timber);
      }
    }
    for (const level of [0.6, 2.05, wall + 0.45]) {
      part('wood', 0, level, depth / 2 + 0.08, width + 0.12, 0.17, 0.17, timber);
      part('wood', 0, level, -depth / 2 - 0.08, width + 0.12, 0.17, 0.17, timber);
      part('wood', -width / 2 - 0.06, level, 0, 0.17, 0.17, depth, timber);
      part('wood', width / 2 + 0.06, level, 0, 0.17, 0.17, depth, timber);
    }
    part('wood', 0, 1.48, depth / 2 + 0.12, 1.22, 2.05, 0.19, '#554637');
    part('wood', 0, 2.61, depth / 2 + 0.17, 1.5, 0.14, 0.21, timber);
    part('metal', 0.39, 1.38, depth / 2 + 0.23, 0.08, 0.12, 0.05, '#b0a173');
    part('stone', 0, 0.2, depth / 2 + 0.6, 1.8, 0.35, 1.05, '#9a998c');
    for (const side of [-1, 1]) {
      const wx = side * width * 0.31;
      part('wood', wx, 2.14, depth / 2 + 0.12, 1.25, 1.37, 0.18, timber);
      part('window', wx, 2.14, depth / 2 + 0.225, 1.02, 1.12, 0.035, '#ffffff');
      part('wood', wx, 2.14, depth / 2 + 0.26, 0.065, 1.14, 0.07, timber);
      part('wood', wx, 2.14, depth / 2 + 0.26, 1.04, 0.065, 0.07, timber);
      part('wood', wx + side * 0.79, 2.14, depth / 2 + 0.12, 0.34, 1.3, 0.1,
        village === 1 ? '#6d8175' : '#847958');
      part('wood', wx, 1.4, depth / 2 + 0.33, 1.35, 0.24, 0.38, '#716044');
      for (let flower = 0; flower < 5; flower++) {
        const p = point(wx + (flower - 2) * 0.2, 1.6 + this.random() * 0.16, depth / 2 + 0.35);
        this.add('crown', p.x, p.y, p.z, 0.22, 0.16, 0.2, '#536e39');
        this.add('flower', p.x, p.y + 0.16, p.z, 0.07, 0.07, 0.07, flower % 2 ? '#d9b06e' : '#d8a4a0');
      }
      // Smaller side windows make the buildings convincing from every approach.
      part('wood', side * (width / 2 + 0.11), 2.05, -0.5, 0.18, 1.25, 1.12, timber);
      part('window', side * (width / 2 + 0.21), 2.05, -0.5, 0.035, 1.01, 0.87, '#ffffff');
      part('wood', side * (width / 2 + 0.24), 2.05, -0.5, 0.07, 1.03, 0.06, timber);
      part('wood', side * (width / 2 + 0.24), 2.05, -0.5, 0.07, 0.06, 0.91, timber);
    }
    part('wood', 0, wall + 1.45, depth / 2 + 0.08, 0.16, 2.05, 0.16, timber);
    part('window', 0, wall + 1.3, depth / 2 + 0.12, 0.6, 0.7, 0.05, '#fff0c8');
    const chimneyHeight = wall + roofHeight + 1;
    part('stone', width * 0.24, chimneyHeight - 1.15, -depth * 0.23, 0.77, 2.8, 0.87, '#918a7a');
    part('stone', width * 0.24, chimneyHeight + 0.29, -depth * 0.23, 0.97, 0.2, 1.07, '#aaa28d');
    part('metal', width * 0.24, chimneyHeight + 0.405, -depth * 0.23, 0.56, 0.03, 0.63, '#36382f');
    if (index < 2) this.chimneySmoke(point(width * 0.24, chimneyHeight + 0.5, -depth * 0.23));
    for (let i = 0; i < 3; i++) {
      const p = point(width / 2 + 0.65, 0.32 + (i === 2 ? 0.5 : 0), -1 + (i % 2) * 0.55);
      this.add('branch', p.x, p.y, p.z, 0.22, 1.5, 0.22, '#8c7352', rotation, Math.PI / 2);
    }
    const barrel = point(-width / 2 - 0.7, 0.53, depth / 2 - 0.65);
    this.add('barrel', barrel.x, barrel.y, barrel.z, 1, 1, 1, '#ffffff');
    this.obstacle(barrel.x, barrel.z, 0.5);
    this.buildings.push({ x, z, halfX: width / 2 + 0.24, halfZ: depth / 2 + 0.3, rotation });
    // The visible doorstep has a small, explicit footprint rather than an invisible porch wall.
    const step = point(0, 0, depth / 2 + 0.5);
    this.buildings.push({ x: step.x, z: step.z, halfX: 0.9, halfZ: 0.55, rotation });
    const entrance = point(0, 0, depth / 2 + 2);
    entrance.y = this.heightAt(entrance.x, entrance.z);
    this.houseList.push({
      id: `${LANDMARKS[village].id}-${index + 1}`,
      name: `${LANDMARKS[village].name} · Stuga ${index + 1}`,
      entrance,
      rotation,
    });
  }

  private chimneySmoke(home: THREE.Vector3): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(215,218,210,0.5)');
    gradient.addColorStop(0.5, 'rgba(205,211,201,0.25)');
    gradient.addColorStop(1, 'rgba(205,211,201,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 3; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, opacity: 0, depthWrite: false }));
      sprite.position.copy(home);
      this.smoke.push(sprite);
      this.smokeHomes.push(home);
      this.scene.add(sprite);
    }
  }

  private makeForest(): void {
    // Deliberate foreground silhouettes frame the first view of Björkby.
    const foreground = [
      [-10, 31, 1], [33, 34, 0], [-13, 21, 0], [34, 18, 2],
      [-20, 38, 2], [36, 45, 0], [-8, 50, 2], [26, 53, 1],
    ];
    for (const [x, z, type] of foreground) this.tree(x, z, type, this.range(12, 17));
    let count = 0;
    for (let attempt = 0; attempt < 9500 && count < 1080; attempt++) {
      const x = this.range(-203, 203);
      const z = this.range(-203, 203);
      if (z > 125 && Math.abs(x) < 55 && this.random() < smooth(125, 205, z) * 0.85) continue;
      if (this.lakeDistance(x, z, 4) < 1.07 || this.pathDistance(x, z) < 4.5) continue;
      if (this.inIntroVista(x, z)) continue;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 7) continue;
      const villageDistance = Math.min(...LANDMARKS.map(v => Math.hypot(x - v.x, z - v.z) - v.radius));
      if (villageDistance < 1) continue;
      if (this.circles.some(tree => Math.hypot(x - tree.x, z - tree.z) < 4.2)) continue;
      const meadow = noise(x * 0.023 + 50, z * 0.023 + 50);
      if (meadow > 0.62 && this.random() < 0.75) continue;
      const pineChance = x < -50 || z < -100 ? 0.64 : 0.29;
      const type = this.random() < pineChance ? 1 : this.random() < 0.22 ? 2 : 0;
      this.tree(x, z, type, this.range(type === 2 ? 10 : 12, type === 1 ? 24 : 20));
      count++;
    }
    // A handful of trees around the commons, not in paths or house approaches.
    for (const village of LANDMARKS) {
      for (let i = 0; i < 9; i++) {
        const angle = i * Math.PI * 2 / 9 + 0.2;
        const x = village.x + Math.cos(angle) * 26;
        const z = village.z + Math.sin(angle) * 26;
        if (!this.inIntroVista(x, z) && this.pathDistance(x, z) > 5 && !this.blocked(x, z, 2) && this.lakeDistance(x, z, 5) > 1) {
          this.tree(x, z, i % 3 === 0 ? 2 : 0, this.range(12, 17));
        }
      }
    }
  }

  private inIntroVista(x: number, z: number): boolean {
    // Crown-sized margins protect the camera-to-common sightline, not just the walking path.
    return x > -11 && x < 32 && z > 6 && z < 49;
  }

  private tree(x: number, z: number, type: number, height: number): void {
    if (Math.hypot(x - TREEHOUSE.x, z - TREEHOUSE.z) < TREEHOUSE.clearing) return;
    const y = this.heightAt(x, z) - 0.08;
    const radius = height * (type === 2 ? 0.023 : 0.031);
    this.treeVolumes.push({ x, z, radius: height * 0.25, bottom: y, top: y + height * 1.12, trunkRadius: radius });
    const yaw = this.random() * Math.PI * 2;
    const bark = type === 2 ? '#e1ddd0' : type === 1 ? '#89715a' : '#76624d';
    const trunkHeight = type === 1 ? height * 0.88 : height * 0.66;
    this.add('trunk', x, y + trunkHeight / 2, z, radius, trunkHeight, radius, bark, yaw);
    this.obstacle(x, z, radius + 0.1);
    for (let root = 0; root < 3; root++) {
      const angle = yaw + root * 2.09;
      this.beam('branch', new THREE.Vector3(x, y + 0.8, z),
        new THREE.Vector3(x + Math.cos(angle) * radius * 2.3, y + 0.05, z + Math.sin(angle) * radius * 2.3),
        radius * 0.55, bark);
    }
    if (type === 1) {
      const palette = ['#385e45', '#466b4c', '#537750', '#365947', '#607951'];
      const color = new THREE.Color(palette[Math.floor(this.random() * palette.length)]);
      for (let layer = 0; layer < 5; layer++) {
        const width = height * (0.2 - layer * 0.03);
        const layerHeight = height * (0.29 - layer * 0.023);
        this.add('pine', x, y + height * (0.42 + layer * 0.12), z,
          width, layerHeight, width, color.clone().multiplyScalar(0.87 + layer * 0.045), yaw + layer * 0.61);
        if (layer < 3) {
          const angle = yaw + layer * 2.4;
          this.beam('branch', new THREE.Vector3(x, y + height * (0.29 + layer * 0.13), z),
            new THREE.Vector3(x + Math.cos(angle) * width * 0.86, y + height * (0.32 + layer * 0.13), z + Math.sin(angle) * width * 0.86),
            radius * 0.3, bark);
        }
      }
    } else {
      const palette = type === 2
        ? ['#88a159', '#99ad63', '#779b57', '#a6b66d']
        : ['#557a43', '#668b4b', '#78934f', '#49754a', '#809953', '#9b9d58'];
      const color = new THREE.Color(palette[Math.floor(this.random() * palette.length)]);
      const spread = height * (type === 2 ? 0.18 : 0.24);
      for (let branch = 0; branch < 5; branch++) {
        const angle = yaw + branch * 2.4;
        const reach = spread * this.range(0.58, 0.98);
        const bx = x + Math.cos(angle) * reach;
        const bz = z + Math.sin(angle) * reach;
        const by = y + height * this.range(0.64, 0.86);
        this.beam('branch', new THREE.Vector3(x, y + height * this.range(0.4, 0.56), z),
          new THREE.Vector3(bx, by, bz), radius * 0.46, bark);
        this.add('crown', bx, by, bz, spread * 0.76, spread * this.range(0.73, 1.05), spread * 0.73,
          color.clone().multiplyScalar(this.range(0.89, 1.12)), angle);
        this.add('crown', bx + Math.cos(angle + 1) * spread * 0.45, by - spread * 0.38,
          bz + Math.sin(angle + 1) * spread * 0.45, spread * 0.45, spread * 0.55, spread * 0.43,
          color.clone().multiplyScalar(this.range(0.9, 1.13)), angle + 0.6);
      }
      this.add('crown', x, y + height * 0.89, z, spread * 0.9, spread * 0.77, spread * 0.86, color, yaw);
      if (type === 2) {
        for (let mark = 0; mark < 7; mark++) {
          this.add('trunk', x, y + 0.8 + mark * trunkHeight / 8, z, radius * (1 - mark * 0.025) + 0.005,
            this.range(0.07, 0.18), radius * (1 - mark * 0.025) + 0.005, '#635f50', yaw);
        }
      }
    }
  }

  private makeGroundCover(): void {
    for (let i = 0; i < 26000; i++) {
      const x = this.range(-198, 198);
      const z = this.range(-198, 198);
      const path = this.pathDistance(x, z);
      const lake = this.lakeDistance(x, z);
      if (lake < 1.13 || path < 2.25 || this.insideVillage(x, z, 8) || this.nearBuilding(x, z, 1)) continue;
      if (noise(x * 0.11, z * 0.11) < 0.28) continue;
      const y = this.heightAt(x, z);
      const scale = this.range(0.45, 1.1);
      const color = new THREE.Color().setHSL(this.range(0.19, 0.26), this.range(0.27, 0.45), this.range(0.34, 0.5));
      this.add('grass', x, y - 0.03, z, scale, scale * this.range(0.6, 1.15), scale, color, this.random() * 6.28);
      if (i % 11 === 0 && noise(x * 0.065 + 7, z * 0.065) > 0.5) {
        const flowerColor = ['#dcd9b9', '#cfb36b', '#b6a1c3', '#9aaed0'][i % 4];
        for (let j = 0; j < 3; j++) {
          this.add('flower', x + this.range(-0.25, 0.25), y + scale * 0.65, z + this.range(-0.25, 0.25),
            0.085, 0.045, 0.085, flowerColor);
        }
      }
    }
    // Dense fern-like low growth, distinct from the fine grass silhouette.
    for (let i = 0; i < 800; i++) {
      const x = this.range(-195, 195);
      const z = this.range(-195, 195);
      if (this.pathDistance(x, z) < 3.2 || this.lakeDistance(x, z) < 1.16 || this.insideVillage(x, z, 24)) continue;
      const y = this.heightAt(x, z);
      const size = this.range(0.35, 0.9);
      for (let j = 0; j < 3; j++) {
        this.add('crown', x + this.range(-0.4, 0.4), y + size * 0.4, z + this.range(-0.4, 0.4),
          size, size * 0.6, size * 0.8, ['#5c783e', '#738747', '#708552'][j], this.random() * 6.28);
      }
    }
    for (let i = 0; i < 340; i++) {
      const x = this.range(-195, 195);
      const z = this.range(-195, 195);
      if (Math.hypot(x - TREEHOUSE.x, z - TREEHOUSE.z) < TREEHOUSE.clearing) continue;
      if (this.pathDistance(x, z) < 4.6 || this.insideVillage(x, z, 26) || this.lakeDistance(x, z) < 1.12 || this.blocked(x, z, 2)) continue;
      if (this.inIntroVista(x, z)) continue;
      const size = this.range(0.45, 2.3);
      const y = this.heightAt(x, z);
      this.add('rock', x, y + size * 0.32, z, size, size * this.range(0.55, 0.85), size * 0.8,
        new THREE.Color('#8b9080').multiplyScalar(this.range(0.72, 1.17)), this.random() * 6.28, this.range(-0.15, 0.15));
      this.add('crown', x + size * 0.15, y + size * 0.78, z, size * 0.75, size * 0.14, size * 0.59, '#617447');
      this.obstacle(x, z, size * 0.93);
    }
    for (let i = 0; i < 1900; i++) {
      const x = this.range(-160, 160);
      const z = this.range(-170, 100);
      if (this.pathDistance(x, z) > 3 || this.lakeDistance(x, z) < 1.1) continue;
      const size = this.range(0.04, 0.13);
      this.add('pebble', x, this.heightAt(x, z) + size * 0.2, z, size, size * 0.35, size * 0.7, '#aaa18a', this.random() * 6.28);
    }
    for (let i = 0; i < 320; i++) {
      const angle = this.random() * Math.PI * 2;
      const distance = this.range(1.03, 1.15);
      const x = LAKE.x + Math.cos(angle) * LAKE.rx * distance;
      const z = LAKE.z + Math.sin(angle) * LAKE.rz * distance;
      if (this.pathDistance(x, z) < 3 || this.nearBuilding(x, z, 2)) continue;
      const y = this.heightAt(x, z);
      if (y < WATER_LEVEL - 0.5) continue;
      const height = this.range(1.2, 2.1);
      this.add('reed', x, y, z, 0.8, height, 0.8, '#969857', this.random() * 6.28);
      if (i % 3 === 0) {
        this.add('branch', x, y + height * 0.83, z, 0.045, height * 0.25, 0.045, '#685238');
      }
    }
  }

  private insideVillage(x: number, z: number, radius: number): boolean {
    return LANDMARKS.some(village => Math.hypot(x - village.x, z - village.z) < radius);
  }

  private nearBuilding(x: number, z: number, padding: number): boolean {
    return this.buildings.some(building => Math.hypot(x - building.x, z - building.z) < Math.hypot(building.halfX, building.halfZ) + padding);
  }

  private makeLake(): void {
    const geometry = new THREE.CircleGeometry(1, 128);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.waterTime,
        uLake: { value: new THREE.Vector2(LAKE.x, LAKE.z) },
        uRadii: { value: new THREE.Vector2(LAKE.rx, LAKE.rz) },
        ...THREE.UniformsLib.fog,
      },
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        uniform float uTime;
        uniform vec2 uLake;
        uniform vec2 uRadii;
        varying vec3 vWorld;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = vWorld.xz;
          float a = p.x * 0.67 + p.y * 0.41 + uTime * 0.66;
          float b = p.x * -0.38 + p.y * 0.92 - uTime * 0.47;
          float c = p.x * 1.9 + p.y * 1.3 + uTime * 0.92;
          vec3 normal = normalize(vec3(
            cos(a) * 0.045 - sin(b) * 0.026 + cos(c) * 0.013,
            1.0,
            cos(a) * 0.028 + sin(b) * 0.05 + cos(c) * 0.009
          ));
          vec3 viewDirection = normalize(cameraPosition - vWorld);
          float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
          float edge = length((p - uLake) / uRadii);
          vec3 deep = vec3(0.045, 0.17, 0.16);
          vec3 shallow = vec3(0.18, 0.29, 0.23);
          vec3 reflected = mix(vec3(0.34, 0.48, 0.48), vec3(0.57, 0.68, 0.66), clamp(viewDirection.y, 0.0, 1.0));
          vec3 color = mix(deep, shallow, smoothstep(0.68, 1.0, edge));
          color = mix(color, reflected, 0.24 + fresnel * 0.62);
          vec3 light = normalize(vec3(-60.0, 90.0, 35.0));
          float specular = pow(max(dot(reflect(-light, normal), viewDirection), 0.0), 210.0);
          color += vec3(1.0, 0.89, 0.65) * specular * 0.8;
          color += sin(a) * sin(b) * 0.007;
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      fog: true,
    });
    const water = new THREE.Mesh(geometry, material);
    water.position.set(LAKE.x, WATER_LEVEL, LAKE.z);
    water.scale.set(LAKE.rx * 1.055, 1, LAKE.rz * 1.055);
    this.scene.add(water);
    // Small lily groups, away from the path-facing shore.
    const lilyGeometry = new THREE.CircleGeometry(1, 11, 0.15, Math.PI * 1.91);
    lilyGeometry.rotateX(-Math.PI / 2);
    this.batch('lily', lilyGeometry, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide }), false);
    for (let i = 0; i < 70; i++) {
      const angle = this.range(-0.35, 1.8);
      const distance = this.range(0.74, 0.92);
      const x = LAKE.x + Math.cos(angle) * LAKE.rx * distance;
      const z = LAKE.z + Math.sin(angle) * LAKE.rz * distance;
      const radius = this.range(0.19, 0.48);
      this.add('lily', x, WATER_LEVEL + 0.025, z, radius, 1, radius, '#5f8152', this.random() * 6.28);
      if (i % 9 === 0) this.add('flower', x, WATER_LEVEL + 0.1, z, 0.1, 0.08, 0.1, '#e4d7bd');
    }
  }

  private makeMountains(): void {
    const geometry = new THREE.ConeGeometry(1, 1, 11, 5);
    const material = new THREE.MeshStandardMaterial({ color: '#667b72', roughness: 1, flatShading: true });
    this.batch('mountain', geometry, material, false);
    for (let i = 0; i < 22; i++) {
      const angle = i / 22 * Math.PI * 2;
      if (Math.sin(angle) > 0) continue;
      const distance = this.range(315, 460);
      const height = this.range(65, 135);
      this.add('mountain', Math.cos(angle) * distance, height / 2 - 18, Math.sin(angle) * distance,
        this.range(75, 145), height, this.range(75, 145), new THREE.Color('#a4b2ab').multiplyScalar(this.range(0.8, 1.08)), this.random() * 6.28);
    }
  }

  private makeBirds(): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.9, 0.08, -0.16, 0.3, 0, 0.13], 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: '#3f4b45', side: THREE.DoubleSide, roughness: 1 });
    for (let i = 0; i < 5; i++) {
      const bird = new THREE.Group();
      const left = new THREE.Mesh(geometry, material);
      const right = new THREE.Mesh(geometry, material);
      right.scale.x = -1;
      bird.add(left, right);
      bird.position.set(30 + i * 3, 35 + i, -30);
      this.birds.push(bird);
      this.scene.add(bird);
    }
  }

  private makeCityTrailSigns(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Kunde inte skapa skyltarna till Norrhamn.');
    context.fillStyle = '#203b36';
    context.fillRect(0, 0, 1024, 256);
    context.strokeStyle = '#e3d6b2';
    context.lineWidth = 8;
    context.strokeRect(12, 12, 1000, 232);
    context.fillStyle = '#fff0cf';
    context.textAlign = 'center';
    context.font = 'bold 64px sans-serif';
    context.fillText('NORRHAMN CITY', 512, 106);
    context.font = '36px sans-serif';
    context.fillText('Följ stigen söderut · Staden utanför skogen', 512, 178);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, side: THREE.DoubleSide });
    for (const z of [62, 128, 186]) {
      const x = 3.7;
      const y = this.heightAt(x, z);
      this.add('wood', x, y + 1.4, z, 0.16, 2.8, 0.16, '#685039');
      this.obstacle(x, z, 0.25);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), material);
      sign.position.set(x, y + 2.5, z);
      sign.rotation.y = Math.PI;
      this.scene.add(sign);
    }
  }

  private finishBatches(): void {
    for (const [name, batch] of this.batches) {
      if (!batch.instances.length) continue;
      // Spatial chunks permit frustum and shadow culling without one draw per tree.
      const groups = new Map<string, Instance[]>();
      const chunkSize = ['crown', 'pine', 'trunk', 'branch', 'grass', 'rock', 'reed'].includes(name) ? 140 : 1000;
      for (const instance of batch.instances) {
        const elements = instance.matrix.elements;
        const key = `${Math.floor((elements[12] + HALF) / chunkSize)},${Math.floor((elements[14] + HALF) / chunkSize)}`;
        let group = groups.get(key);
        if (!group) {
          group = [];
          groups.set(key, group);
        }
        group.push(instance);
      }
      for (const instances of groups.values()) {
        const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, instances.length);
        mesh.name = `forest-${name}`;
        instances.forEach((instance, index) => {
          mesh.setMatrixAt(index, instance.matrix);
          mesh.setColorAt(index, instance.color);
        });
        mesh.castShadow = batch.shadow;
        mesh.receiveShadow = name !== 'flower';
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        if (mesh.boundingSphere) mesh.boundingSphere.radius += 2;
        this.scene.add(mesh);
      }
    }
    this.batches.clear();
  }
}
