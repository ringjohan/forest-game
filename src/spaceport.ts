import * as THREE from "three";
import { ROCKET, SmokeSystem, createPlume, createRocket, makeSmokeTexture } from "./rocket";
import type { Plume, RocketParts } from "./rocket";

/** Rocket axis on the launch table (world coordinates, inside the airport's open western grass). */
export const PAD = new THREE.Vector3(722, 0, 862);
export const SPACEPORT_BOUNDS = { minX: 684, maxX: 760, minZ: 800, maxZ: 936 } as const;
const TABLE_TOP = 7;
const TOWER = { x: PAD.x - 10.5, z: PAD.z, half: 4, height: 88 };
const ELEVATOR_DOOR = new THREE.Vector3(TOWER.x, 0, TOWER.z - TOWER.half - 1.6);
const ARM_HEIGHT = TABLE_TOP + ROCKET.fairingTop + 1.3;
const COUNTDOWN_SECONDS = 12;
/** Ascent duration in the open-air world before the flight continues in the space scene. */
export const ASCENT_SECONDS = 19.5;

type Circle = { x: number; z: number; r: number; top: number; bottom?: number };
type Box = { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
type MapPoint = (x: number, z: number) => { x: number; y: number };

export type LaunchPhase = "idle" | "countdown" | "ascent" | "away";

function standard(color: number, roughness = 0.7, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function concreteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Rymdcentret kräver en 2D-canvas.");
  ctx.fillStyle = "#b9b6ad";
  ctx.fillRect(0, 0, 512, 512);
  const image = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    image.data[i] += n; image.data[i + 1] += n; image.data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${60 + Math.random() * 30},${55 + Math.random() * 25},45,${0.04 + Math.random() * 0.06})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 80, 10 + Math.random() * 40, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(70,68,62,0.55)";
  ctx.lineWidth = 2;
  for (let x = 0; x <= 512; x += 128) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
  for (let y = 0; y <= 512; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function signMaterial(lines: string[], width: number, height: number, background: string, color: string): THREE.MeshBasicMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Rymdcentret kräver en 2D-canvas.");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    const size = i === 0 ? height * 0.34 : height * 0.15;
    ctx.font = `${i === 0 ? 700 : 500} ${Math.round(size)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(line, width / 2, i === 0 ? height * 0.36 : height * (0.62 + (i - 1) * 0.2), width * 0.92);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
}

/** Launch complex LC-1: pad, tower, tanks, masts, the rocket and the open-air part of the launch. */
export class Spaceport {
  readonly group = new THREE.Group();
  readonly rocket: RocketParts;
  phase: LaunchPhase = "idle";
  /** Seconds since boarding during the countdown, then seconds since liftoff. */
  time = 0;
  altitude = 0;
  speed = 0;
  /** Countdown pauses at T-10 until the space graphics have finished loading. */
  holdForAssets = false;

  private readonly circles: Circle[] = [];
  private readonly boxes: Box[] = [];
  private readonly arm = new THREE.Group();
  private readonly plume: Plume;
  private readonly plumeCore: Plume;
  private readonly engineLight = new THREE.PointLight(0xffa24a, 0, 0, 2);
  private readonly floodlights: THREE.SpotLight[] = [];
  private readonly floodMaterial: THREE.MeshStandardMaterial;
  private readonly smoke: SmokeSystem;
  private readonly rocketPosition = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly nozzle = new THREE.Vector3();
  private pitch = 0;
  private emitAccumulator = 0;
  private shotCut = -1;
  private readonly lookTarget = new THREE.Vector3();
  private readonly cameraGoal = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor() {
    this.group.name = "Grönved Rymdcenter · LC-1";
    this.rocket = createRocket();
    this.plume = createPlume({ r0: 1.8, r1: 3.4, length: 46, core: 0xfff6e0, outer: 0xff9a3c, diamonds: 1, soft: 1.15 });
    this.plumeCore = createPlume({ r0: 1.55, r1: 0.9, length: 14, core: 0xffffff, outer: 0xffe0a0, soft: 2.0 });
    this.smoke = new SmokeSystem(makeSmokeTexture());
    this.floodMaterial = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 0.2 });
    this.build();
    this.resetPad();
  }

  get interactionPoint(): THREE.Vector3 { return ELEVATOR_DOOR; }

  nearElevator(position: THREE.Vector3): boolean {
    return this.phase === "idle" && Math.hypot(position.x - ELEVATOR_DOOR.x, position.z - ELEVATOR_DOOR.z) < 4.5;
  }

  contains(x: number, z: number): boolean {
    return x >= SPACEPORT_BOUNDS.minX && x <= SPACEPORT_BOUNDS.maxX && z >= SPACEPORT_BOUNDS.minZ && z <= SPACEPORT_BOUNDS.maxZ;
  }

  private build(): void {
    const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.92 });
    concrete.map!.repeat.set(10, 18);
    const darkConcrete = standard(0x4f4c47, 0.95);
    const scorched = standard(0x1d1b19, 1);
    const steel = new THREE.MeshStandardMaterial({ color: 0x34383c, roughness: 0.62, metalness: 0.35, envMapIntensity: 0.45 });
    const lightSteel = new THREE.MeshStandardMaterial({ color: 0x8d949a, roughness: 0.45, metalness: 0.7 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.5, metalness: 0.1 });
    const orange = standard(0xd9622b, 0.6, 0.2);
    const pipe = new THREE.MeshStandardMaterial({ color: 0xa9adb0, roughness: 0.3, metalness: 0.9 });

    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, shadow = true): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };

    // Apron and walkway from the airport apron to the pad.
    add(new THREE.BoxGeometry(SPACEPORT_BOUNDS.maxX - SPACEPORT_BOUNDS.minX, 0.06, 104), concrete,
      (SPACEPORT_BOUNDS.minX + SPACEPORT_BOUNDS.maxX) / 2, 0.02, 870, false);
    const walk = add(new THREE.BoxGeometry(7, 0.05, 104), concrete, 726, 0.025, 768, false);
    walk.receiveShadow = true;
    for (let z = 722; z < 818; z += 6) add(new THREE.BoxGeometry(0.25, 0.012, 2.4), standard(0xf3c857), 726, 0.06, z, false);
    // Flame trench: scorched floor between two blast walls, open to the north and south.
    add(new THREE.BoxGeometry(10, 0.03, 58), scorched, PAD.x, 0.05, PAD.z, false);
    for (const side of [-1, 1]) {
      this.solid(add(new THREE.BoxGeometry(1.2, 1.6, 58), darkConcrete, PAD.x + side * 5.6, 0.8, PAD.z), 1.2, 58);
    }
    const deflector = add(new THREE.CylinderGeometry(4.6, 4.6, 9.6, 3, 1), darkConcrete, PAD.x, 0.6, PAD.z);
    deflector.rotation.set(0, 0, Math.PI / 2);
    deflector.scale.set(0.35, 1, 1);

    // Launch table: deck with a central exhaust hole on four massive legs.
    const deckShape = new THREE.Shape();
    deckShape.moveTo(-6.5, -6.5); deckShape.lineTo(6.5, -6.5); deckShape.lineTo(6.5, 6.5); deckShape.lineTo(-6.5, 6.5);
    const hole = new THREE.Path();
    hole.absarc(0, 0, 2.6, 0, Math.PI * 2, true);
    deckShape.holes.push(hole);
    const deckGeometry = new THREE.ExtrudeGeometry(deckShape, { depth: 1.4, bevelEnabled: false, curveSegments: 48 });
    deckGeometry.rotateX(-Math.PI / 2);
    add(deckGeometry, steel, PAD.x, TABLE_TOP - 1.4, PAD.z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = add(new THREE.BoxGeometry(1.8, TABLE_TOP - 1.4, 1.8), darkConcrete, PAD.x + sx * 5.6, (TABLE_TOP - 1.4) / 2, PAD.z + sz * 5.6);
      this.solid(leg, 1.8, 1.8);
      const clamp = add(new THREE.BoxGeometry(0.6, 1.1, 0.9), lightSteel, PAD.x + sx * 1.75, TABLE_TOP + 0.5, PAD.z + sz * 1.75);
      clamp.lookAt(PAD.x, TABLE_TOP + 0.5, PAD.z);
    }
    this.boxes.push({ minX: PAD.x - 6.5, maxX: PAD.x + 6.5, minZ: PAD.z - 6.5, maxZ: PAD.z + 6.5, minY: TABLE_TOP - 1.4, maxY: TABLE_TOP });

    // Fixed service tower: an instanced steel lattice with decks, elevator shaft and lightning mast.
    const beams: THREE.Matrix4[] = [];
    const beam = (a: THREE.Vector3, b: THREE.Vector3, thickness: number): void => {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      beams.push(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(thickness, dir.length(), thickness)));
    };
    const h = TOWER.half;
    const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
    const levelHeight = 4;
    for (const [cx, cz] of corners) beam(new THREE.Vector3(TOWER.x + cx, 0, TOWER.z + cz), new THREE.Vector3(TOWER.x + cx, TOWER.height, TOWER.z + cz), 0.55);
    for (let y = 0; y < TOWER.height; y += levelHeight) {
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
        const a0 = new THREE.Vector3(TOWER.x + ax, y, TOWER.z + az), b0 = new THREE.Vector3(TOWER.x + bx, y, TOWER.z + bz);
        const a1 = a0.clone().setY(y + levelHeight), b1 = b0.clone().setY(y + levelHeight);
        beam(a1, b1, 0.32);
        beam(a0, b1, 0.18);
        beam(b0, a1, 0.18);
      }
    }
    const lattice = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, beams.length);
    beams.forEach((matrix, i) => lattice.setMatrixAt(i, matrix));
    lattice.castShadow = lattice.receiveShadow = true;
    lattice.name = "Servicetorn";
    this.group.add(lattice);
    for (let y = 8; y < TOWER.height; y += 8) {
      add(new THREE.BoxGeometry(h * 2 + 0.6, 0.18, h * 2 + 0.6), standard(0x2b2d30, 0.8, 0.4), TOWER.x, y, TOWER.z);
      add(new THREE.BoxGeometry(0.05, 1.1, h * 2 + 0.6), lightSteel, TOWER.x + h + 0.3, y + 0.55, TOWER.z, false);
    }
    add(new THREE.BoxGeometry(2.6, TOWER.height, 2.6), standard(0xb5b8b4, 0.6, 0.3), TOWER.x - 1.2, TOWER.height / 2, TOWER.z - 0.8);
    add(new THREE.BoxGeometry(2.0, 2.6, 0.12), standard(0x8f9a9f, 0.4, 0.6), ELEVATOR_DOOR.x, 1.3, TOWER.z - h - 0.05);
    for (const [px, pz] of [[h - 0.6, -h + 0.6], [h - 1.3, -h + 0.6], [h - 0.6, h - 0.6]]) {
      add(new THREE.CylinderGeometry(0.22, 0.22, TOWER.height - 6, 12), pipe, TOWER.x + px, (TOWER.height - 6) / 2, TOWER.z + pz);
    }
    add(new THREE.CylinderGeometry(0.12, 0.35, 16, 10), lightSteel, TOWER.x, TOWER.height + 8, TOWER.z);
    add(new THREE.BoxGeometry(h * 2 + 3, 1.2, 2.4), steel, TOWER.x + 1.5, TOWER.height + 0.6, TOWER.z);
    this.boxes.push({ minX: TOWER.x - h, maxX: TOWER.x + h, minZ: TOWER.z - h, maxZ: TOWER.z + h, minY: 0, maxY: TOWER.height + 16 });
    // Umbilical arms to each stage plus the crew access arm with its white room.
    for (const y of [TABLE_TOP + 38, TABLE_TOP + ROCKET.upperTop - 4]) {
      add(new THREE.BoxGeometry(5.2, 0.7, 0.9), steel, TOWER.x + h + 2.4, y, TOWER.z);
      add(new THREE.CylinderGeometry(0.16, 0.16, 5, 8), pipe, TOWER.x + h + 2.4, y - 0.6, TOWER.z).rotation.z = Math.PI / 2;
    }
    this.arm.position.set(TOWER.x + h, ARM_HEIGHT, TOWER.z);
    this.group.add(this.arm);
    const armBody = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.4, 2.0), new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.5, metalness: 0.6 }));
    armBody.position.set(2.1, 0, 0);
    armBody.castShadow = true;
    const whiteRoom = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.6, 2.4), white);
    whiteRoom.position.set(4.6, 0, 0);
    whiteRoom.castShadow = true;
    this.arm.add(armBody, whiteRoom);

    // Propellant farm: LOX and RP-1 spheres with feed lines to the table.
    for (const [z, label] of [[838, "LOX"], [888, "RP-1"]] as const) {
      const x = 694;
      add(new THREE.SphereGeometry(5, 48, 24), white, x, 8.5, z);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        add(new THREE.CylinderGeometry(0.22, 0.22, 7, 8), steel, x + Math.cos(a) * 3.6, 3.5, z + Math.sin(a) * 3.6);
      }
      add(new THREE.CylinderGeometry(0.35, 0.35, Math.abs(PAD.x - 6 - x - 4), 12), pipe, (x + 4 + PAD.x - 6) / 2, 1.0, z)
        .rotation.z = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.35, 0.35, Math.abs(z - PAD.z) - 6, 12), pipe, PAD.x - 6.6, 1.0, (z + PAD.z) / 2 + Math.sign(z - PAD.z) * -1)
        .rotation.x = Math.PI / 2;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.2), signMaterial([label], 512, 154, "#11427a", "#ffffff"));
      sign.position.set(x + 5.02, 8.5, z);
      sign.rotation.y = Math.PI / 2;
      this.group.add(sign);
      this.circles.push({ x, z, r: 4.2, top: 13.5 });
    }

    // Sound-suppression water tower.
    const wx = 748, wz = 924;
    add(new THREE.CylinderGeometry(5, 5, 11, 48), white, wx, 52, wz);
    add(new THREE.CylinderGeometry(5.1, 5.1, 0.6, 48), orange, wx, 57.8, wz);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      add(new THREE.CylinderGeometry(0.4, 0.55, 47, 10), steel, wx + Math.cos(a) * 4, 23.5, wz + Math.sin(a) * 4);
    }
    add(new THREE.CylinderGeometry(0.6, 0.6, 47, 12), pipe, wx, 23.5, wz);
    this.circles.push({ x: wx, z: wz, r: 5.4, top: 58 });

    // Lightning-protection masts with sagging catenary wires.
    const masts = [new THREE.Vector3(744, 0, 836), new THREE.Vector3(744, 0, 890), new THREE.Vector3(703, 0, 914)];
    const wireMaterial = new THREE.LineBasicMaterial({ color: 0x2a2c2e });
    const towerTop = new THREE.Vector3(TOWER.x, TOWER.height + 16, TOWER.z);
    for (const m of masts) {
      add(new THREE.CylinderGeometry(0.3, 0.75, 96, 12), standard(0xc9ccd0, 0.5, 0.5), m.x, 48, m.z);
      add(new THREE.CylinderGeometry(0.06, 0.12, 12, 8), standard(0x222222), m.x, 102, m.z);
      this.circles.push({ x: m.x, z: m.z, r: 0.8, top: 108 });
      const top = new THREE.Vector3(m.x, 104, m.z);
      for (const target of [towerTop, ...masts.filter(o => o !== m).map(o => new THREE.Vector3(o.x, 104, o.z))]) {
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          points.push(top.clone().lerp(target, t).add(new THREE.Vector3(0, -Math.sin(t * Math.PI) * 9, 0)));
        }
        this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), wireMaterial));
      }
    }

    // Floodlights for night operations.
    for (const [x, z] of [[752, 828], [752, 898], [690, 912], [690, 816]]) {
      add(new THREE.CylinderGeometry(0.22, 0.35, 26, 10), steel, x, 13, z);
      const head = add(new THREE.BoxGeometry(3.2, 1.8, 0.5), this.floodMaterial, x, 26.5, z);
      head.lookAt(PAD.x, 40, PAD.z);
      this.circles.push({ x, z, r: 0.5, top: 28 });
    }
    for (const [x, z] of [[752, 828], [690, 912]]) {
      const spot = new THREE.SpotLight(0xfff0d8, 0, 260, 0.42, 0.6, 1.2);
      spot.position.set(x, 26, z);
      spot.target.position.set(PAD.x, 42, PAD.z);
      this.group.add(spot, spot.target);
      this.floodlights.push(spot);
    }

    // Entrance sign facing visitors walking up from the terminal.
    const signBoard = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.2),
      signMaterial(["GRÖNVED RYMDCENTER", "Startplatta LC-1 · Bärraketen Nordstjärnan", "Ta hissen i tornet (E) för att gå ombord"], 1400, 420, "#0d1c2c", "#eef4ff"));
    signBoard.position.set(735, 5.2, 806);
    signBoard.rotation.y = Math.PI;
    this.group.add(signBoard);
    for (const dx of [-6, 6]) {
      add(new THREE.BoxGeometry(0.3, 7.2, 0.3), steel, 735 + dx, 3.6, 806.2);
      this.circles.push({ x: 735 + dx, z: 806.2, r: 0.35, top: 7.3 });
    }
    const padMark = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.5), signMaterial(["LC-1"], 512, 200, "#b9b6ad", "#1d2a38"));
    padMark.rotation.set(-Math.PI / 2, 0, Math.PI);
    padMark.position.set(PAD.x + 18, 0.06, PAD.z - 22);
    this.group.add(padMark);

    this.group.add(this.rocket.root, this.smoke.group, this.engineLight);
    this.rocket.root.add(this.plume.mesh, this.plumeCore.mesh);
    this.plume.mesh.visible = this.plumeCore.mesh.visible = false;
  }

  private solid(mesh: THREE.Mesh, width: number, depth: number): void {
    const p = mesh.position;
    const geometry = mesh.geometry as THREE.BoxGeometry;
    const height = geometry.parameters?.height ?? 2;
    this.boxes.push({ minX: p.x - width / 2, maxX: p.x + width / 2, minZ: p.z - depth / 2, maxZ: p.z + depth / 2, minY: p.y - height / 2, maxY: p.y + height / 2 });
  }

  /** Puts a fresh rocket on the table with the crew access arm extended. */
  resetPad(): void {
    this.phase = "idle";
    this.time = 0;
    this.altitude = this.speed = this.pitch = 0;
    this.holdForAssets = false;
    this.rocket.root.visible = true;
    this.rocket.root.position.set(PAD.x, TABLE_TOP, PAD.z);
    this.rocket.root.rotation.set(0, 0, 0);
    this.rocketPosition.copy(this.rocket.root.position);
    this.velocity.set(0, 0, 0);
    this.arm.rotation.y = 0;
    this.plume.mesh.visible = this.plumeCore.mesh.visible = false;
    this.engineLight.intensity = 0;
    this.rocket.engineGlow.emissiveIntensity = 0;
    this.smoke.clear();
  }

  /** Pedestrian collision (ground level only). */
  blocked(x: number, z: number, radius = 0.45): boolean {
    if (x < SPACEPORT_BOUNDS.minX - 10 || x > SPACEPORT_BOUNDS.maxX + 10 || z < SPACEPORT_BOUNDS.minZ - 10 || z > SPACEPORT_BOUNDS.maxZ + 10) return false;
    return this.boxes.some(b => b.minY < 2.1 && b.maxY > 0 && x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ)
      || this.circles.some(c => (c.bottom ?? 0) < 2.1 && Math.hypot(x - c.x, z - c.z) < c.r + radius);
  }

  /** Aircraft and camera collision against the 3D structures, including the rocket on the pad. */
  flightBlocked(x: number, y: number, z: number, radius: number): boolean {
    if (x < SPACEPORT_BOUNDS.minX - 20 || x > SPACEPORT_BOUNDS.maxX + 20 || z < SPACEPORT_BOUNDS.minZ - 20 || z > SPACEPORT_BOUNDS.maxZ + 20 || y > 125) return false;
    if (this.boxes.some(b => x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ && y + radius > b.minY && y - radius < b.maxY)) return true;
    if (this.circles.some(c => y - radius < c.top && y + radius > (c.bottom ?? 0) && Math.hypot(x - c.x, z - c.z) < c.r + radius)) return true;
    return this.phase === "idle" && y - radius < TABLE_TOP + ROCKET.height && y + radius > TABLE_TOP
      && Math.hypot(x - PAD.x, z - PAD.z) < ROCKET.radius + radius;
  }

  /** Begins boarding and the terminal count. */
  board(): void {
    if (this.phase !== "idle") return;
    this.phase = "countdown";
    this.time = 0;
    this.shotCut = -1;
  }

  /** Ends the open-air part immediately (the player skipped ahead to space). */
  finish(): void {
    this.phase = "away";
    this.rocket.root.visible = false;
    this.plume.mesh.visible = this.plumeCore.mesh.visible = false;
    this.engineLight.intensity = 0;
    this.holdForAssets = false;
  }

  get countdown(): number { return this.phase === "countdown" ? COUNTDOWN_SECONDS - this.time : 0; }

  /** Text for the large launch HUD. */
  get status(): string {
    if (this.phase === "countdown") {
      if (this.holdForAssets) return "HÅLLER VID T−10 · Laddar rymdens grafik ...";
      const t = this.countdown;
      if (t > 8) return "Besättningen ombord · Åtkomstarmen dras tillbaka";
      if (t > 3.2) return "Tankning klar · Startsekvens aktiv";
      return "Tändning";
    }
    if (this.phase === "ascent") return this.time < 2 ? "Lyftning!" : this.time < 9 ? "Tornet passerat · Gravitationsvändning" : "Max Q · Maximal aerodynamisk belastning";
    return "";
  }

  get timerText(): string {
    if (this.phase === "countdown") return `T − ${Math.max(0, Math.ceil(this.countdown)).toString().padStart(2, "0")}`;
    if (this.phase === "ascent") return `T + ${Math.floor(this.time).toString().padStart(2, "0")}`;
    return "";
  }

  /** 0 on the ground, approaching 1 as the sky turns black near the edge of the atmosphere. */
  get skyDarkness(): number { return THREE.MathUtils.smoothstep(this.altitude, 400, 9000); }

  get rocketWorldPosition(): THREE.Vector3 { return this.rocketPosition; }

  /** Advances the launch. Returns true once the world part of the ascent is complete. */
  update(dt: number, daylight: number): boolean {
    const night = 1 - daylight;
    this.floodMaterial.emissiveIntensity = 0.2 + night * 3.5;
    for (const spot of this.floodlights) spot.intensity = night * 9000;
    if (this.phase === "idle" || this.phase === "away") {
      this.smoke.update(dt, daylight);
      return false;
    }
    if (this.phase === "countdown") {
      // Hold at T-10 (after the arm swings away) until the space scene can be shown without a stall.
      if (!(this.holdForAssets && this.countdown <= 10)) this.time += dt;
      const t = this.countdown;
      this.arm.rotation.y = -THREE.MathUtils.smoothstep(this.time, 0.5, 5.5) * 1.75;
      this.vent(dt, t);
      const ignition = 1 - THREE.MathUtils.smoothstep(t, 0.2, 3.2);
      this.setEngine(ignition, 0, dt);
      if (t < 3.0) this.padSmoke(dt, 0.35 + ignition);
      if (t <= 0) {
        this.phase = "ascent";
        this.time = 0;
      }
      this.smoke.update(dt, daylight, this.engineLightInfo());
      return false;
    }
    this.time += dt;
    const tau = this.time;
    // Thrust-to-weight rises as propellant burns off; a gentle eastward gravity turn begins after the tower is cleared.
    const acceleration = 11 + 1.6 * tau;
    const targetPitch = THREE.MathUtils.degToRad(28) * THREE.MathUtils.smoothstep(tau, 6, 19);
    this.pitch = targetPitch;
    const direction = this.tmp.set(Math.sin(this.pitch), Math.cos(this.pitch), 0);
    this.speed += acceleration * dt;
    this.velocity.copy(direction).multiplyScalar(this.speed);
    this.rocketPosition.addScaledVector(this.velocity, dt);
    this.altitude = this.rocketPosition.y - TABLE_TOP;
    this.rocket.root.position.copy(this.rocketPosition);
    this.rocket.root.rotation.set(0, 0, -this.pitch);
    this.setEngine(1, this.altitude, dt);
    if (tau < 7) this.padSmoke(dt, Math.max(0, 1.3 - tau * 0.18));
    if (this.altitude < 3200) this.trail(dt);
    this.smoke.update(dt, daylight, this.engineLightInfo());
    if (tau >= ASCENT_SECONDS) {
      this.phase = "away";
      this.rocket.root.visible = false;
      this.engineLight.intensity = 0;
      return true;
    }
    return false;
  }

  private engineLightInfo(): { position: THREE.Vector3; intensity: number } {
    return { position: this.nozzle, intensity: this.plume.material.uniforms.uIntensity.value * 1.0 };
  }

  private setEngine(level: number, altitude: number, dt: number): void {
    const on = level > 0.001;
    this.plume.mesh.visible = this.plumeCore.mesh.visible = on;
    const thin = THREE.MathUtils.smoothstep(altitude, 200, 4000);
    const flicker = 0.93 + Math.sin(this.time * 61) * 0.04 + Math.sin(this.time * 23.7) * 0.03;
    const u = this.plume.material.uniforms;
    u.uTime.value += dt;
    u.uIntensity.value = level * 3.4 * flicker;
    u.uLength.value = THREE.MathUtils.lerp(46, 120, thin) * (0.4 + 0.6 * level);
    u.uR1.value = THREE.MathUtils.lerp(3.4, 22, thin);
    u.uDiamonds.value = 1 - thin * 0.8;
    const c = this.plumeCore.material.uniforms;
    c.uTime.value += dt;
    c.uIntensity.value = level * 4 * flicker;
    this.rocket.engineGlow.emissiveIntensity = level * 3;
    this.nozzle.copy(this.rocketPosition).add(this.tmp.set(Math.sin(this.pitch), -Math.cos(this.pitch), 0).multiplyScalar(4));
    this.engineLight.position.copy(this.nozzle);
    this.engineLight.intensity = level * 5e5 * flicker;
  }

  private vent(dt: number, t: number): void {
    this.emitAccumulator += dt;
    while (this.emitAccumulator > 0.09) {
      this.emitAccumulator -= 0.09;
      for (const height of [TABLE_TOP + 36, TABLE_TOP + ROCKET.upperTop - 2]) {
        const a = Math.random() * Math.PI * 2;
        const p = new THREE.Vector3(PAD.x + Math.cos(a) * 1.9, height + Math.random() * 3, PAD.z + Math.sin(a) * 1.9);
        const v = new THREE.Vector3(Math.cos(a) * 1.5, -1.2 - Math.random(), Math.sin(a) * 1.5);
        this.smoke.emit(p, v, { life: 3.5 + Math.random() * 2, size: 1.2, growth: 2.2, drag: 0.4, rise: -0.2, shade: 1.08 });
      }
      if (t < 6 && Math.random() < 0.5) {
        const p = new THREE.Vector3(PAD.x + (Math.random() - 0.5) * 8, 1, PAD.z + (Math.random() - 0.5) * 30);
        this.smoke.emit(p, new THREE.Vector3(0, 1.5, 0), { life: 6, size: 3, growth: 3, drag: 0.6, rise: 0.4, shade: 1.0 });
      }
    }
  }

  private padSmoke(dt: number, strength: number): void {
    const count = Math.floor(strength * 60 * dt + Math.random());
    for (let i = 0; i < count; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const p = new THREE.Vector3(PAD.x + (Math.random() - 0.5) * 6, 1.5 + Math.random() * 2, PAD.z + dir * (24 + Math.random() * 6));
      const v = new THREE.Vector3((Math.random() - 0.5) * 18, 3 + Math.random() * 8, dir * (28 + Math.random() * 24));
      this.smoke.emit(p, v, { life: 16 + Math.random() * 10, size: 7, growth: 9, drag: 0.55, rise: 0.9, shade: 0.95 + Math.random() * 0.08 });
    }
    if (Math.random() < strength * dt * 20) {
      const a = Math.random() * Math.PI * 2;
      const p = new THREE.Vector3(PAD.x + Math.cos(a) * 8, TABLE_TOP, PAD.z + Math.sin(a) * 8);
      this.smoke.emit(p, new THREE.Vector3(Math.cos(a) * 14, 2, Math.sin(a) * 14), { life: 14, size: 6, growth: 7, drag: 0.5, rise: 0.6, shade: 0.9 });
    }
  }

  private trail(dt: number): void {
    const spacing = 0.02;
    this.emitAccumulator += dt;
    while (this.emitAccumulator > spacing) {
      this.emitAccumulator -= spacing;
      const back = this.tmp.set(Math.sin(this.pitch), -Math.cos(this.pitch), 0);
      const p = this.nozzle.clone().addScaledVector(back, 18 + Math.random() * 20);
      p.x += (Math.random() - 0.5) * 3;
      p.z += (Math.random() - 0.5) * 3;
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, -Math.random() * 3, (Math.random() - 0.5) * 3);
      const high = THREE.MathUtils.smoothstep(this.altitude, 300, 3000);
      this.smoke.emit(p, v, { life: 24, size: 5 + high * 6, growth: 4 + high * 5, drag: 0.3, rise: 0.15, shade: 0.88 });
    }
  }

  /** Cinematic launch camera. Returns false when the host should use its normal camera. */
  updateCamera(camera: THREE.PerspectiveCamera, dt: number, elapsed: number): boolean {
    if (this.phase !== "countdown" && this.phase !== "ascent") return false;
    const rocket = this.rocketPosition;
    const t = this.phase === "countdown" ? this.time - COUNTDOWN_SECONDS : this.time;
    const shots: [number, number][] = [[-99, 0], [-6.5, 1], [-1.8, 2], [5.5, 3], [11, 4], [15.5, 5]];
    let shot = 0;
    for (const [start, id] of shots) if (t >= start) shot = id;
    const cut = shot !== this.shotCut;
    this.shotCut = shot;
    let fov = 50;
    const along = (local: THREE.Vector3): THREE.Vector3 => local.clone()
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), -this.pitch).add(rocket);
    switch (shot) {
      case 0: { // Wide establishing shot with a slow push in.
        const k = THREE.MathUtils.smoothstep(this.time, 0, 6);
        this.cameraGoal.set(PAD.x + THREE.MathUtils.lerp(165, 120, k), THREE.MathUtils.lerp(9, 5, k), PAD.z - THREE.MathUtils.lerp(120, 92, k));
        this.lookTarget.set(PAD.x, 44, PAD.z);
        fov = 42;
        break;
      }
      case 1: // Low angle at the base of the table as the engines light.
        this.cameraGoal.set(PAD.x + 26, 2.2, PAD.z - 34);
        this.lookTarget.set(PAD.x, 34, PAD.z);
        fov = 58;
        break;
      case 2: // Ground camera tracks the liftoff.
        this.cameraGoal.set(PAD.x + 105, 3, PAD.z - 78);
        this.lookTarget.copy(rocket).add(new THREE.Vector3(0, 30, 0));
        fov = 46;
        break;
      case 3: { // Long-lens tracking from the press site; the zoom keeps rocket and plume framed.
        this.cameraGoal.set(PAD.x + 340, 8, PAD.z - 160);
        this.lookTarget.copy(along(new THREE.Vector3(0, 8, 0)));
        const range = this.cameraGoal.distanceTo(this.lookTarget);
        fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(95 / range)), 2.5, 26);
        break;
      }
      case 4: // Chase plane slightly below and beside the stack, looking up past it into the darkening sky.
        this.cameraGoal.copy(along(new THREE.Vector3(-34, -12, -48)));
        this.lookTarget.copy(along(new THREE.Vector3(0, 52, 0)));
        fov = 50;
        break;
      default: // Onboard camera on the booster's base looking down the plume at the receding ground.
        this.cameraGoal.copy(along(new THREE.Vector3(3.4, 6, 0.4)));
        this.lookTarget.copy(along(new THREE.Vector3(9, -120, 0.4)));
        fov = 72;
    }
    if (cut || shot >= 4) camera.position.copy(this.cameraGoal);
    else camera.position.lerp(this.cameraGoal, 1 - Math.exp(-dt * 3));
    // Engine rumble shakes the ground cameras; it falls off with distance from the nozzle.
    const level = this.plume.material.uniforms.uIntensity.value / 3.4;
    const distance = camera.position.distanceTo(this.nozzle);
    const shake = level * (shot >= 4 ? 0.12 : 1.1) / (1 + distance / 140);
    camera.position.x += (Math.sin(elapsed * 47) + Math.sin(elapsed * 31.3)) * shake * 0.5;
    camera.position.y += (Math.sin(elapsed * 53.1) + Math.sin(elapsed * 23.7)) * shake * 0.5;
    camera.up.set(0, 1, 0);
    if (shot >= 4) camera.up.set(Math.sin(this.pitch), Math.cos(this.pitch), 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0);
    camera.lookAt(this.lookTarget);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return true;
  }

  drawMap(ctx: CanvasRenderingContext2D, mapPoint: MapPoint, large: boolean, scale: number): void {
    const rect = (minX: number, minZ: number, maxX: number, maxZ: number, color: string): void => {
      const a = mapPoint(minX, minZ), b = mapPoint(maxX, maxZ);
      ctx.fillStyle = color;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };
    rect(SPACEPORT_BOUNDS.minX, 818, SPACEPORT_BOUNDS.maxX, 922, "#b4b1a6");
    rect(722.5, 716, 729.5, 818, "#c9c2a8");
    rect(PAD.x - 5, PAD.z - 29, PAD.x + 5, PAD.z + 29, "#3b3936");
    rect(TOWER.x - 4, TOWER.z - 4, TOWER.x + 4, TOWER.z + 4, "#2d3236");
    const p = mapPoint(PAD.x, PAD.z);
    ctx.fillStyle = this.phase === "idle" ? "#ffffff" : "#ff9b4a";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 / scale, 0, Math.PI * 2);
    ctx.fill();
    if (large) {
      ctx.font = `${12 / scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#e8f1ff";
      ctx.fillText("RYMDCENTER · E VID TORNET", p.x - 40, p.y + 70 / scale);
    }
  }
}
