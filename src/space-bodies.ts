import * as THREE from "three";
import type { SpaceAssets } from "./space-assets";
import { atmosphereMaterial, cloudMaterial, earthMaterial, planetMaterial, radialGlowTexture, ringMaterial } from "./space-shaders";
import type { AtmosphereOptions } from "./space-shaders";

/** Kilometres per astronomical unit. All space positions are heliocentric kilometres (float64 on the CPU). */
export const AU = 149_597_870;

export type BodyId = "sun" | "mercury" | "venus" | "earth" | "moon" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune";

export type Body = {
  id: BodyId;
  name: string;
  radius: number;
  /** Standard gravitational parameter, km³/s². */
  gm: number;
  position: THREE.Vector3;
  root: THREE.Group;
  tilt: THREE.Group;
  spin: THREE.Group;
  /** Rotation rate, rad/s. */
  spinRate: number;
  surface?: THREE.ShaderMaterial;
  clouds?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  atmosphere?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  rings?: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  /** Surface contact (rocky) or crushing depth (gas giants) in km above the nominal radius. */
  crashAltitude: number;
  color: number;
};

/** Converts geographic longitude/latitude (degrees) to a unit vector in THREE.SphereGeometry's UV frame. */
export function lonLat(lon: number, lat: number): THREE.Vector3 {
  const phi = (lon + 180) / 360 * Math.PI * 2;
  const theta = (90 - lat) * Math.PI / 180;
  return new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}

function basis(a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 {
  const x = a.clone().normalize();
  const y = b.clone().sub(x.clone().multiplyScalar(b.dot(x))).normalize();
  return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y));
}

/** Orientation that puts the local subsolar point under the Sun and keeps the north pole tilted up. */
export function earthOrientation(sunDirection: THREE.Vector3, subsolarLon: number, subsolarLat: number): THREE.Quaternion {
  const local = basis(lonLat(subsolarLon, subsolarLat), new THREE.Vector3(0, 1, 0));
  const tiltFromSun = Math.PI / 2 - THREE.MathUtils.degToRad(subsolarLat);
  const up = new THREE.Vector3(0, 1, 0).sub(sunDirection.clone().multiplyScalar(sunDirection.y)).normalize();
  const north = sunDirection.clone().multiplyScalar(Math.cos(tiltFromSun)).add(up.multiplyScalar(Math.sin(tiltFromSun)));
  const world = basis(sunDirection, north);
  return new THREE.Quaternion().setFromRotationMatrix(world.multiply(local.transpose()));
}

const EARTH_POSITION = new THREE.Vector3(0, 0, AU);
const SUN_FROM_EARTH = EARTH_POSITION.clone().negate().normalize();
export const EARTH_TILT = earthOrientation(SUN_FROM_EARTH, -45, 15);

function ecliptic(distanceAu: number, angle: number, inclination = 0): THREE.Vector3 {
  const d = distanceAu * AU;
  return new THREE.Vector3(Math.sin(angle) * d, Math.sin(inclination) * d, Math.cos(angle) * d);
}

export type BodyData = { id: BodyId; name: string; radius: number; gm: number; position: THREE.Vector3; spinRate: number; crashAltitude: number; color: number };

// The Moon sits ahead of the starting orbit so it rises over the horizon early in the flight.
const MOON_DIRECTION = new THREE.Vector3(0.62, 0.42, 0.66).applyQuaternion(EARTH_TILT).normalize();

