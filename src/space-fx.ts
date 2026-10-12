import * as THREE from "three";
import { radialGlowTexture } from "./space-shaders";

/** Explosion in vacuum: flash, fireball, sparks, tumbling debris and an expanding shock ring. No rising smoke. */
export class SpaceExplosion {
  readonly group = new THREE.Group();
  private age = Infinity;
  private readonly fire: { sprite: THREE.Sprite; velocity: THREE.Vector3 }[] = [];
  private readonly debris: { mesh: THREE.Mesh; velocity: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private readonly sparks: THREE.Points;
  private readonly sparkVelocity: Float32Array;
  private readonly flash: THREE.Sprite;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly light = new THREE.PointLight(0xffa050, 0, 0, 2);

  constructor(smoke: THREE.Texture) {
    this.group.name = "Explosion";
    const glow = radialGlowTexture([[0, "rgba(255,255,255,1)"], [0.2, "rgba(255,230,180,0.8)"], [1, "rgba(0,0,0,0)"]]);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(9, 7.5, 6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.group.add(this.flash, this.light);
    for (let i = 0; i < 26; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smoke, color: new THREE.Color().setHSL(0.045 + Math.random() * 0.06, 1, 0.5).multiplyScalar(1.6),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, rotation: Math.random() * 6,
      }));
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.fire.push({ sprite, velocity: dir.multiplyScalar(0.006 + Math.random() * 0.018) });
      this.group.add(sprite);
    }
    const count = 600;
    const positions = new Float32Array(count * 3);
    this.sparkVelocity = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      dir.multiplyScalar(0.01 + Math.pow(Math.random(), 2) * 0.12);
      this.sparkVelocity.set([dir.x, dir.y, dir.z], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.sparks = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: new THREE.Color(4, 2.4, 1.1), size: 1.8, sizeAttenuation: false, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
    const metals = [0xc8962e, 0xe9eaec, 0x2a2c2f, 0x0b1426].map(color =>
      new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.4, emissive: 0xff5a10, emissiveIntensity: 2 }));
    for (let i = 0; i < 34; i++) {
      const size = 0.0004 + Math.random() * 0.0016;
      const geometry = Math.random() < 0.5 ? new THREE.BoxGeometry(size, size * 0.2, size * 1.6) : new THREE.TetrahedronGeometry(size);
      const mesh = new THREE.Mesh(geometry, metals[i % metals.length]);
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
        .multiplyScalar(0.004 + Math.random() * 0.03);
      this.debris.push({ mesh, velocity, spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
      this.group.add(mesh);
    }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 96), new THREE.MeshBasicMaterial({
      color: new THREE.Color(3, 2.2, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.group.add(this.ring);
    this.group.visible = false;
  }

  /** `scale` 1 is the player's spacecraft; smaller targets use a fraction of it. */
  start(position: THREE.Vector3, camera: THREE.Vector3, scale = 1): void {
    this.age = 0;
    this.group.visible = true;
    this.group.position.copy(position);
    this.group.scale.setScalar(scale);
    this.ring.lookAt(camera);
    const p = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
    p.array.fill(0);
    p.needsUpdate = true;
    for (const f of this.fire) f.sprite.position.set(0, 0, 0);
    for (const d of this.debris) d.mesh.position.set(0, 0, 0);
  }

  get active(): boolean { return this.age < 6; }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.age += dt;
    const a = this.age;
    this.flash.scale.setScalar(0.025 + a * 0.08);
    this.flash.material.opacity = Math.max(0, 1 - a * 4);
    for (const f of this.fire) {
      f.sprite.position.addScaledVector(f.velocity, dt * Math.exp(-a * 1.2));
      f.sprite.scale.setScalar(0.005 + Math.sqrt(a) * 0.016);
      // Fire cools from white-yellow to deep red and fades quickly; nothing billows in vacuum.
      const heat = Math.max(0, 1 - a / 1.6);
      f.sprite.material.color.setRGB(1.6 * (0.6 + heat * 0.4), 1.6 * (0.18 + heat * 0.5), 1.6 * heat * 0.25);
      f.sprite.material.opacity = Math.max(0, 1 - a / 2.2) * 0.85;
      f.sprite.material.rotation += dt * 0.4;
    }
    const p = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, this.sparkVelocity[i * 3] * a, this.sparkVelocity[i * 3 + 1] * a, this.sparkVelocity[i * 3 + 2] * a);
    }
    p.needsUpdate = true;
    (this.sparks.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - a / 2.6);
    for (const d of this.debris) {
      d.mesh.position.addScaledVector(d.velocity, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      (d.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.max(0, 2 - a * 0.8);
    }
    // Units are km, so the inverse-square falloff needs a tiny base intensity.
    this.light.intensity = 0.004 * Math.exp(-a * 2.2) * (1 + Math.sin(a * 40) * 0.15);
    this.ring.scale.setScalar(0.004 + a * 0.08);
    this.ring.material.opacity = Math.max(0, 0.8 - a * 0.9);
    if (a > 6) { this.group.visible = false; this.light.intensity = 0; }
  }
}

/** Hyperspace-style streaks drawn in camera space; `speed` 0..1 controls length and brightness. */
export class WarpStreaks {
  readonly lines: THREE.LineSegments;
  private readonly seeds: Float32Array;
  private readonly count = 1600;

  constructor() {
    const positions = new Float32Array(this.count * 6);
    const colors = new Float32Array(this.count * 6);
    this.seeds = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.pow(Math.random(), 0.6) * 6;
      this.seeds.set([Math.cos(a) * r, Math.sin(a) * r, Math.random()], i * 3);
      const tint = 0.6 + Math.random() * 0.4;
      colors.set([tint * 0.8, tint * 0.9, tint * 1.3, 0, 0, 0], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 50;
    this.lines.name = "Warpstrimmor";
  }

  update(dt: number, speed: number, time: number): void {
    const material = this.lines.material as THREE.LineBasicMaterial;
    material.opacity = Math.min(1, speed * 1.4);
    this.lines.visible = speed > 0.01;
    if (!this.lines.visible) return;
    const p = this.lines.geometry.attributes.position as THREE.BufferAttribute;
    const depth = 40;
    for (let i = 0; i < this.count; i++) {
      const phase = (this.seeds[i * 3 + 2] + time * (0.15 + speed * 2.4)) % 1;
      const z = -depth * (1 - phase) - 0.5;
      const length = 0.2 + speed * speed * 18;
      p.setXYZ(i * 2, this.seeds[i * 3], this.seeds[i * 3 + 1], z);
      p.setXYZ(i * 2 + 1, this.seeds[i * 3] * 1.02, this.seeds[i * 3 + 1] * 1.02, z - length);
    }
    p.needsUpdate = true;
    void dt;
  }
}

/** Screen-space lens flare: ghosts along the line from the Sun through the screen centre. */
export class LensFlare {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  private readonly elements: { sprite: THREE.Sprite; offset: number; size: number; base: number }[] = [];
  private readonly starburst: THREE.Sprite;

  constructor() {
    const ghost = radialGlowTexture([[0, "rgba(255,255,255,0.0)"], [0.55, "rgba(255,255,255,0.08)"], [0.82, "rgba(255,255,255,0.4)"], [0.9, "rgba(255,255,255,0.12)"], [1, "rgba(0,0,0,0)"]]);
    const disc = radialGlowTexture([[0, "rgba(255,255,255,0.65)"], [0.6, "rgba(255,255,255,0.22)"], [1, "rgba(0,0,0,0)"]]);
    const specs: [number, number, number, THREE.Texture][] = [
      [0.0, 0.0, 0x000000, disc], [0.35, 0.05, 0xff9a50, disc], [0.55, 0.12, 0x7fb8ff, ghost], [0.8, 0.035, 0xa0ffcf, disc],
      [1.1, 0.18, 0xffc070, ghost], [1.35, 0.06, 0x9b7bff, disc], [1.7, 0.28, 0x6fa8ff, ghost], [2.1, 0.09, 0xffd59a, disc],
    ];
    for (const [offset, size, color, map] of specs.slice(1)) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false }));
      this.scene.add(sprite);
      this.elements.push({ sprite, offset, size, base: 0.35 });
    }
    // Long anamorphic streak and a six-point starburst sell the bright Sun without blowing out the frame.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(256, 256);
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      const g = ctx.createLinearGradient(0, 0, 250, 0);
      g.addColorStop(0, "rgba(255,245,225,0.9)");
      g.addColorStop(1, "rgba(255,245,225,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(250, 0); ctx.lineTo(0, 3); ctx.fill();
    }
    const streak = ctx.createLinearGradient(-256, 0, 256, 0);
    streak.addColorStop(0, "rgba(120,170,255,0)");
    streak.addColorStop(0.5, "rgba(190,215,255,0.55)");
    streak.addColorStop(1, "rgba(120,170,255,0)");
    ctx.rotate(-Math.PI * 2);
    ctx.fillStyle = streak;
    ctx.fillRect(-256, -2.5, 512, 5);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.starburst = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, color: new THREE.Color(2.2, 2, 1.8) }));
    this.scene.add(this.starburst);
  }

  /** `sun` is in normalised device coordinates; `visibility` 0..1 already includes occlusion. */
  update(sun: THREE.Vector2, visibility: number, aspect: number): void {
    this.camera.left = -aspect;
    this.camera.right = aspect;
    this.camera.updateProjectionMatrix();
    const edge = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(sun.x), Math.abs(sun.y)), 0.75, 1.25);
    const strength = visibility * edge;
    this.scene.visible = strength > 0.01;
    for (const e of this.elements) {
      const x = sun.x * aspect * (1 - e.offset), y = sun.y * (1 - e.offset);
      e.sprite.position.set(x, y, -1);
      e.sprite.scale.setScalar(e.size);
      e.sprite.material.opacity = strength * e.base;
    }
    this.starburst.position.set(sun.x * aspect, sun.y, -1);
    this.starburst.scale.set(0.75, 0.75, 1);
    this.starburst.material.opacity = strength * 0.55;
  }
}

