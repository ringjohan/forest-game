import * as THREE from "three";
import { segmentSphereHit } from "./combat";

const wood = new THREE.MeshStandardMaterial({ color: 0x936036, roughness: 0.8 });
const gold = new THREE.MeshStandardMaterial({ color: 0xe0b65f, metalness: 0.55, roughness: 0.3 });
const string = new THREE.LineBasicMaterial({ color: 0xf5e6bd });

export function makeBow(): THREE.Group {
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.7, 0), new THREE.Vector3(0, -0.4, 0.28),
    new THREE.Vector3(0, 0, 0.38), new THREE.Vector3(0, 0.4, 0.28),
    new THREE.Vector3(0, 0.7, 0),
  ]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.035, 6, false), wood));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -0.7, 0), new THREE.Vector3(0, 0.7, 0),
  ]), string));
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.23, 8), gold);
  grip.position.z = 0.38;
  group.add(grip);
  return group;
}

export function makeFishingRod(): THREE.Group {
  const group = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.035, 2.2, 6), wood);
  rod.position.y = 0.8;
  group.add(rod);
  const reel = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12), gold);
  reel.position.set(0.06, -0.05, 0);
  group.add(reel);
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 1.9, 0), new THREE.Vector3(0, 0.2, 0.4),
  ]), string));
  return group;
}

export interface ArrowTarget {
  center: THREE.Vector3;
  radius: number;
  hit: () => void;
}

type Arrow = { group: THREE.Group; direction: THREE.Vector3; age: number };
export const ARROW_SPEED = 48;
export const ARROW_COOLDOWN = 0.38;

export class Archery {
  private readonly arrows: Arrow[] = [];
  private cooldown = 0;
  private readonly shaft = new THREE.CylinderGeometry(0.018, 0.018, 1.15, 5);
  private readonly tip = new THREE.ConeGeometry(0.06, 0.2, 4);
  private readonly feather = new THREE.BoxGeometry(0.17, 0.22, 0.025);
  private readonly trail = new THREE.MeshBasicMaterial({ color: 0xbaffef, transparent: true, opacity: 0.65 });

  constructor(private readonly scene: THREE.Scene) {}

  get count(): number { return this.arrows.length; }

  shoot(origin: THREE.Vector3, direction: THREE.Vector3): boolean {
    if (this.cooldown > 0) return false;
    if (!Number.isFinite(origin.lengthSq()) || !Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 0.001) {
      throw new Error("Pilen saknar en giltig position eller riktning.");
    }
    this.cooldown = ARROW_COOLDOWN;
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(this.shaft, wood);
    shaft.position.y = -0.575;
    group.add(shaft);
    const tip = new THREE.Mesh(this.tip, gold);
    tip.position.y = -0.1;
    group.add(tip);
    const feather = new THREE.Mesh(this.feather, this.trail);
    feather.position.y = -1;
    group.add(feather);
    const glow = new THREE.Mesh(this.shaft, this.trail);
    glow.scale.set(1.8, 2.2, 1.8);
    glow.position.y = -2.1;
    group.add(glow);
    group.position.copy(origin);
    const heading = direction.clone().normalize();
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), heading);
    this.scene.add(group);
    this.arrows.push({ group, direction: heading, age: 0 });
    return true;
  }

  update(dt: number, targets: () => ArrowTarget[], blocked: (point: THREE.Vector3) => boolean): number {
    this.cooldown = Math.max(0, this.cooldown - dt);
    let hits = 0;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i];
      arrow.age += dt;
      const start = arrow.group.position.clone();
      const end = start.clone().addScaledVector(arrow.direction, ARROW_SPEED * dt);
      let nearest = 1;
      let target: ArrowTarget | undefined;
      for (const candidate of targets()) {
        const t = segmentSphereHit(start, end, candidate.center, candidate.radius);
        if (t !== null && t <= nearest) { nearest = t; target = candidate; }
      }
      // Substeps stop fast arrows at walls/terrain before applying any enemy hit.
      const steps = Math.max(1, Math.ceil(start.distanceTo(end) / 0.15));
      let stopped = false;
      for (let step = 0; step <= steps; step++) {
        const t = Math.min(step / steps, nearest);
        arrow.group.position.lerpVectors(start, end, t);
        if (blocked(arrow.group.position)) { stopped = true; break; }
        if (t === nearest) break;
      }
      if (!stopped && target) { target.hit(); hits++; stopped = true; }
      if (stopped || arrow.age >= 5) {
        this.scene.remove(arrow.group);
        this.arrows.splice(i, 1);
      } else arrow.group.position.copy(end);
    }
    return hits;
  }

  clear(): void {
    for (const arrow of this.arrows) this.scene.remove(arrow.group);
    this.arrows.length = 0;
    this.cooldown = 0;
  }
}