/** Physical layout (km, heliocentric, static) shared by rendering, navigation and tests. */
export const BODY_DATA: Record<BodyId, BodyData> = {
  sun: { id: "sun", name: "Solen", radius: 696_340, gm: 1.32712e11, position: new THREE.Vector3(), spinRate: 2.9e-6, crashAltitude: 2_000_000, color: 0xfff2d0 },
  earth: { id: "earth", name: "Jorden", radius: 6371, gm: 398_600, position: EARTH_POSITION.clone(), spinRate: 7.292e-5, crashAltitude: 0, color: 0x6ea7ff },
  moon: { id: "moon", name: "Månen", radius: 1737.4, gm: 4904.9, position: EARTH_POSITION.clone().addScaledVector(MOON_DIRECTION, 384_400), spinRate: 2.66e-6, crashAltitude: 1.5, color: 0xd9d6cf },
  mercury: { id: "mercury", name: "Merkurius", radius: 2439.7, gm: 22_032, position: ecliptic(0.387, 0.9, 0.05), spinRate: 1.24e-6, crashAltitude: 1.5, color: 0xb8aea2 },
  venus: { id: "venus", name: "Venus", radius: 6051.8, gm: 324_859, position: ecliptic(0.723, -0.5, 0.03), spinRate: -2.99e-7, crashAltitude: 60, color: 0xf2d7a4 },
  mars: { id: "mars", name: "Mars", radius: 3389.5, gm: 42_828, position: ecliptic(1.524, 0.35, 0.02), spinRate: 7.088e-5, crashAltitude: 1.5, color: 0xd07a4a },
  jupiter: { id: "jupiter", name: "Jupiter", radius: 69_911, gm: 1.26687e8, position: ecliptic(5.2, -0.25, 0.02), spinRate: 1.76e-4, crashAltitude: 500, color: 0xd8b48c },
  saturn: { id: "saturn", name: "Saturnus", radius: 58_232, gm: 3.7931e7, position: ecliptic(9.54, 0.6, 0.04), spinRate: 1.64e-4, crashAltitude: 500, color: 0xe8d3a2 },
  uranus: { id: "uranus", name: "Uranus", radius: 25_362, gm: 5.794e6, position: ecliptic(19.2, -1.1, 0.01), spinRate: -1.01e-4, crashAltitude: 500, color: 0xa9e3ee },
  neptune: { id: "neptune", name: "Neptunus", radius: 24_622, gm: 6.8365e6, position: ecliptic(30.1, 1.6, 0.03), spinRate: 1.08e-4, crashAltitude: 500, color: 0x5577ff },
};

/** Height (km) of the "surface" used for crashes and the navigation speed limiter; Earth's includes the atmosphere. */
export function hazardRadius(body: Pick<BodyData, "id" | "radius" | "crashAltitude">): number {
  return body.radius + (body.id === "earth" ? 100 : body.crashAltitude);
}

/** Fresh copy of a body's layout. */
export function data(id: BodyId): BodyData {
  const body = BODY_DATA[id];
  return { ...body, position: body.position.clone() };
}

/** Builds the Sun, eight planets and the Moon with physically based materials and real radii. */
export class SolarSystem {
  readonly group = new THREE.Group();
  readonly bodies = new Map<BodyId, Body>();
  readonly sunGlow: THREE.Sprite;
  readonly belt: THREE.Points;
  private readonly tmp = new THREE.Vector3();

