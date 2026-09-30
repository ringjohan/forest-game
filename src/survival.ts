import * as THREE from "three";
import { World } from "./world";
import { PLAYER_RADIUS, SWORD_COOLDOWN_SECONDS, WEREWOLF_RADIUS } from "./combat";
import { Character } from "./character";
import type { ArrowTarget } from "./archery";
import { TREEHOUSE } from "./treehouse";

export const DAY_SECONDS = 180;
export const NIGHT_SECONDS = 90;

export class Survival {
  time = 0;
  health = 100;
  equipped = false;
  private attackCooldown = 0;
  private hurtCooldown = 0;

  get night(): boolean { return this.time >= DAY_SECONDS; }
  get remaining(): number {
    return Math.ceil((this.night ? DAY_SECONDS + NIGHT_SECONDS : DAY_SECONDS) - this.time);
  }
  get daylight(): number {
    if (!this.night) return Math.min(1, this.time / 12, (DAY_SECONDS - this.time) / 18);
    return 0;
  }

  update(dt: number, sheltered: boolean): void {
    this.time = (this.time + dt) % (DAY_SECONDS + NIGHT_SECONDS);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    if (sheltered || !this.night) this.health = Math.min(100, this.health + dt * 3);
  }

  attack(): boolean {
    if (!this.equipped || this.attackCooldown > 0) return false;
    this.attackCooldown = SWORD_COOLDOWN_SECONDS;
    return true;
  }

  hurt(): boolean {
    if (this.hurtCooldown > 0) return false;
    this.health = Math.max(0, this.health - 20);
    this.hurtCooldown = 1.4;
    return true;
  }

  recover(): void {
    this.health = 100;
    this.hurtCooldown = 4;
  }

  sleepUntilMorning(): void {
    this.time = 0;
    this.recover();
    this.attackCooldown = 0;
  }
}

type Werewolf = {
  group: THREE.Group;
  legs: THREE.Mesh[];
  health: number;
  stun: number;
  thief?: Character;
};

type Burst = {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  particles: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[];
  age: number;
  duration: number;
  vanishing?: THREE.Group;
};

export class Werewolves {
  banditsEnabled = false;
  private readonly wolves: Werewolf[] = [];
  private readonly bursts: Burst[] = [];
  private readonly thieves: Character[] = [];
  private spawnTimer = 0;
  private readonly fur = new THREE.MeshStandardMaterial({ color: 0x454957, roughness: 1 });
  private readonly muzzle = new THREE.MeshStandardMaterial({ color: 0x777884, roughness: 1 });
  private readonly eyes = new THREE.MeshStandardMaterial({ color: 0xffd37e, emissive: 0xff921c, emissiveIntensity: 2 });
  private readonly bodyGeometry = new THREE.SphereGeometry(1, 10, 8);
  private readonly limbGeometry = new THREE.CapsuleGeometry(0.15, 0.65, 3, 6);
  private readonly earGeometry = new THREE.ConeGeometry(0.19, 0.45, 5);
  private readonly particleGeometry = new THREE.OctahedronGeometry(0.12);

  constructor(private readonly scene: THREE.Scene, private readonly world: World) {}

  get count(): number { return this.wolves.length; }

  arrowTargets(): ArrowTarget[] {
    return this.wolves.map(wolf => ({
      center: wolf.group.position.clone().add(new THREE.Vector3(0, wolf.thief ? 1.05 : 1.5, 0)),
      radius: wolf.thief ? 0.85 : 1.1,
      hit: () => {
        const index = this.wolves.indexOf(wolf);
        if (index < 0) return;
        this.wolves.splice(index, 1);
        this.burst(wolf.group.position, wolf.group);
      },
    }));
  }

  blocked(x: number, z: number, radius = PLAYER_RADIUS, except?: THREE.Group): boolean {
    return this.wolves.some(wolf => wolf.group !== except
      && Math.hypot(x - wolf.group.position.x, z - wolf.group.position.z) < radius + WEREWOLF_RADIUS);
  }

