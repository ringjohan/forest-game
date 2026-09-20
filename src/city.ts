import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Character } from "./character";
import type { CityAssets } from "./city-assets";
import type { House } from "./world-types";
import { CITY_ORIGIN, CITY_ROTATION, cityToWorld, onAirportApproach, onForestApproach } from "./geography";
import { circleIntersectsFootprint, footprintCorners, footprintsIntersect } from "./collision";
import type { Footprint } from "./collision";
import { createBmw } from "./bmw";

export interface CityVenue extends House {
  kind: "cafe" | "restaurant" | "shop";
  variant: number;
}

export const CITY_LIMIT = 352;
export const CITY_SIZE = 720;
export const CITY_SPAWN = new THREE.Vector3(-319, 0, 300);
export const CITY_FOREST_GATE = { x: -338, z: 304, halfWidth: 16 };
export const CITY_STREETS = Array.from({ length: 12 }, (_, i) => -330 + i * 60);
const STREETS = CITY_STREETS;
const ROAD_WIDTH = 16;
const SPORT_CAR_LENGTH = 4.6;

type Block = { x: number; z: number; width: number; depth: number; height: number };
type Box = { x: number; y: number; z: number; w: number; h: number; d: number; color: number };
type Axis = "x" | "z";
type District = "oldtown" | "downtown" | "residential" | "warehouse";
type Pedestrian = {
  character: Character;
  route: THREE.Vector3[];
  waypoint: number;
  speed: number;
  pause: number;
  crossingAxis?: Axis;
};
const DISTRICTS: Record<District, { name: string; color: number; height: number; variation: number }> = {
  oldtown: { name: "Gamla stan · Kaféer och stenhus", color: 0xd8b598, height: 12, variation: 0.12 },
  downtown: { name: "Centrum · Glas och skyskrapor", color: 0x91b6c8, height: 48, variation: 0.8 },
  residential: { name: "Lindkvarteren · Bostäder och balkonger", color: 0xd0c4ae, height: 17, variation: 0.2 },
  warehouse: { name: "Magasinskvarteren · Tegel och mat", color: 0xad7861, height: 8, variation: 0.07 },
};
export type VehicleKind = "taxi" | "car" | "bus" | "police" | "van" | "bmw";
const VEHICLE_NAMES: Record<VehicleKind, string> = {
  taxi: "Gul taxi", car: "Sportbil", bus: "Stadsbuss", police: "Polisbil", van: "Skåpbil",
  bmw: "BMW Sport · 400 km/h",
};

export type Vehicle = {
  group: THREE.Group;
  kind: VehicleKind;
  radius: number;
  halfWidth: number;
  halfLength: number;
  centerX: number;
  centerZ: number;
  policeDuty: boolean;
  speed: number;
  maxSpeed: number;
  wheels: THREE.Mesh[];
  detailWheels: { pivot: THREE.Object3D; radius: number }[];
  detail: THREE.Group | null;
  body: THREE.Group;
  route: THREE.Vector3[];
  waypoint: number;
  automatic: boolean;
};

