import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Original two-stage crewed launcher "Nordstjärnan", modelled after the proportions of modern
 * reusable rockets (metres, +Y up, engine exits at Y=0). No real-world markings are reproduced.
 */
export const ROCKET = {
  radius: 1.85,
  boosterTop: 41.9,
  interstageTop: 48.4,
  upperTop: 60,
  fairingTop: 66.2,
  capsuleTop: 69.6,
  height: 77.2,
  mvacExit: 44.2,
} as const;

export type RocketParts = {
  root: THREE.Group;
  booster: THREE.Group;
  upper: THREE.Group;
  fairing: THREE.Group;
  fairingPanels: THREE.Mesh[];
  escapeTower: THREE.Group;
  spacecraft: THREE.Group;
  mvacGlow: THREE.MeshStandardMaterial;
  engineGlow: THREE.MeshStandardMaterial;
};

function canvas(width: number, height: number): { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const ctx = element.getContext("2d");
  if (!ctx) throw new Error("Raketens texturer kräver en 2D-canvas.");
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { ctx, texture };
}

function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function speckle(ctx: CanvasRenderingContext2D, width: number, height: number, amount: number, seed: number): void {
  const image = ctx.getImageData(0, 0, width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const n = (hash(x + seed, y) - 0.5) * amount + (hash(Math.floor(x / 9) + seed, Math.floor(y / 9)) - 0.5) * amount * 0.6;
    image.data[i] = THREE.MathUtils.clamp(image.data[i] + n, 0, 255);
    image.data[i + 1] = THREE.MathUtils.clamp(image.data[i + 1] + n, 0, 255);
    image.data[i + 2] = THREE.MathUtils.clamp(image.data[i + 2] + n, 0, 255);
  }
  ctx.putImageData(image, 0, 0);
}

