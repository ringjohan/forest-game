import * as THREE from "three";
import { SWORD_SWING_SECONDS } from "./combat";

const skin = new THREE.MeshStandardMaterial({ color: 0xd7ac83, roughness: 0.85 });
const leather = new THREE.MeshStandardMaterial({ color: 0x49392c, roughness: 0.95 });
const sole = new THREE.MeshStandardMaterial({ color: 0x272820, roughness: 1 });
const hair = new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 1 });
const brass = new THREE.MeshStandardMaterial({ color: 0xc5a66b, metalness: 0.5, roughness: 0.5 });

function part(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export class Character {
  readonly group = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftKnee = new THREE.Group();
  private readonly rightKnee = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly sword = new THREE.Group();
  private readonly backpack = new THREE.Group();
  private sleeping = false;
  private seated = false;
  private equipped = false;
  private swingTime = 0;
  private swingSide = 1;
  private jumpPreparation = 0;
  private landingTime = 0;
  private readonly slashMaterial = new THREE.MeshBasicMaterial({
    color: 0xd7ecdf, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
  });
  private readonly slash = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.6, 28, 1, 0, Math.PI * 0.45), this.slashMaterial);
  private phase = 0;

  constructor(coatColor = 0x647151, backpack = true) {
    const coat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.98 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x686052, roughness: 1 });
    this.group.add(this.body);

    part(this.body, new THREE.CapsuleGeometry(0.26, 0.42, 5, 10), coat, 0, 1.24, 0);
    part(this.body, new THREE.CylinderGeometry(0.29, 0.35, 0.35, 10), coat, 0, 1.02, 0);
    part(this.body, new THREE.CylinderGeometry(0.3, 0.3, 0.07, 10), leather, 0, 1.12, 0);
    part(this.body, new THREE.BoxGeometry(0.1, 0.09, 0.045), brass, 0, 1.12, 0.3);
    part(this.body, new THREE.CylinderGeometry(0.085, 0.1, 0.17, 8), skin, 0, 1.65, 0);
    const head = part(this.body, new THREE.SphereGeometry(0.2, 14, 12), skin, 0, 1.87, 0.015);
    head.scale.set(0.87, 1.12, 0.91);
    part(this.body, new THREE.SphereGeometry(0.045, 8, 6), skin, 0, 1.87, 0.185);
    const haircut = part(
      this.body,
      new THREE.SphereGeometry(0.208, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.57),
      hair, 0, 1.9, -0.014,
    );
    haircut.scale.set(0.94, 1.08, 1.03);
    part(this.body, new THREE.BoxGeometry(0.3, 0.13, 0.09), hair, 0, 1.83, -0.14);
    for (const x of [-0.065, 0.065]) {
      part(this.body, new THREE.SphereGeometry(0.015, 6, 6), sole, x, 1.9, 0.178);
    }

    for (const [leg, knee, side] of [[this.leftLeg, this.leftKnee, -1], [this.rightLeg, this.rightKnee, 1]] as const) {
      leg.position.set(side * 0.145, 0.96, 0);
      this.group.add(leg);
      part(leg, new THREE.CapsuleGeometry(0.1, 0.25, 4, 8), trousers, 0, -0.2, 0);
      knee.position.y = -0.43;
      leg.add(knee);
      part(knee, new THREE.CapsuleGeometry(0.087, 0.17, 4, 8), trousers, 0, -0.11, 0);
      part(knee, new THREE.CylinderGeometry(0.112, 0.1, 0.24, 8), leather, 0, -0.28, 0);
      part(knee, new THREE.BoxGeometry(0.22, 0.16, 0.35), leather, 0, -0.41, 0.065);
      part(knee, new THREE.BoxGeometry(0.23, 0.045, 0.36), sole, 0, -0.495, 0.065);
    }
    for (const [arm, side] of [[this.leftArm, -1], [this.rightArm, 1]] as const) {
      arm.position.set(side * 0.33, 1.48, 0);
      arm.rotation.z = side * 0.08;
      this.body.add(arm);
      part(arm, new THREE.CapsuleGeometry(0.1, 0.32, 4, 8), coat, 0, -0.22, 0);
      part(arm, new THREE.CylinderGeometry(0.085, 0.075, 0.12, 8), leather, 0, -0.46, 0);
      part(arm, new THREE.SphereGeometry(0.079, 8, 8), skin, 0, -0.56, 0);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8d8dc, metalness: 0.8, roughness: 0.25 });
    this.sword.position.set(0, -0.55, 0.1);
    part(this.sword, new THREE.BoxGeometry(0.1, 0.06, 1.05), steel, 0, 0, 0.64);
    part(this.sword, new THREE.BoxGeometry(0.36, 0.08, 0.08), brass, 0, 0, 0.1);
    part(this.sword, new THREE.BoxGeometry(0.08, 0.08, 0.23), leather, 0, 0, -0.05);
    this.rightArm.add(this.sword);
    this.sword.visible = false;
    this.slash.rotation.x = -Math.PI / 2;
    this.slash.position.set(0, 1.1, 0.3);
    this.slash.visible = false;
    this.group.add(this.slash);
    if (backpack) {
      this.body.add(this.backpack);
      const pack = part(this.backpack, new THREE.BoxGeometry(0.47, 0.5, 0.24), leather, 0, 1.32, -0.28);
      pack.rotation.x = -0.07;
      const canvas = new THREE.MeshStandardMaterial({ color: 0xafa58a, roughness: 1 });
      const roll = part(this.backpack, new THREE.CylinderGeometry(0.12, 0.12, 0.55, 10), canvas, 0, 1.62, -0.27);
      roll.rotation.z = Math.PI / 2;
      for (const x of [-0.15, 0.15]) {
        part(this.body, new THREE.BoxGeometry(0.047, 0.51, 0.025), leather, x, 1.37, 0.246);
        part(this.body, new THREE.BoxGeometry(0.048, 0.08, 0.035), brass, x, 1.29, 0.264);
      }
      part(this.backpack, new THREE.BoxGeometry(0.26, 0.19, 0.1), canvas, 0, 1.2, -0.43);
    }
  }

  equipSword(equipped: boolean): void {
    this.equipped = equipped;
    this.sword.visible = equipped && !this.sleeping;
    if (!equipped) {
      this.swingTime = 0;
      this.slash.visible = false;
    }
  }

  setSleeping(sleeping: boolean): void {
    this.sleeping = sleeping;
    this.backpack.visible = !sleeping;
    this.sword.visible = this.equipped && !sleeping;
    this.swingTime = this.jumpPreparation = this.landingTime = 0;
    this.slash.visible = false;
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.leftLeg.position.y = this.rightLeg.position.y = 0.96;
    this.leftLeg.rotation.x = this.rightLeg.rotation.x = 0;
    this.leftKnee.rotation.x = this.rightKnee.rotation.x = 0;
    this.leftArm.rotation.x = this.rightArm.rotation.x = 0;
    this.rightArm.rotation.y = 0;
  }

  attack(): void {
    this.swingTime = SWORD_SWING_SECONDS;
    this.swingSide *= -1;
  }

  setSeated(seated: boolean): void {
    this.seated = seated;
  }

  prepareJump(): void {
    this.jumpPreparation = 0.1;
  }

  land(): void {
    this.landingTime = 0.2;
  }

  update(dt: number, speed: number, elapsed: number, airborne = false, verticalVelocity = 0): void {
    if (this.sleeping) {
      this.body.position.z = Math.sin(elapsed * 2) * 0.008;
      return;
    }
    if (this.seated) {
      this.body.position.y = -0.25 + Math.sin(elapsed * 1.7) * 0.006;
      this.leftLeg.position.y = this.rightLeg.position.y = 0.71;
      this.leftLeg.rotation.x = this.rightLeg.rotation.x = -Math.PI / 2;
      this.leftKnee.rotation.x = this.rightKnee.rotation.x = Math.PI / 2;
      this.leftArm.rotation.x = -0.55;
      this.rightArm.rotation.x = -0.7 + Math.sin(elapsed * 0.8) * 0.12;
      return;
    }
    this.swingTime = Math.max(0, this.swingTime - dt);
    this.jumpPreparation = Math.max(0, this.jumpPreparation - dt);
    this.landingTime = Math.max(0, this.landingTime - dt);
    this.phase += dt * speed * 2.1;
    const stride = Math.min(speed / 5, 1);
    const swing = Math.sin(this.phase) * 0.67 * stride;
    const smoothing = 1 - Math.exp(-dt * 14);
    this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, swing, smoothing);
    this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, -swing, smoothing);
    this.leftKnee.rotation.x = THREE.MathUtils.lerp(this.leftKnee.rotation.x, Math.max(0, -Math.cos(this.phase)) * stride * 0.8, smoothing);
    this.rightKnee.rotation.x = THREE.MathUtils.lerp(this.rightKnee.rotation.x, Math.max(0, Math.cos(this.phase)) * stride * 0.8, smoothing);
    this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, -swing * 0.7, smoothing);
    this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, swing * 0.7, smoothing);
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.035 * stride + Math.sin(elapsed * 2) * 0.009;
    this.body.rotation.z = Math.sin(this.phase) * stride * 0.025;
    this.body.rotation.y = 0;
    this.body.rotation.x = 0;
    this.leftLeg.position.y = this.rightLeg.position.y = 0.96;
    this.rightArm.rotation.y = 0;
    this.slash.visible = this.swingTime > 0 && this.sword.visible;
    if (this.swingTime > 0) {
      const progress = 1 - this.swingTime / SWORD_SWING_SECONDS;
      const sweep = 1 - (1 - Math.min(progress / 0.65, 1)) ** 3;
      const recovery = 1 - THREE.MathUtils.smoothstep(progress, 0.65, 1);
      this.rightArm.rotation.y = this.swingSide * THREE.MathUtils.lerp(-1.3, 1.5, sweep) * recovery;
      this.rightArm.rotation.x = -0.8 * recovery;
      this.body.rotation.y = this.swingSide * Math.sin(progress * Math.PI) * 0.35;
      this.slash.rotation.z = -2.8 + sweep * 1.1;
      this.slash.scale.x = this.swingSide;
      this.slashMaterial.opacity = Math.sin(progress * Math.PI) * 0.45;
    }
    if (airborne || this.jumpPreparation > 0 || this.landingTime > 0) {
      const bend = airborne
        ? THREE.MathUtils.lerp(0.55, 1.25, THREE.MathUtils.clamp((verticalVelocity + 5) / 13, 0, 1))
        : this.jumpPreparation > 0 ? (1 - this.jumpPreparation / 0.1) * 1.1 : this.landingTime / 0.2;
      const drop = 0.96 * (1 - Math.cos(bend / 2));
      this.leftLeg.rotation.x = this.rightLeg.rotation.x = -bend / 2;
      this.leftKnee.rotation.x = this.rightKnee.rotation.x = bend;
      this.leftLeg.position.y = this.rightLeg.position.y = 0.96 - drop;
      this.body.position.y = -drop;
      this.body.rotation.x = bend * 0.1;
      this.leftArm.rotation.x = airborne ? -0.5 : bend * 0.4;
      if (this.swingTime === 0) this.rightArm.rotation.x = this.leftArm.rotation.x;
    }
  }
}