const plasmaVertex = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vObj;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    vObj = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const plasmaFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vObj;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 41.3))) * 43758.5453); }
  float noise3(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    #include <logdepthbuf_fragment>
    float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
    // vObj.y < 0 is the shock layer ahead of the shield; the wake streams out behind (+y) and thins out.
    float shock = smoothstep(0.1, -0.6, vObj.y);
    float wake = smoothstep(-0.1, 0.4, vObj.y) * (1.0 - smoothstep(0.4, 3.4, vObj.y));
    vec3 q = vObj * vec3(4.0, 1.4, 4.0) - vec3(0.0, uTime * 9.0, 0.0);
    float n = noise3(q) * 0.55 + noise3(q * 2.7 + 3.1) * 0.3 + noise3(q * 6.3) * 0.15;
    float streaks = smoothstep(0.45, 0.9, n);
    float rim = pow(1.0 - facing, 2.2);
    float a = (shock * (0.35 + rim * 0.9) + wake * streaks * rim * 0.9) * uIntensity;
    vec3 hot = mix(vec3(1.0, 0.42, 0.16), vec3(1.0, 0.86, 0.72), shock * facing);
    vec3 color = mix(hot, vec3(0.95, 0.45, 0.85), wake * 0.35);
    gl_FragColor = vec4(color * (1.2 + shock * 2.2), clamp(a, 0.0, 1.0));
  }
`;

/** Shock-heated plasma sheath around the capsule during atmospheric entry (model units, -Y is the heat shield). */
export function createPlasmaSheath(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.SphereGeometry(1, 64, 32);
  // Blunt bow shock ahead of the shield, tapering into a wake behind the capsule.
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const squash = y < 0 ? 0.5 : 1 + y * 2.2;
    const width = y < 0 ? 1.12 : 1 - y * 0.55;
    p.setXYZ(i, p.getX(i) * width, y * squash, p.getZ(i) * width);
  }
  geometry.computeVertexNormals();
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
    vertexShader: plasmaVertex,
    fragmentShader: plasmaFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Plasmamantel";
  mesh.renderOrder = 6;
  return mesh;
}
