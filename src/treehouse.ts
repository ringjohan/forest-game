import * as THREE from "three";
import { makeBow, makeFishingRod } from "./archery";

export const TREEHOUSE = { x: 22, z: 68, clearing: 15 };
export type TreehouseAction = "ascend" | "descend" | "roof" | "cabin" | "chest";
type Level = "ground" | "deck" | "roof";
type Solid = { box: THREE.Box3 };

export class Treehouse {
  readonly group = new THREE.Group();
  readonly base: number;
  readonly floor: number;
  readonly roof: number;
  readonly entrance: THREE.Vector3;
  readonly chestPosition: THREE.Vector3;
  level: Level = "ground";
  opened = false;
  private readonly solids: Solid[] = [];
  private readonly lid = new THREE.Group();
  private readonly treasure = new THREE.Group();
  climbHeading = Math.PI;
  private climb: { points: THREE.Vector3[]; travelled: number; level: Level } | null = null;
  private lidAngle = 0;

  constructor(scene: THREE.Scene, heightAt: (x: number, z: number) => number) {
    this.base = heightAt(TREEHOUSE.x, TREEHOUSE.z);
    this.floor = this.base + 19;
    this.roof = this.floor + 3.4;
    this.group.position.set(TREEHOUSE.x, this.base, TREEHOUSE.z);
    scene.add(this.group);
    this.entrance = new THREE.Vector3(TREEHOUSE.x - 3, heightAt(TREEHOUSE.x - 3, TREEHOUSE.z + 1.5), TREEHOUSE.z + 1.5);
    this.chestPosition = new THREE.Vector3(TREEHOUSE.x + 1.5, this.floor, TREEHOUSE.z - 1.8);
    const boards = [0x9a693e, 0xb68450, 0xc79560, 0xa77848].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.93 }));
    const bark = new THREE.MeshStandardMaterial({ color: 0x61422c, roughness: 1 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd8b45a, metalness: 0.65, roughness: 0.3 });
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      const part = new THREE.Mesh(geometry, material);
      part.position.set(x, y, z);
      part.castShadow = part.receiveShadow = true;
      this.group.add(part);
      return part;
    };
    const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material, solid = true) => {
      const part = mesh(new THREE.BoxGeometry(sx, sy, sz), material, x, y, z);
      if (solid) this.solids.push({ box: new THREE.Box3(
        new THREE.Vector3(TREEHOUSE.x + x - sx / 2, this.base + y - sy / 2, TREEHOUSE.z + z - sz / 2),
        new THREE.Vector3(TREEHOUSE.x + x + sx / 2, this.base + y + sy / 2, TREEHOUSE.z + z + sz / 2),
      ) });
      return part;
    };
    mesh(new THREE.CylinderGeometry(0.6, 1.05, 24, 12), bark, -3, 12, 0);
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.4;
      const x = -5 - Math.abs(Math.sin(angle)) * 4;
      const z = -4 + Math.cos(angle) * 4;
      const end = new THREE.Vector3(x, 23 + i % 3, z);
      const start = new THREE.Vector3(-3, 14 + i * 0.6, 0);
      const branch = mesh(new THREE.CylinderGeometry(0.18, 0.4, start.distanceTo(end), 7), bark, 0, 0, 0);
      branch.position.addVectors(start, end).multiplyScalar(0.5);
      branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
      const leaves = mesh(new THREE.IcosahedronGeometry(2.7, 1),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x6b913e : 0x49773d, roughness: 1 }), x - 1.5, end.y + 1.3, z);
      leaves.scale.y = 0.7;
      for (let a = 0; a < 6; a++) {
        const apple = mesh(new THREE.SphereGeometry(0.19, 8, 6),
          new THREE.MeshStandardMaterial({ color: a % 2 ? 0xc53429 : 0xe85032, roughness: 0.5 }),
          x - 1.5 + Math.sin(a * 2.4) * 2.2, end.y + 0.2 + (a % 2) * 0.5, z + Math.cos(a * 2.4) * 2.2);
        apple.scale.y = 0.92;
      }
    }
    for (const y of [18.85, 22.25]) {
      for (let i = 0; i < 20; i++) {
        const x = -3.8 + i * 0.4;
        if (y === 18.85 && i < 5) {
          box(x, y, -1.7, 0.38, 0.3, 4.6, boards[i % 4]);
          box(x, y, 3, 0.38, 0.3, 2, boards[i % 4]);
        } else if (y === 22.25 && i >= 16) {
          box(x, y, -0.7, 0.38, 0.3, 6.6, boards[i % 4]);
        } else box(x, y, 0, 0.38, 0.3, 8, boards[i % 4]);
      }
      for (const z of [-3.6, 3.6]) {
        const hatch = y === 22.25 && z > 0;
        box(hatch ? -1 : 0, y - 0.4, z, hatch ? 6 : 8.4, 0.5, 0.25, boards[0]);
      }
    }
    // Low plank walls leave large shooting windows; the front has a full-height doorway.
    for (let row = 0; row < 4; row++) {
      const y = 19.18 + row * 0.27;
      box(-1.5, y, -0.25, 0.17, 0.25, 5.5, boards[row]);
      box(3.5, y, -0.25, 0.17, 0.25, 5.5, boards[row]);
      box(1, y, -3, 5, 0.25, 0.17, boards[row]);
      box(-0.7, y, 2.5, 1.6, 0.25, 0.17, boards[row]);
      box(2.7, y, 2.5, 1.6, 0.25, 0.17, boards[row]);
    }
    for (const x of [-1.5, 3.5]) for (const z of [-3, 2.5]) box(x, 20.6, z, 0.2, 3.2, 0.2, boards[0]);
    for (const z of [-3, 2.5]) box(1, 22, z, 5.2, 0.3, 0.2, boards[1]);
    for (const y of [19, 22.4]) {
      for (const side of [-1, 1]) {
        box(side * 3.95, y + 0.7, 0, 0.12, 0.14, 8, boards[2]);
        box(0, y + 0.7, side * 3.95, 8, 0.14, 0.12, boards[2]);
        for (const step of [-3.9, 0, 3.9]) {
          box(side * 3.95, y + 0.4, step, 0.14, 0.8, 0.14, boards[0]);
          box(step, y + 0.4, side * 3.95, 0.14, 0.8, 0.14, boards[0]);
        }
      }
    }
    const ladder = (x: number, z: number, bottom: number, top: number) => {
      for (const side of [-1, 1]) box(x + side * 0.48, (bottom + top) / 2, z, 0.15, top - bottom, 0.16, boards[0], false);
      for (let y = bottom + 0.2; y < top; y += 0.38) box(x, y, z + 0.06, 1.1, 0.16, 0.22, boards[2], false);
    };
    ladder(-3, 1.05, this.entrance.y - this.base, 20);
    ladder(3, 3.5, 19, 23.4);
    box(1.5, 19.37, -1.8, 1.5, 0.74, 0.9, boards[0]);
    for (const x of [0.95, 2.05]) box(x, 19.4, -1.8, 0.1, 0.79, 0.96, brass);
    this.lid.position.set(1.5, 19.75, -2.25);
    this.group.add(this.lid);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 1), boards[2]);
    lidMesh.position.z = 0.45;
    this.lid.add(lidMesh);
    box(1.5, 19.7, -1.31, 0.22, 0.3, 0.08, brass);
    this.treasure.position.set(1.5, 19.8, -1.8);
    const bow = makeBow();
    bow.rotation.z = Math.PI / 3;
    bow.scale.setScalar(0.7);
    const rod = makeFishingRod();
    rod.rotation.z = -0.7;
    rod.scale.setScalar(0.55);
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.05), brass);
    sword.rotation.z = 0.3;
    this.treasure.add(bow, rod, sword);
    this.treasure.visible = false;
    this.group.add(this.treasure);
    const light = new THREE.PointLight(0xffd484, 16, 9);
    light.position.set(1, 21.5, 0);
    this.group.add(light);
  }

  get climbing(): boolean { return this.climb !== null; }
  get elevated(): boolean { return this.level !== "ground"; }

  interaction(position: THREE.Vector3): TreehouseAction | null {
    if (this.climbing) return null;
    if (this.level === "ground") return position.distanceTo(this.entrance) < 2.1 ? "ascend" : null;
    const local = position.clone().sub(this.group.position);
    if (this.level === "roof") return Math.hypot(local.x - 3, local.z - 2.2) < 1.6 ? "cabin" : null;
    if (!this.opened && position.distanceTo(this.chestPosition) < 2) return "chest";
    if (Math.hypot(local.x + 3, local.z - 2) < 1.3) return "descend";
    return local.z > 2.9 && Math.hypot(local.x - 3, local.z - 3.3) < 1.3 ? "roof" : null;
  }

  interact(action: TreehouseAction, position: THREE.Vector3): boolean {
    if (this.interaction(position) !== action) return false;
    if (action === "chest") { this.opened = true; this.treasure.visible = true; return true; }
    const level: Level = action === "ascend" || action === "cabin" ? "deck" : action === "roof" ? "roof" : "ground";
    const to = action === "ascend" ? new THREE.Vector3(TREEHOUSE.x - 3, this.floor, TREEHOUSE.z + 2.45)
      : action === "descend" ? this.entrance.clone()
      : new THREE.Vector3(TREEHOUSE.x + 3, level === "roof" ? this.roof : this.floor, TREEHOUSE.z + (level === "roof" ? 2.1 : 3.3));
    const upperLadder = action === "roof" || action === "cabin";
    const bottom = upperLadder
      ? new THREE.Vector3(TREEHOUSE.x + 3, this.floor, TREEHOUSE.z + 3.3) : this.entrance.clone();
    const top = bottom.clone().setY((upperLadder ? this.roof : this.floor) + 0.2);
    const ascending = action === "ascend" || action === "roof";
    const points = ascending ? [position.clone(), bottom, top, to.clone().setY(top.y), to]
      : [position.clone(), position.clone().setY(top.y), top, bottom, to];
    this.climbHeading = upperLadder ? 0 : Math.PI;
    this.climb = { points, travelled: 0, level };
    return true;
  }

  update(dt: number, position: THREE.Vector3): void {
    this.lidAngle = THREE.MathUtils.damp(this.lidAngle, this.opened ? -1.8 : 0, 5, dt);
    this.lid.rotation.x = this.lidAngle;
    if (!this.climb) return;
    const climb = this.climb;
    climb.travelled += dt * 3;
    let remaining = climb.travelled;
    for (let i = 1; i < climb.points.length; i++) {
      const from = climb.points[i - 1];
      const to = climb.points[i];
      const length = from.distanceTo(to);
      if (remaining < length) {
        position.lerpVectors(from, to, remaining / length);
        return;
      }
      remaining -= length;
    }
    position.copy(climb.points[climb.points.length - 1]);
    this.level = climb.level;
    this.climb = null;
  }

  heightAt(): number { return this.level === "roof" ? this.roof : this.floor; }

  blocked(x: number, z: number, radius: number): boolean {
    if (Math.abs(x - TREEHOUSE.x) > 3.85 - radius || Math.abs(z - TREEHOUSE.z) > 3.85 - radius) return true;
    if (this.level === "roof" && x - TREEHOUSE.x + radius > 2.4 && z - TREEHOUSE.z + radius > 2.6) return true;
    if (this.level === "deck" && x - TREEHOUSE.x - radius < -2
      && z - TREEHOUSE.z + radius > 0.6 && z - TREEHOUSE.z - radius < 2) return true;
    const feet = this.heightAt();
    return this.solidAt(x, feet + 0.8, z, radius);
  }

  solidAt(x: number, y: number, z: number, radius = 0): boolean {
    if (y < this.base + 24 && y > this.base - radius
      && Math.hypot(x - (TREEHOUSE.x - 3), z - TREEHOUSE.z) < 0.9 + radius) return true;
    return this.solids.some(({ box }) => x + radius > box.min.x && x - radius < box.max.x
      && y + radius > box.min.y && y - radius < box.max.y && z + radius > box.min.z && z - radius < box.max.z);
  }
}