/** Painted aluminium-lithium tank skin: weld seams, stringer shading, stencils and exhaust soot. */
function stageSkin(lengthM: number, options: { label?: string; soot?: number; flag?: boolean; dark?: boolean; seams?: number }): THREE.CanvasTexture {
  const width = 1024;
  const height = Math.min(4096, Math.round(lengthM * 96 / 4) * 4);
  const { ctx, texture } = canvas(width, height);
  const metersToPx = height / lengthM;
  ctx.fillStyle = options.dark ? "#16171a" : "#f1f1ed";
  ctx.fillRect(0, 0, width, height);
  // Very soft vertical banding reads as the curved stringer panels under the paint.
  for (let x = 0; x < width; x += 32) {
    ctx.fillStyle = options.dark ? `rgba(255,255,255,${0.012 + (x / 32 % 2) * 0.01})` : `rgba(0,0,0,${0.012 + (x / 32 % 2) * 0.012})`;
    ctx.fillRect(x, 0, 16, height);
  }
  speckle(ctx, width, height, options.dark ? 7 : 5, lengthM);
  const seams = options.seams ?? 2.3;
  for (let m = seams; m < lengthM - 0.2; m += seams) {
    const y = height - m * metersToPx;
    ctx.fillStyle = options.dark ? "rgba(255,255,255,0.08)" : "rgba(60,62,66,0.32)";
    ctx.fillRect(0, y, width, 3);
    ctx.fillStyle = options.dark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.7)";
    ctx.fillRect(0, y + 3, width, 2);
  }
  if (options.label) {
    ctx.save();
    ctx.translate(width * 0.5, height * 0.52);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = options.dark ? "#e9ecef" : "#11161d";
    ctx.font = `700 ${Math.round(metersToPx * 1.5)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.letterSpacing = `${Math.round(metersToPx * 0.25)}px`;
    ctx.fillText(options.label, 0, 0);
    ctx.restore();
  }
  if (options.flag) {
    const fx = width * 0.47, fy = height * 0.08, fw = metersToPx * 1.6, fh = metersToPx * 1.0;
    ctx.fillStyle = "#0b5aa8";
    ctx.fillRect(fx, fy, fw, fh);
    ctx.fillStyle = "#f6c90e";
    ctx.fillRect(fx + fw * 0.31, fy, fw * 0.16, fh);
    ctx.fillRect(fx, fy + fh * 0.4, fw, fh * 0.2);
  }
  // Stencils and hazard markings near the base, small enough to read only up close.
  ctx.fillStyle = options.dark ? "#cfd3d6" : "#30353b";
  ctx.font = `600 ${Math.round(metersToPx * 0.18)}px monospace`;
  ctx.fillText("NO STEP · LOX", width * 0.12, height - metersToPx * 1.5);
  ctx.fillText("GSE UMB 2", width * 0.78, height - metersToPx * 2.3);
  if (options.soot) {
    const gradient = ctx.createLinearGradient(0, height, 0, height - options.soot * metersToPx);
    gradient.addColorStop(0, "rgba(28,24,20,0.75)");
    gradient.addColorStop(0.35, "rgba(38,34,30,0.32)");
    gradient.addColorStop(1, "rgba(40,36,32,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 70; i++) {
      const x = hash(i, 4) * width, w = 3 + hash(i, 7) * 18, h = (0.2 + hash(i, 9)) * options.soot * metersToPx;
      const streak = ctx.createLinearGradient(0, height, 0, height - h);
      streak.addColorStop(0, "rgba(25,22,18,0.4)");
      streak.addColorStop(1, "rgba(25,22,18,0)");
      ctx.fillStyle = streak;
      ctx.fillRect(x, height - h, w, h);
    }
  }
  return texture;
}

function roughnessNoise(): THREE.CanvasTexture {
  const { ctx, texture } = canvas(512, 512);
  ctx.fillStyle = "#7a7a7a";
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 46, 3);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function solarCells(): THREE.CanvasTexture {
  const { ctx, texture } = canvas(512, 1024);
  ctx.fillStyle = "#0b1426";
  ctx.fillRect(0, 0, 512, 1024);
  for (let y = 0; y < 1024; y += 32) for (let x = 0; x < 512; x += 32) {
    const shade = 30 + hash(x, y) * 18;
    ctx.fillStyle = `rgb(${shade * 0.35},${shade * 0.55},${shade + 40})`;
    ctx.fillRect(x + 2, y + 2, 28, 28);
    ctx.fillStyle = "rgba(170,190,220,0.18)";
    ctx.fillRect(x + 2, y + 15, 28, 1);
  }
  ctx.fillStyle = "#c9c4b6";
  for (let y = 0; y < 1024; y += 256) ctx.fillRect(0, y, 512, 6);
  ctx.fillRect(0, 0, 6, 1024);
  ctx.fillRect(506, 0, 6, 1024);
  return texture;
}

function goldFoil(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const color = canvas(512, 512);
  const normal = canvas(512, 512);
  normal.texture.colorSpace = THREE.NoColorSpace;
  color.ctx.fillStyle = "#c8962e";
  color.ctx.fillRect(0, 0, 512, 512);
  normal.ctx.fillStyle = "rgb(128,128,255)";
  normal.ctx.fillRect(0, 0, 512, 512);
  // Crinkled multi-layer insulation: random facets with varying tilt.
  for (let i = 0; i < 900; i++) {
    const x = hash(i, 1) * 512, y = hash(i, 2) * 512, r = 6 + hash(i, 3) * 26;
    const a = hash(i, 4) * Math.PI * 2;
    color.ctx.fillStyle = `rgba(${220 + hash(i, 5) * 35},${150 + hash(i, 6) * 60},${40 + hash(i, 7) * 40},0.35)`;
    normal.ctx.fillStyle = `rgba(${Math.round(128 + Math.cos(a) * 70)},${Math.round(128 + Math.sin(a) * 70)},230,0.55)`;
    for (const ctx of [color.ctx, normal.ctx]) {
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.lineTo(x + Math.cos(a + 2.2) * r * 0.8, y + Math.sin(a + 2.2) * r * 0.8);
      ctx.lineTo(x + Math.cos(a + 4.1) * r * 0.9, y + Math.sin(a + 4.1) * r * 0.9);
      ctx.closePath();
      ctx.fill();
    }
  }
  for (const t of [color.texture, normal.texture]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map: color.texture, normal: normal.texture };
}

function capsuleTiles(): THREE.CanvasTexture {
  const { ctx, texture } = canvas(1024, 512);
  ctx.fillStyle = "#e4e6e8";
  ctx.fillRect(0, 0, 1024, 512);
  speckle(ctx, 1024, 512, 10, 11);
  ctx.strokeStyle = "rgba(90,95,105,0.45)";
  ctx.lineWidth = 2;
  for (let y = 0; y < 512; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke(); }
  for (let row = 0; row < 8; row++) for (let x = (row % 2) * 32; x < 1024; x += 64) {
    ctx.beginPath(); ctx.moveTo(x, row * 64); ctx.lineTo(x, row * 64 + 64); ctx.stroke();
  }
  ctx.fillStyle = "#1b2430";
  ctx.font = "700 46px 'Helvetica Neue', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("NORDSTJÄRNAN", 512, 300);
  return texture;
}

function lathe(points: [number, number][], segments = 64): THREE.LatheGeometry {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

function bellPoints(exit: number, throat: number, length: number, steps = 18): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Rao-style parabolic contour: steep near the throat, nearly straight at the lip.
    points.push([throat + (exit - throat) * Math.pow(t, 0.62), length * (1 - t)]);
  }
  return points.reverse();
}

function addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material,
  x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function gridFin(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const w = 1.25, h = 1.55, depth = 0.22, bar = 0.035;
  const frame = (bw: number, bh: number, x: number, y: number): void => {
    const g = new THREE.BoxGeometry(bw, bh, depth);
    g.translate(x, y, 0);
    parts.push(g);
  };
  frame(w, 0.07, 0, h / 2); frame(w, 0.07, 0, -h / 2);
  frame(0.07, h, w / 2, 0); frame(0.07, h, -w / 2, 0);
  // Diagonal lattice gives the characteristic waffle silhouette of a titanium grid fin.
  for (let i = -6; i <= 6; i++) {
    for (const dir of [1, -1]) {
      const g = new THREE.BoxGeometry(bar, Math.hypot(w, h) * 1.1, depth * 0.9);
      g.rotateZ(dir * Math.PI / 4);
      g.translate(i * 0.17, 0, 0);
      parts.push(g);
    }
  }
  const merged = mergeGeometries(parts.map(g => g.toNonIndexed()));
  // Clip the diagonal bars to the frame by squashing vertices that overshoot it.
  const p = merged.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, THREE.MathUtils.clamp(p.getX(i), -w / 2, w / 2));
    p.setY(i, THREE.MathUtils.clamp(p.getY(i), -h / 2, h / 2));
  }
  merged.computeVertexNormals();
  return merged;
}

/** Builds the complete launch stack; parts are separate groups so they can stage and separate. */
export function createRocket(): RocketParts {
  const R = ROCKET.radius;
  const root = new THREE.Group();
  root.name = "Nordstjärnan · bärraket";
  const booster = new THREE.Group();
  booster.name = "Första steget";
  const upper = new THREE.Group();
  upper.name = "Andra steget";
  const fairing = new THREE.Group();
  fairing.name = "Nyttolastkåpa";
  const escapeTower = new THREE.Group();
  escapeTower.name = "Räddningstorn";
  root.add(booster, upper, fairing, escapeTower);

  const rough = roughnessNoise();
  const paint = (map: THREE.Texture): THREE.MeshPhysicalMaterial => new THREE.MeshPhysicalMaterial({
    map, roughness: 0.42, roughnessMap: rough, metalness: 0.02, clearcoat: 0.4, clearcoatRoughness: 0.35,
  });
  const boosterPaint = paint(stageSkin(ROCKET.boosterTop - 2.6, { label: "GRÖNVED", soot: 9, flag: true }));
  const upperPaint = paint(stageSkin(ROCKET.upperTop - ROCKET.interstageTop, { label: "NORDSTJÄRNAN", seams: 2.9 }));
  const fairingPaint = paint(stageSkin(ROCKET.fairingTop - ROCKET.upperTop, { seams: 9 }));
  const carbon = new THREE.MeshPhysicalMaterial({
    map: stageSkin(ROCKET.interstageTop - ROCKET.boosterTop, { dark: true, seams: 6.5, label: "N-9" }),
    roughness: 0.5, roughnessMap: rough, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.25,
  });
  const blackMetal = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.55, metalness: 0.6 });
  const titanium = new THREE.MeshStandardMaterial({ color: 0x55585b, roughness: 0.38, metalness: 0.95, roughnessMap: rough });
  const engineGlow = new THREE.MeshStandardMaterial({
    color: 0x3b3430, roughness: 0.32, metalness: 0.9, emissive: 0xff6a1a, emissiveIntensity: 0, side: THREE.DoubleSide,
  });
  const mvacGlow = new THREE.MeshStandardMaterial({
    color: 0x2b2a2c, roughness: 0.28, metalness: 0.85, emissive: 0xff4a12, emissiveIntensity: 0, side: THREE.DoubleSide,
  });
  const copper = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.35, metalness: 0.9 });

  // --- First stage: engines, octaweb skirt, tank, legs, grid fins, interstage.
  const bell = lathe(bellPoints(0.46, 0.16, 1.25), 40);
  const chamber = new THREE.CylinderGeometry(0.2, 0.17, 0.5, 24);
  const enginePositions: [number, number][] = [[0, 0]];
  for (let i = 0; i < 8; i++) enginePositions.push([Math.cos(i / 8 * Math.PI * 2) * 1.3, Math.sin(i / 8 * Math.PI * 2) * 1.3]);
  for (const [x, z] of enginePositions) {
    addMesh(booster, bell, engineGlow, x, 0, z);
    addMesh(booster, chamber, copper, x, 1.5, z);
  }
  addMesh(booster, new THREE.CylinderGeometry(R, R * 1.02, 1.35, 64, 1, true), blackMetal, 0, 1.92, 0);
  const shield = addMesh(booster, new THREE.CircleGeometry(R, 64), blackMetal, 0, 1.25, 0);
  shield.rotation.x = Math.PI / 2;
  addMesh(booster, new THREE.CylinderGeometry(R, R, ROCKET.boosterTop - 2.6, 96, 1, true), boosterPaint, 0, (ROCKET.boosterTop + 2.6) / 2, 0);
  const raceway = new THREE.BoxGeometry(0.2, ROCKET.boosterTop - 4, 0.14);
  addMesh(booster, raceway, upperPaint, Math.cos(0.4) * (R + 0.05), ROCKET.boosterTop / 2 + 1, Math.sin(0.4) * (R + 0.05));
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + i * Math.PI / 2;
    const leg = new THREE.Group();
    leg.position.set(Math.cos(angle) * (R + 0.12), 0, Math.sin(angle) * (R + 0.12));
    leg.rotation.y = -angle;
    booster.add(leg);
    const strut = addMesh(leg, new THREE.BoxGeometry(0.28, 9.6, 0.62), carbon, 0, 6.6, 0);
    strut.name = "Landningsben";
    addMesh(leg, new THREE.BoxGeometry(0.22, 0.9, 1.0), blackMetal, 0.05, 1.75, 0);
    addMesh(leg, new THREE.CylinderGeometry(0.07, 0.07, 6.5, 10), titanium, 0.18, 6.8, 0.2);
  }
  const fin = gridFin();
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    const mesh = addMesh(booster, fin, titanium, Math.cos(angle) * (R + 0.2), ROCKET.boosterTop + 0.9, Math.sin(angle) * (R + 0.2));
    mesh.rotation.y = -angle + Math.PI / 2;
  }
  addMesh(booster, new THREE.CylinderGeometry(R + 0.02, R + 0.02, ROCKET.interstageTop - ROCKET.boosterTop, 96, 1, true),
    carbon, 0, (ROCKET.boosterTop + ROCKET.interstageTop) / 2, 0);

  // --- Second stage with its large vacuum nozzle hidden inside the interstage.
  const mvac = addMesh(upper, lathe(bellPoints(1.45, 0.24, 3.7), 72), mvacGlow, 0, ROCKET.mvacExit, 0);
  mvac.name = "Vakuummotor";
  addMesh(upper, new THREE.CylinderGeometry(0.3, 0.26, 0.6, 24), copper, 0, ROCKET.mvacExit + 3.9, 0);
  addMesh(upper, new THREE.CylinderGeometry(R, R, 0.3, 64), blackMetal, 0, ROCKET.interstageTop - 0.15, 0);
  addMesh(upper, new THREE.CylinderGeometry(R, R, ROCKET.upperTop - ROCKET.interstageTop, 96, 1, true), upperPaint,
    0, (ROCKET.interstageTop + ROCKET.upperTop) / 2, 0);
  addMesh(upper, new THREE.BoxGeometry(0.16, ROCKET.upperTop - ROCKET.interstageTop - 1, 0.12), upperPaint,
    Math.cos(0.4) * (R + 0.04), (ROCKET.interstageTop + ROCKET.upperTop) / 2, Math.sin(0.4) * (R + 0.04));

  // --- Fairing: three separable shells around the service module.
  const fairingHeight = ROCKET.fairingTop - ROCKET.upperTop;
  const fairingPanels: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const geometry = new THREE.CylinderGeometry(R, R, fairingHeight, 40, 1, true, i * Math.PI * 2 / 3 + 0.004, Math.PI * 2 / 3 - 0.008);
    const panel = addMesh(fairing, geometry, fairingPaint, 0, ROCKET.upperTop + fairingHeight / 2, 0);
    fairingPanels.push(panel);
  }
  addMesh(fairing, new THREE.TorusGeometry(R, 0.04, 6, 96), blackMetal, 0, ROCKET.upperTop + 0.05, 0).rotation.x = Math.PI / 2;

  // --- Crew spacecraft (capsule + service module) rides inside the stack.
  const spacecraft = createSpacecraft(false);
  spacecraft.position.y = ROCKET.upperTop + 0.4;
  root.add(spacecraft);

  // --- Launch escape system: ogive cover over the capsule and the slender abort tower.
  const coverPaint = paint(stageSkin(6, { seams: 10 }));
  const cover = addMesh(escapeTower, lathe([
    [R + 0.03, 0], [R + 0.02, 0.4], [1.62, 1.6], [1.25, 2.9], [0.85, 4.0], [0.55, 4.9], [0.42, 5.3],
  ], 72), coverPaint, 0, ROCKET.fairingTop, 0);
  cover.name = "Skyddskåpa";
  const towerBase = ROCKET.fairingTop + 5.3;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const rod = addMesh(escapeTower, new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8), titanium,
      Math.cos(a) * 0.3, towerBase + 1.1, Math.sin(a) * 0.3);
    rod.rotation.set(Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08);
  }
  addMesh(escapeTower, new THREE.CylinderGeometry(0.42, 0.42, 3.0, 40), coverPaint, 0, towerBase + 3.6, 0);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const nozzle = addMesh(escapeTower, new THREE.CylinderGeometry(0.1, 0.17, 0.4, 16, 1, true), blackMetal,
      Math.cos(a) * 0.42, towerBase + 2.35, Math.sin(a) * 0.42);
    nozzle.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
  }
  addMesh(escapeTower, lathe([[0.42, 0], [0.38, 0.6], [0.24, 1.3], [0.06, 1.75], [0.0, 1.85]], 32), blackMetal, 0, towerBase + 5.1, 0);

  root.traverse(object => { if (object instanceof THREE.Mesh) object.frustumCulled = true; });
  return { root, booster, upper, fairing, fairingPanels, escapeTower, spacecraft, mvacGlow, engineGlow };
}

/**
 * Crew capsule with its service module. In flight configuration the four solar wings are deployed,
 * and the gold-foil service module carries the orbital engine and RCS quads.
 */
export function createSpacecraft(deployed = true): THREE.Group {
  const group = new THREE.Group();
  group.name = deployed ? "Nordstjärnan · rymdfarkost" : "Rymdfarkost (hopfälld)";
  const foil = goldFoil();
  const gold = new THREE.MeshPhysicalMaterial({
    map: foil.map, normalMap: foil.normal, normalScale: new THREE.Vector2(0.9, 0.9),
    metalness: 1, roughness: 0.3, color: 0xffffff,
  });
  foil.map.repeat.set(3, 2);
  foil.normal.repeat.set(3, 2);
  const white = new THREE.MeshPhysicalMaterial({ color: 0xe9eaec, roughness: 0.5, metalness: 0.05, clearcoat: 0.2 });
  const tiles = new THREE.MeshPhysicalMaterial({ map: capsuleTiles(), roughness: 0.55, metalness: 0.15, clearcoat: 0.25 });
  const heatShield = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.5, metalness: 0.5 });
  const nozzleMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide });
  const windowMat = new THREE.MeshPhysicalMaterial({ color: 0x070b12, roughness: 0.05, metalness: 0.2, clearcoat: 1 });
  const cells = new THREE.MeshPhysicalMaterial({ map: solarCells(), roughness: 0.42, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.18, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  const panelBack = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.7, metalness: 0.1 });

  // Service module (Y 0..4.2) with radiator stripes, then a short adapter and the capsule.
  addMesh(group, new THREE.CylinderGeometry(1.62, 1.62, 3.4, 64, 1, true), gold, 0, 2.1, 0);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    addMesh(group, new THREE.BoxGeometry(0.42, 3.1, 0.03), white, Math.cos(a) * 1.64, 2.1, Math.sin(a) * 1.64).rotation.y = -a + Math.PI / 2;
  }
  addMesh(group, new THREE.CylinderGeometry(1.66, 1.66, 0.3, 64), white, 0, 3.95, 0);
  addMesh(group, new THREE.CylinderGeometry(1.62, 1.4, 0.4, 64), dark, 0, 0.2, 0);
  const engine = addMesh(group, lathe(bellPoints(0.62, 0.14, 1.3), 48), nozzleMaterial, 0, -1.1, 0);
  engine.name = "Huvudmotor";
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const quad = new THREE.Group();
    quad.position.set(Math.cos(a) * 1.7, 3.2, Math.sin(a) * 1.7);
    quad.rotation.y = -a;
    group.add(quad);
    addMesh(quad, new THREE.BoxGeometry(0.22, 0.34, 0.34), white);
    for (const [dx, dy, dz] of [[0.16, 0, 0], [0, 0.22, 0], [0, -0.22, 0], [0, 0, 0.22], [0, 0, -0.22]]) {
      addMesh(quad, new THREE.ConeGeometry(0.045, 0.1, 8, 1, true), nozzleMaterial, dx, dy, dz).lookAt(dx * 10, dy * 10, dz * 10);
    }
  }
  // Four solar wings: folded flat against the module for launch, spread in an X once in orbit.
  const wings: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const hinge = new THREE.Group();
    hinge.position.set(Math.cos(a) * 1.66, 1.3, Math.sin(a) * 1.66);
    hinge.rotation.y = -a;
    group.add(hinge);
    const wing = new THREE.Group();
    wing.name = "Solpanel";
    hinge.add(wing);
    wings.push(wing);
    if (deployed) wing.rotation.z = -Math.PI / 2 + 0.06;
    else wing.rotation.z = 0;
    for (let s = 0; s < 3; s++) {
      const panel = addMesh(wing, new THREE.BoxGeometry(0.05, 2.25, 1.9), panelBack, 0.03, 1.25 + s * 2.32, 0);
      const face = addMesh(wing, new THREE.PlaneGeometry(1.86, 2.2), cells, 0.06, 1.25 + s * 2.32, 0);
      face.rotation.y = Math.PI / 2;
      panel.castShadow = true;
    }
    addMesh(wing, new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8), white, 0, 0.1, 0);
    wing.visible = deployed;
  }

  const capsule = new THREE.Group();
  capsule.name = "Kapsel";
  capsule.position.y = 4.3;
  group.add(capsule);
  addMesh(capsule, lathe([[0, -0.32], [1.2, -0.28], [1.8, -0.12], [1.86, 0]], 64), heatShield);
  const shellGeometry = lathe([[1.86, 0], [1.78, 0.35], [1.42, 1.4], [1.05, 2.45], [0.82, 3.0], [0.72, 3.1]], 96);
  addMesh(capsule, shellGeometry, tiles);
  const adapter = addMesh(capsule, new THREE.CylinderGeometry(0.62, 0.72, 0.4, 48), white, 0, 3.3, 0);
  const ring = addMesh(capsule, new THREE.TorusGeometry(0.58, 0.07, 10, 48), dark, 0, 3.52, 0);
  ring.rotation.x = Math.PI / 2;
  group.userData.docking = [adapter, ring];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 - Math.PI / 4 + (i > 1 ? 0.35 : 0);
    const win = addMesh(capsule, new THREE.CircleGeometry(0.2, 24), windowMat,
      Math.cos(a) * 1.3, 1.95, Math.sin(a) * 1.3);
    win.lookAt(Math.cos(a) * 3, 1.95 + 1.1, Math.sin(a) * 3);
    win.scale.set(1, 1.4, 1);
  }
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const port = addMesh(capsule, new THREE.BoxGeometry(0.16, 0.16, 0.05), dark, Math.cos(a) * 1.62, 0.9, Math.sin(a) * 1.62);
    port.lookAt(Math.cos(a) * 5, 0.9 + 2.3, Math.sin(a) * 5);
  }
  group.userData.capsule = capsule;
  group.userData.wings = wings;
  return group;
}

const plumeVertex = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uLength;
  uniform float uR0;
  uniform float uR1;
  uniform float uShape;
  varying float vT;
  varying vec3 vObj;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    float t = -position.y;
    float r = mix(uR0, uR1, pow(t, uShape));
    vec3 p = vec3(position.x * r, -t * uLength, position.z * r);
    vT = t;
    vObj = vec3(position.x, t, position.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = mv.xyz;
    vNormalV = normalize(normalMatrix * normalize(vec3(position.x, 0.25 * (uR1 - uR0) / max(uLength, 0.001), position.z)));
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const plumeFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uIntensity;
  uniform float uDiamonds;
  uniform float uLength;
  uniform vec3 uCore;
  uniform vec3 uOuter;
  uniform float uSoft;
  varying float vT;
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
    vec3 viewDir = normalize(-vViewPos);
    float facing = abs(dot(normalize(vNormalV), viewDir));
    float body = pow(facing, uSoft);
    float axial = pow(1.0 - vT, 1.4) * smoothstep(0.0, 0.025, vT);
    vec3 q = vec3(vObj.x * 2.5, vT * uLength * 0.12 - uTime * 9.0, vObj.z * 2.5);
    float n = noise3(q) * 0.55 + noise3(q * 2.3 + 7.0) * 0.3 + noise3(q * 5.1) * 0.15;
    float flicker = 0.78 + 0.35 * n;
    float diamonds = uDiamonds * pow(0.5 + 0.5 * cos(vT * uLength * 1.05), 6.0) * exp(-vT * 4.0);
    float core = pow(facing, 3.0) * exp(-vT * 5.5);
    vec3 color = mix(uOuter, uCore, clamp(core * 1.6 + diamonds, 0.0, 1.0));
    float alpha = clamp(body * axial * flicker * (0.55 + diamonds * 1.5 + core), 0.0, 1.0);
    gl_FragColor = vec4(color * uIntensity * (1.0 + diamonds * 2.0 + core * 2.5), alpha);
  }
`;

export type Plume = { mesh: THREE.Mesh; material: THREE.ShaderMaterial };

/** Additive, animated exhaust volume. Its +Y end is the nozzle exit; it extends down -Y. */
export function createPlume(options: { r0: number; r1: number; length: number; core: number; outer: number; diamonds?: number; soft?: number }): Plume {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 48, 48, true);
  geometry.translate(0, -0.5, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uIntensity: { value: 0 }, uDiamonds: { value: options.diamonds ?? 0 },
      uLength: { value: options.length }, uR0: { value: options.r0 }, uR1: { value: options.r1 },
      uShape: { value: 0.55 }, uCore: { value: new THREE.Color(options.core) }, uOuter: { value: new THREE.Color(options.outer) },
      uSoft: { value: options.soft ?? 1.6 },
    },
    vertexShader: plumeVertex,
    fragmentShader: plumeFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = "Avgasplym";
  return { mesh, material };
}

