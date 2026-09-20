import * as THREE from "three";

export { JAIL_SECONDS } from "./police";

type Solid = { x: number; z: number; halfX: number; halfZ: number };

/** A separate, roofless interior; the host owns sentencing and release. */
export class Jail {
  readonly scene = new THREE.Scene();
  readonly spawn = new THREE.Vector3(0, 0, 0);
  private readonly furniture: Solid[] = [];
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);

  constructor() {
    this.scene.name = "Norrhamns polisstation · Väntrum";
    this.scene.background = new THREE.Color(0xc6d2cf);
    this.scene.add(new THREE.HemisphereLight(0xfff4de, 0x778c91, 2.2));
    const daylight = new THREE.DirectionalLight(0xffedca, 2.5);
    daylight.position.set(-3, 8, -5);
    this.scene.add(daylight);
    const cream = new THREE.MeshStandardMaterial({ color: 0xe4dfd0, roughness: 0.9 });
    const floor = new THREE.MeshStandardMaterial({ color: 0xb7bcb1, roughness: 0.85 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x779ca7, roughness: 0.7 });
    const wood = new THREE.MeshStandardMaterial({ color: 0xaf8151, roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9daeb1, metalness: 0.55, roughness: 0.35 });
    const porcelain = new THREE.MeshStandardMaterial({ color: 0xf1f3ec, roughness: 0.24 });
    this.box(0, -0.12, 0, 8.4, 0.24, 10.4, floor);
    for (const x of [-4, 4]) this.box(x, 1.6, 0, 0.2, 3.2, 10.2, cream);
    this.box(0, 1.6, -5, 8, 3.2, 0.2, cream);
    for (const x of [-3, 3]) this.box(x, 1.6, 5, 2, 3.2, 0.2, cream);
    for (const z of [-4.87, 4.87]) this.box(0, 0.55, z, 7.8, 0.12, 0.04, blue);
    for (const x of [-3.87, 3.87]) this.box(x, 0.55, 0, 0.04, 0.12, 9.8, blue);

    // Closed barred door; the full perimeter remains solid for player movement.
    for (const x of [-2, 2]) this.box(x, 1.5, 4.95, 0.16, 3, 0.18, blue);
    for (let x = -1.8; x <= 1.81; x += 0.3) this.box(x, 1.45, 4.95, 0.065, 2.8, 0.065, metal);
    for (const y of [0.12, 1.1, 2.82]) this.box(0, y, 4.95, 4, 0.1, 0.1, metal);
    this.box(1.3, 1.15, 4.82, 0.38, 0.16, 0.12, blue);
    this.sign("NORRHAMNS POLISSTATION", "Väntrum · Dörren öppnas vid frigivning", 0, 3.05, 4.8, Math.PI);

    this.solid(-2.7, 0.6, -1.7, 1.5, 0.2, 3.6, wood);
    this.box(-3.35, 1.05, -1.7, 0.14, 0.9, 3.6, wood);
    for (const z of [-3, -0.4]) for (const x of [-3.1, -2.3]) this.box(x, 0.25, z, 0.12, 0.5, 0.12, metal);
    this.box(-2.65, 0.77, -2.3, 1.1, 0.14, 1.8, blue);
    this.solid(2.75, 0.38, -3.7, 0.85, 0.76, 1.25, porcelain);
    this.box(2.75, 0.96, -4.15, 0.82, 0.72, 0.28, porcelain);
    const seat = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.075, 10, 24), porcelain);
    seat.rotation.x = -Math.PI / 2;
    seat.scale.y = 1.3;
    seat.position.set(2.75, 0.83, -3.55);
    this.scene.add(seat);
    this.box(2.75, 1.33, -4.13, 0.17, 0.035, 0.1, metal);
    this.solid(1.8, 0.65, -3.8, 0.1, 1.3, 2.2, blue);

    const sky = new THREE.MeshBasicMaterial({ color: 0xd9f1fd });
    this.box(0, 2.15, -4.88, 2.8, 1.35, 0.04, sky);
    for (const x of [-1.48, 0, 1.48]) this.box(x, 2.15, -4.83, 0.1, 1.55, 0.12, wood);
    for (const y of [1.4, 2.9]) this.box(0, y, -4.82, 3.05, 0.1, 0.22, wood);
    const sunPatch = new THREE.MeshBasicMaterial({ color: 0xe1dbc0, transparent: true, opacity: 0.45, depthWrite: false });
    this.box(0.2, 0.008, -1.9, 2.7, 0.01, 3, sunPatch);
    this.sign("EN LUGN PAUS", "Sitt gärna en stund · Frigivning efter 60 sekunder", 0, 1.02, -4.84, 0);
  }

  heightAt(_x: number, _z: number): number { return 0; }

  blocked(x: number, z: number, radius = 0.45): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0) return true;
    if (Math.abs(x) + radius >= 3.9 || Math.abs(z) + radius >= 4.9) return true;
    return this.furniture.some(solid => {
      const dx = Math.max(Math.abs(x - solid.x) - solid.halfX, 0);
      const dz = Math.max(Math.abs(z - solid.z) - solid.halfZ, 0);
      return dx * dx + dz * dz <= radius * radius;
    });
  }

  private box(x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material): void {
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private solid(x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material): void {
    this.box(x, y, z, w, h, d, material);
    this.furniture.push({ x, z, halfX: w / 2, halfZ: d / 2 });
  }

  private sign(title: string, subtitle: string, x: number, y: number, z: number, heading: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Kunde inte skapa polisstationens skylt.");
    context.fillStyle = "#264955";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.fillStyle = "#fff6df";
    context.font = "bold 44px sans-serif";
    context.fillText(title, 512, 68);
    context.font = "27px sans-serif";
    context.fillText(subtitle, 512, 126);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 0.67),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    sign.position.set(x, y, z);
    sign.rotation.y = heading;
    this.scene.add(sign);
  }
}
