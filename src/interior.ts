import * as THREE from 'three';
import type { House } from './world-types';

export type Footprint = { x: number; z: number; halfX: number; halfZ: number };

export function distanceToFootprint(x: number, z: number, item: Footprint): number {
  return Math.hypot(
    Math.max(Math.abs(x - item.x) - item.halfX, 0),
    Math.max(Math.abs(z - item.z) - item.halfZ, 0),
  );
}

/** One reusable, roofless room, isolated from outdoor terrain and hazards. */
export class Interior {
  readonly scene = new THREE.Scene();
  readonly spawn = new THREE.Vector3(0, 0, 4.4);
  readonly exit = new THREE.Vector3(0, 0, 5.8);
  private readonly bed: Footprint = { x: -5.2, z: -3.6, halfX: 1.55, halfZ: 2.25 };
  readonly sleepingPosition = new THREE.Vector3(this.bed.x, 1.53, this.bed.z + 0.35);
  readonly sleepingRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private readonly furniture: Footprint[] = [];
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly accent = this.material('#67846d');
  private readonly wood = this.material('#846044');
  private readonly darkWood = this.material('#503b2f');
  private readonly cream = this.material('#e8dfc8');
  private readonly metal = this.material('#343b3b', { metalness: 0.45 });

  constructor() {
    this.scene.name = 'Trygg stuginteriör';
    this.scene.background = new THREE.Color('#262f2b');
    this.makeRoom();
    this.makeFurniture();
    this.makeLighting();
  }