export function makeSmokeTexture(size = 256): THREE.CanvasTexture {
  const { ctx, texture } = canvas(size, size);
  const image = ctx.createImageData(size, size);
  const noise = (x: number, y: number): number => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), sx),
      THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx), sy);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * 2 - 1, v = y / size * 2 - 1;
    const r = Math.hypot(u, v);
    let f = 0, amp = 0.5, freq = 4;
    for (let o = 0; o < 5; o++) { f += noise(x / size * freq + o * 13, y / size * freq) * amp; amp *= 0.5; freq *= 2; }
    const density = THREE.MathUtils.clamp((1 - r * 1.05) * 1.35 + (f - 0.5) * 0.9, 0, 1);
    const i = (y * size + x) * 4;
    const shade = 175 + f * 80;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = shade;
    image.data[i + 3] = Math.pow(density, 1.5) * 255;
  }
  ctx.putImageData(image, 0, 0);
  return texture;
}

type SmokePuff = {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  growth: number;
  drag: number;
  rise: number;
  base: THREE.Color;
  opacity: number;
  alive: boolean;
};

/** Billowing launch steam, exhaust trail and venting vapour; sprites are recycled from a fixed pool. */
export class SmokeSystem {
  readonly group = new THREE.Group();
  private readonly puffs: SmokePuff[] = [];
  private cursor = 0;
  private readonly glow = new THREE.Color();
  private readonly tmp = new THREE.Color();

