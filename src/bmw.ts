import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

type Point = [number, number, number];

function label(text: string, badge = false): THREE.MeshBasicMaterial {
  if (typeof document === "undefined") return new THREE.MeshBasicMaterial({ color: 0xdce8f0 });
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = badge ? 512 : 128;
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext("2d");
  } catch (error) {
    throw new Error(`BMW procedural labels require a working 2D canvas: ${String(error)}`);
  }
  if (!ctx) throw new Error("BMW procedural labels could not create a 2D canvas context.");
  if (badge) {
    ctx.fillStyle = "#c7d6e1";
    ctx.beginPath();
    ctx.arc(256, 256, 250, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#071019";
    ctx.beginPath();
    ctx.arc(256, 256, 229, 0, Math.PI * 2);
    ctx.fill();
    // Original geometric identifier, not a downloaded manufacturer emblem.
    for (let sector = 0; sector < 4; sector++) {
      ctx.fillStyle = sector % 2 ? "#f5f9ff" : "#1685e5";
      ctx.beginPath();
      ctx.moveTo(256, 290);
      ctx.arc(256, 290, 148, sector * Math.PI / 2, (sector + 1) * Math.PI / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 100px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 123);
  } else {
    ctx.fillStyle = "#0a1019";
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = "#647b91";
    ctx.lineWidth = 7;
    ctx.strokeRect(5, 5, 502, 118);
    ctx.fillStyle = "#ecf6ff";
    ctx.font = "bold 74px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 68);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return new THREE.MeshBasicMaterial({ map, transparent: badge });
}

/** Original BMW-inspired coupe; metres, +Z forward, ground at Y=0. No physics or speed claim. */
export function createBmw(): { body: THREE.Group; wheels: THREE.Mesh[] } {
  const body = new THREE.Group();
  body.name = "BMW-inspired procedural sports coupe";
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0x0756a8, metalness: 0.78, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.16,
  });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x111722, roughness: 0.38, metalness: 0.35 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.94 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.84 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xb2c4d4, metalness: 0.92, roughness: 0.22 });
  const rotor = new THREE.MeshStandardMaterial({ color: 0x65727d, metalness: 0.82, roughness: 0.46 });
  const red = new THREE.MeshStandardMaterial({ color: 0xba252d, roughness: 0.42, metalness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x7794af, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.30,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const led = new THREE.MeshStandardMaterial({
    color: 0xe7f7ff, emissive: 0xafdfff, emissiveIntensity: 2.6, roughness: 0.18,
  });
  const tail = new THREE.MeshStandardMaterial({
    color: 0xe32339, emissive: 0xff0c23, emissiveIntensity: 1.6, roughness: 0.24,
  });
  const badgeMaterial = label("BMW", true);
  const plateMaterial = label("BMW");

  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = body): THREE.Mesh {
    const part = new THREE.Mesh(geometry, material);
    part.castShadow = material !== glass && material !== badgeMaterial && material !== plateMaterial;
    part.receiveShadow = true;
    parent.add(part);
    return part;
  }

  function box(w: number, h: number, d: number, x: number, y: number, z: number,
    material: THREE.Material, radius = 0.025, parent: THREE.Object3D = body): THREE.Mesh {
    const part = mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)), material, parent);
    part.position.set(x, y, z);
    return part;
  }

  function panel(points: Point[], material: THREE.Material): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    return mesh(geometry, material);
  }

  function bar(a: Point, b: Point, radius: number, material: THREE.Material): THREE.Mesh {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const part = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material);
    part.position.copy(start.add(end).multiplyScalar(0.5));
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return part;
  }

  function badge(x: number, y: number, z: number, radius: number, tilt: number): void {
    const part = mesh(new THREE.CircleGeometry(radius, 48), badgeMaterial);
    part.position.set(x, y, z);
    part.rotation.x = tilt;
  }

  // The narrow central tub and cut-out outer wings leave genuine clearance around all four tyres.
  box(1.48, 0.49, 4.48, 0, 0.515, 0, paint, 0.10);
  const wing = new THREE.Shape();
  wing.moveTo(-2.35, 0.24);
  wing.lineTo(-2.35, 0.70);
  wing.lineTo(-1.98, 0.85);
  wing.lineTo(-0.9, 0.88);
  wing.lineTo(0.72, 0.85);
  wing.lineTo(1.65, 0.82);
  wing.lineTo(2.35, 0.69);
  wing.lineTo(2.35, 0.24);
  for (const axle of [1.43, -1.40]) {
    wing.lineTo(axle + 0.43, 0.24);
    wing.lineTo(axle + 0.43, 0.36);
    for (let segment = 1; segment <= 24; segment++) {
      const angle = segment / 24 * Math.PI;
      wing.lineTo(axle + Math.cos(angle) * 0.43, 0.36 + Math.sin(angle) * 0.43);
    }
    wing.lineTo(axle - 0.43, 0.24);
  }
  wing.closePath();
  const wingGeometry = new THREE.ExtrudeGeometry(wing, { depth: 0.225, bevelEnabled: false, steps: 1 });
  wingGeometry.rotateY(-Math.PI / 2);
  for (const side of [-1, 1]) {
    const part = mesh(wingGeometry, paint);
    part.position.x = side === 1 ? 0.975 : -0.75;
    box(0.12, 0.11, 1.92, side * 0.92, 0.235, 0.015, carbon);
    box(0.025, 0.025, 1.78, side * 0.985, 0.285, 0.015, paint, 0.01);
    box(0.026, 0.035, 0.22, side * 0.985, 0.79, -0.36, silver, 0.01);
    box(0.032, 0.08, 0.30, side * 0.982, 0.69, 0.86, carbon, 0.015);
    for (let vent = 0; vent < 3; vent++) {
      box(0.036, 0.013, 0.24, side * 0.985, 0.665 + vent * 0.025, 0.86, silver, 0.004);
    }
    bar([side * 0.984, 0.33, -0.67], [side * 0.984, 0.79, -0.67], 0.006, carbon);
  }
  const hood = panel([[-0.75, 0.77, 2.24], [0.75, 0.77, 2.24], [0.75, 0.88, 0.64], [-0.75, 0.88, 0.64]], paint);
  hood.name = "sculpted long bonnet";
  for (const side of [-1, 1]) {
    bar([side * 0.43, 0.797, 1.98], [side * 0.53, 0.883, 0.71], 0.015, paint);
  }
  box(1.61, 0.13, 0.76, 0, 0.805, -1.91, paint, 0.055);
  box(1.88, 0.27, 0.22, 0, 0.46, 2.265, paint, 0.055);
  box(1.92, 0.08, 0.42, 0, 0.235, 2.19, carbon);
  box(1.88, 0.28, 0.24, 0, 0.465, -2.26, paint, 0.05);
  box(1.86, 0.14, 0.39, 0, 0.255, -2.205, carbon);

  // Low, open cabin: glazing is separate from the seats and trim, not an opaque solid block.
  box(1.46, 0.09, 1.80, 0, 0.735, -0.31, carbon);
  box(1.29, 0.07, 1.00, 0, 1.365, -0.29, carbon, 0.035);
  panel([[-0.76, 0.86, 0.69], [0.76, 0.86, 0.69], [0.63, 1.33, 0.21], [-0.63, 1.33, 0.21]], glass);
  panel([[0.76, 0.86, -1.51], [-0.76, 0.86, -1.51], [-0.63, 1.33, -0.79], [0.63, 1.33, -0.79]], glass);
  for (const side of [-1, 1]) {
    const frontLow: Point = [side * 0.77, 0.86, 0.66];
    const frontTop: Point = [side * 0.64, 1.33, 0.21];
    const rearTop: Point = [side * 0.64, 1.33, -0.79];
    const rearLow: Point = [side * 0.77, 0.87, -1.48];
    panel([frontLow, rearLow, rearTop, frontTop], glass);
    bar(frontLow, frontTop, 0.036, paint);
    bar(rearTop, rearLow, 0.060, paint);
    bar(frontTop, rearTop, 0.026, silver);
    bar(frontLow, rearLow, 0.023, carbon);
    bar([side * 0.77, 0.87, -0.61], [side * 0.64, 1.33, -0.61], 0.021, carbon);
    bar([side * 0.77, 0.92, 0.45], [side * 1.00, 0.99, 0.43], 0.025, carbon);
    box(0.22, 0.105, 0.27, side * 0.99, 1.00, 0.41, carbon, 0.045);
    box(0.15, 0.060, 0.012, side * 1.00, 1.004, 0.269, silver, 0.015);
    box(0.17, 0.014, 0.016, side * 1.00, 1.005, 0.548, led, 0.006);
    box(0.47, 0.13, 0.48, side * 0.38, 0.80, -0.19, leather, 0.06);
    const seat = box(0.47, 0.43, 0.14, side * 0.38, 1.00, -0.46, leather, 0.055);
    seat.rotation.x = -0.13;
    box(0.23, 0.16, 0.13, side * 0.38, 1.255, -0.49, carbon, 0.045);
    for (const edge of [-1, 1]) {
      box(0.045, 0.34, 0.18, side * 0.38 + edge * 0.20, 0.99, -0.415, paint, 0.02);
    }
  }
  box(1.38, 0.16, 0.24, 0, 0.90, 0.49, carbon, 0.04);
  box(0.20, 0.17, 0.72, 0, 0.82, -0.10, carbon, 0.035);
  box(0.26, 0.12, 0.022, 0, 1.02, 0.41, silver, 0.012);
  box(0.23, 0.095, 0.025, 0, 1.02, 0.394, carbon, 0.008);
  const steering = mesh(new THREE.TorusGeometry(0.135, 0.016, 8, 24), carbon);
  steering.position.set(-0.38, 1.035, 0.27);
  steering.rotation.x = -0.3;
  bar([-0.50, 1.035, 0.27], [-0.26, 1.035, 0.27], 0.013, silver);
  box(0.08, 0.055, 0.03, -0.38, 1.035, 0.27, carbon);

  // Paired kidney openings, separated by a painted centre spine.
  for (const side of [-1, 1]) {
    box(0.41, 0.34, 0.056, side * 0.235, 0.615, 2.344, silver, 0.095);
    box(0.36, 0.29, 0.060, side * 0.235, 0.615, 2.35, carbon, 0.078);
    for (let slat = 0; slat < 5; slat++) {
      box(0.014, 0.225, 0.018, side * 0.235 + (slat - 2) * 0.055, 0.615, 2.386, silver, 0.005);
    }
    box(0.38, 0.14, 0.035, side * 0.702, 0.696, 2.327, carbon, 0.04);
    box(0.34, 0.024, 0.015, side * 0.702, 0.734, 2.351, led, 0.008);
    for (const offset of [-0.085, 0.085]) {
      box(0.12, 0.017, 0.020, side * 0.702 + offset, 0.666, 2.351, led, 0.006);
      box(0.017, 0.060, 0.020, side * 0.702 + offset - side * 0.052, 0.69, 2.351, led, 0.006);
    }
    box(0.34, 0.14, 0.024, side * 0.695, 0.414, 2.381, carbon, 0.028);
    for (let fin = 0; fin < 3; fin++) {
      box(0.29, 0.012, 0.030, side * 0.695, 0.377 + fin * 0.036, 2.385, rotor, 0.004);
    }
    box(0.60, 0.096, 0.025, side * 0.58, 0.709, -2.357, carbon, 0.025);
    box(0.55, 0.023, 0.014, side * 0.58, 0.729, -2.374, tail, 0.009);
    box(0.32, 0.020, 0.016, side * 0.685, 0.681, -2.374, tail, 0.008);
    box(0.023, 0.061, 0.016, side * 0.845, 0.704, -2.374, tail, 0.008);
    box(0.045, 0.17, 0.29, side * 0.56, 0.947, -2.04, carbon, 0.012);
    for (const offset of [-0.075, 0.075]) {
      const pipe = mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.18, 16, 1, true), silver);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(side * 0.68 + offset, 0.28, -2.30);
      const opening = mesh(new THREE.CircleGeometry(0.049, 16), carbon);
      opening.rotation.y = Math.PI;
      opening.position.set(side * 0.68 + offset, 0.28, -2.389);
    }
  }
  box(1.76, 0.055, 0.27, 0, 1.045, -2.04, carbon, 0.023);
  for (let fin = -2; fin <= 2; fin++) {
    box(0.025, 0.10, 0.35, fin * 0.18, 0.215, -2.19, carbon, 0.005);
  }
  badge(0, 0.813, 2.04, 0.089, -Math.PI / 2 + 0.068);
  badge(0, 0.745, -2.372, 0.072, Math.PI);
  const frontPlate = mesh(new THREE.PlaneGeometry(0.40, 0.10), plateMaterial);
  frontPlate.position.set(0, 0.367, 2.392);
  const rearPlate = mesh(new THREE.PlaneGeometry(0.43, 0.11), plateMaterial);
  rearPlate.position.set(0, 0.487, -2.386);
  rearPlate.rotation.y = Math.PI;

  const wheels: THREE.Mesh[] = [];
  const tyreGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 48);
  for (const side of [-1, 1]) {
    for (const axle of [-1.40, 1.43]) {
      const wheel = mesh(tyreGeometry, rubber);
      wheel.name = `${axle > 0 ? "front" : "rear"}-${side < 0 ? "left" : "right"} wheel`;
      wheel.position.set(side * 0.825, 0.36, axle);
      // Keep the cylinder's local Y axle: City spins these with rotateY(-travel / radius).
      wheel.rotation.z = Math.PI / 2;
      wheel.userData.radius = 0.36;
      wheels.push(wheel);
      const out = -side;
      const disk = mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.017, 32), rotor, wheel);
      disk.position.y = out * 0.142;
      const rim = mesh(new THREE.TorusGeometry(0.285, 0.016, 8, 40), silver, wheel);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = out * 0.147;
      const innerRim = mesh(new THREE.TorusGeometry(0.25, 0.009, 6, 32), carbon, wheel);
      innerRim.rotation.x = Math.PI / 2;
      innerRim.position.y = out * 0.151;
      for (let spoke = 0; spoke < 5; spoke++) {
        for (const split of [-1, 1]) {
          const angle = spoke / 5 * Math.PI * 2 + split * 0.11;
          const arm = box(0.028, 0.024, 0.225, Math.sin(angle) * 0.162, out * 0.155,
            Math.cos(angle) * 0.162, silver, 0.009, wheel);
          arm.rotation.y = angle;
        }
        const angle = spoke / 5 * Math.PI * 2;
        const bolt = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.018, 8), silver, wheel);
        bolt.position.set(Math.sin(angle) * 0.043, out * 0.174, Math.cos(angle) * 0.043);
      }
      const hub = mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.027, 24), carbon, wheel);
      hub.position.y = out * 0.156;
      const cap = mesh(new THREE.CircleGeometry(0.035, 24), badgeMaterial, wheel);
      cap.rotation.x = -out * Math.PI / 2;
      cap.position.y = out * 0.181;
      for (let groove = 0; groove < 3; groove++) {
        const tread = mesh(new THREE.TorusGeometry(0.358, 0.002, 4, 48), carbon, wheel);
        tread.rotation.x = Math.PI / 2;
        tread.position.y = (groove - 1) * 0.064;
      }
      // Brake calipers remain fixed to the car rather than spinning with the rim.
      box(0.040, 0.13, 0.10, side * 0.954, 0.40, axle - 0.17, red, 0.02);
    }
  }
  return { body, wheels };
}