  enter(house: House): void {
    let hash = 0;
    for (const char of house.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const colors = ['#67846d', '#997252', '#667f95', '#947486', '#9a894f'];
    this.accent.color.set(colors[hash % colors.length]);
    this.scene.name = house.name;
    this.scene.userData.houseId = house.id;
  }

  blocked(x: number, z: number, radius = 0.45): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius)) return true;
    radius = Math.max(0, radius);
    if (Math.abs(x) + radius >= 7.8 || Math.abs(z) + radius >= 6.8) return true;
    return this.furniture.some(item => distanceToFootprint(x, z, item) <= radius);
  }

  nearBed(x: number, z: number): boolean {
    return distanceToFootprint(x, z, this.bed) < 1.2;
  }

  heightAt(_x: number, _z: number): number {
    return 0;
  }

  private material(color: string, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...options });
  }

  private box(
    x: number, y: number, z: number, width: number, height: number, depth: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private footprint(x: number, z: number, width: number, depth: number): void {
    this.furniture.push({ x, z, halfX: width / 2, halfZ: depth / 2 });
  }

  private makeRoom(): void {
    // Keep the foundation below the boards, not coplanar with their visible tops.
    this.box(0, -0.21, 0, 16, 0.32, 14, this.darkWood);
    const boards = ['#ad8961', '#b49168', '#a88059'].map(color => this.material(color));
    for (let row = 0; row < 28; row++) {
      this.box(0, -0.025, -6.75 + row * 0.5, 15.6, 0.05, 0.485, boards[row % boards.length]);
    }
    const plaster = this.material('#d5c5a9');
    const cutaway = this.material('#d5c5a9', { transparent: true, opacity: 0.18, depthWrite: false });
    for (const side of [-1, 1]) {
      this.box(side * 7.9, 0.42, 0, 0.2, 0.84, 14, plaster);
      this.box(side * 7.9, 2, 0, 0.2, 2.3, 14, cutaway).castShadow = false;
      this.box(side * 7.76, 0.12, 0, 0.08, 0.24, 13.6, this.darkWood);
    }
    this.box(0, 0.42, -6.9, 15.6, 0.84, 0.2, plaster);
    this.box(0, 2, -6.9, 15.6, 2.3, 0.2, cutaway).castShadow = false;
    this.box(0, 0.12, -6.76, 15.6, 0.24, 0.08, this.darkWood);
    for (const side of [-1, 1]) {
      this.box(side * 4.55, 0.42, 6.9, 6.7, 0.84, 0.2, plaster);
      this.box(side * 1.18, 1.35, 6.85, 0.16, 2.7, 0.18, this.darkWood);
    }
    this.box(0, 2.7, 6.85, 2.5, 0.18, 0.18, this.darkWood);
    const door = this.material('#856446', { transparent: true, opacity: 0.28, depthWrite: false });
    this.box(0, 1.3, 6.95, 2.2, 2.6, 0.12, door).castShadow = false;
    this.box(-0.82, 1.18, 6.83, 0.1, 0.16, 0.12, this.metal);
    this.box(0, 0.015, 5.8, 2.3, 0.03, 1.4, this.accent);
    const glass = this.material('#b8dcde', { emissive: '#87a9a6', emissiveIntensity: 0.4 });
    for (const x of [-4.8, 4]) {
      this.box(x, 2.05, -6.75, 2.35, 1.75, 0.12, this.darkWood);
      this.box(x, 2.05, -6.66, 2.1, 1.5, 0.05, glass);
      this.box(x, 2.05, -6.61, 0.08, 1.5, 0.06, this.cream);
      this.box(x, 2.05, -6.61, 2.1, 0.08, 0.06, this.cream);
      this.box(x, 1.16, -6.5, 2.55, 0.12, 0.4, this.wood);
      for (const side of [-1, 1]) {
        this.box(x + side * 1.28, 2.05, -6.55, 0.32, 1.85, 0.09, this.accent);
      }
    }
    this.box(0, 0.014, -0.3, 3.1, 0.028, 7, this.accent);
    for (const x of [-1.35, 1.35]) {
      this.box(x, 0.031, -0.3, 0.08, 0.008, 6.7, this.cream);
    }
  }

  private makeFurniture(): void {
    // Furnish the perimeter; the rug marks a generous, continuous walking aisle.
    this.furniture.push(this.bed);
    this.box(this.bed.x, 0.43, this.bed.z, this.bed.halfX * 2, 0.7, this.bed.halfZ * 2, this.darkWood);
    this.box(-5.2, 0.92, -3.6, 2.9, 0.38, 4.3, this.cream);
    this.box(-5.2, 1.13, -2.9, 2.95, 0.1, 2.85, this.accent);
    this.box(-5.2, 1.12, -5.13, 2.25, 0.22, 0.85, this.cream);
    this.box(-5.2, 1.12, -5.78, 3.12, 1.3, 0.18, this.wood);
    this.box(-5.2, 0.87, -1.38, 3.12, 0.9, 0.16, this.wood);

    this.footprint(-6, 3.25, 2.2, 1.4);
    this.box(-6, 1.35, 3.25, 2.2, 2.7, 1.4, this.darkWood);
    for (const x of [-6.52, -5.48]) {
      this.box(x, 1.4, 4, 1, 2.42, 0.1, this.wood);
      this.box(x + (x < -6 ? 0.35 : -0.35), 1.35, 4.08, 0.08, 0.23, 0.08, this.metal);
    }

    this.footprint(-1.9, -6.15, 2.3, 1);
    this.box(-1.9, 1.25, -6.58, 2.3, 2.5, 0.12, this.darkWood);
    for (const x of [-3.03, -0.77]) this.box(x, 1.25, -6.15, 0.14, 2.5, 1, this.wood);
    const bookColors = ['#778564', '#a26752', '#738896', '#bbab72'].map(c => this.material(c));
    for (let shelf = 0; shelf < 3; shelf++) {
      const y = 0.22 + shelf * 0.8;
      this.box(-1.9, y, -6.15, 2.3, 0.12, 1, this.wood);
      for (let book = 0; book < 8; book++) {
        const height = 0.38 + book % 3 * 0.09;
        this.box(-2.8 + book * 0.24, y + 0.06 + height / 2, -6.03,
          0.16, height, 0.56, bookColors[(book + shelf) % bookColors.length]);
      }
    }

    this.footprint(3.1, -5.75, 4.2, 1.55);
    this.box(3.1, 0.57, -5.75, 4.2, 1.14, 1.55, this.wood);
    this.box(3.1, 1.2, -5.75, 4.35, 0.15, 1.7, this.cream);
    for (const x of [1.75, 3.1, 4.45]) {
      this.box(x, 0.61, -4.94, 1.2, 0.92, 0.08, this.accent);
      this.box(x, 0.95, -4.87, 0.3, 0.07, 0.06, this.metal);
    }
    this.box(2, 1.29, -5.75, 1.12, 0.035, 0.95, this.metal);
    this.box(2, 1.31, -5.75, 0.87, 0.03, 0.7, this.material('#7c9395'));
    this.box(2, 1.6, -6.22, 0.07, 0.6, 0.07, this.metal);
    this.box(2, 1.88, -6.07, 0.07, 0.07, 0.36, this.metal);
    this.box(4.25, 1.33, -5.6, 0.7, 0.08, 0.55, this.wood);
    this.box(4.22, 1.57, -5.6, 0.48, 0.4, 0.4, this.cream);

    this.footprint(6.35, -5.65, 1.6, 1.75);
    this.box(6.35, 0.64, -5.65, 1.6, 1.28, 1.75, this.metal);
    const fire = this.material('#c98443', { emissive: '#e87b28', emissiveIntensity: 1.1 });
    this.box(6.35, 0.64, -4.76, 0.95, 0.63, 0.04, fire);
    for (const x of [5.95, 6.75]) {
      const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 16), this.darkWood);
      burner.position.set(x, 1.3, -5.65);
      this.scene.add(burner);
    }
    this.box(6.35, 2, -6.32, 0.34, 1.45, 0.34, this.metal);

    this.footprint(4.2, 0.6, 2.4, 2);
    this.box(4.2, 1.15, 0.6, 2.4, 0.18, 2, this.wood);
    for (const x of [3.3, 5.1]) {
      for (const z of [-0.1, 1.3]) this.box(x, 0.53, z, 0.16, 1.06, 0.16, this.darkWood);
    }
    this.chair(4.2, -1.3, false);
    this.chair(4.2, 2.5, true);
    const ceramic = this.material('#d2c6a8');
    for (const z of [0.03, 1.17]) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 20), ceramic);
      plate.position.set(4.2, 1.26, z);
      this.scene.add(plate);
      this.box(4.65, 1.38, z, 0.16, 0.24, 0.16, ceramic);
    }
    this.box(3.7, 1.44, 0.6, 0.3, 0.4, 0.3, this.accent);
    const foliage = this.material('#64824b');
    const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 1), foliage);
    plant.position.set(3.7, 1.82, 0.6);
    this.scene.add(plant);

    this.footprint(6.35, 5.6, 1.8, 1.15);
    this.box(6.35, 0.42, 5.6, 1.8, 0.84, 1.15, this.wood);
    this.box(6.35, 0.87, 5.6, 1.9, 0.13, 1.23, this.darkWood);
    this.box(6.35, 0.59, 6.2, 0.18, 0.27, 0.06, this.metal);
  }

  private chair(x: number, z: number, front: boolean): void {
    this.footprint(x, z, 1, 1);
    this.box(x, 0.6, z, 1, 0.13, 1, this.wood);
    this.box(x, 0.69, z, 0.85, 0.08, 0.85, this.accent);
    for (const dx of [-0.38, 0.38]) {
      for (const dz of [-0.38, 0.38]) this.box(x + dx, 0.28, z + dz, 0.12, 0.56, 0.12, this.darkWood);
    }
    this.box(x, 1.05, z + (front ? 0.44 : -0.44), 1, 0.92, 0.12, this.wood);
  }

  private makeLighting(): void {
    this.scene.add(new THREE.HemisphereLight('#fff2d6', '#8c765e', 2.2));
    const daylight = new THREE.DirectionalLight('#ffe9c5', 2.5);
    daylight.position.set(-3, 10, 4);
    daylight.castShadow = true;
    daylight.shadow.mapSize.set(1024, 1024);
    daylight.shadow.camera.left = daylight.shadow.camera.bottom = -10;
    daylight.shadow.camera.right = daylight.shadow.camera.top = 10;
    daylight.shadow.normalBias = 0.025;
    this.scene.add(daylight);
    const glow = this.material('#ffcf7a', { emissive: '#ffb94f', emissiveIntensity: 1.5 });
    for (const x of [-7.55, 7.55]) {
      this.box(x, 2.15, 0.7, 0.25, 0.7, 0.32, this.darkWood);
      this.box(x, 2.18, 0.7, 0.32, 0.42, 0.4, glow);
      const lamp = new THREE.PointLight('#ffd292', 8, 9, 2);
      lamp.position.set(x * 0.92, 2.35, 0.7);
      this.scene.add(lamp);
    }
    const hearth = new THREE.PointLight('#ffa64f', 4, 5, 2);
    hearth.position.set(6.35, 0.9, -4.4);
    this.scene.add(hearth);
  }
}