  constructor(texture: THREE.Texture, count = 420) {
    this.group.name = "Rök och ånga";
    for (let i = 0; i < count; i++) {
      const material = new THREE.SpriteMaterial({
        map: texture, transparent: true, depthWrite: false, opacity: 0, rotation: i * 2.399, fog: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({
        sprite, velocity: new THREE.Vector3(), age: 0, life: 1, size: 1, growth: 1, drag: 0.5, rise: 0,
        base: new THREE.Color(1, 1, 1), opacity: 0.9, alive: false,
      });
    }
  }

  emit(position: THREE.Vector3, velocity: THREE.Vector3, options: { life: number; size: number; growth: number; drag: number; rise: number; shade: number; opacity?: number }): void {
    const puff = this.puffs[this.cursor];
    this.cursor = (this.cursor + 1) % this.puffs.length;
    puff.alive = true;
    puff.age = 0;
    puff.life = options.life;
    puff.size = options.size;
    puff.growth = options.growth;
    puff.drag = options.drag;
    puff.rise = options.rise;
    puff.base.setScalar(options.shade);
    puff.opacity = options.opacity ?? 0.9;
    puff.velocity.copy(velocity);
    puff.sprite.position.copy(position);
    puff.sprite.visible = true;
    puff.sprite.material.rotation = Math.random() * Math.PI * 2;
  }

  /** `light` is the engine glow position and intensity used to tint nearby smoke orange. */
  update(dt: number, daylight: number, light?: { position: THREE.Vector3; intensity: number }): void {
    this.glow.setRGB(1.0, 0.55, 0.22);
    for (const puff of this.puffs) {
      if (!puff.alive) continue;
      puff.age += dt;
      if (puff.age >= puff.life) {
        puff.alive = false;
        puff.sprite.visible = false;
        continue;
      }
      puff.velocity.multiplyScalar(Math.exp(-puff.drag * dt));
      puff.velocity.y += puff.rise * dt;
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      const t = puff.age / puff.life;
      puff.sprite.scale.setScalar(puff.size + puff.growth * Math.sqrt(puff.age));
      puff.sprite.material.rotation += dt * 0.05;
      const fade = Math.min(1, puff.age * 3) * Math.pow(1 - t, 1.3);
      puff.sprite.material.opacity = fade * puff.opacity;
      const lit = 0.35 + daylight * 0.65;
      this.tmp.copy(puff.base).multiplyScalar(lit);
      if (light && light.intensity > 0) {
        const d = puff.sprite.position.distanceTo(light.position);
        const k = light.intensity * Math.exp(-d / 45);
        this.tmp.r += this.glow.r * k;
        this.tmp.g += this.glow.g * k;
        this.tmp.b += this.glow.b * k;
      }
      puff.sprite.material.color.copy(this.tmp);
    }
  }

  clear(): void {
    for (const puff of this.puffs) { puff.alive = false; puff.sprite.visible = false; }
  }
}
