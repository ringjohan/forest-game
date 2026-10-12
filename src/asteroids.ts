import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { RockSet } from "./space-assets";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Improved Perlin noise (seeded) for deterministic asteroid relief. */
class Perlin {
  private readonly p = new Uint8Array(512);
  constructor(seed: number) {
    const random = mulberry32(seed);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }
  private static fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
  private static grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = Perlin.fade(x), v = Perlin.fade(y), w = Perlin.fade(z);
    const p = this.p;
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const lerp = THREE.MathUtils.lerp;
    return lerp(
      lerp(lerp(Perlin.grad(p[AA], x, y, z), Perlin.grad(p[BA], x - 1, y, z), u),
        lerp(Perlin.grad(p[AB], x, y - 1, z), Perlin.grad(p[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(Perlin.grad(p[AA + 1], x, y, z - 1), Perlin.grad(p[BA + 1], x - 1, y, z - 1), u),
        lerp(Perlin.grad(p[AB + 1], x, y - 1, z - 1), Perlin.grad(p[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }
  fbm(x: number, y: number, z: number, octaves: number): number {
    let sum = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq, z * freq) * amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum;
  }
  ridged(x: number, y: number, z: number, octaves: number): number {
    let sum = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise(x * freq, y * freq, z * freq));
      sum += n * n * amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum;
  }
}

export type AsteroidShape = {
  high: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
  /** Distance from the centre to the surface along a local-space direction (unit scale). */
  surface: (direction: THREE.Vector3) => number;
  maxRadius: number;
};

/** Lumpy, cratered rubble-pile body. The same analytic surface drives every LOD and the collision test. */
export function createAsteroidShape(seed: number, highDetail = 40, lowDetail = 9): AsteroidShape {
  const random = mulberry32(seed * 7919 + 17);
  const perlin = new Perlin(seed);
  const axes = new THREE.Vector3(0.78 + random() * 0.3, 0.58 + random() * 0.3, 0.9 + random() * 0.28);
  const lumpiness = 0.22 + random() * 0.16;
  const craters: { dir: THREE.Vector3; size: number; depth: number }[] = [];
  const count = 22 + Math.floor(random() * 18);
  for (let i = 0; i < count; i++) {
    const dir = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
    const size = 0.05 + Math.pow(random(), 2.4) * 0.55;
    craters.push({ dir, size, depth: 0.22 + random() * 0.2 });
  }
  const height = (d: THREE.Vector3): number => {
    let h = 1 + perlin.fbm(d.x * 1.15 + 3.1, d.y * 1.15, d.z * 1.15, 4) * lumpiness * 2;
    h += (perlin.ridged(d.x * 3.4, d.y * 3.4 + 9, d.z * 3.4, 4) - 0.35) * 0.07;
    h += perlin.fbm(d.x * 14, d.y * 14, d.z * 14, 3) * 0.018;
    for (const c of craters) {
      const angle = Math.acos(THREE.MathUtils.clamp(d.dot(c.dir), -1, 1));
      const x = angle / c.size;
      if (x > 1.6) continue;
      // Parabolic bowl with a raised, sharp-edged rim that falls off into the ejecta blanket.
      if (x < 1) h += c.depth * c.size * (x * x - 1);
      h += c.depth * c.size * 0.32 * Math.exp(-(((x - 1) / 0.22) ** 2));
    }
    return h;
  };
  const build = (detail: number): THREE.BufferGeometry => {
    let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
    geometry.deleteAttribute("normal");
    geometry.deleteAttribute("uv");
    geometry = mergeVertices(geometry);
    const position = geometry.attributes.position;
    const d = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      d.fromBufferAttribute(position, i).normalize();
      const h = height(d);
      position.setXYZ(i, d.x * h * axes.x, d.y * h * axes.y, d.z * h * axes.z);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  };
  const high = build(highDetail);
  const low = build(lowDetail);
  const probe = new THREE.Vector3();
  const surface = (direction: THREE.Vector3): number => {
    // Map the query direction back through the ellipsoid stretch to the undeformed sphere.
    probe.set(direction.x / axes.x, direction.y / axes.y, direction.z / axes.z).normalize();
    const h = height(probe);
    return Math.hypot(probe.x * h * axes.x, probe.y * h * axes.y, probe.z * h * axes.z);
  };
  return { high, low, surface, maxRadius: high.boundingSphere?.radius ?? 1.3 };
}

/** Rock PBR material with tile-free, seam-free triplanar sampling at two scales. */
export function asteroidMaterial(rock: RockSet): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0.02 });
  const uniforms = {
    uRockColor: { value: rock.map }, uRockNormal: { value: rock.normalMap },
    uRockRough: { value: rock.roughnessMap }, uRockAO: { value: rock.aoMap },
    uScale: { value: 1.6 }, uNormalStrength: { value: 1.4 },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        varying vec3 vObjPos; varying vec3 vObjNormal; varying vec3 vNX; varying vec3 vNY; varying vec3 vNZ;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vObjPos = position; vObjNormal = normal;`)
      .replace("#include <defaultnormal_vertex>", `#include <defaultnormal_vertex>
        mat3 rockInstance = mat3(1.0);
        #ifdef USE_INSTANCING
          rockInstance = mat3(instanceMatrix);
        #endif
        vNX = normalize(normalMatrix * (rockInstance * vec3(1.0, 0.0, 0.0)));
        vNY = normalize(normalMatrix * (rockInstance * vec3(0.0, 1.0, 0.0)));
        vNZ = normalize(normalMatrix * (rockInstance * vec3(0.0, 0.0, 1.0)));`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D uRockColor; uniform sampler2D uRockNormal; uniform sampler2D uRockRough; uniform sampler2D uRockAO;
        uniform float uScale; uniform float uNormalStrength;
        varying vec3 vObjPos; varying vec3 vObjNormal; varying vec3 vNX; varying vec3 vNY; varying vec3 vNZ;
        vec3 triWeights(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
        vec4 tri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }
        vec3 triNormal(sampler2D t, vec3 p, vec3 n, vec3 w) {
          vec3 tx = texture2D(t, p.zy).xyz * 2.0 - 1.0;
          vec3 ty = texture2D(t, p.xz).xyz * 2.0 - 1.0;
          vec3 tz = texture2D(t, p.xy).xyz * 2.0 - 1.0;
          tx.xy *= uNormalStrength; ty.xy *= uNormalStrength; tz.xy *= uNormalStrength;
          tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
          ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
          tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
          return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
        }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        vec3 rockN = normalize(vObjNormal);
        vec3 rockW = triWeights(rockN);
        vec3 rockP = vObjPos * uScale;
        vec3 rockP2 = vObjPos * uScale * 5.7 + 0.37;
        vec3 rockAlbedo = mix(tri(uRockColor, rockP, rockW).rgb, tri(uRockColor, rockP2, rockW).rgb, 0.45);
        float rockAO = mix(tri(uRockAO, rockP, rockW).r, tri(uRockAO, rockP2, rockW).r, 0.5);
        float rockLuma = dot(rockAlbedo, vec3(0.299, 0.587, 0.114));
        // Space-weathered regolith is darker and less saturated than terrestrial rock.
        diffuseColor.rgb *= mix(vec3(rockLuma), rockAlbedo, 0.55) * mix(1.0, rockAO, 0.75);`)
      .replace("#include <roughnessmap_fragment>", `float roughnessFactor = roughness * mix(tri(uRockRough, rockP, rockW).g, tri(uRockRough, rockP2, rockW).g, 0.5);`)
      .replace("#include <normal_fragment_maps>", `
        vec3 rockNormal = normalize(mix(triNormal(uRockNormal, rockP, rockN, rockW), triNormal(uRockNormal, rockP2, rockN, rockW), 0.4));
        normal = normalize(vNX * rockNormal.x + vNY * rockNormal.y + vNZ * rockNormal.z);`);
  };
  material.customProgramCacheKey = () => "triplanar-asteroid";
  return material;
}

export type Rock = {
  position: THREE.Vector3;
  scale: number;
  axis: THREE.Vector3;
  spin: number;
  angle: number;
  shape: number;
  quaternion: THREE.Quaternion;
  /** Drift velocity in field coordinates (km/s); fragments and meteoroids move, field rocks rest. */
  velocity?: THREE.Vector3;
  /** Laser hits left before the rock shatters. */
  health?: number;
  /** Orientation the spin is applied on top of (set when the flight frame is re-based). */
  base?: THREE.Quaternion;
  kind?: "meteoroid";
};

/** Extra instances per shape so shattered rocks can spawn fragments without reallocating. */
const SPARE_INSTANCES = 160;

/** A field of tumbling asteroids drawn with per-shape instancing and a near/far LOD split. */
export class AsteroidField {
  readonly group = new THREE.Group();
  readonly rocks: Rock[] = [];
  private readonly high: THREE.InstancedMesh[] = [];
  private readonly low: THREE.InstancedMesh[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly scaleVector = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly inverse = new THREE.Quaternion();
  private readonly spinQuat = new THREE.Quaternion();
  private readonly capacity: number[];

  constructor(
    private readonly shapes: AsteroidShape[], materials: THREE.Material[], rocks: Rock[],
    private readonly lodDistance: number,
  ) {
    this.group.name = "Asteroidfält";
    this.rocks = rocks;
    this.capacity = shapes.map((_, i) => rocks.filter(r => r.shape === i).length + SPARE_INSTANCES);
    shapes.forEach((shape, i) => {
      const material = materials[i % materials.length];
      const high = new THREE.InstancedMesh(shape.high, material, this.capacity[i]);
      const low = new THREE.InstancedMesh(shape.low, material, this.capacity[i]);
      for (const mesh of [high, low]) {
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity[i] * 3), 3);
        this.group.add(mesh);
      }
      this.high.push(high);
      this.low.push(low);
    });
  }

