import * as THREE from "three";

export type CapsuleInterior = {
  group: THREE.Group;
  /** Pilot eye point in capsule coordinates (metres, +Y toward the nose window). */
  eye: THREE.Vector3;
  screen: { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture };
};

function canvasTexture(width: number, height: number): { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kapselns interiör kräver en 2D-canvas.");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { ctx, texture };
}

/** Padded wall panels with seams, handrails, stowage straps and small stencils. */
function wallTexture(): THREE.CanvasTexture {
  const { ctx, texture } = canvasTexture(1024, 512);
  ctx.fillStyle = "#8f979f";
  ctx.fillRect(0, 0, 1024, 512);
  for (let x = 0; x < 1024; x += 128) {
    for (const [y0, y1] of [[0, 170], [170, 350], [350, 512]]) {
      const gradient = ctx.createLinearGradient(x, y0, x + 128, y1);
      gradient.addColorStop(0, "rgba(255,255,255,0.18)");
      gradient.addColorStop(1, "rgba(0,0,0,0.12)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x + 4, y0 + 4, 120, y1 - y0 - 8);
    }
    ctx.fillStyle = "rgba(60,68,78,0.55)";
    ctx.fillRect(x, 0, 3, 512);
  }
  ctx.fillRect(0, 170, 1024, 3);
  ctx.fillRect(0, 350, 1024, 3);
  for (let x = 40; x < 1024; x += 256) {
    ctx.fillStyle = "#3a5f8f";
    ctx.fillRect(x, 220, 46, 60);
    ctx.fillStyle = "#e3b33b";
    ctx.fillRect(x + 120, 300, 90, 12);
    ctx.fillStyle = "#2b3138";
    ctx.font = "600 15px monospace";
    ctx.fillText(["O₂ PANEL", "CO₂ SCRUB", "STOWAGE B", "FIRE EXT"][x / 256 | 0], x, 205);
  }
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material,
  x = 0, y = 0, z = 0, shadows = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = shadows;
  parent.add(mesh);
  return mesh;
}

/** Three-seat cockpit inside the crew capsule, built in capsule coordinates (metres). */
export function createCapsuleInterior(): CapsuleInterior {
  const group = new THREE.Group();
  group.name = "Kapselns interiör";
  const eye = new THREE.Vector3(0, 1.27, 0.2);
  const wall = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.82, side: THREE.BackSide });
  (wall.map as THREE.Texture).repeat.set(5, 1);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2027, roughness: 0.55, metalness: 0.4 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6, metalness: 0.5 });
  const fabric = new THREE.MeshStandardMaterial({ color: 0x252b33, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2f6fb5, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.7, metalness: 0.05 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x1a1408, metalness: 0.9, roughness: 0.08, clearcoat: 1 });

  // Inner pressure shell and floor bulkhead; the shell stops at the windshield ring.
  const shell = new THREE.LatheGeometry([[1.72, 0.06], [1.66, 0.35], [1.33, 1.4], [0.99, 2.42]]
    .map(([r, y]) => new THREE.Vector2(r, y)), 72);
  addMesh(group, shell, wall);
  addMesh(group, new THREE.CircleGeometry(1.72, 72), new THREE.MeshStandardMaterial({ color: 0x5b636c, roughness: 0.9 }), 0, 0.06, 0)
    .rotation.x = -Math.PI / 2;

  // Windshield: frame ring, two mullions dividing it into three panes, and faintly reflective glass.
  addMesh(group, new THREE.TorusGeometry(0.99, 0.045, 10, 72), frame, 0, 2.42, 0).rotation.x = Math.PI / 2;
  for (const x of [-0.42, 0.42]) {
    addMesh(group, new THREE.BoxGeometry(0.04, 0.035, 2 * Math.sqrt(0.99 ** 2 - x * x)), frame, x, 2.43, 0);
  }
  const glass = addMesh(group, new THREE.CircleGeometry(0.99, 72), new THREE.MeshPhysicalMaterial({
    color: 0xbfd6ff, transparent: true, opacity: 0.06, roughness: 0.04, metalness: 0, depthWrite: false,
  }), 0, 2.445, 0, false);
  glass.rotation.x = Math.PI / 2;

  // Flight display and console, angled toward the pilot's eyes. Ship "up" is capsule -Z.
  const dash = new THREE.Group();
  dash.position.set(0, 1.98, 0.62);
  dash.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, dash.position, new THREE.Vector3(0, 0, -1)));
  group.add(dash);
  addMesh(dash, new THREE.BoxGeometry(0.86, 0.4, 0.05), dark);
  const screen = canvasTexture(1024, 440);
  addMesh(dash, new THREE.PlaneGeometry(0.8, 0.344), new THREE.MeshBasicMaterial({ map: screen.texture, color: 0x9aa6b0 }), 0, 0.01, 0.027, false);
  addMesh(dash, new THREE.BoxGeometry(0.96, 0.14, 0.18), dark, 0, -0.27, -0.05);
  const lamps = [0x3cff7a, 0x3cff7a, 0xffb02e, 0x3cff7a, 0x5ab4ff, 0xff4636, 0x3cff7a, 0xffb02e, 0x5ab4ff, 0x3cff7a, 0x3cff7a, 0xffb02e];
  lamps.forEach((color, i) => {
    addMesh(dash, new THREE.BoxGeometry(0.05, 0.035, 0.02), new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: color, emissiveIntensity: 1.6,
    }), -0.33 + i * 0.06, -0.25, 0.04, false);
  });
  for (const side of [-1, 1]) {
    const grip = addMesh(dash, new THREE.CylinderGeometry(0.025, 0.03, 0.16, 12), dark, side * 0.4, -0.4, 0.12);
    grip.rotation.x = Math.PI / 2.4;
    addMesh(dash, new THREE.SphereGeometry(0.035, 12, 8), accent, side * 0.4, -0.37, 0.19);
  }

  // Three seats in a row; the pilot sits in the middle, with two helmeted crewmates beside them.
  for (const x of [-0.78, 0, 0.78]) {
    const seat = new THREE.Group();
    seat.position.x = x;
    seat.rotation.y = -x * 0.25;
    group.add(seat);
    addMesh(seat, new THREE.BoxGeometry(0.5, 0.07, 0.85), fabric, 0, 1.06, 0.53);
    addMesh(seat, new THREE.BoxGeometry(0.32, 0.09, 0.22), fabric, 0, 1.08, 0.0);
    addMesh(seat, new THREE.BoxGeometry(0.5, 0.46, 0.07), fabric, 0, 1.31, 0.96);
    for (const side of [-1, 1]) {
      addMesh(seat, new THREE.BoxGeometry(0.05, 0.14, 0.8), accent, side * 0.26, 1.12, 0.53);
      addMesh(seat, new THREE.CylinderGeometry(0.02, 0.02, 0.9, 8), frame, side * 0.22, 0.65, 0.95);
    }
    if (x !== 0) {
      // Crewmate lying back in the seat: suited torso with shoulders, then the helmet near the headrest.
      addMesh(seat, new THREE.CapsuleGeometry(0.15, 0.32, 6, 16), white, 0, 1.25, 0.55).rotation.x = Math.PI / 2;
      addMesh(seat, new THREE.CapsuleGeometry(0.07, 0.3, 6, 12), white, 0, 1.24, 0.69).rotation.z = Math.PI / 2;
      addMesh(seat, new THREE.SphereGeometry(0.15, 24, 16), white, 0, 1.3, 0.86);
      const shield = addMesh(seat, new THREE.SphereGeometry(0.152, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), visor, 0, 1.31, 0.85);
      shield.rotation.x = -Math.PI / 2 - 0.5;
    }
  }

  // Side consoles with status strips along the walls.
  for (const side of [-1, 1]) {
    const console = addMesh(group, new THREE.BoxGeometry(0.16, 0.55, 0.42), dark, side * 1.05, 1.75, 0.55);
    console.rotation.z = side * 0.3;
    addMesh(console, new THREE.BoxGeometry(0.01, 0.4, 0.05), new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: side < 0 ? 0x5ab4ff : 0x3cff7a, emissiveIntensity: 1.2,
    }), -side * 0.085, 0, 0, false);
  }

  return { group, eye, screen };
}
