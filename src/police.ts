import * as THREE from "three";
import { CITY_STREETS } from "./city";
import type { City, Vehicle } from "./city";
import { circleIntersectsFootprint, footprintsIntersect } from "./collision";
import type { Footprint } from "./collision";

export const SPEED_LIMIT_KMH = 70;
export const JAIL_SECONDS = 60;
export const ESCAPE_SECONDS = 20;

type Axis = "x" | "z";
type Subject = { position: THREE.Vector3; vehicle: Vehicle | null; available: boolean };
type RoadPoint = { position: THREE.Vector3; axis: Axis; street: number };
type Patrol = {
  vehicle: Vehicle;
  lamps: THREE.Mesh[];
  route: THREE.Vector3[];
  replan: number;
  stuck: number;
  closed: Map<string, number>;
};

const ROAD_HALF_WIDTH = 8;
const STOP_LINE = 8;
const SAFE_DISTANCE = 180;
const MAX_SPEED = 55;

export class TrafficPolice {
  wanted = false;
  reason = "";
  escapeRemaining = ESCAPE_SECONDS;
  private contactPending = false;
  private readonly patrols: Patrol[] = [];
  private readonly offenses = new Set<string>();
  private readonly nodes = CITY_STREETS.flatMap(x => CITY_STREETS.map(z => new THREE.Vector3(x, 0, z)));
  private speeding = 0;
  private sampledVehicle: Vehicle | null = null;
  private previousPosition = new THREE.Vector3(Infinity, 0, Infinity);
  private previousHeading = 0;
  private time = 0;