  constructor(assets: SpaceAssets) {
    this.group.name = "Solsystemet";
    const sphere = new THREE.SphereGeometry(1, 256, 128);
    const lowSphere = new THREE.SphereGeometry(1, 128, 64);
    const shell = new THREE.SphereGeometry(1, 192, 96);

    const sunMaterial = new THREE.MeshBasicMaterial({ map: assets.sun, color: new THREE.Color(22, 17, 11) });
    const sun = this.add(data("sun"), lowSphere, sunMaterial);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlowTexture([[0, "rgba(255,248,232,1)"], [0.09, "rgba(255,240,215,0.75)"], [0.16, "rgba(255,215,170,0.16)"],
        [0.4, "rgba(255,170,110,0.03)"], [1, "rgba(0,0,0,0)"]], 512),
      color: new THREE.Color(2.4, 2.1, 1.75), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.sunGlow.scale.setScalar(sun.radius * 11);
    sun.root.add(this.sunGlow);

    const earth = this.add(data("earth"), sphere,
      earthMaterial({ day: assets.earthDay, night: assets.earthNight, clouds: assets.earthClouds, normal: assets.earthNormal, spec: assets.earthSpecular }),
      EARTH_TILT);
    earth.clouds = new THREE.Mesh(sphere, cloudMaterial(assets.earthClouds));
    earth.clouds.scale.setScalar(1 + 11 / 6371);
    earth.clouds.renderOrder = 1;
    earth.spin.add(earth.clouds);
    this.atmosphere(earth, shell, {
      radius: 1 + 110 / 6371, betaR: [35.0, 82.8, 142.7].map(v => v * 1.15) as [number, number, number],
      betaM: 21, hr: 8.5 / 6371, hm: 1.2 / 6371, g: 0.76, intensity: 7,
    });

    this.add(data("moon"), sphere,
      planetMaterial({ map: assets.moon, bump: 0.55, lunar: 1, detail: 0.5, detailScale: 260, albedo: 0.78 }));
    this.add(data("mercury"), lowSphere, planetMaterial({ map: assets.mercury, bump: 0.55, lunar: 1, detail: 0.5, detailScale: 360, albedo: 0.85 }));
    const venus = this.add(data("venus"), lowSphere,
      planetMaterial({ map: assets.venus, rim: 0xffe6b0, rimStrength: 0.35, contrast: 2.6, albedo: 0.92 }));
    this.atmosphere(venus, shell, { radius: 1.025, betaR: [9, 8.2, 6.5], betaM: 18, mieColor: 0xffe3b0, hr: 0.0028, hm: 0.002, g: 0.7, intensity: 5 });
    const mars = this.add(data("mars"), sphere,
      planetMaterial({ map: assets.mars, bump: 0.5, lunar: 0.25, detail: 0.45, detailScale: 480 }), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.44, 0, 0.1)));
    this.atmosphere(mars, shell, { radius: 1.02, betaR: [2.4, 2.9, 4.1], betaM: 2.2, mieColor: 0xd9a36e, hr: 0.0033, hm: 0.0025, g: 0.65, intensity: 7 });
    const gasRim = (color: number, strength: number): { rim: number; rimStrength: number } => ({ rim: color, rimStrength: strength });
    this.add(data("jupiter"), lowSphere,
      planetMaterial({ map: assets.jupiter, ...gasRim(0x9fb8ff, 0.18) }), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0, 0)));
    const saturnTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.47, 0.3, 0.1));
    const saturn = this.add(data("saturn"), lowSphere,
      planetMaterial({ map: assets.saturn, ...gasRim(0xbfd0ff, 0.12), rings: { map: assets.saturnRing, inner: 74_500 / 58_232, outer: 140_220 / 58_232 } }),
      saturnTilt);
    const ringGeometry = new THREE.RingGeometry(74_500 / 58_232, 140_220 / 58_232, 512, 1);
    saturn.rings = new THREE.Mesh(ringGeometry, ringMaterial(assets.saturnRing, 74_500 / 58_232, 140_220 / 58_232));
    saturn.rings.rotation.x = -Math.PI / 2;
    saturn.rings.renderOrder = 2;
    saturn.tilt.add(saturn.rings);
    this.add(data("uranus"), lowSphere,
      planetMaterial({ map: assets.uranus, ...gasRim(0xc8f4ff, 0.35) }), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.71)));
    this.add(data("neptune"), lowSphere,
      planetMaterial({ map: assets.neptune, ...gasRim(0x8fb0ff, 0.35) }), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.49, 0, 0)));

    this.belt = this.makeBelt();
    this.group.add(this.belt);
  }

  private add(spec: Omit<Body, "root" | "tilt" | "spin">, geometry: THREE.SphereGeometry, material: THREE.Material,
    tilt = new THREE.Quaternion()): Body {
    const root = new THREE.Group();
    root.name = spec.name;
    const tiltGroup = new THREE.Group();
    tiltGroup.quaternion.copy(tilt);
    const spin = new THREE.Group();
    const surface = new THREE.Mesh(geometry, material);
    surface.scale.setScalar(1);
    spin.add(surface);
    tiltGroup.add(spin);
    tiltGroup.scale.setScalar(spec.radius);
    root.add(tiltGroup);
    this.group.add(root);
    const body: Body = { ...spec, root, tilt: tiltGroup, spin, surface: material instanceof THREE.ShaderMaterial ? material : undefined };
    this.bodies.set(spec.id, body);
    return body;
  }

  private atmosphere(body: Body, geometry: THREE.SphereGeometry, options: AtmosphereOptions): void {
    const mesh = new THREE.Mesh(geometry, atmosphereMaterial(options));
    mesh.scale.setScalar(body.radius * options.radius);
    mesh.renderOrder = 3;
    mesh.name = `${body.name} · atmosfär`;
    body.root.add(mesh);
    body.atmosphere = mesh;
  }

  private makeBelt(): THREE.Points {
    const count = 26_000;
    const positions = new Float32Array(count * 3);
    let seed = 99;
    const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < count; i++) {
      const r = (2.15 + random() * 1.15 + (random() - 0.5) * 0.2) * AU;
      const a = random() * Math.PI * 2;
      positions.set([Math.sin(a) * r, (random() - 0.5) * 0.18 * AU * random(), Math.cos(a) * r], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: new THREE.Color(0.55, 0.5, 0.45), size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.3, depthWrite: false,
    }));
    points.frustumCulled = false;
    points.name = "Asteroidbältet";
    return points;
  }

  get(id: BodyId): Body {
    const body = this.bodies.get(id);
    if (!body) throw new Error(`Okänd himlakropp: ${id}`);
    return body;
  }

  /**
   * Places every body relative to the floating origin, spins them, and refreshes lighting uniforms.
   * `camera` is the camera position relative to the same origin.
   */
  update(origin: THREE.Vector3, camera: THREE.Vector3, simTime: number, sunIntensity: number): void {
    for (const body of this.bodies.values()) {
      body.root.position.copy(body.position).sub(origin);
      body.spin.rotation.y = body.spinRate * simTime;
      const sunDir = this.tmp.copy(body.position).negate().normalize();
      const u = body.surface?.uniforms;
      if (u) {
        u.sunDir.value.copy(sunDir);
        u.sunIntensity.value = sunIntensity;
        if (u.center) u.center.value.copy(body.root.position);
        if (u.radius) u.radius.value = body.radius;
        if (u.cloudOffset) u.cloudOffset.value = (simTime * 2.2e-6) % 1;
      }
      if (body.clouds) {
        const c = body.clouds.material.uniforms;
        c.sunDir.value.copy(sunDir);
        c.sunIntensity.value = sunIntensity;
        c.cloudOffset.value = u?.cloudOffset.value ?? 0;
      }
      if (body.rings) {
        const r = body.rings.material.uniforms;
        const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(body.tilt.quaternion);
        r.sunDir.value.copy(sunDir);
        r.sunIntensity.value = sunIntensity;
        r.center.value.copy(body.root.position);
        r.radius.value = body.radius;
        r.ringNormal.value.copy(normal);
        if (u?.ringNormal) u.ringNormal.value.copy(normal);
      }
      if (body.atmosphere) {
        const a = body.atmosphere.material.uniforms;
        a.uSunDir.value.copy(sunDir);
        // Camera in planet radii relative to the planet centre, computed in float64 for precision.
        a.uCamLocal.value.copy(camera).sub(body.root.position).divideScalar(body.radius);
        const inside = a.uCamLocal.value.length() < a.uAtmoRadius.value;
        const side = inside ? THREE.BackSide : THREE.FrontSide;
        if (body.atmosphere.material.side !== side) {
          body.atmosphere.material.side = side;
          body.atmosphere.material.needsUpdate = true;
        }
      }
    }
    this.belt.position.copy(origin).negate();
  }

  /** Altitude (km) of a heliocentric point above a body. */
  altitude(body: Body, point: THREE.Vector3): number {
    return point.distanceTo(body.position) - body.radius;
  }
}
