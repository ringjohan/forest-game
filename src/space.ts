import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { SpaceAssets } from "./space-assets";
import { AU, EARTH_TILT, SolarSystem, hazardRadius, lonLat } from "./space-bodies";
import type { Body, BodyId } from "./space-bodies";
import { AsteroidField, asteroidMaterial, createAsteroidShape, scatterRocks } from "./asteroids";
import type { AsteroidShape } from "./asteroids";
import { createStarField } from "./space-shaders";
import { LensFlare, SpaceExplosion, WarpStreaks, createPlasmaSheath } from "./space-fx";
import { LaunchIntro } from "./space-intro";
import type { IntroCamera } from "./space-intro";
import { SmokeSystem, createPlume, createSpacecraft, makeSmokeTexture } from "./rocket";
import type { Plume } from "./rocket";
import { createCapsuleInterior } from "./capsule-interior";
import type { CapsuleInterior } from "./capsule-interior";
import { GEARS, arrivalTime, travelTime, bezier, bezierTangent, blockingBody, dominantBody, formatDuration, formatSpeed, gravityLimit, jumpPath, segmentSphere, speedLimit } from "./space-nav";
import { Impacts, Lasers, spawnSatellites } from "./space-combat";
import type { Satellite } from "./space-combat";
import type { Rock } from "./asteroids";

export type Destination = {
  key: string;
  name: string;
  body: BodyId;
  /** Circular orbit altitude in km (heliocentric distance for the asteroid belt). */
  altitude: number;
  field?: "orbit" | "belt";
};

export const DESTINATIONS: Destination[] = [
  { key: "1", name: "Jorden", body: "earth", altitude: 400, field: "orbit" },
  { key: "2", name: "Månen", body: "moon", altitude: 320 },
  { key: "3", name: "Mars", body: "mars", altitude: 480 },
  { key: "4", name: "Venus", body: "venus", altitude: 450 },
  { key: "5", name: "Merkurius", body: "mercury", altitude: 300 },
  { key: "6", name: "Asteroidbältet", body: "sun", altitude: 2.75 * AU, field: "belt" },
  { key: "7", name: "Jupiter", body: "jupiter", altitude: 75_000 },
  { key: "8", name: "Saturnus", body: "saturn", altitude: 150_000 },
  { key: "9", name: "Uranus", body: "uranus", altitude: 45_000 },
  { key: "0", name: "Neptunus", body: "neptune", altitude: 45_000 },
];

export type SpaceMode = "intro" | "flight" | "warp" | "reentry" | "crash";
/** Free flight in an inertial frame centred on `body`, or the classic circular orbit. */
type Drive = "orbit" | "free";
export type SpaceEvent = { kind: "home"; reason: "reentry" | "crash" } | null;
export type SpaceHud = {
  mode: SpaceMode;
  title: string;
  detail: string;
  caption: string;
  warning: string;
  stats: [string, string][];
  destinations: { key: string; name: string; distance: string; active: boolean; selected: boolean }[];
  marker: { x: number; y: number; visible: boolean; label: string };
  /** Selected navigation target marker (screen fractions); `edge` when clamped to the screen border. */
  target: { x: number; y: number; visible: boolean; edge: boolean; angle: number; label: string; eta: string };
  gear: { index: number; name: string; speed: string; limited: boolean };
  /** Where the lasers converge 1.5 km ahead, in screen fractions. */
  crosshair: { x: number; y: number; visible: boolean };
  score: string;
  fade: number;
  fadeColor: string;
};

type Orbit = { body: Body; radius: number; e1: THREE.Vector3; e2: THREE.Vector3; angle: number; rate: number };

const TIME_SCALES = [1, 10, 50, 250];
const LASER_SPEED = 3;
const LASER_COOLDOWN = 0.11;
/** Free-flight positions are re-based onto a new local frame once the ship is this far (km) from it. */
const REBASE_DISTANCE = 50;
const SUN_INTENSITY = 1.25;
const SHIP_RADIUS = 0.0075;
const WARP_SECONDS = 7.5;
const REENTRY_SECONDS = 10;
const CRASH_SECONDS = 4.2;
const UP = new THREE.Vector3(0, 1, 0);

/** Accelerates toward `target` speed quickly at low gears and proportionally at high ones, so every gear feels responsive. */
function approachSpeed(current: number, target: number, dt: number): number {
  const rate = Math.max(0.04, Math.abs(target) * 1.4);
  if (current < target) return Math.min(target, current + rate * dt);
  return Math.max(target, current - Math.max(rate, Math.abs(current) * 2) * dt);
}

export function formatDistance(km: number): string {
  if (km >= 0.05 * AU) return `${(km / AU).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} AE`;
  if (km >= 10_000) return `${Math.round(km / 1000).toLocaleString("sv-SE")} 000 km`;
  if (km >= 10) return `${Math.round(km).toLocaleString("sv-SE")} km`;
  return `${(km * 1000).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} m`;
}

