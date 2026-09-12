import * as THREE from "three";
import { Character } from "./character";
import type { CityVenue } from "./city";
import { distanceToFootprint } from "./interior";
import type { Footprint } from "./interior";

type Resident = {
  character: Character;
  name: string;
  role: string;
  line: string;
  route: THREE.Vector3[];
  waypoint: number;
  seated: boolean;
};
type Layout = {
  group: THREE.Group;
  furniture: Footprint[];
  residents: Resident[];
  accent: THREE.MeshStandardMaterial;
};

export class VenueInterior {
  readonly scene = new THREE.Scene();
  readonly spawn = new THREE.Vector3(0, 0, 6.8);
  readonly exit = new THREE.Vector3(0, 0, 8);
  private readonly layouts = new Map<string, Layout>();
  private layout: Layout | null = null;
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 20);
  private readonly wood = this.material(0x865c3d);
  private readonly cream = this.material(0xe6dcc6);
  private readonly dark = this.material(0x303b40);
  private readonly steel = this.material(0xb5c0c3, 0.75, 0.3);
  private readonly glass = new THREE.MeshPhysicalMaterial({
    color: 0xa9ccd2, transparent: true, opacity: 0.25, roughness: 0.12, depthWrite: false,
  });
  private readonly goods = [0xb95548, 0xd4b574, 0x688d5b, 0x668bb0, 0xa77b98].map(color => this.material(color));
  private time = 0;

  constructor(private readonly diningSet: THREE.Group, environment: THREE.Texture | null) {
    this.scene.background = new THREE.Color(0x292f34);
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.35;
    this.scene.add(new THREE.HemisphereLight(0xfff0db, 0x6f625a, 1.9));
    const sun = new THREE.DirectionalLight(0xffebcd, 2);
    sun.position.set(-4, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -12;
    sun.shadow.camera.right = sun.shadow.camera.top = 12;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun);
    for (const x of [-5, 5]) {
      const light = new THREE.PointLight(0xffd8a3, 18, 15, 2);
      light.position.set(x, 3.5, 0);
      this.scene.add(light);
    }
  }

  enter(venue: CityVenue): void {
    const key = `${venue.kind}-${venue.variant}`;
    let layout = this.layouts.get(key);
    if (!layout) {
      layout = { group: new THREE.Group(), furniture: [], residents: [], accent: this.material(0x466c61) };
      this.makeRoom(layout, venue);
      if (venue.kind === "shop") this.makeShop(layout, venue);
      else this.makeDining(layout, venue);
      this.layouts.set(key, layout);
    }
    if (this.layout) this.scene.remove(this.layout.group);
    this.layout = layout;
    this.scene.add(layout.group);
    this.scene.name = venue.name;
    this.scene.userData.venueId = venue.id;
    let seed = 0;
    for (const char of venue.id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    layout.accent.color.setHex([0x456d60, 0x915649, 0x527287, 0x907047][seed % 4]);
    for (const [i, resident] of layout.residents.entries()) {
      resident.name = ["Sofia", "Malik", "Tove", "Aron", "Ines", "Hugo", "Lina", "Sami"][(seed + i) % 8];
      if (resident.route.length) {
        resident.character.group.position.copy(resident.route[0]);
        resident.waypoint = 1 % resident.route.length;
      }
    }
  }

  heightAt(_x: number, _z: number): number { return 0; }

  blocked(x: number, z: number, radius = 0.45): boolean {
    if (!this.layout) throw new Error("Ingen stadslokal är öppen.");
    return this.sceneryBlocked(x, z, radius, this.layout)
      || this.layout.residents.some(person => Math.hypot(x - person.character.group.position.x, z - person.character.group.position.z) < radius + 0.4);
  }

  nearExit(position: THREE.Vector3): boolean { return position.distanceTo(this.exit) < 1.7; }

  nearResident(position: THREE.Vector3): Resident | undefined {
    return this.layout?.residents
      .filter(person => person.character.group.position.distanceTo(position) < 3.3)
      .sort((a, b) => a.character.group.position.distanceToSquared(position) - b.character.group.position.distanceToSquared(position))[0];
  }

  update(dt: number, player: THREE.Vector3): void {
    if (!this.layout) throw new Error("Ingen stadslokal är öppen.");
    this.time += dt;
    for (const [i, person] of this.layout.residents.entries()) {
      const p = person.character.group.position;
      let speed = 0;
      if (person.route.length > 1) {
        const target = person.route[person.waypoint];
        const distance = p.distanceTo(target);
        if (distance < 0.05) person.waypoint = (person.waypoint + 1) % person.route.length;
        else {
          const step = Math.min(distance, dt * 0.65);
          const dx = (target.x - p.x) / distance;
          const dz = (target.z - p.z) / distance;
          const x = p.x + dx * step;
          const z = p.z + dz * step;
          const occupied = this.layout.residents.some(other => other !== person
            && Math.hypot(x - other.character.group.position.x, z - other.character.group.position.z) < 0.9);
          if (!occupied && !this.sceneryBlocked(x, z, 0.4, this.layout) && Math.hypot(x - player.x, z - player.z) > 1.1) {
            p.set(x, 0, z);
            person.character.group.rotation.y = Math.atan2(dx, dz);
            speed = 0.65;
          }
        }
      }
      person.character.update(dt, speed, this.time + i * 2);
    }
  }

  private sceneryBlocked(x: number, z: number, radius: number, layout: Layout): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius)) return true;
    return Math.abs(x) + radius >= 9.8 || Math.abs(z) + radius >= 8.8
      || layout.furniture.some(item => distanceToFootprint(x, z, item) <= radius);
  }

  private material(color: number, metalness = 0, roughness = 0.8): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness });
  }

  private box(layout: Layout, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = mesh.receiveShadow = true;
    layout.group.add(mesh);
    return mesh;
  }

  private solid(layout: Layout, x: number, z: number, w: number, h: number, d: number, material: THREE.Material): void {
    this.box(layout, x, h / 2, z, w, h, d, material);
    layout.furniture.push({ x, z, halfX: w / 2, halfZ: d / 2 });
  }

  private cylinder(layout: Layout, x: number, y: number, z: number, radius: number, height: number, material: THREE.Material): void {
    const mesh = new THREE.Mesh(this.cylinderGeometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, height, radius);
    mesh.castShadow = mesh.receiveShadow = true;
    layout.group.add(mesh);
  }

  private sign(layout: Layout, text: string, x: number, y: number, z: number, width: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 768; canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Kunde inte skapa lokalens skylt.");
    ctx.fillStyle = "#233632"; ctx.fillRect(0, 0, 768, 256);
    ctx.fillStyle = "#f6e6c6"; ctx.font = "32px sans-serif"; ctx.textAlign = "center";
    text.split("\n").forEach((line, i) => ctx.fillText(line, 384, 56 + i * 62));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 3),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z);
    layout.group.add(mesh);
  }

  private makeRoom(layout: Layout, venue: CityVenue): void {
    this.box(layout, 0, -0.16, 0, 20, 0.3, 18, this.wood);
    for (let x = -9; x <= 9; x++) {
      for (let z = -8; z <= 8; z++) {
        this.box(layout, x, -0.015, z, 0.98, 0.03, 0.98,
          venue.kind === "restaurant" && (x + z) % 2 === 0 ? this.dark : this.cream);
      }
    }
    const cutaway = this.material(0xd4c5ad);
    cutaway.transparent = true; cutaway.opacity = 0.16; cutaway.depthWrite = false;
    for (const side of [-1, 1]) {
      this.box(layout, side * 9.9, 0.45, 0, 0.2, 0.9, 18, layout.accent);
      this.box(layout, side * 9.9, 2.2, 0, 0.2, 2.6, 18, cutaway).castShadow = false;
      this.box(layout, side * 5.75, 0.45, 8.9, 8.3, 0.9, 0.2, layout.accent);
      this.box(layout, side * 1.6, 1.5, 8.85, 0.15, 3, 0.2, this.wood);
      this.box(layout, side * 5, 2.1, -8.65, 3, 1.6, 0.08, this.glass);
      this.cylinder(layout, side * 5, 3.5, 1.5, 0.5, 0.25, this.steel);
    }
    this.box(layout, 0, 0.45, -8.9, 19.6, 0.9, 0.2, layout.accent);
    this.box(layout, 0, 2.2, -8.9, 19.6, 2.6, 0.2, cutaway).castShadow = false;
    this.box(layout, 0, 3, 8.85, 3.35, 0.16, 0.2, this.wood);
    this.box(layout, 0, 0.025, 7.9, 2.8, 0.05, 1.7, layout.accent);
    this.sign(layout, "UTGÅNG · E", 0, 3.35, 8.85, 3);
    const titles = { cafe: "KAFFE & NYBAKAT", restaurant: "KÖK & MATSAL", shop: ["BÖCKER & PAPPER", "FRUKT & DELIKATESSER", "KLÄDER & DESIGN"][venue.variant] };
    this.sign(layout, titles[venue.kind], 0, 2.7, -8.7, 4);
    for (const x of [-8.7, 8.7]) {
      this.solid(layout, x, 7.3, 0.8, 0.7, 0.8, this.wood);
      const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), this.goods[2]);
      plant.position.set(x, 1.15, 7.3);
      layout.group.add(plant);
    }
  }

  private resident(layout: Layout, role: string, line: string, x: number, z: number, color: number, seated = false, endZ?: number): void {
    const character = new Character(color, false);
    character.group.position.set(x, 0, z);
    character.group.rotation.y = seated ? Math.PI : 0;
    character.setSeated(seated);
    if (role === "Kock") this.cookHat(character);
    layout.group.add(character.group);
    layout.residents.push({
      character, name: "", role, line, seated, waypoint: 1,
      route: endZ === undefined ? [] : [new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 0, endZ)],
    });
    character.update(0, 0, 0);
  }

  private cookHat(character: Character): void {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.3, 12), this.cream);
    hat.position.y = 2.18;
    character.group.add(hat);
  }

  private diningTable(layout: Layout, x: number, z: number, occupied: boolean): void {
    const table = this.diningSet.clone(true);
    table.position.set(x, 0, z);
    table.scale.setScalar(1.5);
    layout.group.add(table);
    layout.furniture.push({ x, z, halfX: 0.8, halfZ: 1.4 });
    this.cylinder(layout, x, 1.13, z, 0.25, 0.04, this.cream);
    this.cylinder(layout, x + 0.3, 1.23, z, 0.08, 0.2, this.cream);
    this.cylinder(layout, x - 0.24, 1.19, z - 0.2, 0.1, 0.2, layout.accent);
    if (occupied) this.resident(layout, "Gäst", "Här sitter jag gärna en stund. Det är skönt att ta en paus från gatornas liv och rörelse.", x, z + 0.95, 0xa87560, true);
  }

  private makeDining(layout: Layout, venue: CityVenue): void {
    const cafe = venue.kind === "cafe";
    this.solid(layout, -5.4, -5, 6.5, 1.12, 1.3, layout.accent);
    this.box(layout, -5.4, 1.16, -5, 6.7, 0.15, 1.45, this.wood);
    this.solid(layout, -5.4, -8.1, 6.5, 1, 0.9, this.steel);
    this.box(layout, -7.4, 1.13, -8.1, 1.4, 0.08, 0.75, this.dark);
    this.box(layout, -7.4, 1.4, -8.3, 0.07, 0.55, 0.07, this.steel);
    this.box(layout, -7.4, 1.65, -8.15, 0.07, 0.07, 0.35, this.steel);
    this.solid(layout, 8.3, -7.2, 1.8, 2.7, 1.5, this.steel);
    this.box(layout, 8.3, 1.4, -6.4, 1.5, 2.25, 0.1, this.glass);
    if (cafe) {
      this.box(layout, -7, 1.6, -5, 1.6, 0.8, 0.8, this.steel);
      this.box(layout, -7, 1.65, -4.57, 1.35, 0.3, 0.06, this.dark);
      for (const x of [-7.4, -6.8]) this.cylinder(layout, x, 1.3, -4.7, 0.1, 0.2, this.cream);
      this.box(layout, -4.5, 1.65, -5, 2.3, 0.85, 1.1, this.glass);
      for (let i = 0; i < 6; i++) this.cylinder(layout, -5.3 + i * 0.3, 1.35, -4.8, 0.12, 0.16, this.goods[1]);
      this.sign(layout, "ESPRESSO · CAPPUCCINO\nKANELBULLE · CROISSANT\nDAGENS SMÖRGÅS", -4.8, 2.6, -8.6, 5);
      this.resident(layout, "Barista", "Välkommen! Espressomaskinen är varm och vi har precis fyllt på med nybakat. Se dig gärna omkring i caféet.", -5.4, -6.8, 0x507366);
    } else {
      for (const x of [-6.2, -4.2]) {
        this.box(layout, x, 1.1, -8.1, 1.6, 0.15, 0.85, this.dark);
        this.cylinder(layout, x, 1.35, -8.1, 0.3, 0.4, this.steel);
      }
      this.box(layout, -5.4, 2.7, -8.1, 4.2, 0.5, 1.1, this.steel);
      this.sign(layout, "DAGENS MENY\nSOPPA · PASTA · GRÖNT\nDESSERT FRÅN KÖKET", -5.2, 2.7, -8.6, 5);
      this.resident(layout, "Kock", "Välkommen till köket! Här förbereder vi dagens rätter medan gästerna slår sig ner i matsalen.", -5.4, -6.7, 0xe8e1cf);
      this.solid(layout, 5.1, -5.2, 4.5, 1.15, 1.2, this.wood);
      for (let i = 0; i < 6; i++) this.cylinder(layout, 3.5 + i * 0.6, 1.4, -5.2, 0.1, 0.45, this.goods[i % 5]);
      this.resident(layout, "Serveringspersonal", "Matsalen är öppen. Vid fönstret finns gott om plats, och köket ligger längst in till vänster.", 5.1, -6.7, 0x39495e);
      this.diningTable(layout, -5, 0, true);
    }
    this.box(layout, -2.9, 1.45, -4.9, 0.5, 0.45, 0.4, this.dark);
    this.diningTable(layout, -5, 4.7, true);
    this.diningTable(layout, 5, 0, true);
    this.diningTable(layout, 5, 4.7, false);
    this.resident(layout, "Stamgäst", "Jag brukar komma hit efter en promenad i Grönved. Dörren längst fram leder tillbaka till samma gata.", 2.6, 6.2, 0x927398, false, -2.4);
    this.resident(layout, "Besökare", "Det finns fler ställen att upptäcka i de andra kvarteren. Jag tittar in här innan jag går vidare.", -2.6, 1.8, 0x65829a, false, 6.4);
  }

  private makeShop(layout: Layout, venue: CityVenue): void {
    const labels = ["BOKHANDEL", "SALUHALL", "KLÄDBUTIK"];
    for (const x of [-6, 6]) {
      for (const z of [-1.3, 3.5]) {
        this.solid(layout, x, z, 3.6, 0.25, 1.4, this.wood);
        for (const side of [-1, 1]) this.box(layout, x + side * 1.72, 1.3, z, 0.14, 2.6, 1.4, this.wood);
        for (let level = 0; level < 3; level++) {
          const y = 0.45 + level * 0.8;
          this.box(layout, x, y, z, 3.6, 0.1, 1.4, this.wood);
          for (let i = 0; i < 8; i++) {
            const material = this.goods[(i + level + venue.variant) % 5];
            if (venue.variant === 1) {
              this.cylinder(layout, x - 1.4 + i * 0.4, y + 0.22, z, 0.16, 0.3, material);
            } else {
              this.box(layout, x - 1.4 + i * 0.4, y + 0.28, z, venue.variant === 0 ? 0.22 : 0.34, 0.46, 0.75, material);
            }
          }
        }
        layout.furniture.push({ x, z, halfX: 1.8, halfZ: 0.7 });
      }
    }
    this.solid(layout, 5, -6, 5.5, 1.15, 1.4, layout.accent);
    this.box(layout, 5, 1.24, -6, 5.7, 0.15, 1.5, this.wood);
    this.box(layout, 4.3, 1.6, -6, 0.75, 0.65, 0.25, this.dark);
    this.box(layout, 4.3, 1.62, -5.85, 0.6, 0.44, 0.03, this.glass);
    this.box(layout, 5.4, 1.45, -5.7, 0.25, 0.25, 0.35, this.dark);
    this.sign(layout, `${labels[venue.variant]}\nNYHETER · LOKALT · UTVALT\nKASSA & INFORMATION`, 5, 2.7, -8.6, 5);
    this.solid(layout, -5.8, -7.3, 4.8, 0.85, 1.5, this.wood);
    for (let i = 0; i < 7; i++) this.box(layout, -7.6 + i * 0.6, 1.1, -7.3, 0.45, 0.4, 0.7, this.goods[i % 5]);
    if (venue.variant === 2) {
      this.box(layout, -5.8, 2.15, -7.3, 4.6, 0.07, 0.07, this.steel);
      for (const x of [-8, -3.6]) this.box(layout, x, 1.5, -7.3, 0.08, 1.4, 0.08, this.steel);
      for (let i = 0; i < 5; i++) {
        const x = -7.5 + i * 0.85;
        const material = this.goods[i];
        this.box(layout, x, 1.75, -7.3, 0.55, 0.65, 0.2, material);
        this.box(layout, x, 1.94, -7.3, 0.8, 0.22, 0.2, material);
      }
      this.box(layout, -9.7, 1.8, -4.2, 0.08, 2.6, 1.4, this.steel);
    } else if (venue.variant === 1) {
      this.box(layout, -5.8, 1.6, -7.3, 4.8, 0.8, 1.55, this.glass);
      this.sign(layout, "FÄRSKT FRÅN TRAKTEN", -5.8, 2.4, -8.6, 4);
    } else {
      this.sign(layout, "ROMANER · RESOR · GRÖNVED\nVECKANS LÄSTIPS", -5.8, 2.4, -8.6, 4);
    }
    this.resident(layout, "Butiksägare", [
      "Välkommen till bokhandeln! På hyllorna finns romaner, reseböcker och berättelser om Grönved. Titta gärna runt.",
      "Välkommen till saluhallen! Här hittar du lokala råvaror, burkar och delikatesser. Hyllorna fylls på under dagen.",
      "Välkommen till ateljén! Här visar vi kläder och formgivning från trakten. Se dig gärna omkring bland kollektionerna.",
    ][venue.variant], 5, -7.6, 0x59765b);
    this.resident(layout, "Kund", "Jag letar efter en present. Det är trevligt att kunna gå in och se vad kvarterets butiker har att visa.", -3, 5.8, 0xb07868, false, -3.5);
    this.resident(layout, "Kund", "Jag tar gärna en sväng bland hyllorna innan jag går vidare till caféet.", 3, -3.2, 0x627d9a, false, 6.5);
    this.resident(layout, "Medarbetare", "Säg till om du undrar över något. Utgången är vid mattan längst fram i butiken.", -5.8, -5.8, 0x9c875f);
  }
}