export class City {
  readonly scene = new THREE.Scene();
  readonly vehicles: Vehicle[] = [];
  readonly venues: CityVenue[] = [];
  readonly officers: { character: Character; home: THREE.Vector3; name: string }[] = [];
  activeVehicle: Vehicle | null = null;
  private time = 0;
  private readonly blocks: Block[] = [];
  private readonly streetFurniture: { x: number; z: number; radius: number }[] = [];
  private readonly treeVolumes: { x: number; z: number; radius: number; height: number }[] = [];
  private readonly pedestrians: Pedestrian[] = [];
  private readonly props: THREE.Object3D[] = [];
  private fountain: THREE.Points | null = null;
  private readonly localLights: { position: THREE.Vector3; color: number }[] = [];
  private readonly lightPool = Array.from({ length: 6 }, () => new THREE.PointLight(0xffd49a, 0, 18, 2));
  private readonly litWindows = new THREE.MeshStandardMaterial({
    color: 0x546875, metalness: 0.45, roughness: 0.2, emissive: 0xffc481, emissiveIntensity: 0.1,
  });
  private readonly bodyGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly roundedGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
  private readonly wheelGeometry = new THREE.CylinderGeometry(0.48, 0.48, 0.3, 20);
  private readonly rimGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.025, 16);
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  private readonly rubber = new THREE.MeshStandardMaterial({ color: 0x202630, roughness: 0.95 });
  private readonly glass = new THREE.MeshStandardMaterial({ color: 0x83bbc9, metalness: 0.5, roughness: 0.23 });
  private readonly chrome = new THREE.MeshStandardMaterial({ color: 0xc4ced5, metalness: 0.9, roughness: 0.22 });
  private readonly headlights = new THREE.MeshStandardMaterial({ color: 0xf3f5ff, emissive: 0xcbdfff, emissiveIntensity: 1.8 });
  private readonly taillights = new THREE.MeshStandardMaterial({ color: 0xa51a22, emissive: 0xff182c, emissiveIntensity: 0.9 });
  private readonly lightMaterials = {
    red: new THREE.MeshStandardMaterial({ color: 0x501c21, emissive: 0xff2438 }),
    amber: new THREE.MeshStandardMaterial({ color: 0x61430a, emissive: 0xffb31c }),
    green: new THREE.MeshStandardMaterial({ color: 0x0a593f, emissive: 0x29ff9a }),
  };
  private readonly signals: Record<Axis, Record<"red" | "amber" | "green", THREE.MeshStandardMaterial>>;
  private readonly facades: Record<District, THREE.MeshStandardMaterial>;

  constructor(private readonly assets: CityAssets) {
    this.scene.background = new THREE.Color(0xb5c6ba);
    this.scene.fog = new THREE.FogExp2(0xb5c6ba, 0.0022);
    this.signals = {
      x: this.lightMaterials,
      z: {
        red: this.lightMaterials.red.clone(),
        amber: this.lightMaterials.amber.clone(),
        green: this.lightMaterials.green.clone(),
      },
    };
    this.facades = {
      oldtown: this.makeFacade("oldtown", 4),
      downtown: this.makeFacade("downtown", 18),
      residential: this.makeFacade("residential", 6),
      warehouse: this.makeFacade("warehouse", 3),
    };
    this.makeStreets();
    this.makeBuildings();
    this.makeStreetLife();
    this.makeTrafficLights();
    this.makeVehicles();
    this.makeOfficers();
    this.makePedestrians();
    this.makeBoulevards();
    this.scene.add(...this.lightPool);
    this.updateSignals();
  }

  heightAt(_x: number, _z: number): number { return 0; }

  nearForestExit(position: THREE.Vector3): boolean {
    return position.x <= -324 && Math.abs(position.z - CITY_FOREST_GATE.z) <= CITY_FOREST_GATE.halfWidth;
  }

  atForestExit(position: THREE.Vector3): boolean {
    return position.x <= CITY_FOREST_GATE.x && this.nearForestExit(position);
  }

  private districtKey(x: number, z: number): District {
    return z < -30 ? x < -30 ? "oldtown" : "downtown" : x < -30 ? "warehouse" : "residential";
  }

  districtAt(x: number, z: number): string {
    if (x < -280 && z > 280) return "Skogsinfarten · Bussterminalen";
    if (x > -22 && x < 82 && Math.abs(z) < 22) return "Centralparken";
    return DISTRICTS[this.districtKey(x, z)].name;
  }

  private makeFacade(district: District, rows: number): THREE.MeshStandardMaterial {
    const canvas = document.createElement("canvas");
    const glow = document.createElement("canvas");
    canvas.width = glow.width = 512;
    canvas.height = glow.height = 1024;
    const ctx = canvas.getContext("2d");
    const light = glow.getContext("2d");
    if (!ctx || !light) throw new Error("Kunde inte skapa stadens fasadmaterial.");
    const modern = district === "downtown";
    ctx.fillStyle = modern ? "#677e8a" : district === "warehouse" ? "#ad8b78" : "#e7e0d1";
    ctx.fillRect(0, 0, 512, 1024);
    light.fillStyle = "#000000";
    light.fillRect(0, 0, 512, 1024);
    if (district === "warehouse" || district === "oldtown") {
      ctx.strokeStyle = "#756357";
      ctx.lineWidth = 2;
      for (let y = 0; y < 1024; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(512, y);
        for (let x = (y % 32 ? 0 : -32); x < 512; x += 64) {
          ctx.moveTo(x, y); ctx.lineTo(x, y + 16);
        }
        ctx.stroke();
      }
    }
    const rowHeight = 1024 / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 6; col++) {
        const x = col * 85 + (modern ? 4 : 19);
        const y = row * rowHeight + 12;
        const w = modern ? 77 : 47;
        const h = rowHeight - (modern ? 16 : 40);
        ctx.fillStyle = "#eeeeea";
        ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
        const reflection = ctx.createLinearGradient(x, y, x + w, y + h);
        reflection.addColorStop(0, "#94b5c5");
        reflection.addColorStop(0.45, "#466477");
        reflection.addColorStop(1, "#24333f");
        ctx.fillStyle = reflection;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "#b6c0be";
        ctx.fillRect(x + w / 2 - 1, y, 2, h);
        if (!modern) ctx.fillRect(x, y + h * 0.65, w, 3);
        if ((row * 7 + col * 3) % 5 < 2) {
          light.fillStyle = "#ffe0a3";
          light.fillRect(x, y, w, h);
        }
      }
    }
    const map = new THREE.CanvasTexture(canvas);
    const emissiveMap = new THREE.CanvasTexture(glow);
    map.colorSpace = emissiveMap.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map, emissiveMap, emissive: 0xffe2af, emissiveIntensity: 0.08,
      metalness: modern ? 0.65 : 0.08, roughness: modern ? 0.25 : 0.82,
    });
  }

  blocked(x: number, z: number, radius = 0.45): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius)) return true;
    const global = cityToWorld(new THREE.Vector3(x, 0, z));
    if ((Math.abs(x) + radius > CITY_LIMIT || Math.abs(z) + radius > CITY_LIMIT)
      && !onForestApproach(global.x, global.z, radius)
      && !onAirportApproach(global.x, global.z, radius)) return true;
    for (const b of this.blocks) {
      const dx = Math.max(Math.abs(x - b.x) - b.width / 2, 0);
      const dz = Math.max(Math.abs(z - b.z) - b.depth / 2, 0);
      if (dx * dx + dz * dz <= radius * radius) return true;
    }
    return this.streetFurniture.some(p => Math.hypot(x - p.x, z - p.z) < radius + p.radius);
  }

  cameraBlocked(x: number, y: number, z: number, radius = 0.4): boolean {
    return this.blocks.some(b => y < b.height + (b.height >= 12 && this.districtKey(b.x, b.z) === "oldtown" ? 4 : 0.5)
      && Math.abs(x - b.x) < b.width / 2 + radius && Math.abs(z - b.z) < b.depth / 2 + radius);
  }

  flightBlocked(x: number, y: number, z: number, radius: number): boolean {
    return this.cameraBlocked(x, y - radius, z, radius)
      || this.treeVolumes.some(tree => y - radius < tree.height
        && Math.hypot(x - tree.x, z - tree.z) < tree.radius + radius)
      || (y - radius < 4 && this.vehicleBlocked(x, z, radius));
  }

  vehicleBlocked(x: number, z: number, radius: number, except?: Vehicle): boolean {
    return this.vehicles.some(v => v !== except
      && circleIntersectsFootprint(x, z, radius, this.vehicleFootprint(v)));
  }

  vehicleFootprint(vehicle: Vehicle, x = vehicle.group.position.x, z = vehicle.group.position.z, heading = vehicle.group.rotation.y): Footprint {
    const c = Math.cos(heading), s = Math.sin(heading);
    return {
      x: x + vehicle.centerX * c + vehicle.centerZ * s,
      z: z - vehicle.centerX * s + vehicle.centerZ * c,
      halfWidth: vehicle.halfWidth, halfLength: vehicle.halfLength, heading,
    };
  }

  vehiclePoseBlocked(vehicle: Vehicle, x: number, z: number, heading: number): boolean {
    const shape = this.vehicleFootprint(vehicle, x, z, heading);
    for (const corner of footprintCorners(shape)) {
      if (Math.abs(corner.x) <= CITY_LIMIT && Math.abs(corner.z) <= CITY_LIMIT) continue;
      const global = cityToWorld(new THREE.Vector3(corner.x, 0, corner.z));
      if (!onForestApproach(global.x, global.z) && !onAirportApproach(global.x, global.z)) return true;
    }
    if (this.blocks.some(b => footprintsIntersect(shape, {
      x: b.x, z: b.z, halfWidth: b.width / 2, halfLength: b.depth / 2, heading: 0,
    }))) return true;
    if (this.streetFurniture.some(p => circleIntersectsFootprint(p.x, p.z, p.radius, shape))) return true;
    if (this.vehicles.some(other => other !== vehicle && footprintsIntersect(shape, this.vehicleFootprint(other)))) return true;
    return this.officers.some(o => circleIntersectsFootprint(o.character.group.position.x, o.character.group.position.z, 0.5, shape))
      || this.pedestrians.some(p => circleIntersectsFootprint(p.character.group.position.x, p.character.group.position.z, 0.45, shape));
  }

  nearVehicle(position: THREE.Vector3): Vehicle | undefined {
    return this.vehicles
      .filter(v => !v.policeDuty && Math.abs(v.speed) < 1 && Math.abs(position.y) < 3
        && circleIntersectsFootprint(position.x, position.z, 2.4, this.vehicleFootprint(v)))
      .sort((a, b) => a.group.position.distanceToSquared(position) - b.group.position.distanceToSquared(position))[0];
  }

  nearOfficer(position: THREE.Vector3): (typeof this.officers)[number] | undefined {
    return this.officers.find(o => o.character.group.position.distanceTo(position) < 3.5);
  }

  nearVenue(position: THREE.Vector3): CityVenue | undefined {
    return this.venues.find(venue => venue.entrance.distanceTo(position) < 2.5);
  }

  venueExit(venue: CityVenue): THREE.Vector3 | undefined {
    for (const [dx, dz] of [[0, 0], [0, 0.8], [0, 1.6], [-1.5, 1.6], [1.5, 1.6], [0, 2.5]]) {
      const position = venue.entrance.clone().add(new THREE.Vector3(dx, 0, dz));
      if (!this.blocked(position.x, position.z) && !this.vehicleBlocked(position.x, position.z, 0.45)
        && !this.pedestrianBlocked(position.x, position.z, 0.45)) return position;
    }
    return undefined;
  }

  nearCitizen(position: THREE.Vector3): { character: Character; name: string; line: string } | undefined {
    const index = this.pedestrians.findIndex(person => person.character.group.position.distanceTo(position) < 2.7);
    if (index < 0) return undefined;
    return {
      character: this.pedestrians[index].character,
      name: ["Mira", "Elias", "Noor", "Leo", "Ada", "Olle", "Vera", "Amir"][index % 8],
      line: [
        "Jag brukar ta en kaffe här innan jobbet. Uteserveringarna ligger längs kvarterens södra sida. Följ doften av nyrostat!",
        "Vill du tillbaka till skogen? Följ den gröna skylten vid terminalen och fortsätt längs stigen. Flygplatsen ligger på andra sidan staden och syns på världskartan.",
        "Fontänen i Centralparken är min favoritplats. Sedan brukar jag ta en promenad förbi tegelhusen i Gamla stan.",
        "Det är stor skillnad mellan kvarteren! Glastornen ligger i sydost, och de gamla magasinen väster om Gamla stan har fått nya restauranger.",
      ][index % 4],
    };
  }

  vehicleName(vehicle: Vehicle): string { return VEHICLE_NAMES[vehicle.kind]; }

  drawWorldMap(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(CITY_ORIGIN.x, CITY_ORIGIN.z);
    ctx.rotate(-CITY_ROTATION);
    ctx.fillStyle = "#647781";
    ctx.fillRect(-360, -360, 720, 720);
    ctx.fillStyle = "#253647";
    for (const street of STREETS) {
      ctx.fillRect(street - 8, -360, 16, 720);
      ctx.fillRect(-360, street - 8, 720, 16);
    }
    for (const b of this.blocks) {
      ctx.fillStyle = `#${DISTRICTS[this.districtKey(b.x, b.z)].color.toString(16)}`;
      ctx.fillRect(b.x - b.width / 2, b.z - b.depth / 2, b.width, b.depth);
    }
    ctx.fillStyle = "#61936f";
    ctx.fillRect(-18, -18, 36, 36);
    ctx.fillRect(42, -18, 36, 36);
    for (const vehicle of this.vehicles) {
      ctx.fillStyle = vehicle.kind === "police" ? "#6eb4ff" : "#ffd878";
      ctx.fillRect(vehicle.group.position.x - 2, vehicle.group.position.z - 2, 4, 4);
    }
    for (const venue of this.venues) {
      ctx.fillStyle = venue.kind === "cafe" ? "#f3c57b" : venue.kind === "restaurant" ? "#ed9585" : "#a7dce4";
      ctx.fillRect(venue.entrance.x - 3, venue.entrance.z - 3, 6, 6);
    }
    ctx.restore();
  }

  enter(vehicle: Vehicle): void {
    if (vehicle.policeDuty) throw new Error("En polisbil i tjänst kan inte lånas.");
    vehicle.automatic = false;
    vehicle.speed = 0;
    this.activeVehicle = vehicle;
  }

  exit(): THREE.Vector3 | null {
    const vehicle = this.activeVehicle;
    if (!vehicle || Math.abs(vehicle.speed) > 0.8) return null;
    const heading = vehicle.group.rotation.y;
    for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI, 0]) {
      const offset = (Math.abs(Math.sin(angle)) > 0.5 ? vehicle.halfWidth : vehicle.halfLength) + 1.1;
      const center = this.vehicleFootprint(vehicle);
      const x = center.x + Math.sin(heading + angle) * offset;
      const z = center.z + Math.cos(heading + angle) * offset;
      if (!this.blocked(x, z) && !this.vehicleBlocked(x, z, 0.5) && !this.pedestrianBlocked(x, z, 0.5)) {
        vehicle.speed = 0;
        this.activeVehicle = null;
        return new THREE.Vector3(x, 0, z);
      }
    }
    return null;
  }

  drive(dt: number, throttle: number, steering: number, brake: boolean): void {
    const v = this.activeVehicle;
    if (!v) return;
    const acceleration = v.kind === "bmw" ? 26 : v.kind === "bus" ? 7 : 12;
    if (brake) v.speed = THREE.MathUtils.damp(v.speed, 0, v.kind === "bmw" ? 12 : 9, dt);
    else if (throttle !== 0) v.speed += throttle * acceleration * dt;
    else v.speed = THREE.MathUtils.damp(v.speed, 0, v.kind === "bmw" ? 0.25 : 0.7, dt);
    v.speed = THREE.MathUtils.clamp(v.speed, -7, v.maxSpeed);
    if (Math.abs(v.speed) < 0.03) v.speed = 0;
    const stability = v.kind === "bmw" ? THREE.MathUtils.clamp(16 / (Math.abs(v.speed) + 8), 0.22, 1) : 1;
    const turn = -steering * Math.min(Math.abs(v.speed) / 5, 1) * Math.sign(v.speed) * dt * 1.25 * stability;
    this.advanceVehicle(v, dt, turn);
  }

  createPatrol(x: number, z: number, heading: number): Vehicle {
    const vehicle = this.makeVehicle("police", x, z, heading);
    vehicle.policeDuty = true;
    vehicle.maxSpeed = 55;
    return vehicle;
  }

  movePatrol(vehicle: Vehicle, dt: number, heading: number, speed: number): boolean {
    const turn = Math.atan2(Math.sin(heading - vehicle.group.rotation.y), Math.cos(heading - vehicle.group.rotation.y));
    vehicle.speed = THREE.MathUtils.clamp(speed, 0, vehicle.maxSpeed);
    return this.advanceVehicle(vehicle, dt, turn);
  }

  private advanceVehicle(v: Vehicle, dt: number, turn: number): boolean {
    // Sweep translation and rotation; a 400 km/h car must not skip thin obstacles.
    const steps = Math.max(1, Math.ceil((Math.abs(v.speed) * dt + Math.abs(turn) * v.radius) / 0.2));
    let moved = false;
    let travelled = 0;
    for (let step = 0; step < steps; step++) {
      const heading = v.group.rotation.y + turn / steps;
      const x = v.group.position.x + Math.sin(heading) * v.speed * dt / steps;
      const z = v.group.position.z + Math.cos(heading) * v.speed * dt / steps;
      if (this.vehiclePoseBlocked(v, x, z, heading)) {
        v.speed = 0;
        break;
      }
      const distance = Math.hypot(x - v.group.position.x, z - v.group.position.z);
      moved ||= distance > 0.000001 || Math.abs(heading - v.group.rotation.y) > 0.000001;
      travelled += distance * Math.sign(v.speed);
      v.group.rotation.y = heading;
      v.group.position.set(x, 0, z);
    }
    this.spinWheels(v, dt, travelled);
    return moved;
  }

  update(dt: number, daylight: number, player: THREE.Vector3): void {
    this.time += dt;
    for (const facade of Object.values(this.facades)) {
      facade.emissiveIntensity = THREE.MathUtils.lerp(0.85, 0.04, daylight);
    }
    this.updateSignals();
    this.litWindows.emissiveIntensity = THREE.MathUtils.lerp(1.8, 0.04, daylight);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.12, 0.8, daylight);
    const lights = this.localLights
      .filter(light => light.position.distanceToSquared(player) < 45 ** 2)
      .sort((a, b) => a.position.distanceToSquared(player) - b.position.distanceToSquared(player));
    for (const [i, light] of this.lightPool.entries()) {
      light.intensity = lights[i] ? (1 - daylight) * 45 : 0;
      if (lights[i]) {
        light.position.copy(lights[i].position);
        light.color.setHex(lights[i].color);
      }
    }
    for (const prop of this.props) prop.visible = prop.position.distanceToSquared(player) < 130 ** 2;
    if (this.fountain) {
      const positions = this.fountain.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const phase = (this.time * 0.55 + i / positions.count) % 1;
        const angle = i * 2.39996;
        positions.setXYZ(i, Math.cos(angle) * phase * 2.3, 0.7 + Math.sin(phase * Math.PI) * 2.4, Math.sin(angle) * phase * 2.3);
      }
      positions.needsUpdate = true;
    }
    for (const vehicle of this.vehicles) {
      vehicle.group.visible = vehicle === this.activeVehicle || vehicle.group.position.distanceToSquared(player) < 170 ** 2;
      if (vehicle.detail) {
        vehicle.detail.visible = vehicle.group.position.distanceToSquared(player) < 45 ** 2;
        vehicle.body.visible = !vehicle.detail.visible;
      }
    }
    for (const officer of this.officers) {
      officer.character.group.visible = officer.character.group.position.distanceToSquared(player) < 115 ** 2;
    }
    for (const person of this.pedestrians) {
      person.character.group.visible = person.character.group.position.distanceToSquared(player) < 115 ** 2;
    }
    if (dt === 0) return;
    for (const v of this.vehicles) {
      if (!v.automatic || v === this.activeVehicle) continue;
      const pos = v.group.position;
      let destination = v.route[v.waypoint];
      if (pos.distanceTo(destination) < 0.15) {
        v.waypoint = (v.waypoint + 1) % v.route.length;
        destination = v.route[v.waypoint];
      }
      const dx = destination.x - pos.x;
      const dz = destination.z - pos.z;
      const distance = Math.hypot(dx, dz);
      const axis: Axis = Math.abs(dx) > Math.abs(dz) ? "x" : "z";
      const direction = Math.sign(axis === "x" ? dx : dz);
      const coordinate = axis === "x" ? pos.x : pos.z;
      const crossing = STREETS.find(s => {
        const ahead = (s - coordinate) * direction;
        return ahead > 0 && ahead < 11 + v.radius;
      });
      const mustStop = crossing !== undefined && this.signal(axis) !== "green"
        && (crossing - coordinate) * direction > 8;
      const step = Math.min(distance, 9 * dt);
      const x = pos.x + dx / distance * step;
      const z = pos.z + dz / distance * step;
      const aheadX = x + dx / distance * 1.4;
      const aheadZ = z + dz / distance * 1.4;
      if (mustStop || this.vehicleBlocked(aheadX, aheadZ, v.radius + 0.5, v)
        || (!this.activeVehicle && Math.hypot(x - player.x, z - player.z) < v.radius + 1.8)
        || this.pedestrianBlocked(x, z, v.radius + 0.8)) {
        v.speed = 0;
      } else {
        pos.set(x, 0, z);
        v.group.rotation.y = Math.atan2(dx, dz);
        v.speed = 9;
        this.spinWheels(v, dt);
      }
    }
    for (const officer of this.officers) {
      const p = officer.character.group.position;
      const targetZ = officer.home.z + Math.sin(this.time * 0.22) * 5;
      const z = p.z + THREE.MathUtils.clamp(targetZ - p.z, -dt * 1.1, dt * 1.1);
      if (!this.blocked(p.x, z, 0.4) && !this.vehicleBlocked(p.x, z, 1.4)
        && !this.pedestrianBlocked(p.x, z, 0.4, officer.character) && Math.hypot(player.x - p.x, player.z - z) > 2) {
        const speed = Math.abs(z - p.z) / dt;
        officer.character.group.rotation.y = z > p.z ? 0 : Math.PI;
        p.z = z;
        officer.character.update(dt, speed, this.time);
      } else officer.character.update(dt, 0, this.time);
    }
    for (const person of this.pedestrians) {
      const p = person.character.group.position;
      person.pause = Math.max(0, person.pause - dt);
      let speed = 0;
      if (person.route.length > 1 && person.pause === 0) {
        const destination = person.route[person.waypoint];
        const distance = p.distanceTo(destination);
        if (distance < 0.08) {
          person.waypoint = (person.waypoint + 1) % person.route.length;
          person.pause = 0.7;
        } else {
          const step = Math.min(distance, person.speed * dt);
          const dx = (destination.x - p.x) / distance;
          const dz = (destination.z - p.z) / distance;
          const x = p.x + dx * step;
          const z = p.z + dz * step;
          const enteringCrossing = person.crossingAxis && STREETS.some(street =>
            Math.abs(p.x - street) >= 8 && Math.abs(x - street) < 8);
          if ((!enteringCrossing || !person.crossingAxis || this.signal(person.crossingAxis) === "red")
            && !this.blocked(x, z, 0.4) && !this.vehicleBlocked(x, z, 1)
            && Math.hypot(x - player.x, z - player.z) > 1
            && !this.pedestrianBlocked(x, z, 0.35, person.character)) {
            p.set(x, 0, z);
            person.character.group.rotation.y = Math.atan2(dx, dz);
            speed = person.speed;
          }
        }
      }
      if (person.character.group.visible) person.character.update(dt, speed, this.time);
    }
  }

  drawMap(ctx: CanvasRenderingContext2D, large: boolean, position: THREE.Vector3, heading: number): void {
    const { width, height } = ctx.canvas;
    const scale = large ? (height - 50) / CITY_SIZE : 1.5;
    ctx.fillStyle = "#1b293a";
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2 - (large ? 0 : position.x * scale), height / 2 - (large ? 0 : position.z * scale));
    ctx.scale(scale, scale);
    ctx.fillStyle = "#647781";
    ctx.fillRect(-CITY_LIMIT, -CITY_LIMIT, CITY_LIMIT * 2, CITY_LIMIT * 2);
    ctx.fillStyle = "#253647";
    for (const street of STREETS) {
      ctx.fillRect(street - 8, -CITY_LIMIT, 16, CITY_LIMIT * 2);
      ctx.fillRect(-CITY_LIMIT, street - 8, CITY_LIMIT * 2, 16);
    }
    for (const b of this.blocks) {
      ctx.fillStyle = `#${DISTRICTS[this.districtKey(b.x, b.z)].color.toString(16)}`;
      ctx.fillRect(b.x - b.width / 2, b.z - b.depth / 2, b.width, b.depth);
    }
    ctx.fillStyle = "#61936f";
    ctx.fillRect(-18, -18, 36, 36);
    ctx.fillRect(42, -18, 36, 36);
    for (const venue of this.venues) {
      ctx.fillStyle = venue.kind === "cafe" ? "#f3c57b" : venue.kind === "restaurant" ? "#ed9585" : "#a7dce4";
      ctx.beginPath();
      ctx.arc(venue.entrance.x, venue.entrance.z, 2.6 / scale, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const v of this.vehicles) {
      ctx.fillStyle = v.kind === "police" ? "#6eb4ff" : "#ffd878";
      ctx.fillRect(v.group.position.x - 2, v.group.position.z - 2, 4, 4);
    }
    ctx.fillStyle = "#ffe4a6";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    if (large) {
      ctx.fillText("CENTRALPARKEN", 30, 8);
      ctx.fillText("BUSSTERMINAL", -255, 345);
      ctx.fillText("NORRHAMN CITY", 0, -345);
      ctx.fillText("GAMLA STAN", -170, -180);
      ctx.fillText("CENTRUM", 170, -180);
      ctx.fillText("MAGASINSKVARTEREN", -170, 160);
      ctx.fillText("LINDKVARTEREN", 170, 160);
    }
    ctx.strokeStyle = "#ffe4a6";
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    ctx.moveTo(-CITY_LIMIT, CITY_FOREST_GATE.z);
    ctx.lineTo(-306, CITY_FOREST_GATE.z);
    ctx.stroke();
    if (large) {
      ctx.textAlign = "left";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText("← SKOGSSTIGEN", -350, 286);
    }
    ctx.translate(position.x, position.z);
    ctx.rotate(-heading + Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, -7 / scale);
    ctx.lineTo(5 / scale, 5 / scale);
    ctx.lineTo(0, 2 / scale);
    ctx.lineTo(-5 / scale, 5 / scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  pedestrianBlocked(x: number, z: number, radius: number, except?: Character): boolean {
    return this.officers.some(o => o.character !== except && Math.hypot(x - o.character.group.position.x, z - o.character.group.position.z) < radius + 0.5)
      || this.pedestrians.some(p => p.character !== except && Math.hypot(x - p.character.group.position.x, z - p.character.group.position.z) < radius + 0.45);
  }

  private spinWheels(v: Vehicle, dt: number, travel = v.speed * dt): void {
    for (const wheel of v.wheels) {
      const radius = typeof wheel.userData.radius === "number" ? wheel.userData.radius : 0.48 * v.body.scale.y;
      wheel.rotateY(-travel / radius);
    }
    for (const wheel of v.detailWheels) wheel.pivot.rotateX(travel / wheel.radius);
  }

  signal(axis: Axis): "red" | "amber" | "green" {
    const phase = (this.time + (axis === "z" ? 13 : 0)) % 26;
    return phase < 10 ? "green" : phase < 12 ? "amber" : "red";
  }

  private updateSignals(): void {
    for (const axis of ["x", "z"] as const) {
      const signal = this.signal(axis);
      for (const color of ["red", "amber", "green"] as const) {
        this.signals[axis][color].emissiveIntensity = color === signal ? 2.5 : 0;
      }
    }
  }

  private batch(boxes: Box[], material: THREE.Material = this.bodyMaterial): void {
    // Local batches can be culled instead of drawing the whole city at every corner.
    const cells = new Map<string, Box[]>();
    for (const box of boxes) {
      const key = `${Math.floor(box.x / 120)},${Math.floor(box.z / 120)}`;
      const cell = cells.get(key);
      if (cell) cell.push(box);
      else cells.set(key, [box]);
    }
    for (const cell of cells.values()) this.batchCell(cell, material);
  }

  private batchCell(boxes: Box[], material: THREE.Material): void {
    const mesh = new THREE.InstancedMesh(this.bodyGeometry, material, boxes.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      dummy.position.set(b.x, b.y, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new THREE.Color(b.color));
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
  }

  private makeStreets(): void {
    const boxes: Box[] = [{ x: 0, y: -0.2, z: 0, w: CITY_SIZE, h: 0.3, d: CITY_SIZE, color: 0x9da6a7 }];
    const roads: Box[] = [];
    for (const s of STREETS) {
      roads.push({ x: s, y: -0.025, z: 0, w: ROAD_WIDTH, h: 0.04, d: CITY_SIZE, color: 0xffffff });
      roads.push({ x: 0, y: -0.022, z: s, w: CITY_SIZE, h: 0.04, d: ROAD_WIDTH, color: 0xffffff });
      for (let p = -348; p < 350; p += 10) {
        if (STREETS.some(cross => Math.abs(cross - p) < 12)) continue;
        for (const offset of [-0.25, 0.25]) {
          boxes.push({ x: s + offset, y: 0.006, z: p, w: 0.12, h: 0.012, d: 4, color: 0xeac75e });
          boxes.push({ x: p, y: 0.006, z: s + offset, w: 4, h: 0.012, d: 0.12, color: 0xeac75e });
        }
      }
      for (const cross of STREETS) {
        for (const side of [-1, 1]) {
          for (let stripe = -6; stripe <= 6; stripe += 2) {
            boxes.push({ x: s + stripe, y: 0.015, z: cross + side * 10, w: 1, h: 0.015, d: 3, color: 0xf0e9d9 });
            boxes.push({ x: s + side * 10, y: 0.015, z: cross + stripe, w: 3, h: 0.015, d: 1, color: 0xf0e9d9 });
          }
        }
      }
    }
    this.batch(boxes);
    this.batch(roads, this.assets.asphalt);
    const entrance: Box[] = [
      { x: -340, y: 0.035, z: CITY_FOREST_GATE.z, w: 26, h: 0.025, d: 12, color: 0xd8d2bc },
    ];
    this.batch(entrance, this.assets.pavement);
    const posts: Box[] = [-1, 1].map(side => ({
      x: -340, y: 2.6, z: CITY_FOREST_GATE.z + side * 9, w: 0.35, h: 5.2, d: 0.35, color: 0x4d6251,
    }));
    this.batch(posts);
    for (const post of posts) this.streetFurniture.push({ x: post.x, z: post.z, radius: 0.25 });
    this.sign("GRÖNVED · GÅ TILL SKOGEN", -339, 5.2, CITY_FOREST_GATE.z, 18, "#244c36", Math.PI / 2);
    this.sign("NORRHAMN CITY", -341, 5.2, CITY_FOREST_GATE.z, 18, "#123e58", -Math.PI / 2);
    this.sign("← SKOGEN · FÖLJ STIGEN", -319, 3.5, 313, 15, "#244c36");
    this.sign("NORRHAMNS FLYGPLATS →", 90, 3.5, -345, 18, "#123e58");
    this.sign("BUSSTERMINAL", -302, 3, 315, 10, "#123e58");
  }

  private makeBuildings(): void {
    const towers: Record<District, Box[]> = { oldtown: [], downtown: [], residential: [], warehouse: [] };
    const details: Box[] = [];
    const windows: Box[] = [];
    const glowing: Box[] = [];
    const sidewalks: Box[] = [];
    const roofs: Box[] = [];
    for (let ix = 0; ix < 11; ix++) {
      for (let iz = 0; iz < 11; iz++) {
        const x = -300 + ix * 60;
        const z = -300 + iz * 60;
        const park = iz === 5 && (ix === 5 || ix === 6);
        const terminal = ix === 0 && iz === 10;
        if (park || terminal) {
          details.push({ x, y: 0.02, z, w: 38, h: 0.04, d: 38, color: park ? 0x63865a : 0x727e83 });
          if (park) {
            details.push({ x, y: 0.05, z, w: 4, h: 0.05, d: 38, color: 0xc6bc9d });
          }
          continue;
        }
        const district = this.districtKey(x, z);
        const style = DISTRICTS[district];
        const shop = (ix + iz * 2) % 5 === 0 || (ix === 1 && iz === 10);
        sidewalks.push({ x, y: -0.035, z, w: 42, h: 0.06, d: 42, color: 0xeeeeee });
        for (const dx of [-10, 10]) {
          for (const dz of [-10, 10]) {
            const n = (ix * 47 + iz * 31 + dx * 7 + dz * 13 + 1000) % 97;
            const height = style.height + n * style.variation;
            const storefront = shop && dz === 10;
            const b = { x: x + dx, z: z + dz, width: 16, depth: storefront ? 12 : 16, height };
            this.blocks.push(b);
            const tint = new THREE.Color(style.color).multiplyScalar(0.86 + (n % 5) * 0.04).getHex();
            towers[district].push({ x: b.x, y: height / 2, z: b.z, w: b.width, h: height, d: b.depth, color: tint });
            if (district === "oldtown" || district === "warehouse") {
              for (let y = 5.6; y < height - 1; y += 3.5) {
                for (const offset of [-5.5, -1.8, 1.8, 5.5]) {
                  for (const side of [-1, 1]) {
                    const panes = (Math.floor(y) + n + Math.round(offset)) % 3 === 0 ? glowing : windows;
                    panes.push({ x: b.x + offset, y, z: b.z + side * (b.depth / 2 + 0.06), w: 1.7, h: 2.2, d: 0.12, color: 0xb5c8d1 });
                    panes.push({ x: b.x + side * 8.06, y, z: b.z + offset * b.depth / 16, w: 0.12, h: 2.2, d: 1.7, color: 0xb5c8d1 });
                    details.push({ x: b.x + offset, y: y - 1.2, z: b.z + side * (b.depth / 2 + 0.13), w: 2.1, h: 0.18, d: 0.35, color: 0xddd2be });
                    details.push({ x: b.x + offset, y, z: b.z + side * (b.depth / 2 + 0.15), w: 0.07, h: 2.2, d: 0.08, color: 0x313e42 });
                  }
                }
              }
            }
            details.push({ x: b.x, y: 0.4, z: b.z, w: 16.3, h: 0.8, d: b.depth + 0.3, color: 0x706d67 });
            details.push({ x: b.x, y: height + 0.2, z: b.z, w: 16.6, h: 0.4, d: b.depth + 0.6, color: 0x69737b });
            if (district === "oldtown") {
              roofs.push({ x: b.x, y: height + 2, z: b.z, w: 17, h: 4, d: b.depth + 1, color: 0x684d43 });
              details.push({ x: b.x + 4, y: height + 3, z: b.z - 3, w: 1, h: 5, d: 1, color: 0x8c6956 });
              for (let level = 4; level < height; level += 4) {
                details.push({ x: b.x, y: level, z: b.z, w: 16.2, h: 0.18, d: b.depth + 0.2, color: 0xd9cdb9 });
              }
            } else if (district === "downtown") {
              details.push({ x: b.x, y: height + 1.6, z: b.z, w: 11, h: 3, d: 10, color: 0x566571 });
              for (const side of [-1, 1]) {
                details.push({ x: b.x + side * 7.7, y: height / 2, z: b.z + b.depth / 2 + 0.1, w: 0.25, h: height, d: 0.2, color: 0xc4cdd1 });
              }
              if (n % 3 === 0) details.push({ x: b.x, y: height + 7, z: b.z, w: 0.3, h: 12, d: 0.3, color: 0x99a6ae });
            } else if (district === "residential") {
              for (let level = 4; level < height - 2; level += 4) {
                for (const side of [-1, 1]) {
                  const balconyX = b.x + side * 4.5;
                  const balconyZ = b.z + b.depth / 2 + 0.7;
                  details.push({ x: balconyX, y: level, z: balconyZ, w: 3.7, h: 0.2, d: 1.5, color: 0xc4c1b7 });
                  details.push({ x: balconyX, y: level + 0.9, z: balconyZ + 0.7, w: 3.7, h: 0.1, d: 0.08, color: 0x404e55 });
                  for (const rail of [-1.6, 0, 1.6]) details.push({ x: balconyX + rail, y: level + 0.45, z: balconyZ + 0.7, w: 0.07, h: 0.9, d: 0.07, color: 0x404e55 });
                }
              }
            } else {
              details.push({ x: b.x + 4, y: height + 0.7, z: b.z, w: 4, h: 1, d: 3, color: 0x667078 });
              if (!storefront) details.push({ x: b.x, y: 2.1, z: b.z + b.depth / 2 + 0.05, w: 7, h: 4, d: 0.15, color: 0x485660 });
            }
            if (storefront) {
              this.makeShop(b, dx < 0, ix + iz, details, windows);
            } else {
              windows.push({ x: b.x - 4, y: 1.6, z: b.z + b.depth / 2 + 0.08, w: 1.6, h: 2.6, d: 0.12, color: 0x82999f });
            }
          }
        }
      }
    }
    for (const district of Object.keys(towers) as District[]) {
      this.batch(towers[district], district === "oldtown" || district === "warehouse" ? this.assets.bricks : this.facades[district]);
    }
    this.batch(details);
    this.batch(sidewalks, this.assets.pavement);
    this.batch(windows, this.glass);
    this.batch(glowing, this.litWindows);
    const roofGeometry = new THREE.CylinderGeometry(0, 1, 1, 4);
    roofGeometry.rotateY(Math.PI / 4);
    roofGeometry.scale(Math.SQRT1_2, 1, Math.SQRT1_2);
    const roofMesh = new THREE.InstancedMesh(roofGeometry, this.bodyMaterial, roofs.length);
    const dummy = new THREE.Object3D();
    for (const [i, roof] of roofs.entries()) {
      dummy.position.set(roof.x, roof.y, roof.z);
      dummy.scale.set(roof.w, roof.h, roof.d);
      dummy.updateMatrix();
      roofMesh.setMatrixAt(i, dummy.matrix);
      roofMesh.setColorAt(i, new THREE.Color(roof.color));
    }
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    this.scene.add(roofMesh);
    this.sign("CENTRALPARKEN", 0, 3.2, 20, 9, "#28684d");
    this.sign("POLIS  /  CITY PATROL", -320, 3.2, 285, 9, "#244783");
  }

  private makeShop(b: Block, cafe: boolean, index: number, details: Box[], windows: Box[]): void {
    const front = b.z + b.depth / 2;
    const color = cafe ? 0x326a61 : 0x934b3e;
    windows.push({ x: b.x, y: 1.6, z: front + 0.06, w: 13, h: 2.8, d: 0.12, color: 0xc3d1cc });
    for (const dx of [-6.6, -2.2, 2.2, 6.6]) {
      details.push({ x: b.x + dx, y: 1.6, z: front + 0.15, w: 0.14, h: 3, d: 0.2, color: 0x303c3e });
    }
    details.push({ x: b.x, y: 3.6, z: front + 0.9, w: 14, h: 0.18, d: 2, color });
    for (let dx = -6; dx <= 6; dx += 2) {
      details.push({ x: b.x + dx, y: 3.71, z: front + 0.9, w: 0.8, h: 0.04, d: 2, color: 0xe5dcca });
    }
    const kind = cafe ? "cafe" : index % 2 === 0 ? "shop" : "restaurant";
    const variant = Math.floor(index / 2) % 3;
    const names = kind === "cafe" ? ["Café Linden", "Kafferosteriet", "Espresso Norr"]
      : kind === "restaurant" ? ["Bistro Hamnen", "Trattoria", "Brasseriet"] : ["Norrhamns Bokhandel", "Saluhallen", "Ateljé Norr"];
    const name = names[variant];
    this.venues.push({
      id: `city-${b.x}-${b.z}`, name, kind, variant, rotation: 0,
      entrance: new THREE.Vector3(b.x, 0, front + 1.1),
    });
    this.sign(name.toLocaleUpperCase("sv-SE"), b.x, 4.3, front + 0.2, 12, cafe ? "#23594f" : "#73382e");
    for (const side of [-1, 1]) {
      details.push({ x: b.x + side * 0.95, y: 1.5, z: front + 0.22, w: 0.12, h: 3, d: 0.18, color: 0xd4c3a1 });
    }
    details.push({ x: b.x + 0.65, y: 1.25, z: front + 0.34, w: 0.07, h: 0.5, d: 0.08, color: 0xe0c38d });
    this.sign("ÖPPET · E", b.x, 2.7, front + 0.35, 1.65, "#244c36");
    for (const dx of [-4, 4]) {
      const x = b.x + dx;
      const z = front + 2.4;
      this.placeProp(this.assets.furniture, x, z, 1.1, Math.PI / 2);
      this.streetFurniture.push({ x, z, radius: 0.75 });
      for (const side of [-1, 1]) {
        this.streetFurniture.push({ x: x + side * 0.95, z, radius: 0.35 });
      }
      details.push({ x, y: 0.9, z, w: 0.12, h: 0.2, d: 0.12, color: 0xf4efdd });
    }
    this.localLights.push({ position: new THREE.Vector3(b.x, 3, front + 1.4), color: 0xffc588 });
    details.push({ x: b.x + 7, y: 0.45, z: front + 2.4, w: 1.5, h: 0.8, d: 0.7, color: 0x70604b });
    details.push({ x: b.x + 7, y: 1, z: front + 2.4, w: 1.6, h: 0.6, d: 0.8, color: 0x4b7651 });
    this.streetFurniture.push({ x: b.x + 7, z: front + 2.4, radius: 0.9 });
  }

  private makeStreetLife(): void {
    const details: Box[] = [];
    const lamps: Box[] = [];
    for (let ix = 0; ix < 11; ix += 2) {
      for (let iz = 0; iz < 11; iz += 2) {
        const x = -300 + ix * 60 + 19;
        const z = -300 + iz * 60;
        this.placeProp(this.assets.lamp, x, z, 1.4);
        lamps.push({ x, y: 4.6, z, w: 0.12, h: 0.14, d: 0.12, color: 0xffe1b3 });
        this.localLights.push({ position: new THREE.Vector3(x, 4.6, z), color: 0xffd9a3 });
        this.streetFurniture.push({ x, z, radius: 0.2 });
      }
    }
    for (const [x, z] of [[-305, 288], [-297, 288], [0, 10], [60, 10], [0, -10], [60, -10]]) {
      details.push({ x, y: 0.5, z, w: 3, h: 0.16, d: 0.7, color: 0x9c7857 });
      details.push({ x, y: 0.95, z: z - 0.3, w: 3, h: 0.65, d: 0.12, color: 0x9c7857 });
      for (const side of [-1, 1]) {
        details.push({ x: x + side, y: 0.25, z, w: 0.12, h: 0.5, d: 0.7, color: 0x394650 });
      }
      this.blocks.push({ x, z, width: 3, depth: 0.8, height: 1.3 });
    }
    for (const x of [-308, -294]) {
      details.push({ x, y: 1.8, z: 287, w: 0.2, h: 3.6, d: 0.2, color: 0x394650 });
      this.streetFurniture.push({ x, z: 287, radius: 0.2 });
    }
    details.push({ x: -301, y: 3.6, z: 288, w: 15, h: 0.2, d: 4, color: 0x486d7b });
    this.batch(details);
    this.batch(lamps, this.headlights);
  }

  private placeProp(template: THREE.Group, x: number, z: number, scale = 1, rotation = 0): THREE.Group {
    const prop = template.clone(true);
    prop.position.set(x, 0, z);
    prop.scale.setScalar(scale);
    prop.rotation.y = rotation;
    this.scene.add(prop);
    this.props.push(prop);
    return prop;
  }

  private makeBoulevards(): void {
    const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.34, 4, 8);
    const leavesGeometry = new THREE.IcosahedronGeometry(1, 2);
    const bark = new THREE.MeshStandardMaterial({ color: 0x625044, roughness: 0.96 });
    const foliage = [0x416b3b, 0x527c40, 0x688747].map(color =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    const trees: { x: number; z: number; scale: number }[] = [];
    for (const x of [0, 60]) {
      for (const side of [-1, 1]) {
        for (const z of [-12, 0, 12]) trees.push({ x: x + side * 12, z, scale: 1 });
      }
    }
    for (let z = 272; z <= 336; z += 8) {
      trees.push({ x: -359 - (z % 3) * 3, z, scale: 1.4 });
      if (Math.abs(z - CITY_FOREST_GATE.z) > 18) trees.push({ x: -346, z, scale: 1.2 });
    }
    for (const [x, z] of [[-300, 283], [-240, 283], [-240, 317], [-180, 283], [-180, 317], [-120, 283]]) {
      trees.push({ x, z, scale: 0.8 });
    }
    this.batch([{ x: -377, y: -0.1, z: 304, w: 48, h: 0.1, d: 112, color: 0x547044 }]);
    for (const [i, tree] of trees.entries()) {
      const group = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeometry, bark);
      trunk.position.y = 2;
      trunk.castShadow = true;
      group.add(trunk);
      for (let crown = 0; crown < 7; crown++) {
        const angle = crown * 2.4;
        const leaves = new THREE.Mesh(leavesGeometry, foliage[(i + crown) % foliage.length]);
        leaves.position.set(Math.cos(angle) * 1.1, 4.5 + (crown % 3) * 0.7, Math.sin(angle) * 1.1);
        leaves.scale.set(1.5, 1.9, 1.5);
        leaves.castShadow = true;
        leaves.receiveShadow = true;
        group.add(leaves);
      }
      group.position.set(tree.x, 0, tree.z);
      group.scale.setScalar(tree.scale);
      this.treeVolumes.push({ x: tree.x, z: tree.z, radius: 2.6 * tree.scale, height: 7.8 * tree.scale });
      this.scene.add(group);
      this.props.push(group);
      this.streetFurniture.push({ x: tree.x, z: tree.z, radius: 0.34 * tree.scale });
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3, 0.35, 8, 40), this.chrome);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(60, 0.5, 0);
    this.scene.add(rim);
    const water = new THREE.Mesh(new THREE.CircleGeometry(3, 40),
      new THREE.MeshPhysicalMaterial({ color: 0x55939a, metalness: 0.4, roughness: 0.12, clearcoat: 1 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(60, 0.45, 0);
    this.scene.add(water);
    this.streetFurniture.push({ x: 60, z: 0, radius: 3.4 });
    const droplets = new THREE.BufferGeometry();
    droplets.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(120 * 3), 3));
    droplets.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.8, 0), 4);
    this.fountain = new THREE.Points(droplets, new THREE.PointsMaterial({
      color: 0xc0ecf1, size: 0.085, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    this.fountain.position.set(60, 0, 0);
    this.scene.add(this.fountain);
  }

  private makeTrafficLights(): void {
    const poles: Box[] = [];
    const lamps: Record<Axis, Record<"red" | "amber" | "green", Box[]>> = {
      x: { red: [], amber: [], green: [] }, z: { red: [], amber: [], green: [] },
    };
    for (const x of STREETS) {
      for (const z of STREETS) {
        for (const side of [-1, 1]) {
          const px = x + side * 9;
          const pz = z + side * 9;
          poles.push({ x: px, y: 2.7, z: pz, w: 0.18, h: 5.4, d: 0.18, color: 0x34424e });
          this.streetFurniture.push({ x: px, z: pz, radius: 0.2 });
          for (const axis of ["x", "z"] as const) {
            const lx = px + (axis === "z" ? -side * 3 : 0);
            const lz = pz + (axis === "x" ? -side * 3 : 0);
            poles.push({ x: (px + lx) / 2, y: 5.3, z: (pz + lz) / 2, w: axis === "z" ? 3.2 : 0.15, h: 0.15, d: axis === "x" ? 3.2 : 0.15, color: 0x34424e });
            poles.push({ x: lx, y: 4.6, z: lz, w: 0.75, h: 1.7, d: 0.75, color: 0x20252e });
            for (const [i, color] of (["red", "amber", "green"] as const).entries()) {
              lamps[axis][color].push({
                x: lx + (axis === "x" ? -side * 0.4 : 0), y: 5.1 - i * 0.5,
                z: lz + (axis === "z" ? -side * 0.4 : 0),
                w: axis === "x" ? 0.05 : 0.42, h: 0.35, d: axis === "z" ? 0.05 : 0.42, color: 0xffffff,
              });
            }
          }
        }
      }
    }
    this.batch(poles);
    for (const axis of ["x", "z"] as const) {
      for (const color of ["red", "amber", "green"] as const) this.batch(lamps[axis][color], this.signals[axis][color]);
    }
  }

  private makeVehicle(kind: VehicleKind, x: number, z: number, heading: number): Vehicle {
    const group = new THREE.Group();
    if (kind === "bmw") {
      const { body, wheels } = createBmw();
      group.add(body);
      return this.registerVehicle(group, kind, body, wheels, x, z, heading);
    }
    const body = new THREE.Group();
    group.add(body);
    const long = kind === "bus" ? 7.4 : kind === "van" ? 4.8 : 4.2;
    const color = { taxi: 0xf3bd32, car: 0xd44f47, bus: 0x3c91a4, police: 0xe5edf4, van: 0xddd0ae }[kind];
    const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.65, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.16 });
    const box = (w: number, h: number, d: number, px: number, py: number, pz: number, material: THREE.Material, rounded = false) => {
      const mesh = new THREE.Mesh(rounded ? this.roundedGeometry : this.bodyGeometry, material);
      mesh.scale.set(w, h, d);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);
      return mesh;
    };
    const tall = kind === "bus" || kind === "van";
    box(2.08, 0.64, long, 0, 0.91, 0, paint, true);
    box(1.9, 0.15, long * 0.92, 0, 0.54, 0, this.rubber, true);
    box(1.98, 0.25, long * 0.94, 0, 1.17, 0, paint, true);
    const roofY = tall ? 2.65 : 2.08;
    if (tall) {
      box(1.98, 1.36, long - 0.4, 0, 1.92, -0.08, paint, true);
      box(1.73, 0.98, 0.055, 0, 2.02, long / 2 - 0.26, this.glass);
      if (kind === "bus") {
        for (let pz = -long / 2 + 0.85; pz < long / 2 - 0.5; pz += 1.05) {
          for (const side of [-1, 1]) {
            box(0.04, 0.83, 0.87, side * 1.005, 2.05, pz, this.glass);
            box(0.045, 0.08, 0.87, side * 1.035, 2.05, pz, this.chrome);
          }
        }
        box(0.045, 1.85, 0.8, 1.02, 1.46, 2.25, this.glass);
        box(1.5, 0.2, 0.04, 0, 2.57, long / 2 - 0.25, this.headlights);
      } else {
        for (const side of [-1, 1]) {
          box(0.04, 0.8, 1, side * 1.005, 2.05, 1.4, this.glass);
          box(0.04, 0.95, 2.4, side * 1.005, 1.9, -0.5, paint);
        }
        box(0.035, 1.65, 0.045, 0, 1.77, -long / 2 - 0.01, this.rubber);
      }
    } else {
      // Sloped glazing and a narrow roof give the cabin an actual sedan silhouette.
      const cabin = new THREE.BufferGeometry();
      cabin.setAttribute("position", new THREE.Float32BufferAttribute([
        -0.94, 1.28, -1.35, 0.94, 1.28, -1.35, -0.94, 1.28, 1.16, 0.94, 1.28, 1.16,
        -0.79, 2.02, -0.85, 0.79, 2.02, -0.85, -0.79, 2.02, 0.55, 0.79, 2.02, 0.55,
      ], 3));
      cabin.setIndex([0, 5, 1, 0, 4, 5, 2, 7, 6, 2, 3, 7, 0, 6, 4, 0, 2, 6, 1, 7, 3, 1, 5, 7, 4, 7, 5, 4, 6, 7]);
      cabin.computeVertexNormals();
      const glazing = new THREE.Mesh(cabin, this.glass);
      glazing.castShadow = true;
      body.add(glazing);
      box(1.68, 0.13, 1.55, 0, roofY, -0.15, paint, true);
      for (const side of [-1, 1]) {
        const pillar = box(0.1, 0.76, 0.12, side * 0.865, 1.65, -0.1, this.rubber);
        pillar.rotation.z = side * 0.2;
        const frontPillar = box(0.09, 0.98, 0.09, side * 0.865, 1.65, 0.85, paint);
        frontPillar.rotation.x = -0.69;
        const rearPillar = box(0.11, 0.91, 0.1, side * 0.865, 1.65, -1.1, paint);
        rearPillar.rotation.x = 0.59;
      }
      box(1.85, 0.09, 0.8, 0, 1.31, 1.6, paint, true);
      if (kind === "car") {
        box(1.9, 0.09, 0.38, 0, 1.55, -1.85, paint, true);
        for (const side of [-1, 1]) box(0.08, 0.25, 0.12, side * 0.6, 1.4, -1.85, this.rubber);
      }
    }
    if (tall) box(2, 0.16, long - 0.3, 0, roofY + 0.05, -0.08, paint, true);
    for (const side of [-1, 1]) {
      box(0.32, 0.18, 0.36, side * 1.12, tall ? 2 : 1.55, tall ? long / 2 - 0.7 : 0.85, paint, true);
      box(0.25, 0.12, 0.03, side * 1.12, tall ? 2 : 1.55, tall ? long / 2 - 0.9 : 0.66, this.chrome);
      box(0.035, 0.04, long * 0.7, side * 1.045, 1.13, 0, this.chrome);
      for (const door of [-0.85, 0.45]) {
        box(0.045, 0.07, 0.23, side * 1.048, 1.17, door, this.chrome, true);
        box(0.02, 0.43, 0.018, side * 1.046, 0.89, door - 0.25, this.rubber);
      }
    }
    for (const end of [-1, 1]) {
      box(1.92, 0.18, 0.13, 0, 0.68, end * long / 2, this.chrome, true);
      box(0.46, 0.17, 0.035, 0, 0.9, end * (long / 2 + 0.075), this.headlights);
    }
    box(0.86, 0.24, 0.04, 0, 1.12, long / 2 + 0.025, this.rubber);
    for (const y of [1.04, 1.12, 1.2]) box(0.78, 0.018, 0.04, 0, y, long / 2 + 0.05, this.chrome);
    if (kind === "police") {
      for (const side of [-1, 1]) box(0.025, 0.22, long * 0.75, side * 1.05, 0.97, 0, this.rubber);
      for (const side of [-1, 1]) {
        box(0.7, 0.18, 0.4, side * 0.4, 2.32, 0, new THREE.MeshStandardMaterial({
          color: side < 0 ? 0x3185ff : 0xfa5448, emissive: side < 0 ? 0x1249e0 : 0xe02b16, emissiveIntensity: 1.2,
        }));
      }
    }
    if (kind === "taxi") box(0.65, 0.3, 0.35, 0, 2.35, 0, paint);
    const wheels: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      box(0.45, 0.16, 0.08, side * 0.7, 1.16, long / 2 + 0.03, this.headlights, true);
      box(0.4, 0.16, 0.08, side * 0.7, 1.12, -long / 2 - 0.03, this.taillights, true);
      for (const axle of [-1, 1]) {
        const wheel = new THREE.Mesh(this.wheelGeometry, this.rubber);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 1.08, 0.48, axle * (long / 2 - 0.8));
        wheel.castShadow = true;
        const rim = new THREE.Mesh(this.rimGeometry, this.chrome);
        rim.position.y = -side * 0.165;
        wheel.add(rim);
        for (let spoke = 0; spoke < 5; spoke++) {
          const inset = new THREE.Mesh(this.bodyGeometry, this.rubber);
          inset.scale.set(0.07, 0.027, 0.38);
          inset.rotation.y = spoke * Math.PI * 2 / 5;
          inset.position.y = -side * 0.184;
          wheel.add(inset);
        }
        body.add(wheel);
        wheels.push(wheel);
      }
    }
    const detail = kind === "car" ? this.assets.car.clone(true) : null;
    const detailWheels: Vehicle["detailWheels"] = [];
    if (detail) {
      const axleNames = ["WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR"];
      for (const name of axleNames) {
        const wheel = detail.getObjectByName(name);
        if (!wheel) throw new Error(`Bilmodellen saknar hjul: ${name}`);
        // The asset faces +Z, but its wheel groups contain presentation poses.
        // Reparent before scaling, then align each wheel's native X axle with the car.
        detail.attach(wheel);
        wheel.quaternion.identity();
        const brakePad = wheel.getObjectByName(`${name}BrakePad`);
        if (!brakePad) throw new Error(`Bilmodellen saknar bromsdel: ${name}`);
        detail.attach(brakePad);
        const wheelSize = new THREE.Box3().setFromObject(wheel, true).getSize(new THREE.Vector3());
        detailWheels.push({ pivot: wheel, radius: Math.max(wheelSize.y, wheelSize.z) / 2 });
      }
      const bounds = new THREE.Box3().setFromObject(detail, true);
      const size = bounds.getSize(new THREE.Vector3());
      const scale = SPORT_CAR_LENGTH / size.z;
      const center = bounds.getCenter(new THREE.Vector3());
      detail.scale.setScalar(scale);
      detail.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      for (const wheel of detailWheels) wheel.radius *= scale;
      // Match both LOD silhouettes to the visible asset, not to its old enclosing circle.
      const proxyBounds = new THREE.Box3().setFromObject(body, true);
      const proxySize = proxyBounds.getSize(new THREE.Vector3());
      body.scale.set(size.x * scale / proxySize.x, size.y * scale / proxySize.y, SPORT_CAR_LENGTH / proxySize.z);
      const proxyCenter = proxyBounds.getCenter(new THREE.Vector3());
      body.position.set(-proxyCenter.x * body.scale.x, -proxyBounds.min.y * body.scale.y, -proxyCenter.z * body.scale.z);
      group.add(detail);
      detail.visible = false;
    }
    return this.registerVehicle(group, kind, body, wheels, x, z, heading, detail, detailWheels);
  }

  private registerVehicle(
    group: THREE.Group, kind: VehicleKind, body: THREE.Group, wheels: THREE.Mesh[],
    x: number, z: number, heading: number, detail: THREE.Group | null = null,
    detailWheels: Vehicle["detailWheels"] = [],
  ): Vehicle {
    const bounds = new THREE.Box3().setFromObject(detail ?? body, true);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    if (!(size.x > 0 && size.z > 0)) throw new Error(`Fordonet ${kind} saknar kollisionsmått.`);
    const halfWidth = size.x / 2;
    const halfLength = size.z / 2;
    const radius = Math.hypot(halfWidth, halfLength);
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    group.name = VEHICLE_NAMES[kind];
    this.scene.add(group);
    const vehicle: Vehicle = {
      group, kind, radius, halfWidth, halfLength, centerX: center.x, centerZ: center.z, policeDuty: false, speed: 0,
      maxSpeed: kind === "bmw" ? 400 / 3.6 : kind === "bus" ? 19 : kind === "car" ? 32 : 25,
      wheels, body, detail, detailWheels, route: [], waypoint: 0, automatic: false,
    };
    this.vehicles.push(vehicle);
    return vehicle;
  }

  private makeVehicles(): void {
    const kinds: VehicleKind[] = ["taxi", "car", "bus", "police", "van"];
    for (let i = 0; i < kinds.length; i++) this.makeVehicle(kinds[i], -315 + i * 7, 307, Math.PI);
    this.makeVehicle("bmw", -278, 307, Math.PI);
    for (let i = 0; i < 30; i++) {
      const column = i % 6;
      const row = Math.floor(i / 6);
      const left = STREETS[column];
      const right = STREETS[column + 5];
      const top = STREETS[row];
      const bottom = STREETS[row + 6];
      const route = [
        new THREE.Vector3(left + 3.5, 0, top + 3.5),
        new THREE.Vector3(right - 3.5, 0, top + 3.5),
        new THREE.Vector3(right - 3.5, 0, bottom - 3.5),
        new THREE.Vector3(left + 3.5, 0, bottom - 3.5),
      ];
      const start = i % 4;
      const from = route[start];
      const to = route[(start + 1) % 4];
      const position = from.clone().lerp(to, 0.15 + (i % 3) * 0.23);
      const v = this.makeVehicle(kinds[i % kinds.length], position.x, position.z, Math.atan2(to.x - from.x, to.z - from.z));
      v.route = route;
      v.waypoint = (start + 1) % 4;
      v.automatic = true;
    }
  }

  private makeOfficers(): void {
    for (const [i, [x, z]] of [[-320, 285], [-20, 5], [80, -8], [160, -170]].entries()) {
      const character = new Character(0x234878, false);
      character.group.position.set(x, 0, z);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.13, 10), new THREE.MeshStandardMaterial({ color: 0x183256 }));
      cap.position.y = 2.1;
      character.group.add(cap);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0xffd265 }));
      badge.position.set(0.13, 1.4, 0.27);
      character.group.add(badge);
      this.scene.add(character.group);
      this.officers.push({ character, home: character.group.position.clone(), name: ["Sam", "Kim", "Alex", "Robin"][i] });
    }
  }

  private makePedestrians(): void {
    const colors = [0x416778, 0xa25d4b, 0xc4a16b, 0x535b72, 0x628060, 0x927290];
    const centers = [
      [-300, 300], [-240, 300], [-240, 240], [-180, 180], [-60, 60],
      [-180, 300], [-300, 240], [-180, 240], [-120, 300], [-120, 240],
      [-240, -180], [-180, -120], [-60, -60], [0, 0], [60, 0],
      [-120, -120], [-180, -60], [-240, -60], [120, 0], [0, 120],
      [60, -120], [120, -180], [240, -240], [60, 120], [180, 180], [240, 300],
    ];
    for (const [i, [x, z]] of centers.entries()) {
      for (let j = 0; j < 4; j++) {
        const character = new Character(colors[(i + j) % colors.length], false);
        const route = [[-20.5, 20.5], [-20.5, -20.5], [20.5, -20.5], [20.5, 20.5]]
          .map(([dx, dz]) => new THREE.Vector3(x + dx, 0, z + dz));
        const start = j % route.length;
        character.group.position.copy(route[start]).lerp(route[(start + 1) % route.length], 0.15 + j * 0.2);
        character.group.scale.setScalar(0.88 + (i + j) % 4 * 0.05);
        this.scene.add(character.group);
        this.pedestrians.push({ character, route, waypoint: (start + 1) % route.length, speed: 0.85 + (i + j) % 4 * 0.15, pause: 0 });
      }
    }
    for (const [i, [x, z]] of [[-270, 270], [-210, 270], [-150, 270], [-30, -30], [90, -90], [150, 150]].entries()) {
      const route = [new THREE.Vector3(x - 12, 0, z + 10), new THREE.Vector3(x + 12, 0, z + 10)];
      const character = new Character(colors[i % colors.length], false);
      character.group.position.copy(route[0]);
      this.scene.add(character.group);
      this.pedestrians.push({ character, route, waypoint: 1, speed: 1.25, pause: 0, crossingAxis: "z" });
    }
    // Small groups linger by the shop windows, clear of the through-walkway.
    for (const [i, [x, z]] of [[-250, 317.1], [-190, -42.9], [110, -42.9], [290, 17.1]].entries()) {
      for (const side of [-1, 1]) {
        const character = new Character(colors[(i + (side > 0 ? 1 : 0)) % colors.length], false);
        character.group.position.set(x + side * 1.3, 0, z);
        character.group.rotation.y = -side * Math.PI / 2;
        this.scene.add(character.group);
        this.pedestrians.push({ character, route: [], waypoint: 0, speed: 0, pause: 0 });
      }
    }
  }

  private sign(text: string, x: number, y: number, z: number, width: number, background: string, rotation = 0): void {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Kunde inte skapa stadens skyltar.");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 512, 64);
    ctx.strokeStyle = "#d7e7e5";
    ctx.strokeRect(3, 3, 506, 58);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 25px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 41);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 8), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    sign.position.set(x, y, z);
    sign.rotation.y = rotation;
    this.scene.add(sign);
  }
}