/** The space flight: floating-origin solar system, the player's spacecraft, cinematics and post-processing. */
export class Space {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.0004, 2e10);
  mode: SpaceMode = "intro";
  hud: SpaceHud;

  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly flare = new LensFlare();
  private readonly system: SolarSystem;
  private readonly frame = new THREE.Group();
  private readonly ship = new THREE.Group();
  private readonly model: THREE.Group;
  private readonly serviceModule: THREE.Object3D[];
  private readonly wings: THREE.Object3D[];
  private readonly enginePlume: Plume;
  private readonly rcs: SmokeSystem;
  private readonly plasma: ReturnType<typeof createPlasmaSheath>;
  private readonly stars: THREE.Points;
  private readonly sunLight = new THREE.DirectionalLight(0xfff4e8, 3.4);
  private readonly planetLight = new THREE.HemisphereLight(0x000000, 0x2a4a80, 0);
  private readonly shapes: AsteroidShape[];
  private readonly rockMaterials: THREE.Material[];
  private readonly smoke: THREE.Texture;
  private readonly explosion: SpaceExplosion;
  private readonly streaks = new WarpStreaks();
  private readonly intro: LaunchIntro;
  private readonly pmrem: THREE.PMREMGenerator;
  private environment: THREE.Texture | null = null;
  private field: AsteroidField | null = null;
  private fieldCenter = new THREE.Vector3();
  private orbit: Orbit;
  private destination = DESTINATIONS[0];
  private simTime = 0;
  private timeScale = 0;
  private modeTime = 0;
  private homeAfterWarp = false;
  private warp: { points: THREE.Vector3[]; next: Destination; seconds: number } | null = null;
  private drive: Drive = "orbit";
  private gear = 1;
  /** Navigation target chosen with the number keys. */
  private target: Destination | null = null;
  private limited = false;
  private gravityLimited = false;
  /** After an automatic arrival the throttle must be released before it can take the craft out of orbit again. */
  private throttleLatch = false;
  private throttling = false;
  private boosting = false;
  private readonly lasers = new Lasers();
  private impacts!: Impacts;
  private satellites: Satellite[] = [];
  private readonly targetExplosions: SpaceExplosion[] = [];
  private fireCooldown = 0;
  private meteorTimer = 6;
  private kills = { rocks: 0, satellites: 0 };
  private readonly previous = new THREE.Vector3();
  private fireSide = 1;
  private crashCause = "";
  private notice = "";
  private noticeTime = 0;
  private reentryFrom = 0;
  private sideModule: THREE.Group | null = null;
  private readonly p = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly w = new THREE.Vector3();
  private lookYaw = 0;
  private lookPitch = 0;
  private zoom = 1;
  private readonly camLocal = new THREE.Vector3(0, 0.006, -0.03);
  private readonly camUp = new THREE.Vector3(0, 1, 0);
  private readonly camTarget = new THREE.Vector3();
  private readonly introCamera: IntroCamera = { position: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 50 };
  private readonly anchor = new THREE.Vector3();
  private readonly frameQuat = new THREE.Quaternion();
  private readonly origin = new THREE.Vector3();
  private shake = 0;
  private elapsed = 0;
  hudHidden = false;
  /** Pilot's-eye view from inside the capsule (V). */
  cockpit = false;
  private readonly interior: CapsuleInterior;
  private readonly docking: THREE.Object3D[];
  private readonly exteriorShadows: [THREE.Mesh, boolean][] = [];
  private readonly cabinLight = new THREE.PointLight(0xfff1dc, 0, 0.0035, 0);
  private readonly cockpitEye = new THREE.Vector3();
  private screenTimer = 0;

  constructor(renderer: THREE.WebGLRenderer, assets: SpaceAssets) {
    this.scene.name = "Rymden";
    this.scene.background = assets.milkyWay;
    this.scene.backgroundIntensity = 0.2;
    this.scene.backgroundRotation.set(0.5, 0.2, 1.05);
    this.system = new SolarSystem(assets);
    this.scene.add(this.system.group, this.frame);
    this.stars = createStarField(9000, 5e8);
    this.scene.add(this.stars);
    this.smoke = makeSmokeTexture();

    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const s = this.sunLight.shadow.camera;
    s.left = s.bottom = -0.9;
    s.right = s.top = 0.9;
    s.near = 0.01;
    s.far = 8;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.002;
    this.scene.add(this.sunLight, this.sunLight.target, this.planetLight, new THREE.AmbientLight(0x1a2233, 0.05));

    // Player spacecraft (km): the metre-scale model is wrapped so its +Y nose points along the ship's +Z.
    this.model = createSpacecraft(true);
    this.wings = this.model.userData.wings as THREE.Object3D[];
    const capsule = this.model.userData.capsule as THREE.Object3D;
    this.serviceModule = this.model.children.filter(child => child !== capsule);
    this.docking = this.model.userData.docking as THREE.Object3D[];
    this.model.traverse(object => { if (object instanceof THREE.Mesh) this.exteriorShadows.push([object, object.castShadow]); });
    this.interior = createCapsuleInterior();
    this.interior.group.visible = false;
    this.interior.group.add(this.cabinLight);
    this.cabinLight.position.set(0, 1.9, 0);
    capsule.add(this.interior.group);
    // Capsule coordinates (m) → model (+4.3 m) → ship frame in km, where model +Y is the ship's nose (+Z).
    const eye = this.interior.eye.clone().add(capsule.position);
    this.cockpitEye.set(eye.x, -eye.z, eye.y).multiplyScalar(0.001);
    const wrapper = new THREE.Group();
    wrapper.scale.setScalar(0.001);
    wrapper.rotation.x = Math.PI / 2;
    wrapper.add(this.model);
    this.ship.add(wrapper);
    this.ship.name = "Spelarens rymdfarkost";
    this.enginePlume = createPlume({ r0: 0.6, r1: 3.2, length: 16, core: 0xe6f0ff, outer: 0x6c98ff, soft: 1.25 });
    this.enginePlume.mesh.position.y = -1.1;
    this.model.add(this.enginePlume.mesh);
    this.rcs = new SmokeSystem(this.smoke, 90);
    this.model.add(this.rcs.group);
    this.plasma = createPlasmaSheath();
    this.plasma.scale.setScalar(2.15);
    this.plasma.position.y = 0.6;
    capsule.add(this.plasma);
    this.frame.add(this.ship);
    this.explosion = new SpaceExplosion(this.smoke);
    this.frame.add(this.explosion.group);
    this.impacts = new Impacts(this.smoke);
    this.frame.add(this.lasers.group, this.impacts.group);
    for (let i = 0; i < 3; i++) {
      const blast = new SpaceExplosion(this.smoke);
      this.targetExplosions.push(blast);
      this.frame.add(blast.group);
    }
    this.camera.add(this.streaks.lines);
    this.scene.add(this.camera);

    this.shapes = Array.from({ length: 6 }, (_, i) => createAsteroidShape(101 + i * 17));
    this.rockMaterials = assets.rocks.map(rock => asteroidMaterial(rock));
    this.intro = new LaunchIntro(this.ship, this.wings, this.smoke);
    this.frame.add(this.intro.group);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.orbit = this.makeOrbit(DESTINATIONS[0]);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const flarePass = new RenderPass(this.flare.scene, this.flare.camera);
    flarePass.clear = false;
    flarePass.clearDepth = true;
    this.composer.addPass(flarePass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.62, 0.7, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize(innerWidth, innerHeight, Math.min(devicePixelRatio, 2));
    this.hud = this.emptyHud();
  }

  private emptyHud(): SpaceHud {
    return {
      mode: this.mode, title: "", detail: "", caption: "", warning: "", stats: [], destinations: [],
      marker: { x: 0, y: 0, visible: false, label: "" }, fade: 0, fadeColor: "#000",
      target: { x: 0, y: 0, visible: false, edge: false, angle: 0, label: "", eta: "" },
      gear: { index: 1, name: "", speed: "", limited: false }, crosshair: { x: 0.5, y: 0.5, visible: false }, score: "",
    };
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width, height);
    (this.stars.material as THREE.ShaderMaterial).uniforms.pixelRatio.value = pixelRatio;
  }

  /** Compiles every shader up front so the first space frame does not stall. */
  async prepare(renderer: THREE.WebGLRenderer): Promise<void> {
    this.begin(false);
    this.update(0.001, new Set());
    // Hidden effects are skipped by compileAsync; show them for the compile so the first explosion does not stall.
    const hidden = [this.explosion.group, ...this.targetExplosions.map(e => e.group)];
    for (const group of hidden) group.visible = true;
    await renderer.compileAsync(this.scene, this.camera);
    for (const group of hidden) group.visible = false;
    // Upload every texture now; otherwise each 8K planet map stalls the first frame it comes into view.
    const textures = new Set<THREE.Texture>();
    const collect = (value: unknown): void => {
      if (value instanceof THREE.Texture) textures.add(value);
    };
    this.scene.traverse(object => {
      const material = (object as THREE.Mesh).material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        for (const value of Object.values(m)) collect(value);
        if (m instanceof THREE.ShaderMaterial) for (const uniform of Object.values(m.uniforms)) collect(uniform.value);
      }
    });
    collect(this.scene.background);
    for (const texture of textures) renderer.initTexture(texture);
  }

  /** Circular orbit with a pleasing day-side arrival; the home orbit passes over Scandinavia heading east. */
  private makeOrbit(destination: Destination): Orbit {
    const body = this.system.get(destination.body);
    const radius = destination.body === "sun" ? destination.altitude : body.radius + destination.altitude;
    let e1: THREE.Vector3, e2: THREE.Vector3;
    if (destination.body === "earth") {
      const north = UP.clone().applyQuaternion(EARTH_TILT);
      const lat = 58;
      e1 = lonLat(16, lat).applyQuaternion(EARTH_TILT);
      const east = new THREE.Vector3().crossVectors(north, e1).normalize();
      const northward = new THREE.Vector3().crossVectors(e1, east).normalize();
      const heading = -Math.acos(THREE.MathUtils.clamp(Math.cos(THREE.MathUtils.degToRad(72)) / Math.cos(THREE.MathUtils.degToRad(lat)), -1, 1));
      e2 = east.multiplyScalar(Math.cos(heading)).addScaledVector(northward, Math.sin(heading)).normalize();
    } else if (destination.body === "sun") {
      e1 = new THREE.Vector3(Math.sin(0.15), 0.02, Math.cos(0.15)).normalize();
      e2 = new THREE.Vector3(Math.cos(0.15), 0, -Math.sin(0.15)).normalize();
    } else {
      const sun = body.position.clone().negate().normalize();
      const axis = new THREE.Vector3().crossVectors(sun, UP).normalize();
      const gas = ["jupiter", "saturn", "uranus", "neptune"].includes(destination.body);
      e1 = sun.clone().applyAxisAngle(axis, THREE.MathUtils.degToRad(gas ? 32 : 62));
      if (destination.body === "moon") {
        // Arrive on the sunlit, Earth-facing side so the flight home starts with Earth in clear view, not behind the Moon.
        const earth = this.system.get("earth").position.clone().sub(body.position).normalize();
        e1 = earth.multiplyScalar(0.75).addScaledVector(sun, 0.45).normalize();
      }
      e2 = sun.clone().negate().addScaledVector(e1, e1.dot(sun)).normalize();
      if (destination.body === "saturn") e2.applyAxisAngle(e1, 0.35);
    }
    return { body, radius, e1, e2, angle: 0, rate: Math.sqrt(body.gm / radius ** 3) };
  }

  /** Frame-local axes: X = orbit normal, Y = radial up, Z = prograde. */
  private computeFrame(orbit: Orbit, radius = orbit.radius): void {
    const c = Math.cos(orbit.angle), s = Math.sin(orbit.angle);
    const up = orbit.e1.clone().multiplyScalar(c).addScaledVector(orbit.e2, s);
    const forward = orbit.e2.clone().multiplyScalar(c).addScaledVector(orbit.e1, -s);
    const normal = new THREE.Vector3().crossVectors(up, forward);
    this.anchor.copy(orbit.body.position).addScaledVector(up, radius);
    this.frameQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(normal, up, forward));
  }

  private buildEnvironment(color: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 512, 256);
    const c = new THREE.Color(color);
    const gradient = ctx.createLinearGradient(0, 128, 0, 256);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.2, `rgba(${c.r * 255},${c.g * 255},${c.b * 255},0.35)`);
    gradient.addColorStop(1, `rgba(${c.r * 255},${c.g * 255},${c.b * 255},0.9)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 128, 512, 128);
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 120, 1, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    this.environment?.dispose();
    this.environment = this.pmrem.fromEquirectangular(texture).texture;
    texture.dispose();
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.32;
  }

  private buildField(destination: Destination): void {
    if (this.field) {
      this.field.group.removeFromParent();
      this.field = null;
    }
    const belt = destination.field === "belt";
    this.fieldCenter.set(belt ? 0 : 0.4, belt ? 0 : 0.25, belt ? 9 : 15);
    const rocks = !destination.field ? [] : scatterRocks(belt ? 77 : 31, belt ? 560 : 240, this.fieldCenter,
      belt ? new THREE.Vector3(16, 7, 16) : new THREE.Vector3(5.5, 2.4, 9),
      0.02, belt ? 0.95 : 0.5, this.shapes.length, { point: new THREE.Vector3(), radius: belt ? 2.2 : 4 });
    for (const rock of rocks) rock.health = Math.ceil(1 + rock.scale * 9);
    this.field = new AsteroidField(this.shapes, this.rockMaterials, rocks, 2.2);
    this.frame.add(this.field.group);
    for (const satellite of this.satellites) satellite.object.removeFromParent();
    // Target satellites drift near the arrival point; more around Earth, a few at every other stop.
    this.satellites = spawnSatellites(destination.body === "earth" ? 6 : 3, new THREE.Vector3(0, 0.05, 2.5), 3.5,
      DESTINATIONS.indexOf(destination) * 97 + 13);
    for (const satellite of this.satellites) this.frame.add(satellite.object);
    this.lasers.clear();
    this.impacts.clear();
  }

  /** Arrival at a destination: new orbit, a fresh local scene and a clean flight state. */
  private arrive(destination: Destination): void {
    this.destination = destination;
    this.orbit = this.makeOrbit(destination);
    this.p.set(0, 0, 0);
    this.v.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.q.identity();
    if (destination.body !== "sun") {
      // Pitch the nose toward the horizon so the planet fills the lower part of the arrival view.
      const dip = Math.acos(this.orbit.body.radius / this.orbit.radius);
      this.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.max(0, dip - 0.3));
    }
    this.drive = "orbit";
    if (this.target === destination) this.target = null;
    this.buildField(destination);
    // Seen from inside the solar system the belt is far too sparse to show as a band; a dotted line only looks broken.
    this.system.belt.visible = false;
    this.buildEnvironment(this.system.get(destination.body).color);
    this.planetLight.groundColor.set(this.system.get(destination.body).color);
  }

  /** Starts the space part of the flight; the intro continues the open-air ascent. */
  begin(skipIntro: boolean): void {
    this.arrive(DESTINATIONS[0]);
    this.simTime = 0;
    this.timeScale = 0;
    this.homeAfterWarp = false;
    this.warp = null;
    this.gear = 1;
    this.target = null;
    this.kills = { rocks: 0, satellites: 0 };
    this.meteorTimer = 6;
    this.crashCause = "";
    this.drive = "orbit";
    this.throttleLatch = false;
    this.lookYaw = this.lookPitch = 0;
    this.zoom = 1;
    this.setCockpit(false);
    for (const part of this.serviceModule) part.visible = true;
    this.sideModule?.removeFromParent();
    this.sideModule = null;
    this.ship.visible = true;
    this.plasma.material.uniforms.uIntensity.value = 0;
    this.intro.group.visible = true;
    this.intro.start();
    this.setMode(skipIntro ? "flight" : "intro");
    if (skipIntro) this.finishIntro();
  }

  private setMode(mode: SpaceMode): void {
    this.mode = mode;
    this.modeTime = 0;
  }

  private finishIntro(): void {
    while (!this.intro.done) this.intro.update(0.05);
    this.p.copy(this.intro.shipPosition);
    this.q.copy(this.ship.quaternion);
    this.camLocal.copy(this.p).add(new THREE.Vector3(0, 0.008, -0.034));
    this.setMode("flight");
  }

  /** Switches between the chase camera and the pilot's seat; sun shadows are refitted to the cabin. */
  setCockpit(on: boolean): void {
    this.cockpit = on;
    this.interior.group.visible = on;
    for (const part of this.docking) part.visible = !on;
    // Inside, only the cabin's own walls cast shadows, so sunlight enters through the windshield alone.
    for (const [mesh, cast] of this.exteriorShadows) mesh.castShadow = on ? false : cast;
    const shadow = this.sunLight.shadow;
    const range = on ? 0.005 : 0.9;
    shadow.camera.left = shadow.camera.bottom = -range;
    shadow.camera.right = shadow.camera.top = range;
    shadow.camera.near = on ? 2.96 : 0.01;
    shadow.camera.far = on ? 3.04 : 8;
    shadow.camera.updateProjectionMatrix();
    shadow.bias = on ? -0.0002 : -0.0004;
    shadow.normalBias = on ? 0.00001 : 0.002;
    this.cabinLight.intensity = on ? 0.45 : 0;
    this.camera.near = on ? 0.00003 : 0.0004;
    this.camera.updateProjectionMatrix();
    this.lookYaw = this.lookPitch = 0;
    this.screenTimer = 0;
  }

  look(dx: number, dy: number): void {
    this.lookYaw -= dx * 0.005;
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + dy * 0.004, -1.2, 1.2);
  }

  zoomBy(delta: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(delta * 0.001), 0.45, 6);
  }

  /** Discrete key actions. Returns true when the key was used by the space flight. */
  keydown(code: string): boolean {
    if (code === "Enter" && this.mode === "intro") { this.finishIntro(); return true; }
    if (code === "KeyV") {
      if (this.mode !== "intro" && this.mode !== "crash") this.setCockpit(!this.cockpit);
      return true;
    }
    if (code === "KeyU") { this.hudHidden = !this.hudHidden; return true; }
    if (code === "KeyR") { this.lookYaw = this.lookPitch = 0; this.zoom = 1; return true; }
    if (code === "KeyQ" || code === "KeyE") {
      this.gear = THREE.MathUtils.clamp(this.gear + (code === "KeyE" ? 1 : -1), 0, GEARS.length - 1);
      return true;
    }
    const navigation = code.startsWith("Digit") || ["KeyH", "KeyT", "KeyJ", "KeyB"].includes(code);
    if (this.mode !== "flight") return navigation;
    const destination = DESTINATIONS.find(d => `Digit${d.key}` === code);
    if (destination) {
      // First press selects a course to fly yourself; pressing the same number again engages the autopilot.
      if (this.target === destination) this.startWarp(destination);
      else this.target = destination;
      return true;
    }
    if (code === "KeyJ") {
      if (this.target) this.startWarp(this.target);
      else this.say("Välj ett mål med 1–0 först.");
      return true;
    }
    if (code === "KeyB") { this.parkHere(); return true; }
    if (code === "KeyT") {
      if (this.drive === "orbit") this.timeScale = (this.timeScale + 1) % TIME_SCALES.length;
      else this.say("Tidsacceleration fungerar i omloppsbana (B).");
      return true;
    }
    if (code === "KeyH") {
      const earth = this.system.get("earth");
      const distance = this.shipHelio(new THREE.Vector3()).distanceTo(earth.position) - earth.radius;
      if (this.drive === "orbit" && this.orbit.body === earth) this.startReentry();
      else if (distance < 60_000) { this.park(earth); this.startReentry(); }
      else { this.homeAfterWarp = true; this.startWarp(DESTINATIONS[0]); }
      return true;
    }
    return false;
  }

  /** Moves every frame-local object into a new local frame (float64 anchor + orientation) without visible change. */
  private rebase(anchor: THREE.Vector3, quat: THREE.Quaternion): void {
    const inverse = quat.clone().invert();
    const rotation = inverse.clone().multiply(this.frameQuat);
    const offset = this.anchor.clone().sub(anchor).applyQuaternion(inverse);
    const point = (v: THREE.Vector3): void => { v.applyQuaternion(rotation).add(offset); };
    for (const v of [this.p, this.camLocal, this.camTarget, this.fieldCenter, this.previous]) point(v);
    for (const v of [this.v, this.camUp]) v.applyQuaternion(rotation);
    this.q.premultiply(rotation);
    for (const rock of this.field?.rocks ?? []) {
      point(rock.position);
      rock.velocity?.applyQuaternion(rotation);
      rock.base = (rock.base ?? new THREE.Quaternion()).premultiply(rotation);
    }
    for (const satellite of this.satellites) {
      point(satellite.object.position);
      satellite.object.quaternion.premultiply(rotation);
      satellite.velocity.applyQuaternion(rotation);
    }
    for (const object of [this.explosion.group, ...this.targetExplosions.map(e => e.group), this.sideModule]) {
      if (!object) continue;
      point(object.position);
      object.quaternion.premultiply(rotation);
    }
    this.lasers.rebase(point, rotation);
    this.impacts.rebase(point, rotation);
    this.intro.group.visible = false;
    this.anchor.copy(anchor);
    this.frameQuat.copy(quat);
  }

  /** Leaves the circular orbit: the frame freezes in place and the ship flies freely from here. */
  private release(): void {
    if (this.drive === "free") return;
    this.drive = "free";
    this.timeScale = 0;
  }

  /** Enters a circular orbit around `body` at the ship's current distance, heading where the nose points. */
  /** `minimumAltitude` keeps automatic arrivals clear of Earth's re-entry line. */
  private park(body: Body, minimumAltitude = 50): void {
    const position = this.shipHelio(new THREE.Vector3());
    const radius = Math.max(position.distanceTo(body.position), body.radius + Math.max(minimumAltitude, hazardRadius(body) - body.radius + 50));
    const e1 = position.clone().sub(body.position).normalize();
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q).applyQuaternion(this.frameQuat);
    const e2 = nose.addScaledVector(e1, -nose.dot(e1));
    if (e2.lengthSq() < 1e-8) e2.set(e1.y, -e1.x, 0).add(new THREE.Vector3(0, 0, 1e-3));
    e2.normalize();
    const orbit: Orbit = { body, radius, e1, e2, angle: 0, rate: Math.sqrt(body.gm / radius ** 3) };
    const frame = this.frameQuat.clone();
    const anchor = this.anchor.clone();
    this.orbit = orbit;
    this.computeFrame(orbit);
    const newAnchor = this.anchor.clone(), newQuat = this.frameQuat.clone();
    this.anchor.copy(anchor);
    this.frameQuat.copy(frame);
    this.rebase(newAnchor, newQuat);
    this.v.set(0, 0, 0);
    this.drive = "orbit";
    this.limited = this.gravityLimited = false;
    this.destination = DESTINATIONS.find(d => d.body === body.id) ?? { key: "", name: body.name, body: body.id, altitude: radius - body.radius };
  }

  private parkHere(): void {
    const position = this.shipHelio(new THREE.Vector3());
    const body = dominantBody(position, [...this.system.bodies.values()].filter(b => b.id !== "sun"));
    const altitude = position.distanceTo(body.position) - body.radius;
    if (this.drive === "orbit") { this.say(`Du är redan i omloppsbana runt ${this.orbit.body.name}.`); return; }
    if (altitude > body.radius * 40) { this.say(`För långt från ${body.name} för omloppsbana. Flyg närmare.`); return; }
    this.park(body);
  }

  private shipHelio(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.p).applyQuaternion(this.frameQuat).add(this.anchor);
  }

  /** Autopilot hyper-jump on a curved route that climbs away from the departure body and never cuts through a planet. */
  private startWarp(next: Destination): void {
    if (next === this.destination && this.drive === "orbit") { this.say(`Du är redan vid ${next.name}.`); return; }
    const from = this.shipHelio(new THREE.Vector3());
    const orbit = this.makeOrbit(next);
    const to = orbit.body.position.clone().addScaledVector(orbit.e1, orbit.radius);
    const bodies = [...this.system.bodies.values()].map(b => ({ position: b.position, radius: hazardRadius(b) }));
    const departure = dominantBody(from, [...this.system.bodies.values()].filter(b => b.id !== "sun"));
    const near = from.distanceTo(departure.position) < departure.radius * 60;
    const points = jumpPath(from, near ? { position: departure.position, radius: departure.radius } : null, to,
      next.body === "sun" ? null : { position: orbit.body.position, radius: orbit.body.radius }, bodies);
    const seconds = THREE.MathUtils.clamp(4.5 + Math.log10(Math.max(10, from.distanceTo(to))) * 0.45, 6, 9.5);
    // The local frame freezes during the jump so drifting fields and targets stay put behind the ship.
    this.drive = "free";
    this.warp = { points, next, seconds };
    this.timeScale = 0;
    this.v.set(0, 0, 0);
    this.setMode("warp");
  }

  private startReentry(): void {
    this.timeScale = 0;
    this.reentryFrom = this.orbit.radius;
    this.v.set(0, 0, 0);
    // Jettison the service module; only the capsule with its heat shield enters the atmosphere.
    const clone = this.model.clone(true);
    const capsuleClone = clone.getObjectByName("Kapsel");
    if (capsuleClone) capsuleClone.visible = false;
    const holder = new THREE.Group();
    holder.add(clone);
    holder.scale.setScalar(0.001);
    holder.position.copy(this.p);
    holder.quaternion.copy(this.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    holder.userData.velocity = new THREE.Vector3(0, 0.002, -0.004).applyQuaternion(this.q);
    this.frame.add(holder);
    this.sideModule = holder;
    for (const part of this.serviceModule) part.visible = false;
    this.setMode("reentry");
  }

  private crash(): void {
    if (this.cockpit) this.setCockpit(false);
    this.crashCause ||= "Kollision! Rymdfarkosten förstördes.";
    this.setMode("crash");
    this.v.set(0, 0, 0);
    // Pull the camera back so the fireball and the drifting wreckage are framed rather than filling the screen.
    this.camLocal.sub(this.p).setLength(0.11).add(this.p);
    this.explosion.start(this.p, this.camLocal);
    this.ship.visible = false;
    this.shake = 1;
  }

  /** Advances the space flight. Returns `home` when the player should be back at the spaceport. */
  update(rawDt: number, keys: ReadonlySet<string>): SpaceEvent {
    const dt = Math.min(Math.max(rawDt, 0), 0.05);
    this.elapsed += dt;
    this.modeTime += dt;
    const scale = this.mode === "flight" ? TIME_SCALES[this.timeScale] : 1;
    this.simTime += dt * scale;
    let event: SpaceEvent = null;
    // Only the intro and re-entry override the orbit radius; otherwise read it after the mode logic,
    // because arrival, parking and re-entry can switch to a new orbit in the middle of this frame.
    let radius: number | null = null;
    let warpSpeed = 0;
    this.shake = Math.max(0, this.shake - dt * 0.6);
    switch (this.mode) {
      case "intro": {
        const k = THREE.MathUtils.smoothstep(this.intro.time, 0, 17);
        radius = this.orbit.body.radius + THREE.MathUtils.lerp(70, this.destination.altitude, k);
        this.intro.update(dt);
        this.shake = this.intro.time < 3 || (this.intro.time > 4.4 && this.intro.time < 11.8) ? 0.12 : 0;
        if (this.intro.done) this.finishIntro();
        break;
      }
      case "flight":
        this.fly(dt, keys);
        this.fireCooldown = Math.max(0, this.fireCooldown - dt);
        if (this.mode === "flight" && (keys.has("Space") || keys.has("KeyF")) && this.fireCooldown === 0) this.fire();
        break;
      case "warp":
        warpSpeed = this.updateWarp();
        break;
      case "reentry":
        radius = this.updateReentry(dt);
        if (this.modeTime >= REENTRY_SECONDS) event = { kind: "home", reason: "reentry" };
        break;
      case "crash":
        if (this.modeTime >= CRASH_SECONDS) event = { kind: "home", reason: "crash" };
        break;
    }
    this.explosion.update(dt);
    for (const blast of this.targetExplosions) blast.update(dt);
    if (this.drive === "orbit") {
      this.orbit.angle += this.orbit.rate * dt * scale;
      this.computeFrame(this.orbit, radius ?? this.orbit.radius);
    }
    if (this.mode === "warp" && this.warp) {
      // Keep the ship exactly at the route's heliocentric point (float64, no precision loss on screen).
      const position = this.warpPosition();
      if (position.distanceTo(this.anchor) > REBASE_DISTANCE) this.rebase(position, this.frameQuat.clone());
      this.p.copy(position).sub(this.anchor).applyQuaternion(this.frameQuat.clone().invert());
    } else if (this.drive === "free" && this.p.length() > REBASE_DISTANCE && this.mode === "flight") {
      this.rebase(this.shipHelio(new THREE.Vector3()), this.frameQuat.clone());
    }
    this.shipHelio(this.origin);
    this.frame.position.copy(this.anchor).sub(this.origin);
    this.frame.quaternion.copy(this.frameQuat);
    if (this.mode !== "intro") {
      this.ship.position.copy(this.p);
      this.ship.quaternion.copy(this.q);
    }
    this.noticeTime = Math.max(0, this.noticeTime - dt);
    const body = this.drive === "orbit" ? this.orbit.body
      : dominantBody(this.origin, [...this.system.bodies.values()].filter(b => b.id !== "sun"));
    const altitude = this.drive === "orbit" && body.id === "sun" ? Infinity : this.origin.distanceTo(body.position) - body.radius;
    if (this.mode === "flight" && this.drive === "orbit") {
      if (body.id === "earth" && altitude < 140) this.startReentry();
      else if (altitude < body.crashAltitude) this.crash();
    }
    if (this.mode !== "intro") {
      this.lasers.update(dt, (from, to) => this.laserHit(from, to));
      this.impacts.update(dt);
      this.updateSatellites(dt);
      this.updateMeteoroids(dt);
    }
    this.updateCamera(dt, warpSpeed);
    this.system.update(this.origin, this.camera.position, this.simTime, SUN_INTENSITY);
    this.stars.position.copy(this.camera.position);
    this.updateLights(altitude, body);
    if (this.field) this.field.update(dt * (this.mode === "crash" ? 1 : 1), this.p);
    this.streaks.update(dt, warpSpeed, this.elapsed);
    this.rcs.update(dt, 1);
    this.updateFlare();
    this.updateHud(altitude);
    if (this.cockpit) {
      this.screenTimer -= dt;
      if (this.screenTimer <= 0) { this.screenTimer = 0.2; this.paintScreen(); }
    }
    return event;
  }

  private fly(dt: number, keys: ReadonlySet<string>): void {
    const has = (code: string): boolean => keys.has(code);
    const rate = 0.85;
    const target = new THREE.Vector3(
      (Number(has("ArrowUp")) - Number(has("ArrowDown"))) * rate,
      (Number(has("ArrowLeft")) - Number(has("ArrowRight"))) * rate,
      (Number(has("KeyD")) - Number(has("KeyA"))) * rate * 1.3,
    );
    this.w.lerp(target, 1 - Math.exp(-dt * 3.5));
    this.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.w.x * dt, this.w.y * dt, this.w.z * dt))).normalize();
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
    if (this.throttleLatch && !has("KeyW") && !has("KeyS")) this.throttleLatch = false;
    const throttle = !this.throttleLatch;
    if (throttle && (has("KeyW") || has("KeyS") || has("KeyX"))) this.release();
    const boost = has("ShiftLeft") || has("ShiftRight") ? 10 : 1;
    this.throttling = has("KeyW") && !this.throttleLatch;
    this.boosting = boost > 1;
    const cruise = GEARS[this.gear].speed * boost;
    let along = this.v.dot(forward);
    const lateral = this.v.clone().addScaledVector(forward, -along);
    if (throttle && has("KeyW")) along = approachSpeed(along, cruise, dt);
    else if (throttle && has("KeyS")) along = along > 0 ? Math.max(0, along * Math.exp(-dt * 5) - 0.05 * dt) : approachSpeed(along, -Math.min(cruise, 1) * 0.5, dt);
    // Flight assist turns sideways drift into the new heading, so the craft steers like a car instead of sliding.
    lateral.multiplyScalar(Math.exp(-dt * 2.4));
    this.v.copy(forward).multiplyScalar(along).add(lateral);
    if (has("KeyX")) {
      this.v.multiplyScalar(Math.exp(-dt * 5));
      if (this.v.length() < 0.002) this.v.set(0, 0, 0);
    }
    if (this.drive === "free") this.limitApproach();
    this.previous.copy(this.p);
    this.p.addScaledVector(this.v, dt);
    const plume = this.enginePlume.material.uniforms;
    plume.uTime.value += dt;
    plume.uIntensity.value = THREE.MathUtils.damp(plume.uIntensity.value, throttle && has("KeyW") ? (boost > 1 ? 2.4 : 1.3) : 0, 10, dt);
    plume.uLength.value = 16 + this.gear * 1.6 + (boost > 1 ? 10 : 0);
    if (target.lengthSq() > 0 || has("KeyS") || has("KeyX")) this.thrusterPuffs(target);
    if (this.drive === "free" && this.sweepBodies()) return;
    if (this.drive === "free" && this.arriveAtTarget()) return;
    const rock = this.field?.raycast(this.previous, this.p, SHIP_RADIUS);
    if (rock) { this.crash(); return; }
    if (this.satellites.some(sat => segmentSphere(this.previous, this.p, sat.object.position, sat.radius + SHIP_RADIUS) !== null)) {
      this.crash();
      return;
    }
    if (this.homeAfterWarp && this.modeTime > 1.2) {
      this.homeAfterWarp = false;
      this.startReentry();
    }
  }

  /**
   * Automatic approach braking: on a collision course with a body, the closing speed may not exceed
   * a fraction of the remaining clearance per second. Flying past at any speed is still allowed.
   */
  private limitApproach(): void {
    const position = this.shipHelio(new THREE.Vector3());
    const velocity = this.v.clone().applyQuaternion(this.frameQuat);
    this.limited = false;
    let clearance = Infinity;
    for (const body of this.system.bodies.values()) clearance = Math.min(clearance, position.distanceTo(body.position) - hazardRadius(body));
    const cap = gravityLimit(clearance);
    this.gravityLimited = velocity.length() > cap * 1.001;
    if (this.gravityLimited) velocity.setLength(cap);
    for (const body of this.system.bodies.values()) {
      const speed = velocity.length();
      if (speed < 1e-9) break;
      const toBody = body.position.clone().sub(position);
      const distance = toBody.length();
      const hazard = hazardRadius(body);
      const ahead = toBody.dot(velocity) / speed;
      if (ahead <= 0) continue;
      const miss = Math.sqrt(Math.max(0, distance * distance - ahead * ahead));
      if (miss > hazard * 1.6) continue;
      // Heading for a body: cap the whole speed, not just the closing part, so the craft settles in front of it
      // instead of sliding sideways around it and shooting off into space.
      const allowed = speedLimit(distance - hazard);
      if (speed > allowed) {
        velocity.setLength(allowed);
        this.limited = true;
      }
    }
    this.v.copy(velocity.applyQuaternion(this.frameQuat.clone().invert()));
  }

  /** Swept test of this frame's motion against every body: Earth's atmosphere starts re-entry, other surfaces crash. */
  private sweepBodies(): boolean {
    const a = this.previous.clone().applyQuaternion(this.frameQuat).add(this.anchor);
    const b = this.shipHelio(new THREE.Vector3());
    for (const body of this.system.bodies.values()) {
      const earth = body.id === "earth";
      const t = segmentSphere(a, b, body.position, body.radius + (earth ? 140 : body.crashAltitude));
      if (t === null) continue;
      this.p.lerpVectors(this.previous, this.p, t);
      if (earth) {
        this.park(body);
        this.startReentry();
      } else {
        this.crashCause = body.id === "sun" ? "Farkosten kom för nära solen." : `Farkosten slog i ${body.name}.`;
        this.crash();
      }
      return true;
    }
    return false;
  }

  /** Flying yourself to the selected target ends in a circular orbit once the craft is close and still closing in. */
  private arriveAtTarget(): boolean {
    const target = this.target;
    if (!target || target.body === "sun") return false;
    const body = this.system.get(target.body);
    const position = this.shipHelio(new THREE.Vector3());
    const toBody = body.position.clone().sub(position);
    const altitude = toBody.length() - body.radius;
    const closing = this.v.clone().applyQuaternion(this.frameQuat).dot(toBody.normalize());
    if (closing <= 0 || altitude > Math.max(target.altitude * 1.6, 600)) return false;
    // Earth's limiter settles ~100 km up; lift the arrival orbit so it is a stable parking orbit, not a re-entry.
    this.park(body, body.id === "earth" ? 250 : 50);
    this.target = null;
    this.throttleLatch = true;
    this.say(`Framme · omloppsbana runt ${body.name}. W för att flyga vidare.`);
    return true;
  }

  private fire(): void {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    this.fireSide = -this.fireSide;
    const origin = this.p.clone().addScaledVector(forward, 0.008).addScaledVector(right, this.fireSide * 0.0019);
    this.lasers.fire(origin, forward, LASER_SPEED, this.v);
    this.fireCooldown = LASER_COOLDOWN;
  }

  /** Laser impact test for one bolt step; returns true when the bolt is spent. */
  private laserHit(from: THREE.Vector3, to: THREE.Vector3): boolean {
    let best: { t: number; apply: () => void } | null = null;
    const hit = this.field?.raycast(from, to, 0.0006);
    if (hit) best = { t: hit.t, apply: () => this.hitRock(hit.rock, hit.point) };
    for (const satellite of this.satellites) {
      const t = segmentSphere(from, to, satellite.object.position, satellite.radius);
      if (t !== null && (!best || t < best.t)) best = { t, apply: () => this.hitSatellite(satellite, from.clone().lerp(to, t)) };
    }
    best?.apply();
    return best !== null;
  }

  private hitRock(rock: Rock, point: THREE.Vector3): void {
    const normal = point.clone().sub(rock.position).normalize();
    this.impacts.burst(point, normal, Math.max(0.004, rock.scale * 0.05));
    rock.health = (rock.health ?? 1) - 1;
    if (rock.health > 0) return;
    this.field!.remove(rock);
    this.kills.rocks++;
    this.impacts.burst(rock.position, normal, Math.max(0.01, rock.scale * 0.45), true);
    if (rock.scale < 0.05) return;
    // Larger rocks break into tumbling fragments that can be shot again.
    const pieces = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pieces; i++) {
      const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const scale = rock.scale * (0.26 + Math.random() * 0.2);
      this.field!.add({
        position: rock.position.clone().addScaledVector(direction, rock.scale * 0.45),
        velocity: (rock.velocity?.clone() ?? new THREE.Vector3()).addScaledVector(direction, 0.006 + Math.random() * 0.02),
        scale, health: 1 + Math.floor(scale * 8),
        axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        spin: (Math.random() - 0.5) * 1.2, angle: Math.random() * 6, shape: Math.floor(Math.random() * this.shapes.length),
        quaternion: new THREE.Quaternion(), base: rock.base?.clone(),
      });
    }
  }

  private hitSatellite(satellite: Satellite, point: THREE.Vector3): void {
    satellite.health--;
    this.impacts.burst(point, point.clone().sub(satellite.object.position).normalize(), 0.004);
    if (satellite.health > 0) return;
    const blast = this.targetExplosions.find(e => !e.active) ?? this.targetExplosions[0];
    blast.start(satellite.object.position, this.camLocal, 0.35);
    satellite.object.removeFromParent();
    this.satellites.splice(this.satellites.indexOf(satellite), 1);
    this.kills.satellites++;
  }

  /** Meteoroids streak across the ship's path now and then; they can be dodged or shot down. */
  private updateMeteoroids(dt: number): void {
    const field = this.field;
    if (!field) return;
    for (const rock of [...field.rocks]) {
      if (rock.kind === "meteoroid" && rock.position.distanceTo(this.p) > 25) field.remove(rock);
    }
    this.meteorTimer -= dt;
    if (this.meteorTimer > 0 || this.mode !== "flight") return;
    this.meteorTimer = 5 + Math.random() * 7;
    if (field.rocks.filter(r => r.kind === "meteoroid").length >= 10) return;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    const side = Math.random() < 0.5 ? -1 : 1;
    const start = this.p.clone().addScaledVector(forward, 2.5 + Math.random() * 2)
      .addScaledVector(right, side * (1.8 + Math.random())).addScaledVector(up, (Math.random() - 0.5) * 1.2);
    const aim = this.p.clone().addScaledVector(forward, 0.8 + Math.random() * 2.5).addScaledVector(up, (Math.random() - 0.5) * 0.3);
    const scale = 0.012 + Math.random() * 0.04;
    field.add({
      position: start, scale, kind: "meteoroid", health: 1 + Math.floor(scale * 30),
      velocity: aim.sub(start).normalize().multiplyScalar(0.08 + Math.random() * 0.12).add(this.v),
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      spin: (Math.random() - 0.5) * 2, angle: 0, shape: Math.floor(Math.random() * this.shapes.length), quaternion: new THREE.Quaternion(),
    });
  }

  private updateSatellites(dt: number): void {
    for (const satellite of this.satellites) {
      satellite.object.position.addScaledVector(satellite.velocity, dt);
      satellite.object.rotateX(satellite.spin.x * dt);
      satellite.object.rotateY(satellite.spin.y * dt);
      const beacon = satellite.object.getObjectByName("Ljusfyr");
      if (beacon) beacon.visible = Math.sin(this.elapsed * 6 + satellite.object.id) > 0.6;
    }
  }

  private say(text: string): void {
    this.notice = text;
    this.noticeTime = 3;
  }

  private thrusterPuffs(turn: THREE.Vector3): void {
    if (Math.random() > 0.55) return;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      if ((i + Math.round(turn.x + turn.y * 2 + turn.z * 3)) % 2) continue;
      const out = new THREE.Vector3(Math.cos(a), (Math.random() - 0.5) * 0.8, Math.sin(a)).normalize();
      const p = new THREE.Vector3(Math.cos(a) * 1.9, 3.2, Math.sin(a) * 1.9);
      this.rcs.emit(p, out.multiplyScalar(6), { life: 0.45, size: 0.2, growth: 1.1, drag: 1.2, rise: 0, shade: 0.9, opacity: 0.35 });
    }
  }

  private warpTravel(): number {
    return THREE.MathUtils.smootherstep(this.modeTime / this.warp!.seconds, 0.16, 0.9);
  }

  private warpPosition(): THREE.Vector3 {
    return bezier(this.warp!.points, this.warpTravel());
  }

  private updateWarp(): number {
    const w = this.warp!;
    const t = this.modeTime / w.seconds;
    if (this.field) this.field.group.visible = t < 0.18;
    for (const satellite of this.satellites) satellite.object.visible = t < 0.18;
    this.intro.group.visible = false;
    const direction = bezierTangent(w.points, Math.max(0.001, this.warpTravel()));
    const facing = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    const local = this.frameQuat.clone().invert().multiply(facing);
    this.q.slerp(local, t < 0.16 ? THREE.MathUtils.smoothstep(t, 0, 0.16) : 0.2);
    const plume = this.enginePlume.material.uniforms;
    plume.uIntensity.value = t > 0.1 && t < 0.92 ? 2.6 : 0;
    plume.uTime.value += 0.016;
    this.shake = Math.max(this.shake, t > 0.14 && t < 0.25 ? 0.5 : 0);
    if (t >= 1) {
      const next = w.next;
      this.warp = null;
      this.arrive(next);
      this.setMode("flight");
      this.camLocal.copy(new THREE.Vector3(0, 0.006, -0.03));
      return 0;
    }
    return Math.sin(Math.PI * THREE.MathUtils.clamp((t - 0.14) / 0.8, 0, 1));
  }

  private updateReentry(dt: number): number {
    const t = this.modeTime;
    const k = THREE.MathUtils.smootherstep(t, 0.5, REENTRY_SECONDS - 0.8);
    const radius = THREE.MathUtils.lerp(this.reentryFrom, this.orbit.body.radius + 62, k);
    this.p.multiplyScalar(Math.exp(-dt * 0.6));
    // Heat shield forward: the ship's +Z (nose) points retrograde, slightly pitched for lift.
    const target = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.35));
    this.q.slerp(target, 1 - Math.exp(-dt * 1.4));
    const heat = THREE.MathUtils.smoothstep(t, 2.2, 5) * (1 - THREE.MathUtils.smoothstep(t, 8.8, 9.8));
    const u = this.plasma.material.uniforms;
    u.uTime.value += dt;
    u.uIntensity.value = heat * (0.85 + Math.sin(t * 37) * 0.08 + Math.sin(t * 13) * 0.07);
    this.enginePlume.material.uniforms.uIntensity.value = 0;
    this.shake = Math.max(this.shake, heat * 0.55);
    if (this.sideModule) {
      this.sideModule.position.addScaledVector(this.sideModule.userData.velocity as THREE.Vector3, dt);
      this.sideModule.rotateX(dt * 0.2);
    }
    return radius;
  }

  private updateCamera(dt: number, warpSpeed: number): void {
    let fov = 55;
    if (this.cockpit && this.mode !== "intro" && this.mode !== "crash") {
      // Head look from the pilot's seat: drag right looks right, drag down looks down.
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw, -1.6, 1.6);
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch, -0.8, 0.75);
      const head = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1 + this.lookPitch, this.lookYaw, 0, "YXZ"));
      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(head).applyQuaternion(this.q);
      this.camLocal.copy(this.cockpitEye).applyQuaternion(this.q).add(this.p);
      this.camTarget.copy(this.camLocal).addScaledVector(direction, 0.01);
      this.camUp.set(0, 1, 0).applyQuaternion(head).applyQuaternion(this.q);
      fov = 72 + warpSpeed * 14;
    } else if (this.mode === "intro") {
      this.intro.camera(this.introCamera);
      this.camLocal.copy(this.introCamera.position);
      this.camTarget.copy(this.introCamera.target);
      this.camUp.copy(this.introCamera.up);
      fov = this.introCamera.fov;
    } else {
      const reentry = this.mode === "reentry";
      const dist = (reentry ? 0.03 : 0.036) * this.zoom;
      const yaw = Math.PI + this.lookYaw + (reentry ? Math.PI * 0.82 : 0);
      const pitch = (reentry ? 0.12 : 0.24) + this.lookPitch;
      const offset = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
        .multiplyScalar(dist).applyQuaternion(this.q);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
      offset.addScaledVector(forward, -Math.min(this.v.length(), 3) * 0.002);
      const current = this.camLocal.clone().sub(this.p);
      if (this.mode === "warp" || current.length() > 0.5) current.copy(offset);
      if (this.mode !== "crash") current.lerp(offset, 1 - Math.exp(-dt * 6));
      else current.multiplyScalar(1 + dt * 0.08);
      this.camLocal.copy(this.p).add(current);
      this.camUp.lerp(UP.clone().applyQuaternion(this.q), 1 - Math.exp(-dt * 3)).normalize();
      this.camTarget.copy(this.p).addScaledVector(forward, reentry ? 0 : 0.004);
      if (!reentry) this.camTarget.addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(this.q), 0.0075 * this.zoom);
      fov = 55 + warpSpeed * 22;
    }
    const relative = this.camLocal.clone().sub(this.p);
    const target = this.camTarget.clone().sub(this.p);
    if (this.mode === "intro") {
      relative.copy(this.camLocal).sub(this.p);
      target.copy(this.camTarget).sub(this.p);
    }
    const shake = this.shake * (this.cockpit ? 0.000012 : 0.0007);
    relative.x += (Math.sin(this.elapsed * 43) + Math.sin(this.elapsed * 29.7)) * shake;
    relative.y += (Math.sin(this.elapsed * 51) + Math.sin(this.elapsed * 23.3)) * shake;
    this.camera.position.copy(relative.applyQuaternion(this.frameQuat));
    this.camera.up.copy(this.camUp).applyQuaternion(this.frameQuat);
    this.camera.lookAt(target.applyQuaternion(this.frameQuat));
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, fov, 6, dt || 0.016);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateLights(altitude: number, body: Body): void {
    const sunDir = this.origin.clone().negate().normalize();
    this.sunLight.position.copy(sunDir).multiplyScalar(3);
    this.sunLight.target.position.set(0, 0, 0);
    const up = this.origin.clone().sub(body.position).normalize();
    this.planetLight.position.copy(up);
    const near = body.id === "sun" ? 0 : THREE.MathUtils.clamp(body.radius / (body.radius + Math.max(altitude, 0)), 0, 1) ** 2;
    const day = THREE.MathUtils.smoothstep(up.dot(sunDir), -0.25, 0.4);
    this.planetLight.intensity = near * day * 0.75;
    this.scene.environmentRotation.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, up));
  }

  private updateFlare(): void {
    const sun = this.system.get("sun");
    const sunWorld = sun.root.position;
    const toSun = sunWorld.clone().sub(this.camera.position);
    const distance = toSun.length();
    toSun.divideScalar(distance);
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    let visibility = forward.dot(toSun) > 0.2 ? 1 : 0;
    for (const body of this.system.bodies.values()) {
      if (body.id === "sun" || visibility === 0) continue;
      const toBody = body.root.position.clone().sub(this.camera.position);
      const along = toBody.dot(toSun);
      if (along <= 0 || along > distance) continue;
      const miss = toBody.addScaledVector(toSun, -along).length();
      const edge = body.radius * (body.atmosphere ? 1.01 : 1);
      visibility = Math.min(visibility, THREE.MathUtils.smoothstep(miss, edge * 0.998, edge * 1.004));
    }
    if (!this.ship.visible) visibility *= 1;
    const ndc = sunWorld.clone().project(this.camera);
    this.flare.update(new THREE.Vector2(ndc.x, ndc.y), visibility, this.camera.aspect);
    // Glare from the Sun washes out faint stars, as with a real camera exposure.
    const glare = visibility * (1 - THREE.MathUtils.smoothstep(Math.hypot(ndc.x, ndc.y), 0.4, 1.6));
    (this.stars.material as THREE.ShaderMaterial).uniforms.brightness.value = 1 - glare * 0.75;
    this.scene.backgroundIntensity = 0.2 * (1 - glare * 0.7);
  }

  private destinationPoint(d: Destination): THREE.Vector3 {
    return d.body === "sun" ? new THREE.Vector3(Math.sin(0.15), 0.02, Math.cos(0.15)).normalize().multiplyScalar(d.altitude)
      : this.system.get(d.body).position;
  }

  private destinationDistance(d: Destination): number {
    return Math.max(0, this.origin.distanceTo(this.destinationPoint(d)) - (d.body === "sun" ? 0 : this.system.get(d.body).radius));
  }

  private updateHud(altitude: number): void {
    const hud = this.hud;
    const body = this.orbit.body;
    const t = this.modeTime;
    hud.mode = this.mode;
    const nearest = dominantBody(this.origin, [...this.system.bodies.values()].filter(b => b.id !== "sun"));
    hud.title = this.mode === "warp" && this.warp ? `Hopp mot ${this.warp.next.name}`
      : this.drive === "orbit" ? (this.destination.body === "sun" ? "Asteroidbältet · 2,75 AE från solen" : `Omloppsbana runt ${body.name}`)
        : `Fri flygning · nära ${nearest.name}`;
    hud.detail = this.drive === "orbit" ? (this.throttleLatch ? "Nordstjärnan · släpp W och tryck igen för att flyga vidare" : "Nordstjärnan · W lämnar omloppsbanan")
      : "Nordstjärnan · B går in i omloppsbana";
    const speed = this.mode === "warp" && this.warp ? this.warpSpeedKms() : this.v.length();
    hud.stats = [
      [this.drive === "orbit" ? "Höjd" : `Höjd över ${nearest.name}`, Number.isFinite(altitude) ? formatDistance(Math.max(0, altitude)) : "—"],
      ["Fart", formatSpeed(speed)],
      this.drive === "orbit"
        ? ["Banhastighet", `${(this.orbit.rate * this.orbit.radius).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} km/s`]
        : ["Växel", `${this.gear + 1} · ${GEARS[this.gear].name}`],
      this.drive === "orbit" ? ["Tid", `×${TIME_SCALES[this.timeScale]}`] : ["Träffar", `${this.kills.rocks + this.kills.satellites}`],
    ];
    hud.destinations = DESTINATIONS.map(d => ({
      key: d.key, name: d.name, distance: formatDistance(this.destinationDistance(d)),
      active: this.drive === "orbit" && d === this.destination, selected: d === this.target,
    }));
    hud.gear = { index: this.gear, name: GEARS[this.gear].name, speed: formatSpeed(GEARS[this.gear].speed), limited: (this.limited || this.gravityLimited) && this.mode === "flight" && this.drive === "free" };
    const aim = this.p.clone().add(new THREE.Vector3(0, 0, 1.5).applyQuaternion(this.q)).sub(this.p)
      .applyQuaternion(this.frameQuat).project(this.camera);
    hud.crosshair = { x: (aim.x + 1) / 2, y: (1 - aim.y) / 2, visible: this.mode === "flight" && aim.z < 1 && Math.abs(aim.x) < 1 && Math.abs(aim.y) < 1 };
    hud.score = this.kills.rocks + this.kills.satellites > 0
      ? `${this.kills.rocks} stenar · ${this.kills.satellites} satelliter` : "";
    hud.caption = this.mode === "intro" ? this.intro.caption
      : this.mode === "warp" && this.warp ? (t < 1.2 ? `Kurs läggs mot ${this.warp.next.name} ...` : `Hopp · ${formatDistance(this.warpPosition().distanceTo(this.warp.points[3]))} kvar`)
        : this.mode === "reentry" ? (t < 2 ? "Servicemodulen kopplas loss · Värmeskölden framåt" : t < 8 ? "Återinträde · 1 600 °C mot värmeskölden" : "Fallskärmarna vecklas ut ...")
          : this.mode === "crash" ? `${this.crashCause} Ingen skadades i simulatorn.`
            : this.noticeTime > 0 ? this.notice
              : t < 4 && this.drive === "orbit" && this.destination.body !== "earth" ? `Framme vid ${this.destination.name}` : "";
    hud.warning = "";
    if (this.mode === "flight") {
      if (this.limited && this.drive === "free") hud.warning = `INFLYGNING · Farten begränsas nära ${nearest.name}`;
      const near = this.field?.nearest(this.p) ?? Infinity;
      if (near < 0.5) hud.warning = `KOLLISIONSVARNING · Asteroid ${formatDistance(Math.max(0, near))}`;
    }
    hud.marker.visible = false;
    if (this.field && this.mode === "flight" && this.destination.field && this.drive === "orbit") {
      const distance = this.p.distanceTo(this.fieldCenter);
      if (distance > 4) {
        const world = this.fieldCenter.clone().sub(this.p).applyQuaternion(this.frameQuat);
        const ndc = world.clone().project(this.camera);
        const inFront = this.camera.getWorldDirection(new THREE.Vector3()).dot(world) > 0;
        if (inFront && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1) {
          hud.marker = { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2, visible: true, label: `Asteroidfält · ${formatDistance(distance)}` };
        }
      }
    }
    hud.target.visible = false;
    if (this.target && (this.mode === "flight" || this.mode === "warp")) {
      const point = this.destinationPoint(this.target);
      const world = point.clone().sub(this.origin);
      const distance = this.destinationDistance(this.target);
      const ndc = world.clone().project(this.camera);
      const behind = this.camera.getWorldDirection(new THREE.Vector3()).dot(world) < 0;
      let x = ndc.x, y = ndc.y;
      if (behind) { x = -x; y = -y; }
      const edge = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
      if (edge) {
        const k = 1 / Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86, 1e-6);
        x *= k; y *= k;
      }
      const closing = this.v.clone().applyQuaternion(this.frameQuat).dot(world.clone().normalize());
      const blocker = this.target.body === "sun" ? null
        : blockingBody(this.origin, point, this.system.bodies.values(), hazardRadius, this.target.body);
      hud.target = {
        x: (x + 1) / 2, y: (1 - y) / 2, visible: true, edge, angle: Math.atan2(-y, x),
        label: `${this.target.name} · ${formatDistance(distance)}`,
        eta: blocker ? `${blocker.name} är i vägen · sväng runt eller J: autopilot` : this.eta(distance, closing, world),
      };
    }
    const warpSeconds = this.warp?.seconds ?? WARP_SECONDS;
    hud.fade = this.mode === "intro" ? 1 - THREE.MathUtils.smoothstep(t, 0, 1.4)
      : this.mode === "reentry" ? THREE.MathUtils.smoothstep(t, REENTRY_SECONDS - 2.4, REENTRY_SECONDS - 0.2)
        : this.mode === "crash" ? THREE.MathUtils.smoothstep(t, CRASH_SECONDS - 1, CRASH_SECONDS)
          : this.mode === "warp" ? Math.max(0, 1 - Math.abs(t / warpSeconds - 0.15) * 25) * 0.6 + Math.max(0, 1 - Math.abs(t / warpSeconds - 0.92) * 22) * 0.8
            : 0;
    hud.fadeColor = this.mode === "crash" ? "#000000" : "#ffffff";
  }

  /** Arrival estimate: simulated with the selected gear while the throttle is held and the nose points at the target. */
  private eta(distance: number, closing: number, toTarget: THREE.Vector3): string {
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q).applyQuaternion(this.frameQuat);
    const aimed = nose.dot(toTarget.clone().normalize()) > 0.995;
    if (this.mode === "flight" && this.throttling && aimed) {
      let clearance = Infinity;
      for (const body of this.system.bodies.values()) clearance = Math.min(clearance, this.origin.distanceTo(body.position) - hazardRadius(body));
      const cruise = GEARS[this.gear].speed * (this.boosting ? 10 : 1);
      return `Framme om ${formatDuration(travelTime(clearance, distance, cruise, Math.max(0, closing)))}`;
    }
    if (closing > 0.01) return `Framme om ${formatDuration(this.target?.body === "sun" ? distance / closing : arrivalTime(distance, closing))}`;
    return aimed ? `W: flyg dit · ${this.target?.key} igen / J: autopilot` : `Sikta på markören · ${this.target?.key} igen / J: autopilot`;
  }

  private warpSpeedKms(): number {
    const dt = 0.01;
    const now = this.warpPosition();
    this.modeTime += dt;
    const later = this.warpPosition();
    this.modeTime -= dt;
    return now.distanceTo(later) / dt;
  }

  /** Flight computer display in the cabin: telemetry, an orbit plot and warnings. */
  private paintScreen(): void {
    const { ctx, texture } = this.interior.screen;
    const hud = this.hud;
    const W = 1024, H = 440;
    ctx.fillStyle = "#06111b";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#1f4460";
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#7fb6e0";
    ctx.font = "600 22px 'Helvetica Neue', Arial, sans-serif";
    ctx.fillText("NORDSTJÄRNAN · FLYGDATOR", 28, 44);
    ctx.textAlign = "right";
    const modeText = this.mode === "warp" ? "AUTOPILOT" : this.mode === "reentry" ? "ÅTERINTRÄDE" : this.drive === "orbit" ? "OMLOPPSBANA" : `VÄXEL ${this.gear + 1}`;
    ctx.fillStyle = this.mode === "reentry" ? "#ffb35c" : "#5effa0";
    ctx.fillText(modeText, W - 28, 44);
    ctx.textAlign = "left";
    ctx.fillStyle = "#eef6ff";
    ctx.font = "500 34px 'Helvetica Neue', Arial, sans-serif";
    ctx.fillText(hud.title, 28, 96, 600);
    hud.stats.forEach(([label, value], i) => {
      const x = 28 + (i % 2) * 300, y = 150 + Math.floor(i / 2) * 104;
      ctx.fillStyle = "#0c2133";
      ctx.fillRect(x, y, 280, 88);
      ctx.fillStyle = "#7fa6c4";
      ctx.font = "600 18px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(label.toUpperCase(), x + 16, y + 30);
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 34px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(value, x + 16, y + 72, 250);
    });
    // Orbit plot: the planet, the circular orbit and the ship's current position on it.
    const cx = 800, cy = 250, ring = 130;
    const plotted = this.drive === "orbit" ? this.orbit.body
      : dominantBody(this.origin, [...this.system.bodies.values()].filter(b => b.id !== "sun"));
    const planet = this.destination.body === "sun" && this.drive === "orbit" ? 26
      : Math.max(26, Math.min(ring - 12, ring * plotted.radius / Math.max(plotted.radius, this.origin.distanceTo(plotted.position))));
    ctx.fillStyle = `#${plotted.color.toString(16).padStart(6, "0")}`;
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(cx, cy, planet, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#3d8fd0";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(cx, cy, ring, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    const angle = this.drive === "orbit" ? this.orbit.angle % (Math.PI * 2) : Math.PI / 2;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(cx + Math.cos(angle) * ring, cy - Math.sin(angle) * ring, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#7fa6c4";
    ctx.font = "600 18px 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(plotted.name.toUpperCase(), cx, cy + ring + 34);
    ctx.textAlign = "left";
    if (hud.warning || (this.mode !== "flight" && hud.caption)) {
      ctx.fillStyle = hud.warning ? "#4a0d0d" : "#0c2133";
      ctx.fillRect(28, H - 52, 580, 36);
      ctx.fillStyle = hud.warning ? "#ff8a7a" : "#ffd796";
      ctx.font = "600 20px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(hud.warning || hud.caption, 40, H - 27, 556);
    }
    texture.needsUpdate = true;
  }

  render(): void {
    this.composer.render();
  }
}
