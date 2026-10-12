import * as THREE from "three";
import { ROCKET, SmokeSystem, createPlume, createRocket } from "./rocket";
import type { Plume, RocketParts } from "./rocket";

type Drift = { object: THREE.Object3D; velocity: THREE.Vector3; spin: THREE.Vector3 };
export type IntroCamera = { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number };

const KM = 0.001;
export const INTRO_SECONDS = 17;

/**
 * Orbit insertion played out in the orbital frame (km): MECO, staging, second-stage burn,
 * escape-tower and fairing jettison, SECO, spacecraft separation and solar-array deployment.
 */
export class LaunchIntro {
  readonly group = new THREE.Group();
  time = 0;
  caption = "";
  private readonly stack = new THREE.Group();
  private readonly rocket: RocketParts;
  private readonly boosterPlume: Plume;
  private readonly upperPlume: Plume;
  private readonly towerPlumes: Plume[] = [];
  private readonly drifts: Drift[] = [];
  private readonly puffs: SmokeSystem;
  private readonly direction = new THREE.Vector3(0, Math.sin(0.26), Math.cos(0.26));
  private stackSpeed = 0;
  private events = new Set<string>();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly ship: THREE.Group, private readonly wings: THREE.Object3D[], smoke: THREE.Texture) {
    this.group.name = "Uppskjutning i omloppsbana";
    this.rocket = createRocket();
    this.stack.scale.setScalar(KM);
    this.stack.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.direction);
    this.stack.add(this.rocket.root);
    this.group.add(this.stack);
    this.boosterPlume = createPlume({ r0: 1.75, r1: 30, length: 120, core: 0xfff0d0, outer: 0xff9a50, soft: 1.25 });
    this.rocket.booster.add(this.boosterPlume.mesh);
    this.upperPlume = createPlume({ r0: 1.45, r1: 22, length: 85, core: 0xffeedd, outer: 0xd0784a, soft: 1.4 });
    this.upperPlume.mesh.position.y = ROCKET.mvacExit;
    this.rocket.upper.add(this.upperPlume.mesh);
    const towerBase = ROCKET.fairingTop + 5.3 + 2.35;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const plume = createPlume({ r0: 0.17, r1: 2.2, length: 16, core: 0xffffff, outer: 0xffb060, soft: 1.3 });
      plume.mesh.position.set(Math.cos(a) * 0.5, towerBase, Math.sin(a) * 0.5);
      plume.mesh.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
      this.rocket.escapeTower.add(plume.mesh);
      this.towerPlumes.push(plume);
    }
    this.puffs = new SmokeSystem(smoke, 160);
    this.group.add(this.puffs.group);
  }

  get done(): boolean { return this.time >= INTRO_SECONDS; }

  /** Ensures the stack and spacecraft start in launch configuration. */
  start(): void {
    this.time = 0;
    this.events.clear();
    this.stackSpeed = 0;
    this.stack.position.set(0, 0, 0);
    for (const drift of this.drifts) drift.object.removeFromParent();
    this.drifts.length = 0;
    this.ship.visible = false;
    for (const wing of this.wings) wing.rotation.z = 0;
    this.boosterPlume.material.uniforms.uIntensity.value = 0.85;
    this.upperPlume.material.uniforms.uIntensity.value = 0;
    for (const plume of this.towerPlumes) plume.material.uniforms.uIntensity.value = 0;
    this.rocket.engineGlow.emissiveIntensity = 3;
  }

  private once(name: string, at: number, action: () => void): void {
    if (this.time >= at && !this.events.has(name)) {
      this.events.add(name);
      action();
    }
  }

  private release(object: THREE.Object3D, velocity: THREE.Vector3, spin: THREE.Vector3): void {
    this.group.attach(object);
    this.drifts.push({ object, velocity, spin });
  }

  private along(meters: number): THREE.Vector3 {
    return this.stack.position.clone().addScaledVector(this.direction, meters * KM);
  }

  private puff(meters: number, count: number, spread = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).applyQuaternion(this.stack.quaternion);
      const p = this.along(meters).addScaledVector(out, ROCKET.radius * KM);
      this.puffs.emit(p, out.multiplyScalar(0.008 * spread), { life: 1.3, size: 0.001, growth: 0.004, drag: 0.6, rise: 0, shade: 0.85, opacity: 0.32 });
    }
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    for (const plume of [this.boosterPlume, this.upperPlume, ...this.towerPlumes]) plume.material.uniforms.uTime.value += dt;
    this.caption = t < 3 ? "T+02:31 · 68 km · Första steget brinner för fullt"
      : t < 3.6 ? "MECO · Huvudmotorerna stängs av"
        : t < 4.4 ? "Stegseparation"
          : t < 8 ? "Andra stegets vakuummotor tänds"
            : t < 9.8 ? "Räddningstornet släpps"
              : t < 11.8 ? "Nyttolastkåpan delas och faller bort"
                : t < 12.6 ? "SECO · Omloppsbana nådd · 7,67 km/s"
                  : t < INTRO_SECONDS - 1 ? "Rymdfarkosten separerar · Solpanelerna fälls ut"
                    : "Välkommen till omloppsbanan";

    const booster = this.boosterPlume.material.uniforms.uIntensity;
    if (t > 3) booster.value = Math.max(0, booster.value - dt * 5);
    this.rocket.engineGlow.emissiveIntensity = booster.value * 2;
    this.once("separation", 3.6, () => {
      this.release(this.rocket.booster, this.direction.clone().multiplyScalar(-0.006).add(new THREE.Vector3(0, -0.0012, 0)), new THREE.Vector3(0.12, 0, 0.05));
      this.puff(ROCKET.boosterTop + 2, 30);
    });
    const upper = this.upperPlume.material.uniforms.uIntensity;
    if (t > 4.4 && t < 11.8) upper.value = Math.min(0.7, upper.value + dt * 1.6);
    if (t >= 11.8) upper.value = Math.max(0, upper.value - dt * 4);
    this.rocket.mvacGlow.emissiveIntensity = upper.value * 2.5;
    if (t > 4.4 && t < 11.8) this.stackSpeed += 0.014 * dt;
    this.once("tower", 8, () => {
      this.release(this.rocket.escapeTower, this.direction.clone().multiplyScalar(this.stackSpeed + 0.03).add(new THREE.Vector3(0.004, 0.006, 0)), new THREE.Vector3(0.3, 0, 0.6));
      for (const plume of this.towerPlumes) plume.material.uniforms.uIntensity.value = 1.6;
    });
    if (t > 9.2) for (const plume of this.towerPlumes) plume.material.uniforms.uIntensity.value = Math.max(0, plume.material.uniforms.uIntensity.value - dt * 1.5);
    this.once("fairing", 9.8, () => {
      this.rocket.fairingPanels.forEach((panel, i) => {
        const a = i * Math.PI * 2 / 3 + Math.PI / 3;
        const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).applyQuaternion(this.stack.quaternion);
        const axis = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
        this.release(panel, out.multiplyScalar(0.004).addScaledVector(this.direction, this.stackSpeed), axis.multiplyScalar(-0.5));
      });
      this.puff(ROCKET.upperTop + 1, 24, 0.6);
    });
    this.once("spacecraft", 12.6, () => {
      // Hand over to the player's free-flying spacecraft at exactly the same pose.
      this.rocket.spacecraft.visible = false;
      this.ship.visible = true;
      this.ship.position.copy(this.along(ROCKET.upperTop + 0.4));
      this.ship.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction);
      this.stackSpeed -= 0.003;
      this.puff(ROCKET.upperTop + 0.5, 20, 0.5);
    });
    if (t > 13) {
      const k = THREE.MathUtils.smoothstep(t, 13, 16);
      for (const wing of this.wings) wing.rotation.z = -(Math.PI / 2 - 0.06) * k;
    }
    if (this.events.has("spacecraft")) this.ship.position.addScaledVector(this.direction, 0.0016 * dt);
    this.stack.position.addScaledVector(this.direction, this.stackSpeed * dt);
    for (const drift of this.drifts) {
      drift.object.position.addScaledVector(drift.velocity, dt);
      drift.object.rotateX(drift.spin.x * dt);
      drift.object.rotateY(drift.spin.y * dt);
      drift.object.rotateZ(drift.spin.z * dt);
    }
    this.puffs.update(dt, 1);
  }

  /** Scripted shots in frame-local kilometres. */
  camera(out: IntroCamera): void {
    const t = this.time;
    out.up.set(0, 1, 0);
    const swing = t * 0.004;
    if (t < 4.4) {
      out.position.copy(this.along(8)).add(new THREE.Vector3(0.1 + swing, 0.022, -0.085));
      out.target.copy(this.along(6));
      out.fov = 46;
    } else if (t < 8) {
      const booster = this.drifts[0]?.object.position ?? this.along(0);
      out.position.copy(this.along(20)).add(new THREE.Vector3(0.075, 0.02, -0.05 - (t - 4.4) * 0.006));
      out.target.copy(this.along(30)).lerp(booster, 0.35);
      out.fov = 46;
    } else if (t < 9.8) {
      out.position.copy(this.along(66)).add(new THREE.Vector3(0.03, 0.012, -0.012));
      out.target.copy(this.along(72));
      out.fov = 48;
    } else if (t < 12.6) {
      out.position.copy(this.along(58)).add(new THREE.Vector3(0.026, 0.006, -0.02));
      out.target.copy(this.along(63));
      out.fov = 50;
    } else {
      const k = t - 12.6;
      const orbit = 0.6 + k * 0.12;
      out.position.copy(this.ship.position).add(this.tmp.set(Math.sin(orbit) * 0.022, 0.007, -Math.cos(orbit) * 0.022));
      out.target.copy(this.ship.position);
      out.fov = 50;
    }
  }

  /** Frame-local position of the spacecraft at the end of the sequence. */
  get shipPosition(): THREE.Vector3 { return this.ship.position; }
}