  constructor(private readonly city: City) {
    const geometry = new THREE.BoxGeometry(0.3, 0.18, 0.35);
    for (const [x, z] of [[-330, 270], [-210, 270], [90, -270]]) {
      const candidates = [0, 14, -14, 28, -28].map(offset => new THREE.Vector3(x, 0, z + offset));
      const spawn = candidates.find(p => !city.blocked(p.x, p.z, 3.5) && !city.vehicleBlocked(p.x, p.z, 4));
      if (!spawn) throw new Error("Ingen fri plats för polispatrullen på gatan.");
      const vehicle = city.createPatrol(spawn.x, spawn.z, 0);
      if (city.vehiclePoseBlocked(vehicle, spawn.x, spawn.z, 0)) {
        throw new Error("Polispatrullens startplats är blockerad.");
      }
      const lamps = [-0.5, 0.5].map(offset => {
        const lamp = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x159fff }));
        lamp.position.set(offset, 2.35, 0);
        lamp.visible = false;
        vehicle.group.add(lamp);
        return lamp;
      });
      this.patrols.push({ vehicle, lamps, route: [], replan: 0, stuck: 0, closed: new Map() });
    }
  }

  /** Call once after each driving step, with the pre-step city-local position. */
  observeDriving(from: THREE.Vector3, vehicle: Vehicle, dt: number): string | null {
    if (!Number.isFinite(dt) || dt <= 0) return null;
    const heading = vehicle.group.rotation.y;
    const continuous = this.sampledVehicle === vehicle && this.previousPosition.distanceToSquared(from) < 0.01;
    const oldHeading = continuous ? this.previousHeading : heading;
    if (!continuous) this.speeding = 0;
    this.sampledVehicle = vehicle;
    this.previousHeading = heading;
    this.previousPosition.copy(vehicle.group.position);
    this.speeding = Math.abs(vehicle.speed) * 3.6 > SPEED_LIMIT_KMH + 0.01 ? this.speeding + dt : 0;

    const reports: string[] = [];
    if (this.crossedRed(from, oldHeading, vehicle)) reports.push("Rödljuskörning");
    if (this.speeding + 1e-8 >= 0.5) reports.push(`Fortkörning · gräns ${SPEED_LIMIT_KMH} km/h`);
    const fresh = reports.filter(report => !this.offenses.has(report));
    if (!fresh.length) return null;
    for (const report of fresh) this.offenses.add(report);
    this.wanted = true;
    this.reason = [...this.offenses].join(" + ");
    return fresh.join(" + ");
  }

  update(dt: number, subject: Subject): "arrest" | "escaped" | null {
    if (!Number.isFinite(dt) || dt <= 0) return null;
    if (subject.vehicle !== this.sampledVehicle || !subject.available) {
      this.speeding = 0;
      this.sampledVehicle = null;
    }
    if (!this.wanted) return null;
    // Keep turning, obstacle checks, and continuous timers independent of frame rate.
    let remaining = dt;
    while (remaining > 1e-8) {
      const step = Math.min(remaining, 1 / 30);
      remaining -= step;
      this.time += step;
      let near = false;
      for (const patrol of this.patrols) {
        if (patrol.vehicle === subject.vehicle || patrol.vehicle === this.city.activeVehicle) {
          for (const lamp of patrol.lamps) lamp.visible = false;
          continue;
        }
        this.pursue(patrol, subject, step);
        patrol.lamps.forEach((lamp, index) => { lamp.visible = (Math.floor(this.time * 8) + index) % 2 === 0; });
        const distance = patrol.vehicle.group.position.distanceTo(subject.position);
        near ||= distance <= SAFE_DISTANCE;
        if (subject.available && (this.contactPending || this.canCapture(patrol.vehicle, subject))) {
          this.clear();
          return "arrest";
        }
      }
      this.escapeRemaining = near ? ESCAPE_SECONDS : Math.max(0, this.escapeRemaining - step);
      if (this.escapeRemaining <= 1e-8) {
        this.clear();
        return "escaped";
      }
    }
    return null;
  }

  clear(): void {
    this.wanted = false;
    this.reason = "";
    this.escapeRemaining = ESCAPE_SECONDS;
    this.contactPending = false;
    this.speeding = 0;
    this.sampledVehicle = null;
    this.offenses.clear();
    for (const patrol of this.patrols) {
      patrol.vehicle.speed = 0;
      patrol.route = [];
      patrol.replan = patrol.stuck = 0;
      patrol.closed.clear();
      for (const lamp of patrol.lamps) lamp.visible = false;
    }
  }

  private center(position: THREE.Vector3, vehicle: Vehicle, heading = vehicle.group.rotation.y): THREE.Vector3 {
    return new THREE.Vector3(
      position.x + vehicle.centerX * Math.cos(heading) + vehicle.centerZ * Math.sin(heading),
      position.y,
      position.z - vehicle.centerX * Math.sin(heading) + vehicle.centerZ * Math.cos(heading),
    );
  }

  private extent(vehicle: Vehicle, heading: number, axis: Axis): number {
    return axis === "x"
      ? Math.abs(Math.cos(heading)) * vehicle.halfWidth + Math.abs(Math.sin(heading)) * vehicle.halfLength
      : Math.abs(Math.sin(heading)) * vehicle.halfWidth + Math.abs(Math.cos(heading)) * vehicle.halfLength;
  }

  private crossedRed(from: THREE.Vector3, oldHeading: number, vehicle: Vehicle): boolean {
    const to = vehicle.group.position;
    const dx = to.x - from.x, dz = to.z - from.z;
    if (Math.hypot(dx, dz) < 0.001 || Math.abs(to.y) > 3) return false;
    const axis: Axis = Math.abs(dx) > Math.abs(dz) ? "x" : "z";
    const across: Axis = axis === "x" ? "z" : "x";
    if (this.city.signal(axis) !== "red") return false;
    const direction = Math.sign(to[axis] - from[axis]);
    const start = this.center(from, vehicle, oldHeading);
    const end = this.center(to, vehicle);
    const leadingStart = start[axis] + direction * this.extent(vehicle, oldHeading, axis);
    const leadingEnd = end[axis] + direction * this.extent(vehicle, vehicle.group.rotation.y, axis);
    for (const crossing of CITY_STREETS) {
      const line = crossing - direction * STOP_LINE;
      if ((leadingStart - line) * direction >= -1e-7 || (leadingEnd - line) * direction < 0) continue;
      const fraction = (line - leadingStart) / (leadingEnd - leadingStart);
      const lanePosition = THREE.MathUtils.lerp(start[across], end[across], fraction);
      if (CITY_STREETS.some(street => Math.abs(lanePosition - street) <= ROAD_HALF_WIDTH)) return true;
    }
    return false;
  }

  checkContact(subject: Subject, shape?: Footprint): boolean {
    if (!this.wanted) return false;
    const touching = this.patrols.some(patrol => patrol.vehicle !== subject.vehicle
      && this.canCapture(patrol.vehicle, subject, this.city.vehicleFootprint(patrol.vehicle), shape));
    this.contactPending ||= touching;
    return touching;
  }

  private canCapture(vehicle: Vehicle, subject: Subject, patrolShape = this.city.vehicleFootprint(vehicle), subjectShape?: Footprint): boolean {
    if (!subject.available || Math.abs(subject.position.y - vehicle.group.position.y) > 2.5) return false;
    const targetShape = subject.vehicle ? subjectShape ?? this.city.vehicleFootprint(subject.vehicle) : null;
    if (targetShape ? !footprintsIntersect(patrolShape, targetShape)
      : !circleIntersectsFootprint(subject.position.x, subject.position.z, 0.45, patrolShape)) return false;
    const from = new THREE.Vector3(patrolShape.x, 0, patrolShape.z);
    const to = targetShape ? new THREE.Vector3(targetShape.x, 0, targetShape.z) : subject.position;
    const distance = from.distanceTo(to);
    const samples = Math.max(1, Math.ceil(distance / 0.3));
    for (let i = 0; i <= samples; i++) {
      const fraction = i / samples;
      const x = THREE.MathUtils.lerp(from.x, to.x, fraction);
      const z = THREE.MathUtils.lerp(from.z, to.z, fraction);
      if (this.city.blocked(x, z, 0.3)) return false;
      if (this.city.vehicles.some(other => other !== vehicle && other !== subject.vehicle
        && circleIntersectsFootprint(x, z, 0.3, this.city.vehicleFootprint(other)))) return false;
    }
    return true;
  }

  private roadPoint(position: THREE.Vector3, lateral = 0): RoadPoint {
    const nearest = (value: number) => CITY_STREETS.reduce((best, street) =>
      Math.abs(street - value) < Math.abs(best - value) ? street : best, CITY_STREETS[0]);
    const x = nearest(position.x), z = nearest(position.z);
    const axis: Axis = Math.abs(x - position.x) < Math.abs(z - position.z) ? "z" : "x";
    const street = axis === "x" ? z : x;
    const p = position.clone();
    p.y = 0;
    p[axis] = THREE.MathUtils.clamp(p[axis], CITY_STREETS[0], CITY_STREETS[CITY_STREETS.length - 1]);
    const across = axis === "x" ? "z" : "x";
    p[across] = street + THREE.MathUtils.clamp(p[across] - street, -lateral, lateral);
    return { position: p, axis, street };
  }

  private pursue(patrol: Patrol, subject: Subject, dt: number): void {
    const vehicle = patrol.vehicle;
    if (this.canCapture(vehicle, subject)) {
      vehicle.speed = 0;
      patrol.stuck = 0;
      return;
    }
    patrol.replan -= dt;
    if (patrol.replan <= 0) {
      for (const [key, until] of patrol.closed) if (until <= this.time) patrol.closed.delete(key);
      patrol.route = this.route(vehicle.group.position, subject.position, patrol);
      patrol.replan = 1.25;
    }
    const position = vehicle.group.position;
    while (patrol.route.length && position.distanceTo(patrol.route[0]) < 0.12) patrol.route.shift();
    const next = patrol.route[0];
    if (!next) {
      vehicle.speed = 0;
      return;
    }
    const distance = position.distanceTo(next);
    const heading = Math.atan2(next.x - position.x, next.z - position.z);
    const turn = Math.atan2(Math.sin(heading - vehicle.group.rotation.y), Math.cos(heading - vehicle.group.rotation.y));
    // Turn at waypoints, not by cutting diagonally across building corners.
    const rotating = Math.abs(turn) > 0.025;
    const nextHeading = vehicle.group.rotation.y + THREE.MathUtils.clamp(turn, -2.8 * dt, 2.8 * dt);
    const speed = rotating ? 0 : Math.min(MAX_SPEED, vehicle.speed + 18 * dt, distance / dt, Math.sqrt(48 * distance));
    const moved = this.city.movePatrol(vehicle, dt, nextHeading, speed, shape => {
      const touching = this.canCapture(vehicle, subject, shape);
      this.contactPending ||= touching;
      return touching;
    });
    patrol.stuck = moved ? 0 : patrol.stuck + dt;
    if (patrol.stuck > 1.25) {
      const axis: Axis = Math.abs(next.x - position.x) > Math.abs(next.z - position.z) ? "x" : "z";
      const across = axis === "x" ? "z" : "x";
      const street = CITY_STREETS.reduce((best, value) =>
        Math.abs(value - position[across]) < Math.abs(best - position[across]) ? value : best, CITY_STREETS[0]);
      const start = position.clone();
      const end = next.clone();
      start[across] = end[across] = street;
      for (const key of this.edgeKeys(start, end)) patrol.closed.set(key, this.time + 12);
      patrol.replan = 0;
      patrol.stuck = 0;
    }
  }

  private edgeKeys(from: THREE.Vector3, to: THREE.Vector3): string[] {
    const axis: Axis = Math.abs(to.x - from.x) > Math.abs(to.z - from.z) ? "x" : "z";
    const direction = Math.sign(to[axis] - from[axis]);
    if (!direction) return [];
    const street = axis === "x" ? from.z : from.x;
    const low = Math.min(from[axis], to[axis]), high = Math.max(from[axis], to[axis]);
    const keys: string[] = [];
    for (let i = 0; i < CITY_STREETS.length - 1; i++) {
      if (low < CITY_STREETS[i + 1] - 0.01 && high > CITY_STREETS[i] + 0.01) {
        keys.push(`${axis}:${street}:${i}:${direction}`);
      }
    }
    return keys;
  }

  private route(from: THREE.Vector3, target: THREE.Vector3, patrol: Patrol): THREE.Vector3[] {
    const start = this.roadPoint(from), finish = this.roadPoint(target);
    const points = [...this.nodes, start.position, finish.position];
    const startId = this.nodes.length, finishId = startId + 1;
    const adjacency = points.map(() => [] as number[]);
    const connect = (a: number, b: number) => {
      adjacency[a].push(b);
      adjacency[b].push(a);
    };
    const size = CITY_STREETS.length;
    for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) {
      const id = x * size + z;
      if (x + 1 < size) connect(id, id + size);
      if (z + 1 < size) connect(id, id + 1);
    }
    const attach = (id: number, road: RoadPoint) => {
      const streetIndex = CITY_STREETS.indexOf(road.street);
      const coordinate = road.position[road.axis];
      let upper = CITY_STREETS.findIndex(street => street >= coordinate);
      if (upper < 0) upper = size - 1;
      for (const index of new Set([Math.max(0, upper - 1), upper])) {
        connect(id, road.axis === "x" ? index * size + streetIndex : streetIndex * size + index);
      }
    };
    attach(startId, start);
    attach(finishId, finish);
    if (start.axis === finish.axis && start.street === finish.street) connect(startId, finishId);
    const cost = points.map(() => Infinity);
    const previous = points.map(() => -1);
    const open = new Set([startId]);
    cost[startId] = 0;
    while (open.size) {
      let current = -1, best = Infinity;
      for (const id of open) {
        const score = cost[id] + points[id].distanceTo(finish.position);
        if (score < best) { current = id; best = score; }
      }
      if (current === finishId) break;
      open.delete(current);
      for (const next of adjacency[current]) {
        if (this.edgeKeys(points[current], points[next]).some(key => patrol.closed.has(key))) continue;
        const nextCost = cost[current] + points[current].distanceTo(points[next]);
        if (nextCost >= cost[next]) continue;
        cost[next] = nextCost;
        previous[next] = current;
        open.add(next);
      }
    }
    // A temporarily sealed street is a real obstruction: wait and retry, never teleport.
    if (!Number.isFinite(cost[finishId])) return [];
    const result: THREE.Vector3[] = [];
    for (let id = finishId; id !== startId; id = previous[id]) result.unshift(points[id].clone());
    if (from.distanceTo(start.position) > 0.1) result.unshift(start.position.clone());
    const curb = this.roadPoint(target, Math.max(0, ROAD_HALF_WIDTH - patrol.vehicle.radius - 0.5)).position;
    if (curb.distanceTo(finish.position) > 0.1) result.push(curb);
    if (target.distanceTo(result[result.length - 1] ?? from) > 0.1) {
      result.push(new THREE.Vector3(target.x, 0, target.z));
    }
    return result;
  }
}