  private burst(position: THREE.Vector3, vanishing?: THREE.Group): void {
    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y += 1.3;
    const material = new THREE.MeshBasicMaterial({
      color: vanishing ? 0xb7a3df : 0xf4dca0, transparent: true, opacity: 0.7, depthWrite: false,
    });
    const particles: Burst["particles"] = [];
    const count = vanishing ? 16 : 7;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      const mesh = new THREE.Mesh(this.particleGeometry, material);
      const velocity = new THREE.Vector3(Math.sin(angle) * 2, 0.8 + (i % 4) * 0.5, Math.cos(angle) * 2);
      group.add(mesh);
      particles.push({ mesh, velocity });
    }
    this.scene.add(group);
    this.bursts.push({ group, material, particles, age: 0, duration: vanishing ? 0.7 : 0.3, vanishing });
  }

  private updateEffects(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.age += dt;
      const progress = Math.min(1, burst.age / burst.duration);
      burst.material.opacity = 0.7 * (1 - progress);
      for (const particle of burst.particles) {
        particle.mesh.position.addScaledVector(particle.velocity, dt);
        particle.mesh.rotation.y += dt * 4;
        particle.mesh.scale.setScalar(1 - progress * 0.8);
      }
      if (burst.vanishing) {
        burst.vanishing.scale.setScalar(Math.max(0, 1 - progress * 2));
        burst.vanishing.rotation.y += dt * 4;
      }
      if (progress === 1) {
        this.scene.remove(burst.group);
        if (burst.vanishing) this.scene.remove(burst.vanishing);
        burst.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const wolf of this.wolves) this.scene.remove(wolf.group);
    this.wolves.length = 0;
    this.spawnTimer = 0;
    for (const burst of this.bursts) {
      this.scene.remove(burst.group);
      if (burst.vanishing) this.scene.remove(burst.vanishing);
      burst.material.dispose();
    }
    this.bursts.length = 0;
  }

  private spawn(player: THREE.Vector3, thief = false): void {
    for (let attempt = 0; attempt < 48; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 19 + Math.random() * 9;
      const x = player.x + Math.sin(angle) * distance;
      const z = player.z + Math.cos(angle) * distance;
      if (this.world.blocked(x, z, WEREWOLF_RADIUS) || this.blocked(x, z, WEREWOLF_RADIUS)) continue;
      if (thief) {
        let character = this.thieves.find(candidate => !this.wolves.some(wolf => wolf.group === candidate.group)
          && !this.bursts.some(burst => burst.vanishing === candidate.group));
        if (!character) {
          character = new Character(0x694b75, false);
          const mask = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.08), this.fur);
          mask.position.set(0, 1.9, 0.17);
          character.group.add(mask);
          this.thieves.push(character);
        }
        character.group.scale.setScalar(1);
        character.group.rotation.set(0, 0, 0);
        character.group.position.set(x, this.world.heightAt(x, z), z);
        this.scene.add(character.group);
        this.wolves.push({ group: character.group, legs: [], health: 2, stun: 0, thief: character });
        return;
      }
      const group = new THREE.Group();
      const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
        const part = new THREE.Mesh(geometry, material);
        part.position.set(x, y, z);
        part.scale.set(sx, sy, sz);
        part.castShadow = true;
        group.add(part);
        return part;
      };
      mesh(this.bodyGeometry, this.fur, 0, 1.55, 0, 0.6, 0.85, 0.38);
      mesh(this.bodyGeometry, this.fur, 0, 2.42, 0.18, 0.4, 0.43, 0.38);
      mesh(this.bodyGeometry, this.muzzle, 0, 2.26, 0.53, 0.24, 0.2, 0.38);
      const legs: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        mesh(this.earGeometry, this.fur, side * 0.27, 2.87, 0.12);
        mesh(this.bodyGeometry, this.eyes, side * 0.18, 2.48, 0.49, 0.055, 0.045, 0.04);
        legs.push(mesh(this.limbGeometry, this.fur, side * 0.28, 0.55, 0));
        const arm = mesh(this.limbGeometry, this.fur, side * 0.66, 1.35, 0.18, 1.2, 1.15, 1.2);
        arm.rotation.z = side * 0.2;
      }
      group.position.set(x, this.world.heightAt(x, z), z);
      this.scene.add(group);
      this.wolves.push({ group, legs, health: 2, stun: 0 });
      return;
    }
    // A crowded area may have no safe spawn; retry later without placing inside obstacles.
  }

  update(dt: number, elapsed: number, player: THREE.Vector3, sheltered: boolean, survival: Survival): boolean {
    this.updateEffects(dt);
    if (!survival.night) {
      for (let i = this.wolves.length - 1; i >= 0; i--) {
        if (this.wolves[i].thief) continue;
        this.scene.remove(this.wolves[i].group);
        this.wolves.splice(i, 1);
      }
    }
    this.spawnTimer -= dt;
    const banditsNearby = this.banditsEnabled && Math.hypot(player.x - TREEHOUSE.x, player.z - TREEHOUSE.z) < 80;
    if (!sheltered && (survival.night || banditsNearby) && this.spawnTimer <= 0 && this.wolves.length < 4) {
      this.spawn(player, !survival.night || (banditsNearby && this.wolves.length % 2 === 1));
      this.spawnTimer = 6;
    }
    let hit = false;
    for (let i = this.wolves.length - 1; i >= 0; i--) {
      const wolf = this.wolves[i];
      const pos = wolf.group.position;
      const distance = Math.hypot(player.x - pos.x, player.z - pos.z);
      if (distance > 70) {
        this.scene.remove(wolf.group);
        this.wolves.splice(i, 1);
        continue;
      }
      wolf.stun = Math.max(0, wolf.stun - dt);
      wolf.group.rotation.z = Math.sin(wolf.stun * 25) * wolf.stun * 0.18;
      if (sheltered || wolf.stun > 0) continue;
      let angle = Math.atan2(player.x - pos.x, player.z - pos.z);
      if (player.y - pos.y > 4) {
        angle += distance < 16 ? Math.PI : distance < 24 ? Math.PI / 2 : 0;
      }
      wolf.group.rotation.y = angle;
      if (distance > 1.35) {
        // Try angled routes as well as sliding so a tree does not permanently trap a wolf.
        for (const turn of [0, 0.65, -0.65, 1.3, -1.3]) {
          const x = pos.x + Math.sin(angle + turn) * dt * 4.1;
          const z = pos.z + Math.cos(angle + turn) * dt * 4.1;
          if (!this.world.blocked(x, z, WEREWOLF_RADIUS)
            && !this.blocked(x, z, WEREWOLF_RADIUS, wolf.group)
            && Math.hypot(x - player.x, z - player.z) >= PLAYER_RADIUS + WEREWOLF_RADIUS) {
            pos.set(x, this.world.heightAt(x, z), z);
            break;
          }
        }
      } else if (player.y - pos.y < 1.2) {
        hit = survival.hurt() || hit;
      }
      if (wolf.thief) wolf.thief.update(dt, distance > 1.35 ? 4.1 : 0, elapsed);
      else {
        wolf.legs[0].rotation.x = Math.sin(elapsed * 10 + i) * 0.6;
        wolf.legs[1].rotation.x = -wolf.legs[0].rotation.x;
      }
    }
    return hit;
  }

  strike(player: THREE.Vector3, facing: number): number {
    let hits = 0;
    for (let i = this.wolves.length - 1; i >= 0; i--) {
      const wolf = this.wolves[i];
      const delta = wolf.group.position.clone().sub(player);
      const distance = Math.hypot(delta.x, delta.z);
      const forward = (delta.x * Math.sin(facing) + delta.z * Math.cos(facing)) / Math.max(distance, 0.001);
      if (distance > 3.3 || Math.abs(delta.y) > 2.5 || (distance > 1 && forward < 0.15)) continue;
      hits++;
      wolf.health--;
      wolf.stun = 0.45;
      if (wolf.health <= 0) {
        this.wolves.splice(i, 1);
        this.burst(wolf.group.position, wolf.group);
      } else {
        this.burst(wolf.group.position);
        const x = wolf.group.position.x + delta.x / Math.max(distance, 0.001) * 0.45;
        const z = wolf.group.position.z + delta.z / Math.max(distance, 0.001) * 0.45;
        if (!this.world.blocked(x, z, WEREWOLF_RADIUS) && !this.blocked(x, z, WEREWOLF_RADIUS, wolf.group)) {
          wolf.group.position.set(x, this.world.heightAt(x, z), z);
        }
      }
    }
    return hits;
  }
}
