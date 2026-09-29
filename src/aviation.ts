import * as THREE from "three";
import { circleIntersectsFootprint } from "./collision";
import type { AircraftImpact } from "./crash-effects";

export const AIRPORT_BOUNDS = { minX: 680, maxX: 860, minZ: 580, maxZ: 940 } as const;
export const AIRPORT_SPAWN = new THREE.Vector3(781.5, 0, 640);
export const FLIGHT_CEILING = 10_000;
export const FLIGHT_VIEW_DISTANCE = FLIGHT_CEILING * 3;

export function flightFogDensity(altitude: number): number {
  return 0.00065 / (1 + Math.max(0, altitude) / 500);
}

const PARKING = new THREE.Vector3(790, 1.55, 640);
const GEAR_HEIGHT = 1.55;
const WORLD = { minX: -230, maxX: 900, minZ: -240, maxZ: 980, ceiling: FLIGHT_CEILING };
const UP = new THREE.Vector3(0, 1, 0);
type Solid = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
type MapPoint = (x: number, z: number) => { x: number; y: number };

function material(color: number, roughness = 0.7, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(
  parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number,
  width: number, height: number, depth: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = height > 0.1;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cylinder(
  parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number,
  top: number, bottom: number, height: number, segments = 12,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Canvas is optional so flight and collision logic also work in headless tests.
function canvasTexture(width: number, height: number): {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture;
} | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, ctx, texture };
}

/** Airport geometry uses world coordinates; the aircraft's children use aircraft coordinates (+Z forward). */
export class Aviation {
  readonly group = new THREE.Group();
  readonly plane = new THREE.Group();
  active = false;
  cockpit = false;
  speed = 0;
  grounded = true;
  crashRemaining = 0;

  private readonly airport = new THREE.Group();
  private readonly shell = new THREE.Group();
  private readonly propeller = new THREE.Group();
  private readonly solids: Solid[] = [];
  private readonly planeSolids: THREE.Box3[] = [];
  private readonly panel = canvasTexture(1024, 384);
  private readonly position = new THREE.Vector3();
  private readonly previous = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private readonly samples = [
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 2.5),
    new THREE.Vector3(0, -0.1, 4.35), new THREE.Vector3(0, 0.15, -3.8),
    new THREE.Vector3(0, 1.35, -3.6),
    ...[-6.2, -4.8, -3.2, -1.6, 1.6, 3.2, 4.8, 6.2].map(x => new THREE.Vector3(x, -0.12, 0)),
    new THREE.Vector3(-2.3, 0.35, -3.6), new THREE.Vector3(2.3, 0.35, -3.6),
  ];
  private heading = 0;
  private verticalSpeed = 0;
  private bank = 0;
  private pitch = 0;
  private instrumentTime = 0;
  private noticeTime = 0;
  private altitude = 0;
  private cameraCut = true;

  constructor() {
    this.group.name = "Grönved flygplats";
    this.airport.name = "Flygplats · bana 18 / 36";
    this.plane.name = "SE-GRN · Grönved Air";
    this.group.add(this.airport, this.plane);
    this.buildAirport();
    this.buildPlane();
    this.plane.updateMatrixWorld(true);
    this.plane.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.computeBoundingBox();
        if (!object.geometry.boundingBox) throw new Error("Flygplanet saknar kollisionsgeometri.");
        this.planeSolids.push(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      }
    });
    this.plane.position.copy(PARKING);
    this.paintInstruments();
  }

  private solidBox(
    mat: THREE.Material, x: number, y: number, z: number,
    width: number, height: number, depth: number,
  ): THREE.Mesh {
    this.solids.push({
      minX: x - width / 2, maxX: x + width / 2, minY: y - height / 2,
      maxY: y + height / 2, minZ: z - depth / 2, maxZ: z + depth / 2,
    });
    return box(this.airport, mat, x, y, z, width, height, depth);
  }

  private sign(
    text: string, width: number, height: number, background = "#153d45", foreground = "#f8f3df",
  ): THREE.MeshBasicMaterial {
    const surface = canvasTexture(width, height);
    if (!surface) return new THREE.MeshBasicMaterial({ color: foreground });
    surface.ctx.fillStyle = background;
    surface.ctx.fillRect(0, 0, width, height);
    surface.ctx.fillStyle = foreground;
    surface.ctx.font = `700 ${Math.round(height * 0.48)}px sans-serif`;
    surface.ctx.textAlign = "center";
    surface.ctx.textBaseline = "middle";
    surface.ctx.fillText(text, width / 2, height * 0.52, width * 0.92);
    return new THREE.MeshBasicMaterial({ map: surface.texture, side: THREE.DoubleSide });
  }

  private buildAirport(): void {
    const grass = material(0x73875b);
    const asphalt = material(0x424b50);
    const shoulder = material(0x676c66);
    const concrete = material(0xb8b7a7);
    const white = material(0xf4edd6);
    const yellow = material(0xf4c857);
    const teal = material(0x246773, 0.48, 0.15);
    const metal = material(0x697a81, 0.42, 0.55);
    const glass = material(0x487781, 0.24, 0.45);
    const orange = material(0xe88049);
    box(this.airport, grass, 770, -0.07, 760, 180, 0.1, 360);
    box(this.airport, shoulder, 790, -0.005, 763, 32, 0.03, 334);
    box(this.airport, asphalt, 790, 0.013, 763, 24, 0.025, 326);
    box(this.airport, concrete, 748, 0.01, 660, 52, 0.035, 110);
    box(this.airport, asphalt, 783, 0.027, 691, 72, 0.025, 16);
    // No fence or collision slab crosses the pedestrian connection from the city.
    box(this.airport, concrete, 723, 0.04, 650, 118, 0.035, 7);
    box(this.airport, concrete, 781, 0.041, 644, 3, 0.035, 12);
    box(this.airport, concrete, 700, 0.04, 642.5, 7, 0.035, 15);
    box(this.airport, yellow, 748, 0.048, 660, 0.2, 0.018, 70);
    box(this.airport, yellow, 769, 0.049, 691, 42, 0.018, 0.2);
    for (const x of [778.8, 801.2]) box(this.airport, white, x, 0.036, 763, 0.28, 0.012, 320);
    for (let z = 625; z < 916; z += 22) box(this.airport, white, 790, 0.036, z, 0.45, 0.012, 10);
    for (const z of [608, 918]) {
      for (const x of [781, 783, 785, 795, 797, 799]) {
        box(this.airport, white, x, 0.036, z, 1.1, 0.012, 9);
      }
    }
    for (const [z, label, rotation] of [[622, "18", Math.PI], [904, "36", 0]] as const) {
      const marking = new THREE.Mesh(new THREE.PlaneGeometry(7, 5), this.sign(label, 256, 192, "#424b50"));
      marking.rotation.set(-Math.PI / 2, 0, rotation);
      marking.position.set(790, 0.041, z);
      this.airport.add(marking);
    }
    const blueLight = new THREE.MeshBasicMaterial({ color: 0x80d6ff });
    const greenLight = new THREE.MeshBasicMaterial({ color: 0x77ffc1 });
    for (let z = 600; z <= 926; z += 18) {
      for (const x of [776, 804]) {
        cylinder(this.airport, metal, x, 0.18, z, 0.09, 0.13, 0.36, 6);
        box(this.airport, blueLight, x, 0.4, z, 0.24, 0.14, 0.24);
      }
    }
    for (const z of [601, 925]) {
      for (let x = 780; x <= 800; x += 4) box(this.airport, greenLight, x, 0.08, z, 0.4, 0.1, 0.5);
    }

    // The terminal faces the open east-west walkway, rather than blocking it.
    this.solidBox(white, 700, 5, 625, 32, 10, 20);
    this.solidBox(teal, 700, 10.25, 625, 34, 0.5, 22);
    box(this.airport, glass, 700, 4.7, 635.06, 29, 5.6, 0.12);
    for (let x = 687; x <= 714; x += 4.5) box(this.airport, white, x, 4.7, 635.18, 0.18, 5.8, 0.18);
    box(this.airport, teal, 700, 1.5, 635.2, 4, 3, 0.16);
    box(this.airport, glass, 700, 1.7, 635.3, 3.6, 2.3, 0.1);
    this.solidBox(metal, 700, 4.5, 638, 37, 0.25, 8);
    for (const x of [682, 718]) this.solidBox(metal, x, 2.2, 641.6, 0.25, 4.4, 0.25);
    const terminalSign = new THREE.Mesh(new THREE.PlaneGeometry(27, 2.4), this.sign("GRÖNVED  /  AIR", 1024, 128));
    terminalSign.position.set(700, 8.3, 635.18);
    this.airport.add(terminalSign);

    this.solidBox(white, 735, 12, 730, 6, 24, 6);
    this.solidBox(teal, 735, 23, 730, 12, 1, 10);
    this.solidBox(glass, 735, 26, 730, 11, 5, 9);
    this.solidBox(teal, 735, 29, 730, 13, 1, 11);
    for (const x of [729.6, 740.4]) {
      for (const z of [725.6, 734.4]) box(this.airport, metal, x, 26, z, 0.25, 5, 0.25);
    }
    this.solidBox(metal, 735, 32, 730, 0.15, 5, 0.15);
    box(this.airport, orange, 735, 34.7, 730, 0.3, 0.3, 0.3);

    // An actual open hangar: only its walls and roof are solid.
    this.solidBox(metal, 819.5, 7, 699, 1, 14, 48);
    this.solidBox(metal, 854.5, 7, 699, 1, 14, 48);
    this.solidBox(metal, 837, 7, 722.5, 36, 14, 1);
    this.solidBox(teal, 837, 14.5, 699, 37, 1, 50);
    box(this.airport, concrete, 837, 0.018, 699, 34, 0.03, 48);
    box(this.airport, teal, 837, 12.5, 674.9, 34, 3, 0.2);
    const hangarSign = new THREE.Mesh(new THREE.PlaneGeometry(15, 1.9), this.sign("HANGAR  01", 512, 96));
    hangarSign.position.set(837, 12.5, 674.72);
    hangarSign.rotation.y = Math.PI;
    this.airport.add(hangarSign);
    for (let x = 822; x <= 852; x += 3) box(this.airport, metal, x, 13.2, 674.7, 0.06, 2.4, 0.08);

    this.solidBox(white, 754, 1.2, 619, 3, 2.4, 5);
    box(this.airport, teal, 754, 2.5, 619.4, 3.1, 0.3, 4.4);
    box(this.airport, glass, 754, 1.85, 616.45, 2.5, 0.8, 0.12);
    for (const x of [752.5, 755.5]) {
      for (const z of [617.5, 620.5]) {
        const wheel = cylinder(this.airport, material(0x26343a), x, 0.5, z, 0.5, 0.5, 0.25);
        wheel.rotation.z = Math.PI / 2;
      }
    }

    this.solidBox(metal, 763, 4, 750, 0.18, 8, 0.18);
    for (let i = 0; i < 6; i++) {
      const sock = cylinder(this.airport, i % 2 ? white : orange, 763 + i * 0.55, 8 - i * 0.09, 750,
        0.44 - i * 0.055, 0.48 - i * 0.055, 0.56, 12);
      sock.rotation.z = Math.PI / 2 + 0.16;
    }
    const boarding = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.1), this.sign("E  ·  OMBORD", 512, 128));
    boarding.rotation.x = -Math.PI / 2;
    boarding.position.set(779.5, 0.072, 641);
    this.airport.add(boarding);
  }

  private buildPlane(): void {
    const ivory = material(0xf6efe0, 0.36, 0.18);
    const teal = material(0x236676, 0.32, 0.35);
    const orange = material(0xe69146, 0.4, 0.1);
    const rubber = material(0x1b242b, 0.94);
    const metal = material(0x91a4aa, 0.3, 0.7);
    const dark = material(0x26363e);
    this.shell.name = "Yttre flygkropp";
    this.plane.add(this.shell);
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), ivory);
    body.scale.set(0.88, 0.82, 4.25);
    body.position.set(0, 0, -0.05);
    body.castShadow = true;
    this.shell.add(body);
    for (const x of [-0.84, 0.84]) box(this.shell, teal, x, 0.05, -0.4, 0.07, 0.24, 5.9);
    const nose = cylinder(this.shell, teal, 0, 0, 3.4, 0.55, 0.76, 1.4, 24);
    nose.rotation.x = Math.PI / 2;
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshStandardMaterial({
      color: 0x9bd6dd, roughness: 0.1, metalness: 0.25, transparent: true, opacity: 0.36, depthWrite: false,
    }));
    canopy.position.set(0, 0.67, 0.8);
    canopy.scale.set(0.84, 1, 1.63);
    this.shell.add(canopy);
    for (const side of [-1, 1]) {
      box(this.plane, ivory, side * 3.55, -0.12, -0.15, 5.8, 0.17, 1.7);
      box(this.plane, teal, side * 6.1, -0.08, -0.15, 0.72, 0.22, 1.73);
      box(this.plane, orange, side * 4.9, -0.015, -0.15, 0.28, 0.025, 1.73);
      box(this.plane, metal, side * 4, -0.12, -0.96, 3.7, 0.12, 0.15);
      const strut = box(this.plane, metal, side * 1.15, -0.7, -0.5, 0.11, 1.04, 0.11);
      strut.rotation.z = side * 0.34;
      const wheel = cylinder(this.plane, rubber, side * 1.35, -1.17, -0.5, 0.38, 0.38, 0.23, 18);
      wheel.rotation.z = Math.PI / 2;
      const hub = cylinder(this.plane, metal, side * 1.48, -1.17, -0.5, 0.17, 0.17, 0.025, 12);
      hub.rotation.z = Math.PI / 2;
      box(this.plane, ivory, side * 1.3, 0.3, -3.5, 2.6, 0.12, 1.03);
      box(this.plane, teal, side * 2.35, 0.36, -3.5, 0.5, 0.1, 1.04);
    }
    const tail = box(this.plane, teal, 0, 1.08, -3.6, 0.15, 1.75, 1.25);
    tail.rotation.x = -0.15;
    box(this.plane, orange, 0, 1.83, -3.7, 0.17, 0.2, 1.03);
    box(this.plane, metal, 0, -0.85, 2.55, 0.1, 0.72, 0.1);
    const frontWheel = cylinder(this.plane, rubber, 0, -1.22, 2.55, 0.33, 0.33, 0.2, 18);
    frontWheel.rotation.z = Math.PI / 2;
    this.propeller.position.set(0, 0, 4.23);
    const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x34414a, transparent: true, opacity: 0.62 });
    for (const angle of [0, Math.PI / 2]) {
      const blade = box(this.propeller, bladeMaterial, 0, 0, 0, 0.13, 2.8, 0.06);
      blade.rotation.z = angle;
    }
    const spinner = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 10), orange);
    spinner.scale.z = 1.6;
    spinner.position.z = 0.12;
    this.propeller.add(spinner);
    this.plane.add(this.propeller);
    for (const [x, color] of [[-6.4, 0x83ffd4], [6.4, 0xff6860]] as const) {
      box(this.plane, new THREE.MeshBasicMaterial({ color }), x, 0.07, -0.1, 0.14, 0.12, 0.2);
    }

    const interior = new THREE.Group();
    interior.name = "Cockpit · instrument och vindruteram";
    this.plane.add(interior);
    box(interior, dark, 0, -0.3, 0.55, 1.5, 0.1, 2.8);
    for (const x of [-0.38, 0.38]) {
      box(interior, teal, x, 0, 0.02, 0.6, 0.25, 0.7);
      box(interior, dark, x, 0.36, -0.28, 0.58, 0.8, 0.14);
    }
    box(interior, dark, 0, 0.28, 2.04, 1.63, 0.6, 0.18);
    box(interior, dark, 0, 0.61, 2.05, 1.78, 0.08, 0.35);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(1.51, 0.565), new THREE.MeshBasicMaterial({
      map: this.panel?.texture ?? null, color: this.panel ? 0xffffff : 0x182c39, toneMapped: false,
    }));
    display.rotation.y = Math.PI;
    display.position.set(0, 0.31, 1.942);
    interior.add(display);
    // Only thin frames cross the windscreen; there is intentionally no opaque windshield.
    for (const x of [-0.8, 0.8]) {
      const frame = box(interior, ivory, x, 1.13, 2.16, 0.045, 1.13, 0.045);
      frame.rotation.x = 0.16;
      box(interior, dark, x, 0.38, 1, 0.08, 0.1, 2.25);
    }
    box(interior, ivory, 0, 1.67, 2.24, 1.63, 0.045, 0.045);
    box(interior, metal, 0, 0.08, 1.45, 0.065, 0.065, 0.7);
    box(interior, dark, 0, 0.08, 1.12, 0.62, 0.065, 0.065);
    for (const x of [-0.29, 0.29]) box(interior, dark, x, 0.15, 1.12, 0.055, 0.2, 0.065);
  }

  /** Pedestrian obstacles only; roofs and tower cabins do not create invisible walls beneath them. */
  blocked(x: number, z: number, radius = 0.45): boolean {
    return this.solids.some(s => s.minY < 2.1 && s.maxY > 0
      && x + radius > s.minX && x - radius < s.maxX
      && z + radius > s.minZ && z - radius < s.maxZ)
      || this.planeBlocked(x, z, radius);
  }

  planeBlocked(x: number, z: number, radius = 0.45): boolean {
    if (!this.grounded || Math.hypot(x - this.plane.position.x, z - this.plane.position.z) > 8 + radius) return false;
    const heading = this.plane.rotation.y;
    const c = Math.cos(heading), s = Math.sin(heading);
    // Separate components leave the empty spaces beside the nose and tail walkable.
    return this.planeSolids.some(bounds => {
      if (bounds.min.y + this.plane.position.y >= 2.1 || bounds.max.y + this.plane.position.y <= 0) return false;
      const cx = (bounds.min.x + bounds.max.x) / 2;
      const cz = (bounds.min.z + bounds.max.z) / 2;
      return circleIntersectsFootprint(x, z, radius, {
        x: this.plane.position.x + cx * c + cz * s,
        z: this.plane.position.z - cx * s + cz * c,
        halfWidth: (bounds.max.x - bounds.min.x) / 2,
        halfLength: (bounds.max.z - bounds.min.z) / 2,
        heading,
      });
    });
  }

  flightBlocked(x: number, y: number, z: number, radius: number): boolean {
    return this.solids.some(s => {
      const dx = Math.max(s.minX - x, 0, x - s.maxX);
      const dy = Math.max(s.minY - y, 0, y - s.maxY);
      const dz = Math.max(s.minZ - z, 0, z - s.maxZ);
      return dx * dx + dy * dy + dz * dz < radius * radius;
    });
  }

  nearPlane(position: THREE.Vector3): boolean {
    return !this.active && this.grounded && this.speed <= 0.5
      && Math.hypot(position.x - this.plane.position.x, position.z - this.plane.position.z) < 10
      && Math.abs(position.y - (this.plane.position.y - GEAR_HEIGHT)) < 2.5;
  }

  enter(): void {
    if (!this.grounded || this.speed > 0.5 || this.active) return;
    this.active = true;
    this.shell.visible = !this.cockpit;
    this.cameraCut = true;
  }

  exit(blocked: (x: number, z: number) => boolean): THREE.Vector3 | null {
    if (!this.active || this.crashRemaining > 0 || !this.grounded || this.speed > 0.5) return null;
    for (const side of [-1, 1]) {
      for (const forward of [0, -2, 2]) {
        const exit = new THREE.Vector3(side * 8.5, 0, forward).applyAxisAngle(UP, this.heading);
        exit.add(this.plane.position);
        exit.y = this.plane.position.y - GEAR_HEIGHT;
        if (exit.x < AIRPORT_BOUNDS.minX + 1 || exit.x > AIRPORT_BOUNDS.maxX - 1
          || exit.z < AIRPORT_BOUNDS.minZ + 1 || exit.z > AIRPORT_BOUNDS.maxZ - 1
          || this.blocked(exit.x, exit.z) || blocked(exit.x, exit.z)) continue;
        this.active = false;
        this.speed = 0;
        this.shell.visible = true;
        return exit;
      }
    }
    return null;
  }

  toggleView(): void {
    if (this.crashRemaining > 0) return;
    this.cockpit = !this.cockpit;
    this.shell.visible = !this.active || !this.cockpit;
    this.cameraCut = true;
  }

  private onRunway(x: number, z: number): boolean {
    return Math.abs(x - 790) < 10 && z > 605 && z < 921;
  }

  private reset(reason: string): string {
    this.crashRemaining = 0;
    this.plane.visible = true;
    this.plane.position.copy(PARKING);
    this.plane.rotation.set(0, 0, 0);
    this.heading = this.verticalSpeed = this.bank = this.pitch = this.speed = 0;
    this.grounded = true;
    this.altitude = 0;
    this.cameraCut = true;
    this.paintInstruments();
    return `${reason} Säker återställning: planet står stilla på flygplatsen. Ingen skadades.`;
  }

  update(
    dt: number, keys: ReadonlySet<string>, groundHeight: (x: number, z: number) => number,
    obstacle: (x: number, y: number, z: number, radius: number) => boolean,
    onImpact?: (impact: AircraftImpact) => void,
  ): string | null {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return null;
    if (this.crashRemaining > 0) {
      this.crashRemaining = Math.max(0, this.crashRemaining - Math.min(dt, 0.5));
      return this.crashRemaining <= 1e-8 ? this.reset("Efter kraschen hämtas du tillbaka.") : null;
    }
    const crash = (reason: string, ground: boolean, contact = this.position): string => {
      this.crashRemaining = 4;
      this.speed = this.verticalSpeed = 0;
      this.grounded = false;
      this.cockpit = false;
      this.shell.visible = true;
      // Keep the camera on the last clear pose, rather than inside the struck building.
      this.plane.visible = false;
      this.cameraCut = true;
      onImpact?.({ position: this.position.clone(), contact: contact.clone(), ground });
      return `Krasch! ${reason} Du återvänder till flygplatsen om fyra sekunder.`;
    };
    const pressed = (...codes: string[]): boolean => codes.some(code => keys.has(code));
    const throttle = pressed("KeyW", "w", "W");
    const brake = pressed("KeyS", "s", "S");
    const steer = Number(pressed("ArrowLeft")) - Number(pressed("ArrowRight"));
    const climb = pressed("ArrowDown");
    const descend = pressed("ArrowUp");
    // Bound catch-up after a suspended browser tab; every simulated step still sweeps the entire aircraft.
    const elapsed = Math.min(dt, 0.5);
    const steps = Math.ceil(elapsed / (1 / 90));
    const step = elapsed / steps;
    let message: string | null = null;
    const warn = (text: string): void => {
      if (this.noticeTime <= 0 && !message) { message = text; this.noticeTime = 4; }
    };
    for (let i = 0; i < steps; i++) {
      this.noticeTime = Math.max(0, this.noticeTime - step);
      const acceleration = brake ? (this.grounded ? -14 : -12)
        : throttle ? (this.grounded ? 9 : 7) : this.grounded ? -1.3 : -0.3;
      this.speed = THREE.MathUtils.clamp(this.speed + acceleration * step, this.grounded ? 0 : 16, 78);
      this.heading += steer * (this.grounded ? 0.7 : 0.56) * Math.min(1, this.speed / 9) * step;
      this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
      this.previous.copy(this.plane.position);
      const surface = groundHeight(this.previous.x, this.previous.z);
      const agl = this.previous.y - surface - GEAR_HEIGHT;
      const landingApproach = !this.grounded && this.onRunway(this.previous.x, this.previous.z)
        && this.speed <= 40 && Math.abs(Math.cos(this.heading)) >= 0.88;
      if (this.grounded && !descend && !brake && (climb ? this.speed >= 18 : throttle && this.speed >= 22)) {
        if (this.onRunway(this.previous.x, this.previous.z)) {
          this.grounded = false;
          this.verticalSpeed = 3;
          message = "Du har lyft! ↓ stiger · ↑ sjunker · ← → svänger · V växlar vy.";
        } else warn("Kör till startbanan innan du lyfter.");
      }
      let targetClimb = 0;
      if (!this.grounded) {
        targetClimb = descend ? -9 : climb ? 13 : throttle && !brake && agl < 20 ? 6 : this.speed < 20 ? -2 : 0;
        if (landingApproach && targetClimb < 0 && agl < 8) {
          targetClimb = Math.max(targetClimb, -Math.max(1.5, agl * 1.2));
        }
        if (this.previous.y > WORLD.ceiling - 15 && targetClimb > 0) {
          targetClimb *= Math.max(0, (WORLD.ceiling - this.previous.y) / 15);
          warn("Maxhöjd 10 000 m – plana ut eller sjunk med ↑.");
        }
        this.verticalSpeed = THREE.MathUtils.damp(this.verticalSpeed, targetClimb, 4, step);
      } else this.verticalSpeed = 0;
      this.position.copy(this.previous);
      let dx = Math.sin(this.heading) * this.speed * step;
      let dz = Math.cos(this.heading) * this.speed * step;
      const edgeX = dx > 0 ? WORLD.maxX - 8 - this.position.x : this.position.x - WORLD.minX - 8;
      const edgeZ = dz > 0 ? WORLD.maxZ - 8 - this.position.z : this.position.z - WORLD.minZ - 8;
      if ((Math.abs(dx) > 0.00001 && edgeX < 35) || (Math.abs(dz) > 0.00001 && edgeZ < 35)) {
        warn("Världens gräns – sväng tillbaka över skogen och staden med ← / →.");
      }
      dx *= THREE.MathUtils.clamp(edgeX / 35, 0, 1);
      dz *= THREE.MathUtils.clamp(edgeZ / 35, 0, 1);
      this.position.x = THREE.MathUtils.clamp(this.position.x + dx, WORLD.minX + 8, WORLD.maxX - 8);
      this.position.z = THREE.MathUtils.clamp(this.position.z + dz, WORLD.minZ + 8, WORLD.maxZ - 8);
      this.position.y = Math.min(WORLD.ceiling, this.position.y + this.verticalSpeed * step);
      const floor = groundHeight(this.position.x, this.position.z);
      if (this.grounded) {
        if (this.position.x < AIRPORT_BOUNDS.minX || this.position.x > AIRPORT_BOUNDS.maxX
          || this.position.z < AIRPORT_BOUNDS.minZ || this.position.z > AIRPORT_BOUNDS.maxZ) {
          this.position.copy(this.previous);
          this.speed = 0;
          warn("Stanna på flygplatsen vid taxning. Starta längs banan med W.");
        } else if (Math.abs(floor - surface) > 0.3) {
          return crash("Ojämn mark framför planet.", true);
        } else this.position.y = floor + GEAR_HEIGHT;
      } else if (this.position.y <= floor + GEAR_HEIGHT) {
        if (!this.onRunway(this.position.x, this.position.z)) {
          return crash("Markkontakt utanför landningsbanan.", true);
        }
        if (this.speed > 40 || this.verticalSpeed < -10 || Math.abs(Math.cos(this.heading)) < 0.88) {
          return crash("Inflygningen var för snabb eller sned.", true);
        }
        this.position.y = floor + GEAR_HEIGHT;
        this.grounded = true;
        this.verticalSpeed = 0;
        this.pitch = this.bank = 0;
        message = "Mjuk landning! Bromsa med S och tryck E när planet står stilla.";
      }
      // Flare valid approaches so descent cannot pitch the nose into the runway before the gear touches.
      const attitudeScale = landingApproach && this.verticalSpeed < 0 ? THREE.MathUtils.clamp((agl - 2) / 6, 0, 1) : 1;
      this.bank = THREE.MathUtils.damp(this.bank, this.grounded ? 0 : -steer * 0.34 * attitudeScale, 4, step);
      this.pitch = THREE.MathUtils.damp(this.pitch,
        this.grounded ? 0 : -Math.atan2(this.verticalSpeed, Math.max(20, this.speed)) * 0.72 * attitudeScale, 4, step);
      this.plane.rotation.set(this.pitch, this.heading, this.bank, "YXZ");
      // Substeps are <0.9 m even at maximum speed. Wing, tail and nose samples prevent thin-obstacle tunnelling.
      for (const sample of this.samples) {
        this.probe.copy(sample).applyQuaternion(this.plane.quaternion).add(this.position);
        if (this.probe.y - 0.28 < groundHeight(this.probe.x, this.probe.z)) {
          return crash("Vingen träffade marken.", true, this.probe);
        }
        if (this.flightBlocked(this.probe.x, this.probe.y, this.probe.z, 0.78)
          || obstacle(this.probe.x, this.probe.y, this.probe.z, 0.78)) {
          return crash("Planet träffade ett föremål.", false, this.probe);
        }
      }
      this.plane.position.copy(this.position);
    }
    this.propeller.rotation.z += elapsed * (18 + this.speed * 1.5);
    this.altitude = Math.max(0, this.plane.position.y - groundHeight(this.plane.position.x, this.plane.position.z));
    this.instrumentTime += elapsed;
    if (this.instrumentTime >= 0.1) { this.instrumentTime = 0; this.paintInstruments(); }
    return message;
  }

  updateCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.active) return;
    const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.5)) : 0;
    if (this.cockpit) {
      this.cameraPosition.set(0, 0.98, -0.1).applyQuaternion(this.plane.quaternion).add(this.plane.position);
      this.cameraTarget.set(0, 0.97, 25).applyQuaternion(this.plane.quaternion).add(this.plane.position);
      this.cameraUp.copy(UP).applyQuaternion(this.plane.quaternion);
      camera.position.copy(this.cameraPosition);
      camera.up.copy(this.cameraUp);
    } else {
      const overview = THREE.MathUtils.smoothstep(this.altitude, 100, 2000);
      const followHeight = THREE.MathUtils.lerp(6.4, 90, overview);
      const lookAhead = THREE.MathUtils.lerp(10, 0, overview);
      this.cameraPosition.set(-Math.sin(this.heading) * 17, followHeight, -Math.cos(this.heading) * 17).add(this.plane.position);
      this.cameraTarget.set(Math.sin(this.heading) * lookAhead, 1.2, Math.cos(this.heading) * lookAhead).add(this.plane.position);
      camera.position.lerp(this.cameraPosition, this.cameraCut ? 1 : 1 - Math.exp(-5 * elapsed));
      camera.up.copy(UP);
    }
    camera.lookAt(this.cameraTarget);
    // Keep the aircraft interior in front of the near plane without changing host FOV or clipping distance.
    if (camera.near > 0.1) { camera.near = 0.1; camera.updateProjectionMatrix(); }
    this.cameraCut = false;
  }

  private paintInstruments(): void {
    if (!this.panel) return;
    const { ctx, texture } = this.panel;
    ctx.fillStyle = "#122631";
    ctx.fillRect(0, 0, 1024, 384);
    ctx.strokeStyle = "#385563";
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, 1008, 368);
    ctx.font = "bold 21px sans-serif";
    ctx.fillStyle = "#a9c5cd";
    ctx.textAlign = "left";
    ctx.fillText("GRÖNVED AIR", 28, 36);
    ctx.textAlign = "right";
    ctx.fillText("SE–GRN   /   SPORT 180", 990, 36);
    const gauge = (x: number, label: string, value: number, max: number, unit: string): void => {
      const y = 171, radius = 103;
      ctx.fillStyle = "#07141d";
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#60808a"; ctx.lineWidth = 5; ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      for (let i = 0; i <= 10; i++) {
        const angle = (-0.75 + i * 0.15) * Math.PI;
        const sx = Math.sin(angle), sy = -Math.cos(angle);
        ctx.strokeStyle = i >= 9 ? "#e99759" : "#cfe8e7";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sx * 77, sy * 77); ctx.lineTo(sx * 88, sy * 88); ctx.stroke();
      }
      const angle = (-0.75 + THREE.MathUtils.clamp(value / max, 0, 1) * 1.5) * Math.PI;
      ctx.rotate(angle);
      ctx.strokeStyle = "#f3ce73"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, -75); ctx.stroke();
      ctx.restore();
      ctx.textAlign = "center";
      ctx.font = "bold 31px monospace"; ctx.fillStyle = "#f7f0d8";
      ctx.fillText(`${Math.round(value)}`, x, y + 43);
      ctx.font = "17px sans-serif"; ctx.fillStyle = "#9db8c3"; ctx.fillText(unit, x, y + 65);
      ctx.font = "bold 20px sans-serif"; ctx.fillStyle = "#d6e5e3"; ctx.fillText(label, x, 298);
    };
    gauge(143, "FART", this.speed * 3.6, 300, "km/h");
    gauge(635, "HÖJD", this.altitude, FLIGHT_CEILING, "m AGL");
    const cx = 387, cy = 171;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, 100, 0, Math.PI * 2); ctx.clip();
    ctx.translate(cx, cy); ctx.rotate(-this.bank);
    const horizon = this.pitch * 140;
    ctx.fillStyle = "#487d9b"; ctx.fillRect(-160, -180, 320, 180 + horizon);
    ctx.fillStyle = "#956944"; ctx.fillRect(-160, horizon, 320, 180);
    ctx.strokeStyle = "#f9f1d4"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-150, horizon); ctx.lineTo(150, horizon); ctx.stroke();
    for (const offset of [-40, -20, 20, 40]) {
      ctx.beginPath(); ctx.moveTo(-20, horizon + offset); ctx.lineTo(20, horizon + offset); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "#60808a"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, 100, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "#ffde7d"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx - 58, cy); ctx.lineTo(cx - 18, cy);
    ctx.lineTo(cx, cy + 10); ctx.lineTo(cx + 18, cy); ctx.lineTo(cx + 58, cy); ctx.stroke();
    ctx.textAlign = "center"; ctx.font = "bold 20px sans-serif"; ctx.fillStyle = "#d6e5e3";
    ctx.fillText("HORISONT", cx, 298);
    ctx.fillStyle = "#081b24"; ctx.fillRect(766, 64, 231, 212);
    ctx.fillStyle = "#80e6c0"; ctx.font = "bold 23px monospace";
    ctx.fillText(this.grounded ? "PÅ MARKEN" : "I LUFTEN", 881, 100);
    ctx.fillStyle = "#c8dfdf"; ctx.font = "20px monospace";
    const compass = ((Math.round(180 - THREE.MathUtils.radToDeg(this.heading)) % 360) + 360) % 360;
    ctx.fillText(`KURS ${String(compass).padStart(3, "0")}°`, 881, 145);
    ctx.fillText(`${this.verticalSpeed >= 0 ? "+" : ""}${this.verticalSpeed.toFixed(1)} m/s`, 881, 184);
    ctx.fillStyle = "#eec778"; ctx.fillText("BANA 18 / 36", 881, 229);
    ctx.fillStyle = "#a9c5cd"; ctx.font = "19px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("W GAS   S BROMS   ← → SVÄNG   ↓ STIG   ↑ SJUNK   V VY", 512, 345);
    texture.needsUpdate = true;
  }

  drawMap(ctx: CanvasRenderingContext2D, mapPoint: MapPoint): void {
    const rect = (minX: number, minZ: number, maxX: number, maxZ: number, color: string): void => {
      const a = mapPoint(minX, minZ), b = mapPoint(maxX, minZ);
      const c = mapPoint(maxX, maxZ), d = mapPoint(minX, maxZ);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
    };
    ctx.save();
    rect(680, 580, 860, 940, "#718260");
    rect(778, 600, 802, 926, "#3e4b52");
    rect(722, 605, 774, 715, "#aaa995");
    rect(664, 647, 783, 653, "#d8cda8");
    rect(684, 615, 716, 635, "#286773");
    rect(819, 675, 855, 723, "#286773");
    const a = mapPoint(790, 612), b = mapPoint(790, 914);
    ctx.strokeStyle = "#f0ead2"; ctx.lineWidth = 1.3; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    const p = this.plane.position;
    const point = (x: number, z: number): { x: number; y: number } => mapPoint(
      p.x + x * Math.cos(this.heading) + z * Math.sin(this.heading),
      p.z - x * Math.sin(this.heading) + z * Math.cos(this.heading),
    );
    ctx.strokeStyle = this.active ? "#ffe5a3" : "#fff8e3"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    for (const [x1, z1, x2, z2] of [[0, -6, 0, 6], [-7, 0, 7, 0], [-3, -5, 3, -5]]) {
      const from = point(x1, z1), to = point(x2, z2);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    }
    ctx.restore();
  }
}
