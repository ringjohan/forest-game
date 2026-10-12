import * as THREE from "three";

/** Speed selector (km/s). The upper gears are arcade "superluminal" cruise speeds for crossing the solar system. */
export const GEARS: { speed: number; name: string }[] = [
  { speed: 0.1, name: "Manöver" },
  { speed: 1, name: "Dockning" },
  { speed: 10, name: "Omloppsfart" },
  { speed: 100, name: "Snabb" },
  { speed: 1_000, name: "Interplanetär" },
  { speed: 10_000, name: "Kryss" },
  { speed: 100_000, name: "Supercruise" },
  { speed: 299_792, name: "Ljusfart" },
  { speed: 3_000_000, name: "Hyperfart ×10" },
  { speed: 30_000_000, name: "Hyperfart ×100" },
  { speed: 300_000_000, name: "Hyperfart ×1000" },
];

/** Fraction of the remaining distance per second the craft may cover near a body; keeps arrival smooth and crash-free. */
export const LIMITER_RATE = 0.9;
/** Below this clearance (km) the closing speed is held asymptotic, so the craft can never touch a surface. */
export const LIMITER_FLOOR = 0.35;

export type SphereBody = { position: THREE.Vector3; radius: number };

/**
 * Gravity-well cap (per second, in multiples of the clearance to the nearest body), as in supercruise:
 * near a planet the craft is held to a few hundred thousand km/s, between planets the top gears open up,
 * so it can never jump past a planet in a single frame.
 */
export const GRAVITY_RATE = 2.2;

export function gravityLimit(clearance: number): number {
  return Math.max(LIMITER_FLOOR * 4, Math.max(0, clearance) * GRAVITY_RATE);
}

/** Allowed speed (km/s) at a given clearance above the nearest surface. */
export function speedLimit(clearance: number): number {
  return Math.max(0, clearance) * LIMITER_RATE;
}

/** First body (other than `except`) whose hazard sphere blocks the straight line a→b. */
export function blockingBody<T extends SphereBody & { id: string }>(a: THREE.Vector3, b: THREE.Vector3, bodies: Iterable<T>,
  hazard: (body: T) => number, except?: string): T | null {
  for (const body of bodies) {
    if (body.id === except) continue;
    if (segmentSphere(a, b, body.position, hazard(body) * 1.05) !== null) return body;
  }
  return null;
}

/** First parameter t ∈ [0, 1] where segment a→b enters the sphere, or null if it misses (or starts inside). */
export function segmentSphere(a: THREE.Vector3, b: THREE.Vector3, center: THREE.Vector3, radius: number): number | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - center.x, fy = a.y - center.y, fz = a.z - center.z;
  const aa = dx * dx + dy * dy + dz * dz;
  const c = fx * fx + fy * fy + fz * fz - radius * radius;
  if (c <= 0) return 0;
  if (aa === 0) return null;
  const bb = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = bb * bb - 4 * aa * c;
  if (disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}

export function bezier(p: THREE.Vector3[], t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const u = 1 - t;
  return out.set(0, 0, 0)
    .addScaledVector(p[0], u * u * u).addScaledVector(p[1], 3 * u * u * t)
    .addScaledVector(p[2], 3 * u * t * t).addScaledVector(p[3], t * t * t);
}

export function bezierTangent(p: THREE.Vector3[], t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const u = 1 - t;
  return out.set(0, 0, 0)
    .addScaledVector(p[1].clone().sub(p[0]), 3 * u * u)
    .addScaledVector(p[2].clone().sub(p[1]), 6 * u * t)
    .addScaledVector(p[3].clone().sub(p[2]), 3 * t * t)
    .normalize();
}

/** Smallest clearance (km above the surface, scaled by `margin`) of a Bézier path from all bodies. */
export function pathClearance(points: THREE.Vector3[], bodies: SphereBody[], margin = 1.02, samples = 400): number {
  let worst = Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    bezier(points, i / samples, p);
    for (const body of bodies) worst = Math.min(worst, p.distanceTo(body.position) - body.radius * margin);
  }
  return worst;
}