  /** Rotates every rock and assigns it to the high- or low-detail mesh based on distance to the viewer. */
  update(dt: number, viewer: THREE.Vector3): void {
    for (let i = 0; i < this.shapes.length; i++) { this.high[i].count = 0; this.low[i].count = 0; }
    for (const rock of this.rocks) {
      if (rock.velocity) rock.position.addScaledVector(rock.velocity, dt);
      rock.angle += rock.spin * dt;
      this.spinQuat.setFromAxisAngle(rock.axis, rock.angle);
      rock.quaternion.copy(this.spinQuat);
      if (rock.base) rock.quaternion.premultiply(rock.base);
      this.scaleVector.setScalar(rock.scale);
      this.matrix.compose(rock.position, rock.quaternion, this.scaleVector);
      const near = rock.position.distanceTo(viewer) - rock.scale < this.lodDistance * Math.max(1, rock.scale * 3);
      const mesh = near ? this.high[rock.shape] : this.low[rock.shape];
      const index = mesh.count++;
      mesh.setMatrixAt(index, this.matrix);
      const shade = 0.42 + ((rock.shape * 37 + Math.floor(rock.scale * 1000)) % 17) / 17 * 0.22;
      mesh.instanceColor!.setXYZ(index, shade, shade * 0.97, shade * 0.93);
    }
    for (const mesh of [...this.high, ...this.low]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  /** Returns the rock whose real surface is within `radius` of `point` (field coordinates). */
  collide(point: THREE.Vector3, radius: number): Rock | null {
    for (const rock of this.rocks) if (this.touches(rock, point, radius)) return rock;
    return null;
  }

  private touches(rock: Rock, point: THREE.Vector3, radius: number): boolean {
    const shape = this.shapes[rock.shape];
    const distance = point.distanceTo(rock.position);
    if (distance > shape.maxRadius * rock.scale + radius) return false;
    if (distance < 1e-9) return true;
    this.local.copy(point).sub(rock.position).applyQuaternion(this.inverse.copy(rock.quaternion).invert());
    return distance < shape.surface(this.local.normalize()) * rock.scale + radius;
  }

  /** First rock whose real surface the swept segment a→b touches, with the impact point. */
  raycast(a: THREE.Vector3, b: THREE.Vector3, radius: number): { rock: Rock; point: THREE.Vector3; t: number } | null {
    const direction = b.clone().sub(a);
    const length = direction.length();
    let best: { rock: Rock; point: THREE.Vector3; t: number } | null = null;
    const point = new THREE.Vector3();
    for (const rock of this.rocks) {
      const bound = this.shapes[rock.shape].maxRadius * rock.scale + radius;
      // Closest approach to the bounding sphere, then march through it at a fraction of the rock size.
      const along = length > 0 ? THREE.MathUtils.clamp(rock.position.clone().sub(a).dot(direction) / (length * length), 0, 1) : 0;
      if (point.copy(a).addScaledVector(direction, along).distanceTo(rock.position) > bound) continue;
      const span = length > 0 ? bound / length : 1;
      const start = Math.max(0, along - span), end = Math.min(1, along + span);
      const steps = Math.max(2, Math.ceil((end - start) * length / Math.max(rock.scale * 0.08, 0.002)));
      for (let i = 0; i <= steps; i++) {
        const t = start + (end - start) * i / steps;
        if (best && t >= best.t) break;
        point.copy(a).addScaledVector(direction, t);
        if (this.touches(rock, point, radius)) { best = { rock, point: point.clone(), t }; break; }
      }
    }
    return best;
  }

  /** Adds a rock if its shape still has spare instances. */
  add(rock: Rock): boolean {
    if (this.rocks.filter(r => r.shape === rock.shape).length >= this.capacity[rock.shape]) return false;
    rock.quaternion.setFromAxisAngle(rock.axis, rock.angle);
    if (rock.base) rock.quaternion.premultiply(rock.base);
    this.rocks.push(rock);
    return true;
  }

  remove(rock: Rock): void {
    const index = this.rocks.indexOf(rock);
    if (index >= 0) this.rocks.splice(index, 1);
  }

  get shapeCount(): number { return this.shapes.length; }

  boundingRadius(rock: Rock): number { return this.shapes[rock.shape].maxRadius * rock.scale; }

  /** Distance from `point` to the nearest rock surface (approximate, via bounding radius). */
  nearest(point: THREE.Vector3): number {
    let best = Infinity;
    for (const rock of this.rocks) {
      best = Math.min(best, point.distanceTo(rock.position) - this.shapes[rock.shape].maxRadius * 0.85 * rock.scale);
    }
    return best;
  }
}

/** Scatters rocks in an ellipsoidal cloud with a power-law size distribution (km). */
export function scatterRocks(seed: number, count: number, center: THREE.Vector3, extent: THREE.Vector3,
  minSize: number, maxSize: number, shapes: number, keepClear?: { point: THREE.Vector3; radius: number }): Rock[] {
  const random = mulberry32(seed);
  const rocks: Rock[] = [];
  let attempts = 0;
  while (rocks.length < count && attempts++ < count * 20) {
    const p = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
    if (p.lengthSq() > 1) continue;
    p.multiply(extent).add(center);
    const scale = minSize + Math.pow(random(), 3.2) * (maxSize - minSize);
    if (keepClear && p.distanceTo(keepClear.point) < keepClear.radius + scale * 1.3) continue;
    if (rocks.some(r => r.position.distanceTo(p) < (r.scale + scale) * 1.25)) continue;
    rocks.push({
      position: p, scale,
      axis: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
      spin: (0.02 + random() * 0.12) * (random() < 0.5 ? -1 : 1) / Math.max(0.4, scale * 4),
      angle: random() * Math.PI * 2,
      shape: Math.floor(random() * shapes),
      quaternion: new THREE.Quaternion(),
    });
  }
  return rocks;
}