/**
 * Hyper-jump route between two orbits. It climbs radially away from the departure body,
 * crosses open space and descends radially onto the arrival orbit, never passing through a body.
 */
export function jumpPath(from: THREE.Vector3, departure: SphereBody | null, to: THREE.Vector3, arrival: SphereBody | null,
  bodies: SphereBody[]): THREE.Vector3[] {
  const length = from.distanceTo(to);
  const outward = (point: THREE.Vector3, body: SphereBody | null, fallback: THREE.Vector3): THREE.Vector3 =>
    body ? point.clone().sub(body.position).normalize() : fallback.clone();
  const across = to.clone().sub(from).normalize();
  const up = outward(from, departure, across);
  const down = outward(to, arrival, across.clone().negate());
  let best: THREE.Vector3[] = [from.clone(), from.clone(), to.clone(), to.clone()];
  let bestClearance = -Infinity;
  for (let attempt = 0; attempt < 10; attempt++) {
    const scale = 0.18 * 1.6 ** attempt;
    const lift = Math.max((departure?.radius ?? 0) * 3, length * scale);
    const drop = Math.max((arrival?.radius ?? 0) * 3, length * scale);
    const points = [from.clone(), from.clone().addScaledVector(up, lift), to.clone().addScaledVector(down, drop), to.clone()];
    const clearance = pathClearance(points, bodies);
    if (clearance > 0) return points;
    if (clearance > bestClearance) { bestClearance = clearance; best = points; }
  }
  return best;
}

/** Body whose gravity dominates at `point` (largest GM/d²), ignoring the Sun unless nothing else is close. */
export function dominantBody<T extends SphereBody & { gm: number; id: string }>(point: THREE.Vector3, bodies: Iterable<T>): T {
  let best: T | null = null;
  let bestPull = -Infinity;
  for (const body of bodies) {
    const pull = body.gm / Math.max(1, point.distanceToSquared(body.position));
    if (pull > bestPull) { bestPull = pull; best = body; }
  }
  if (!best) throw new Error("Solsystemet saknar himlakroppar.");
  return best;
}

/** Arrival time including the soft-braking approach (seconds until roughly 300 km above the surface). */
export function arrivalTime(clearance: number, closing: number): number {
  const stop = 300;
  if (clearance <= stop) return 1;
  const brakeFrom = closing / LIMITER_RATE;
  const cruise = clearance > brakeFrom ? (clearance - brakeFrom) / closing : 0;
  return cruise + Math.log(Math.min(clearance, brakeFrom) / stop) / LIMITER_RATE;
}

/**
 * Flight time (s) for a straight trip of `distance` km at `cruise` km/s that starts `startClearance` km above
 * the departure body, including the gravity-well cap on the way out and the soft braking on arrival.
 */
export function travelTime(startClearance: number, distance: number, cruise: number, speed = 0): number {
  const stop = 300;
  if (distance <= stop) return 0;
  let time = 0;
  let s = 0;
  let v = Math.max(speed, LIMITER_FLOOR);
  for (let i = 0; i < 2000 && s < distance - stop; i++) {
    const remaining = distance - s;
    const limit = Math.min(cruise, gravityLimit(Math.min(startClearance + s, remaining)), speedLimit(remaining));
    // Speed ramps up at the same rate as the flight model (≈1.4 × target per second).
    const dt = Math.max(1e-3, Math.min(0.25, remaining / Math.max(v, 1e-3) * 0.05));
    v = Math.min(limit, v + Math.max(0.04, cruise * 1.4) * dt);
    s += v * dt;
    time += dt;
  }
  return time;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds > 359_999) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
}

export function formatSpeed(kms: number): string {
  const a = Math.abs(kms);
  if (a >= 299_792 * 0.5) return `${(kms / 299_792).toLocaleString("sv-SE", { maximumFractionDigits: a > 299_792 * 20 ? 0 : 1 })} c`;
  if (a >= 10) return `${Math.round(kms).toLocaleString("sv-SE")} km/s`;
  if (a >= 1) return `${kms.toLocaleString("sv-SE", { maximumFractionDigits: 2 })} km/s`;
  return `${Math.round(kms * 1000).toLocaleString("sv-SE")} m/s`;
}
