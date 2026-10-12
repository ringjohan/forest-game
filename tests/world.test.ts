import * as THREE from "three";
import { World } from "../src/world";
import { City, CITY_SPAWN } from "../src/city";
import type { Vehicle } from "../src/city";
import { loadCityAssets } from "../src/city-assets";
import { cityToWorld, worldToCity, CITY_ORIGIN, CITY_ROTATION, FOREST_JOIN } from "../src/geography";
import { Aviation, AIRPORT_SPAWN, FLIGHT_CEILING, FLIGHT_VIEW_DISTANCE, flightFogDensity } from "../src/aviation";
import { circleIntersectsFootprint, footprintsIntersect } from "../src/collision";
import { TrafficPolice, SPEED_LIMIT_KMH, JAIL_SECONDS, ESCAPE_SECONDS } from "../src/police";
import { Jail } from "../src/jail";
import { CrashEffects } from "../src/crash-effects";
import type { AircraftImpact } from "../src/crash-effects";
import { TREEHOUSE } from "../src/treehouse";
import { Archery, ARROW_COOLDOWN, ARROW_SPEED } from "../src/archery";
import { Survival, Werewolves, DAY_SECONDS } from "../src/survival";
import { PLAYER_RADIUS, segmentSphereHit } from "../src/combat";
import { Spaceport, PAD, SPACEPORT_BOUNDS } from "../src/spaceport";
import { createAsteroidShape, AsteroidField, scatterRocks } from "../src/asteroids";
import { AU, BODY_DATA, earthOrientation, hazardRadius, lonLat } from "../src/space-bodies";
import { GEARS, bezier, gravityLimit, jumpPath, segmentSphere, speedLimit, travelTime } from "../src/space-nav";

const results = document.querySelector<HTMLPreElement>("#results")!;
const lines: string[] = [];
let failed = 0;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, run: () => void): void {
  try {
    run();
    lines.push(`PASS ${name}`);
  } catch (error) {
    failed++;
    lines.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(name, error);
  }
  results.textContent = lines.join("\n");
}

async function run(): Promise<void> {
  const world = new World(new THREE.Scene());
  const city = new City(await loadCityAssets());
  const aviation = new Aviation();
  const traffic = new TrafficPolice(city);
  const spaceport = new Spaceport();

  test("Treehouse approach, ladders, treasure, doorway and roof form a playable round trip", () => {
    const house = world.treehouse;
    const pos = new THREE.Vector3(0, 0, 67);
    function finishClimb(): void {
      for (let step = 0; step < 1200 && house.climbing; step++) {
        house.update(1 / 60, pos);
        assert(!house.solidAt(pos.x, pos.y + 0.1, pos.z, 0.04), "Climbing passes through a plank instead of a hatch");
      }
      assert(!house.climbing, "Climbing never completes");
    }
    for (let i = 0; i <= 100; i++) {
      pos.lerpVectors(new THREE.Vector3(0, 0, 67), house.entrance, i / 100);
      assert(!world.blocked(pos.x, pos.z, PLAYER_RADIUS), "Treehouse approach is blocked");
    }
    pos.copy(house.entrance);
    assert(house.interaction(pos) === "ascend", "Ground ladder prompt missing");
    assert(!house.interact("chest", pos) && !house.opened, "Treasure can be taken from the ground");
    assert(house.interact("ascend", pos), "Cannot start climbing");
    house.update(1, pos);
    assert(house.climbing && pos.y > house.entrance.y && pos.y < house.floor, "Climbing teleports");
    const paused = pos.clone();
    house.update(0, pos);
    assert(pos.equals(paused), "Paused climbing still moves");
    finishClimb();
    assert(house.elevated && pos.y === house.floor, "Did not land on the deck");
    assert(!house.blocked(pos.x, pos.z, PLAYER_RADIUS), "Deck landing is blocked");
    function walk(x: number, z: number): void {
      const from = pos.clone();
      const to = new THREE.Vector3(TREEHOUSE.x + x, house.heightAt(), TREEHOUSE.z + z);
      for (let i = 1; i <= 60; i++) {
        pos.lerpVectors(from, to, i / 60);
        assert(!house.blocked(pos.x, pos.z, PLAYER_RADIUS), `Blocked on deck/roof at ${pos.x}, ${pos.z}`);
      }
    }
    walk(-3, 3.2);
    walk(1, 3.2);
    walk(1, -0.5);
    assert(house.interaction(pos) === "chest", "Cannot reach treasure through doorway");
    assert(house.interact("chest", pos) && house.opened, "Chest did not unlock equipment");
    assert(!house.interact("chest", pos), "Treasure can be claimed twice");
    walk(1, 3.2);
    walk(3, 3.3);
    assert(house.interact("roof", pos), "Roof ladder inaccessible");
    finishClimb();
    assert(pos.y === house.roof && !house.blocked(pos.x, pos.z, PLAYER_RADIUS), "Roof landing is blocked");
    walk(0, 2.1);
    walk(0, 0);
    assert(house.blocked(TREEHOUSE.x + 4, TREEHOUSE.z, PLAYER_RADIUS), "Can walk off the roof");
    assert(house.solidAt(TREEHOUSE.x + 0.2, house.roof - 0.1, TREEHOUSE.z), "Roof plank does not stop arrows/aircraft");
    walk(0, 2.1);
    walk(3, 2.1);
    assert(house.interact("cabin", pos), "Cannot descend from roof");
    finishClimb();
    walk(1, 3.2);
    walk(-3, 3.2);
    walk(-3, 2.45);
    assert(house.interact("descend", pos), "Cannot descend to forest");
    finishClimb();
    assert(pos.equals(house.entrance) && !house.elevated, "Did not return to ground");
    assert(house.opened, "Treasure state was lost after leaving");
  });

  test("Arrow sweeps hit once at different frame rates and have unlimited ammunition", () => {
    for (const dt of [1 / 144, 1 / 30, 0.1]) {
      const scene = new THREE.Scene();
      const bow = new Archery(scene);
      let hits = 0;
      const center = new THREE.Vector3(0, 0, -8);
      for (let shot = 0; shot < 80; shot++) {
        assert(bow.shoot(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)), "Ammunition ran out");
        assert(!bow.shoot(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)), "Shot cooldown missing");
        assert(scene.children.length === 1, "Arrow is not visible in the scene");
        for (let t = 0; t < ARROW_COOLDOWN + dt; t += dt) {
          bow.update(dt, () => [{ center, radius: 0.4, hit: () => { hits++; } }], () => false);
        }
        assert(hits === shot + 1 && bow.count === 0, "Arrow missed/tunnelled or hit repeatedly");
      }
      assert(scene.children.length === 0, "Expired arrows leak scene objects");
    }
  });

  test("Arrows stop at obstacles before enemies and choose the nearest target", () => {
    const bow = new Archery(new THREE.Scene());
    let near = 0;
    let far = 0;
    const targets = () => [
      { center: new THREE.Vector3(0, 0, -9), radius: 0.5, hit: () => { far++; } },
      { center: new THREE.Vector3(0, 0, -6), radius: 0.5, hit: () => { near++; } },
    ];
    bow.shoot(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    bow.update(0.3, targets, p => p.z < -3);
    assert(near === 0 && far === 0 && bow.count === 0, "Arrow penetrated a wall");
    bow.clear();
    bow.shoot(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    bow.update(0, targets, () => false);
    assert(Number(bow.count) === 1 && near === 0, "Paused projectile advanced");
    bow.update(0.3, targets, () => false);
    assert(Number(near) === 1 && far === 0 && bow.count === 0, "Wrong target or piercing arrow");
    bow.clear();
    bow.shoot(new THREE.Vector3(), new THREE.Vector3(1, 0, 0));
    bow.update(5, () => [], () => false);
    assert(bow.count === 0, "Missed arrow never expires");
    assert(ARROW_SPEED > 0 && segmentSphereHit(new THREE.Vector3(), new THREE.Vector3(0, 0, -10),
      new THREE.Vector3(0, 3, -5), 1) === null, "Vertical aim ignored");
  });

  test("Forest arrows hit trunks, not the empty air below their canopies", () => {
    const trunk = new THREE.Vector3(-10, world.heightAt(-10, 31) + 2, 31);
    assert(world.projectileBlocked(trunk), "Arrow passes through a visible foreground trunk");
    assert(!world.projectileBlocked(trunk.clone().add(new THREE.Vector3(2, 0, 0))), "Canopy blocks empty space beside the trunk");
    assert(world.projectileBlocked(new THREE.Vector3(0, world.heightAt(0, 30) - 0.1, 30)), "Arrow passes underground");
  });

  test("A visible arrow can fly from the roof into the forest clearing", () => {
    const house = world.treehouse;
    const origin = new THREE.Vector3(TREEHOUSE.x + 3.45, house.roof + 1.7, TREEHOUSE.z + 1);
    const target = new THREE.Vector3(TREEHOUSE.x + 12, world.heightAt(TREEHOUSE.x + 12, TREEHOUSE.z + 1) + 1.2, TREEHOUSE.z + 1);
    const bow = new Archery(new THREE.Scene());
    let hits = 0;
    bow.shoot(origin, target.clone().sub(origin));
    for (let i = 0; i < 100; i++) bow.update(0.02, () => [{ center: target, radius: 0.8, hit: () => { hits++; } }],
      point => world.projectileBlocked(point));
    assert(hits === 1, "Cannot shoot from the actual roof past its railing to ground level");
  });

  test("Thieves and monsters are arrow targets, vanish with effects, and cannot hit the roof", () => {
    const scene = new THREE.Scene();
    const enemies = new Werewolves(scene, world);
    const survival = new Survival();
    const pos = new THREE.Vector3(TREEHOUSE.x, world.treehouse.roof, TREEHOUSE.z);
    enemies.banditsEnabled = true;
    enemies.update(0.04, 0, pos, false, survival);
    assert(enemies.count === 1, "Daytime thief missing after treasure");
    for (let i = 0; i < 600; i++) enemies.update(0.04, i * 0.04, pos, false, survival);
    assert(survival.health === 100, "Ground enemy damaged the player on the roof");
    assert(enemies.arrowTargets().some(t => Math.hypot(t.center.x - pos.x, t.center.z - pos.z) > 10), "Enemies hide directly below the roof");
    for (const target of enemies.arrowTargets()) target.hit();
    assert(Number(enemies.count) === 0 && scene.children.length > 0, "Hit did not start vanishing effect");
    enemies.update(1, 25, pos, true, survival);
    assert(scene.children.length === 0, "Vanished enemies/effects remain in scene");
    enemies.clear();
    survival.time = DAY_SECONDS;
    enemies.update(0.04, 26, pos, false, survival);
    assert(Number(enemies.count) === 1, "Night monster missing");
    enemies.arrowTargets()[0].hit();
    enemies.update(1, 27, pos, true, survival);
    assert(Number(enemies.count) === 0 && scene.children.length === 0, "Monster did not disappear");
    enemies.clear();
  });

  function withDriver(runTest: (driver: Vehicle) => void): void {
    const driver = city.vehicles.find(vehicle => vehicle.kind === "bmw");
    assert(driver !== undefined, "BMW driver fixture missing");
    const active = city.activeVehicle;
    const states = city.vehicles.map(vehicle => ({
      vehicle, position: vehicle.group.position.clone(), heading: vehicle.group.rotation.y,
      speed: vehicle.speed, automatic: vehicle.automatic,
    }));
    traffic.clear();
    city.enter(driver);
    try { runTest(driver); }
    finally {
      traffic.clear();
      for (const state of states) {
        state.vehicle.group.position.copy(state.position);
        state.vehicle.group.rotation.y = state.heading;
        state.vehicle.speed = state.speed;
        state.vehicle.automatic = state.automatic;
      }
      city.activeVehicle = active;
    }
  }

  test("Parked aircraft blocks its body and wings without blocking the boarding space", () => {
    assert(aviation.blocked(790, 640), "Can walk through the fuselage");
    assert(aviation.blocked(795, 640), "Can walk through a wing");
    assert(aviation.blocked(790, 643), "Can walk through the nose");
    assert(!aviation.blocked(794, 643), "Empty space beside the nose is blocked");
    assert(!aviation.blocked(AIRPORT_SPAWN.x, AIRPORT_SPAWN.z) && aviation.nearPlane(AIRPORT_SPAWN), "Boarding position is blocked");
    const moved = new Aviation();
    moved.plane.position.set(800, 1.55, 700);
    moved.plane.rotation.y = Math.PI / 2;
    assert(moved.blocked(800, 695), "Wing collision did not rotate and move with the aircraft");
    assert(!moved.planeBlocked(790, 640), "Aircraft left a ghost collider at its old position");
    moved.enter();
    const exit = moved.exit((x, z) => moved.blocked(x, z));
    assert(exit !== null && !moved.blocked(exit.x, exit.z), "Cannot exit beside the parked aircraft");
  });

  test("Vehicle collision uses oriented width and length rather than an enclosing circle", () => {
    const shape = { x: 0, z: 0, halfWidth: 1, halfLength: 2.3, heading: 0 };
    assert(circleIntersectsFootprint(1.4, 0, 0.45, shape), "Visible side is not solid");
    assert(!circleIntersectsFootprint(1.46, 0, 0.45, shape), "Invisible width outside the car");
    assert(!footprintsIntersect(shape, { ...shape, x: 2.01 }), "Separated narrow cars collide");
    assert(footprintsIntersect(shape, { ...shape, x: 1.99 }), "Overlapping cars do not collide");
    assert(circleIntersectsFootprint(0, 1.4, 0.45, { ...shape, heading: Math.PI / 2 }), "Collider did not rotate");
    assert(!circleIntersectsFootprint(0, 1.46, 0.45, { ...shape, heading: Math.PI / 2 }), "Rotated car has excess width");
  });

  test("Red sport car collider and both visible LODs have the same width", () => {
    const car = city.vehicles.find(vehicle => vehicle.kind === "car");
    assert(car?.detail !== null && car?.detail !== undefined, "Detailed red sport car missing");
    const detail = new THREE.Box3().setFromObject(car.detail, true).getSize(new THREE.Vector3());
    const proxy = new THREE.Box3().setFromObject(car.body, true).getSize(new THREE.Vector3());
    assert(Math.abs(detail.x - car.halfWidth * 2) < 0.001, "Collider width differs from detailed car");
    assert(Math.abs(proxy.x - detail.x) < 0.001, "Distance LOD changes the visible width");
    assert(Math.abs(detail.z - car.halfLength * 2) < 0.001, "Collider length differs from detailed car");
    const footprint = city.vehicleFootprint(car);
    assert(!city.vehicleBlocked(footprint.x + car.halfWidth + 0.46, footprint.z, 0.45), "Walking beside the car hits its old radius");
  });

  test("BMW reaches 400 km/h and swept collision stops it before another vehicle", () => {
    const bmw = city.vehicles.find(vehicle => vehicle.kind === "bmw");
    const obstacle = city.vehicles.find(vehicle => vehicle.kind === "taxi");
    assert(bmw !== undefined && obstacle !== undefined, "BMW or collision fixture missing");
    const saved = city.vehicles.map(vehicle => ({
      vehicle, position: vehicle.group.position.clone(), heading: vehicle.group.rotation.y, speed: vehicle.speed,
    }));
    const previousVehicle = city.activeVehicle;
    try {
      for (const [i, vehicle] of city.vehicles.entries()) vehicle.group.position.set(1000 + i * 10, 0, 1000);
      city.enter(bmw);
      bmw.group.position.set(334, 0, -320);
      bmw.group.rotation.y = 0;
      for (let i = 0; i < 250; i++) city.drive(0.02, 1, 0, false);
      assert(Math.abs(bmw.speed * 3.6 - 400) < 0.001, `Actual BMW top speed is ${bmw.speed * 3.6} km/h`);
      assert(bmw.group.position.z > -30, "Top speed changed without actual travel");
      const heading = bmw.group.rotation.y;
      city.drive(0.04, 1, 1, false);
      assert(Math.abs(bmw.group.rotation.y - heading) < 0.02, "High-speed steering is unstable");
      bmw.group.position.set(334, 0, 0);
      bmw.group.rotation.y = 0;
      bmw.speed = bmw.maxSpeed;
      obstacle.group.position.set(334, 0, 8);
      obstacle.group.rotation.y = 0;
      city.drive(0.1, 1, 0, false);
      assert(bmw.speed === 0 && bmw.group.position.z < 4, "Fast BMW tunnels through another car");
      assert(!footprintsIntersect(city.vehicleFootprint(bmw), city.vehicleFootprint(obstacle)), "Collision stops after penetration");
    } finally {
      for (const state of saved) {
        state.vehicle.group.position.copy(state.position);
        state.vehicle.group.rotation.y = state.heading;
        state.vehicle.speed = state.speed;
      }
      city.activeVehicle = previousVehicle;
    }
  });

  test("Police allow 70 km/h but pursue sustained speeding", () => withDriver(driver => {
    assert(SPEED_LIMIT_KMH === 70, "Wrong city speed limit");
    driver.group.position.set(0, 0, 334);
    driver.group.rotation.y = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      driver.speed = 70 / 3.6;
      const before = driver.group.position.clone();
      driver.group.position.x += driver.speed * 0.2;
      traffic.observeDriving(before, driver, 0.2);
    }
    assert(!traffic.wanted, "Legal speed causes a pursuit");
    for (let i = 0; i < 4; i++) {
      driver.speed = 72 / 3.6;
      const before = driver.group.position.clone();
      driver.group.position.x += driver.speed * 0.2;
      traffic.observeDriving(before, driver, 0.2);
    }
    assert(traffic.wanted && traffic.reason.length > 0, "Speeding does not trigger police");
  }));

  test("Police detect red stop-line crossings, not green lights or already occupied intersections", () => withDriver(driver => {
    assert(city.signal("z") === "red" && city.signal("x") === "green", "Traffic light fixture changed");
    driver.speed = 15;
    driver.group.rotation.y = Math.PI / 2;
    driver.group.position.set(-277, 0, -326.5);
    traffic.observeDriving(new THREE.Vector3(-286, 0, -326.5), driver, 0.6);
    assert(!traffic.wanted, "Green light wrongly triggers pursuit");
    driver.group.rotation.y = 0;
    driver.group.position.set(-326.5, 0, -266);
    traffic.observeDriving(new THREE.Vector3(-326.5, 0, -271), driver, 0.6);
    assert(!traffic.wanted, "Already inside intersection when red is punished");
    driver.group.position.set(-326.5, 0, -277);
    traffic.observeDriving(new THREE.Vector3(-326.5, 0, -286), driver, 0.6);
    assert(traffic.wanted, "Driving through red does not trigger pursuit");
  }));

  test("A police patrol physically approaches and arrests a stopped driver", () => withDriver(driver => {
    const patrols = city.vehicles.filter(vehicle => vehicle.policeDuty);
    assert(patrols.length > 0, "No pursuing police");
    for (const [i, vehicle] of city.vehicles.entries()) {
      vehicle.group.position.set(1000 + i * 10, 0, 1000);
      vehicle.automatic = false;
    }
    driver.group.position.set(334, 0, 0);
    driver.group.rotation.y = 0;
    driver.speed = 25;
    traffic.observeDriving(new THREE.Vector3(334, 0, -1), driver, 1);
    driver.speed = 0;
    patrols[0].group.position.set(334, 0, -18);
    patrols[0].group.rotation.y = 0;
    const start = patrols[0].group.position.clone();
    let event: string | null = null;
    for (let i = 0; i < 500 && event !== "arrest"; i++) {
      event = traffic.update(0.04, { position: driver.group.position, vehicle: driver, available: true });
    }
    assert(patrols[0].group.position.distanceTo(start) > 1, "Patrol did not physically pursue");
    assert(event === "arrest", "Nearby police cannot arrest a stopped driver");
    assert(!footprintsIntersect(city.vehicleFootprint(driver), city.vehicleFootprint(patrols[0])), "Police catch by driving through the player");
    assert(city.nearVehicle(patrols[0].group.position) !== patrols[0], "An on-duty pursuit car can be stolen");
  }));

  test("Police can be lost after 20 continuous seconds at a safe distance", () => withDriver(driver => {
    driver.group.position.set(0, 0, 334);
    driver.group.rotation.y = Math.PI / 2;
    driver.speed = 25;
    traffic.observeDriving(new THREE.Vector3(-1, 0, 334), driver, 1);
    assert(traffic.wanted, "Pursuit fixture did not start");
    const distant = new THREE.Vector3(-800, 0, 304);
    let escaped = false;
    for (let i = 0; i < (ESCAPE_SECONDS - 1) * 25; i++) {
      escaped ||= traffic.update(0.04, { position: distant, vehicle: null, available: false }) === "escaped";
    }
    assert(!escaped && traffic.wanted, "Police give up before 20 seconds");
    const patrol = city.vehicles.find(vehicle => vehicle.policeDuty);
    assert(patrol !== undefined, "No patrol to test regained contact");
    traffic.update(0.04, { position: patrol.group.position.clone(), vehicle: null, available: false });
    assert(Math.abs(traffic.escapeRemaining - ESCAPE_SECONDS) < 0.001, "Nearby police do not reset the escape countdown");
    for (let i = 0; i < ESCAPE_SECONDS * 25 + 1; i++) {
      escaped ||= traffic.update(0.04, { position: distant, vehicle: null, available: false }) === "escaped";
    }
    assert(escaped && !traffic.wanted, "Cannot escape after sustained safe distance");
  }));

  function contactFixture(driver: Vehicle): Vehicle {
    for (const [i, vehicle] of city.vehicles.entries()) {
      vehicle.group.position.set(1000 + i * 10, 0, 1000);
      vehicle.automatic = false;
    }
    const patrol = city.vehicles.find(vehicle => vehicle.policeDuty);
    assert(patrol !== undefined, "No patrol fixture");
    patrol.group.position.set(330, 0, 0);
    patrol.group.rotation.y = 0;
    driver.group.position.set(330, 0, -20);
    driver.group.rotation.y = 0;
    driver.speed = 30;
    traffic.observeDriving(driver.group.position.clone(), driver, 1);
    assert(traffic.wanted, "Contact fixture is not wanted");
    return patrol;
  }

  test("Wanted pedestrians are arrested on the first touch, but not for proximity or while unavailable", () => withDriver(driver => {
    const patrol = contactFixture(driver);
    const shape = city.vehicleFootprint(patrol);
    const subject = { position: new THREE.Vector3(shape.x + shape.halfWidth + 0.46, 0, shape.z), vehicle: null, available: true };
    assert(!traffic.checkContact(subject), "Arrested without touching");
    subject.position.x -= 0.011;
    subject.available = false;
    assert(!traffic.checkContact(subject), "Arrested indoors");
    subject.available = true;
    subject.position.y = 4;
    assert(!traffic.checkContact(subject), "Arrested above the police car");
    subject.position.y = 0;
    assert(traffic.checkContact(subject), "Tiny side contact was ignored");
    assert(traffic.update(0, subject) === null && traffic.wanted, "Pause did not stop arrest processing");
    assert(traffic.update(1 / 120, subject) === "arrest", "Contact still requires an arrest timer");
    assert(!traffic.checkContact(subject), "Contact arrests a non-wanted player");
  }));

  test("Vehicle side contacts arrest instantly regardless of heading or speed", () => withDriver(driver => {
    for (const heading of [0, Math.PI / 2, Math.PI / 4]) {
      const patrol = contactFixture(driver);
      driver.group.rotation.y = heading;
      const shape = city.vehicleFootprint(driver);
      const patrolShape = city.vehicleFootprint(patrol);
      const extent = Math.abs(Math.cos(heading)) * shape.halfWidth + Math.abs(Math.sin(heading)) * shape.halfLength;
      const target = { ...shape, x: patrolShape.x + patrolShape.halfWidth + extent - 0.001, z: patrolShape.z };
      driver.speed = 400 / 3.6;
      const subject = { position: driver.group.position, vehicle: driver, available: true };
      assert(traffic.checkContact(subject, target), `High-speed contact missed at heading=${heading}`);
      assert(traffic.update(1 / 120, subject) === "arrest", "Fast driver was not arrested immediately");
    }
  }));

  test("Swept driving contact catches a 400 km/h car before collision resolution erases the touch", () => withDriver(driver => {
    for (const dt of [1 / 60, 0.04, 0.1]) {
      const patrol = contactFixture(driver);
      driver.group.position.set(330, 0, -8);
      driver.speed = 400 / 3.6;
      const subject = { position: driver.group.position, vehicle: driver, available: true };
      for (let i = 0; i < 20 && driver.speed > 0; i++) {
        city.drive(dt, 1, 0, false, shape => traffic.checkContact(subject, shape));
      }
      assert(!footprintsIntersect(city.vehicleFootprint(driver), city.vehicleFootprint(patrol)), "Contact penetrated the police car");
      assert(traffic.update(dt, subject) === "arrest", `Swept contact was lost at dt=${dt}`);
    }
  }));

  test("A moving patrol arrests a pedestrian at contact without driving through them", () => withDriver(driver => {
    const patrol = contactFixture(driver);
    const subject = { position: new THREE.Vector3(330, 0, 10), vehicle: null, available: true };
    let event: string | null = null;
    for (let i = 0; i < 200 && !event; i++) event = traffic.update(0.04, subject);
    assert(event === "arrest", "Patrol stopped short of pedestrian contact");
    assert(!circleIntersectsFootprint(subject.position.x, subject.position.z, 0.45, city.vehicleFootprint(patrol)),
      "Patrol drove through pedestrian");
  }));

  test("Even touching footprints cannot arrest through a building wall", () => withDriver(driver => {
    const patrol = contactFixture(driver);
    const entrance = city.venues[0].entrance;
    patrol.group.position.set(entrance.x, 0, entrance.z + 1.5);
    const shape = city.vehicleFootprint(patrol);
    const subject = { position: new THREE.Vector3(shape.x, 0, shape.z - shape.halfLength - 0.44), vehicle: null, available: true };
    assert(circleIntersectsFootprint(subject.position.x, subject.position.z, 0.45, shape),
      "Wall fixture is not in contact");
    assert(!traffic.checkContact(subject), "Contact caused arrest through a wall");
  }));

  test("Detention lasts one minute and the cell is a bounded playable room", () => {
    assert(JAIL_SECONDS === 60, "Detention is not one minute");
    const jail = new Jail();
    assert(!jail.blocked(jail.spawn.x, jail.spawn.z), "Player spawns inside a cell obstacle");
    assert(jail.blocked(100, 100), "Can walk through the cell walls");
    let meshes = 0;
    jail.scene.traverse(object => { if (object instanceof THREE.Mesh) meshes++; });
    assert(meshes > 5, "Holding cell is not rendered");
  });

  test("City and forest coordinate transforms are inverses", () => {
    for (const p of [CITY_SPAWN, new THREE.Vector3(-360, 0, 304), new THREE.Vector3(120, 42, -310)]) {
      assert(worldToCity(cityToWorld(p)).distanceTo(p) < 1e-9, "Coordinate round trip changed position");
    }
    const root = new THREE.Group();
    root.position.copy(CITY_ORIGIN);
    root.rotation.y = CITY_ROTATION;
    root.updateMatrixWorld(true);
    assert(root.localToWorld(CITY_SPAWN.clone()).distanceTo(cityToWorld(CITY_SPAWN)) < 1e-9, "Rendered transform differs from collision transform");
  });

  test("Forest trail is traversable and level at the shared city edge", () => {
    let previousHeight = world.heightAt(0, 125);
    for (let z = 125; z <= FOREST_JOIN; z += 0.25) {
      assert(!world.blocked(0, z), `Forest blocked at ${z}`);
      const height = world.heightAt(0, z);
      assert(Math.abs(height - previousHeight) < 0.7, `Terrain step at ${z}`);
      previousHeight = height;
    }
    assert(Math.abs(world.heightAt(0, FOREST_JOIN)) < 0.001, "Forest and city are not at the same elevation");
    for (let z = FOREST_JOIN; z <= 242; z += 0.25) {
      const p = worldToCity(new THREE.Vector3(0, 0, z));
      assert(!city.blocked(p.x, p.z), `City approach blocked at ${z}`);
    }
  });

  test("Crossing in either direction preserves world-space position and heading", () => {
    for (const z of [209.9, 210, 210.1]) {
      const p = new THREE.Vector3(0, 1.8, z);
      assert(cityToWorld(worldToCity(p)).distanceTo(p) < 1e-9, "Crossing teleports");
      const heading = 0.6;
      const direction = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading - CITY_ROTATION);
      direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), CITY_ROTATION);
      assert(direction.distanceTo(new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))) < 1e-9, "Crossing changes heading");
    }
  });

  test("Airport access joins a city street without an invisible wall", () => {
    for (let x = 638; x <= 679; x += 0.25) {
      const p = worldToCity(new THREE.Vector3(x, 0, 660));
      assert(!city.blocked(p.x, p.z), `City airport road blocked at ${x}`);
    }
    for (let x = 680; x <= 782; x += 0.25) {
      assert(!aviation.blocked(x, 660), `Airport footpath blocked at ${x}`);
    }
  });

  test("Existing forest houses and city venues remain available", () => {
    assert(world.houses.length === 15, "Forest houses changed");
    assert(city.venues.length > 0 && city.vehicles.length > 0, "Existing city interactions missing");
    assert(world.houses.every(h => world.nearHouse(h.entrance.x, h.entrance.z)?.id === h.id), "House entrances inaccessible");
  });

  test("Spaceport walkway reaches the tower elevator without walls, and the pad stays clear of the runway", () => {
    const door = spaceport.interactionPoint;
    // Footpath from the airport apron, up the yellow walkway, then along the apron to the elevator door.
    const route = [new THREE.Vector3(726, 0, 660), new THREE.Vector3(726, 0, 818), new THREE.Vector3(door.x + 3, 0, 818),
      new THREE.Vector3(door.x + 3, 0, door.z - 2), door.clone().setZ(door.z - 0.6)];
    for (let i = 1; i < route.length; i++) {
      for (let t = 0; t <= 1; t += 0.01) {
        const p = route[i - 1].clone().lerp(route[i], t);
        assert(!aviation.blocked(p.x, p.z, PLAYER_RADIUS) && !spaceport.blocked(p.x, p.z, PLAYER_RADIUS),
          `Spaceport walk blocked at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      }
    }
    assert(spaceport.nearElevator(door.clone().setZ(door.z - 0.6)), "Elevator interaction unreachable");
    assert(spaceport.contains(door.x, door.z), "Elevator is outside the spaceport area");
    assert(SPACEPORT_BOUNDS.maxX < 778, "Spaceport overlaps the runway");
    assert(spaceport.blocked(PAD.x + 5.6, PAD.z + 5.6), "Launch table legs are not solid");
    assert(spaceport.flightBlocked(PAD.x, 50, PAD.z, 1), "Aircraft can fly through the rocket on the pad");
    assert(!spaceport.flightBlocked(790, 50, 760, 6), "Spaceport blocks the runway approach");
  });

  test("Launch counts down, holds for loading, lifts off and hands over to space exactly once", () => {
    spaceport.resetPad();
    spaceport.board();
    spaceport.holdForAssets = true;
    let ignitedEarly = false;
    for (let i = 0; i < 600; i++) {
      spaceport.update(1 / 60, 1);
      ignitedEarly ||= spaceport.countdown > 3.5 && spaceport.rocketWorldPosition.y > 7.01;
    }
    assert(spaceport.phase === "countdown" && Math.abs(spaceport.countdown - 10) < 0.05, "Countdown did not hold at T-10 while loading");
    spaceport.holdForAssets = false;
    let handovers = 0;
    let previous = spaceport.altitude;
    for (let i = 0; i < 60 * 40; i++) {
      if (spaceport.update(1 / 60, 1)) handovers++;
      assert(spaceport.altitude >= previous - 1e-6, "Rocket sank during the ascent");
      previous = spaceport.altitude;
    }
    assert(!ignitedEarly, "Rocket moved before ignition");
    const phase: string = spaceport.phase;
    assert(handovers === 1 && phase === "away", "Ascent did not hand over to space exactly once");
    assert(previous > 2500, `Ascent too low before the space scene: ${previous.toFixed(0)} m`);
    spaceport.resetPad();
    const resetPhase: string = spaceport.phase;
    assert(resetPhase === "idle" && spaceport.altitude === 0, "Pad reset failed");
  });

  test("Asteroid collisions follow the real cratered surface, not a bounding sphere", () => {
    const shape = createAsteroidShape(7, 12, 4);
    const rocks = scatterRocks(3, 1, new THREE.Vector3(), new THREE.Vector3(0.001, 0.001, 0.001), 0.4, 0.4, 1);
    assert(rocks.length === 1, "Rock scatter failed");
    const field = new AsteroidField([shape], [new THREE.MeshBasicMaterial()], rocks, 2);
    field.update(0, new THREE.Vector3(10, 0, 0));
    const rock = rocks[0];
    let insideMiss = 0;
    for (let i = 0; i < 200; i++) {
      const dir = new THREE.Vector3(Math.sin(i * 2.4) * Math.cos(i * 0.7), Math.cos(i * 2.4), Math.sin(i * 0.7)).normalize();
      const local = dir.clone().applyQuaternion(rock.quaternion.clone().invert());
      const surface = shape.surface(local) * rock.scale;
      assert(!field.collide(rock.position.clone().addScaledVector(dir, surface + 0.02), 0.01), "Collision reported in open space above the surface");
      if (!field.collide(rock.position.clone().addScaledVector(dir, surface - 0.02), 0.01)) insideMiss++;
    }
    assert(insideMiss === 0, `${insideMiss} points inside the asteroid were not detected`);
    assert(field.collide(rock.position, 0.01) === rock, "Asteroid core is not solid");
  });

  test("Autopilot routes between every pair of stops never pass through a planet, the Moon or the Sun", () => {
    const bodies = Object.values(BODY_DATA);
    const spheres = bodies.map(b => ({ position: b.position, radius: hazardRadius(b) }));
    const stops = bodies.filter(b => b.id !== "sun").map(b => ({ body: b, point: b.position.clone().add(new THREE.Vector3(0.3, 0.8, 0.5).normalize().multiplyScalar(b.radius + 400)) }));
    for (const from of stops) for (const to of stops) {
      if (from === to) continue;
      const route = jumpPath(from.point, { position: from.body.position, radius: from.body.radius }, to.point,
        { position: to.body.position, radius: to.body.radius }, spheres);
      const p = new THREE.Vector3();
      for (let i = 1; i < 400; i++) {
        bezier(route, i / 400, p);
        for (const b of bodies) {
          assert(p.distanceTo(b.position) > hazardRadius(b), `${from.body.id} → ${to.body.id} passes through ${b.id}`);
        }
      }
      assert(route[0].equals(from.point) && route[3].equals(to.point), "Route does not start and end at the orbits");
    }
  });

  test("Free-flight gears reach light speed and beyond, while the approach limiter always stops above the surface", () => {
    assert(GEARS[0].speed <= 0.1 && GEARS[GEARS.length - 1].speed >= 299_792 * 100, "Gear range too narrow");
    assert(GEARS.every((g, i) => i === 0 || g.speed > GEARS[i - 1].speed), "Gears are not increasing");
    for (const body of Object.values(BODY_DATA)) {
      // Dive straight down at the top gear with Shift, at 20 fps (the 0.05 s step clamp) and 144 fps.
      for (const fps of [20, 144]) {
        let clearance = body.radius * 30;
        let seconds = 0, impact = Infinity;
        const dt = 1 / fps;
        while (clearance > 0 && seconds < 120) {
          const speed = Math.min(GEARS[GEARS.length - 1].speed * 10, speedLimit(clearance));
          assert(speed * dt < clearance, `${body.id} reaches the surface at ${fps} fps`);
          if (clearance > 500 && clearance - speed * dt <= 500) impact = seconds;
          clearance -= speed * dt;
          seconds += dt;
        }
        assert(clearance > 0 && clearance < 100, `${body.id} approach did not settle just above the surface`);
        assert(impact < 25, `${body.id}: reaching 500 km above the surface took ${impact.toFixed(1)} s at ${fps} fps`);
      }
    }
  });

  test("Gravity brake: top gear from the Moon reaches Earth in seconds without a single-frame overshoot", () => {
    const moon = BODY_DATA.moon, earth = BODY_DATA.earth;
    const direction = earth.position.clone().sub(moon.position).normalize();
    const p = moon.position.clone().addScaledVector(direction, hazardRadius(moon) + 300);
    const top = GEARS[GEARS.length - 1].speed * 10;
    let seconds = 0;
    const dt = 1 / 20;
    while (p.distanceTo(earth.position) - hazardRadius(earth) > 1000 && seconds < 60) {
      const clearance = Math.min(p.distanceTo(moon.position) - hazardRadius(moon), p.distanceTo(earth.position) - hazardRadius(earth));
      const toEarth = p.distanceTo(earth.position) - hazardRadius(earth);
      const speed = Math.min(top, gravityLimit(clearance), speedLimit(toEarth));
      assert(speed * dt < Math.max(toEarth, 1), "One frame jumps past Earth");
      p.addScaledVector(direction, speed * dt);
      seconds += dt;
    }
    assert(seconds < 20, `Moon → Earth by hand took ${seconds.toFixed(1)} s`);
    const estimate = travelTime(300, moon.position.distanceTo(earth.position) - hazardRadius(moon) - hazardRadius(earth) - 300, top);
    assert(Math.abs(estimate - seconds) < Math.max(3, seconds * 0.4), `ETA ${estimate.toFixed(1)} s far from flight time ${seconds.toFixed(1)} s`);
    assert(gravityLimit(AU) * 1 > GEARS[GEARS.length - 1].speed, "Top gear never opens up between planets");
  });

  test("Swept sphere test catches a 1 000 c step that jumps clean over a planet", () => {
    const earth = BODY_DATA.earth;
    const a = earth.position.clone().add(new THREE.Vector3(0, 0, -3e8));
    const b = earth.position.clone().add(new THREE.Vector3(0, 0, 3e8));
    const t = segmentSphere(a, b, earth.position, earth.radius);
    assert(t !== null && Math.abs(t - (3e8 - earth.radius) / 6e8) < 1e-9, "Fast step tunnelled through Earth");
    assert(segmentSphere(a, b.clone().add(new THREE.Vector3(earth.radius * 3, 0, 0)), earth.position, earth.radius) === null, "Miss reported as a hit");
  });

  test("Lasers chip asteroids and split large ones into fragments that can be shot again", () => {
    const shape = createAsteroidShape(9, 8, 3);
    const rock = { position: new THREE.Vector3(0, 0, 1), scale: 0.2, axis: new THREE.Vector3(0, 1, 0), spin: 0, angle: 0, shape: 0, quaternion: new THREE.Quaternion(), health: 2 };
    const field = new AsteroidField([shape], [new THREE.MeshBasicMaterial()], [rock], 2);
    field.update(0, new THREE.Vector3());
    const hit = field.raycast(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0.95), 0.0006);
    assert(hit?.rock === rock && hit.point.z < 1 && hit.point.z > 0.6, "Laser segment did not hit the near face of the rock");
    assert(field.raycast(new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 2), 0.0006) === null, "Laser hit a rock it passed beside");
    assert(field.add({ ...rock, position: new THREE.Vector3(0, 0, 3), velocity: new THREE.Vector3(0, 0, 1), quaternion: new THREE.Quaternion() }), "Fragment could not be added");
    field.update(0.5, new THREE.Vector3());
    assert(Math.abs(field.rocks[1].position.z - 3.5) < 1e-9, "Fragments do not drift");
    field.remove(rock);
    assert(field.rocks.length === 1, "Destroyed rock not removed");
  });

  test("Earth orientation puts the chosen subsolar point under the Sun with north up", () => {
    const sun = new THREE.Vector3(0, 0, -1);
    const q = earthOrientation(sun, -45, 15);
    const subsolar = lonLat(-45, 15).applyQuaternion(q);
    assert(Math.acos(THREE.MathUtils.clamp(subsolar.dot(sun), -1, 1)) < 1e-6, "Subsolar point is not facing the Sun");
    const north = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    assert(Math.abs(Math.asin(north.dot(sun)) - THREE.MathUtils.degToRad(15)) < 1e-6, "Axial tilt toward the Sun is wrong");
    assert(north.y > 0.9, "Earth's north pole is not up");
    assert(AU > 1.49e8 && AU < 1.5e8, "Astronomical unit has the wrong scale");
  });

  test("Aircraft boards, takes off and can switch views without changing flight state", () => {
    aviation.enter();
    assert(aviation.active, "Did not board");
    const keys = new Set(["KeyW", "ArrowDown"]);
    for (let i = 0; i < 300; i++) aviation.update(1 / 60, keys, () => 0, () => false);
    assert(aviation.speed > 10 && !aviation.grounded, "Did not take off");
    const position = aviation.plane.position.clone();
    const speed = aviation.speed;
    const previousView = aviation.cockpit;
    aviation.toggleView();
    assert(aviation.cockpit !== previousView, "Camera did not switch");
    assert(aviation.plane.position.equals(position) && aviation.speed === speed, "Camera switch changed flight state");
    assert(aviation.exit(() => false) === null, "Can exit in mid-air");
    const camera = new THREE.PerspectiveCamera(52, 1, 0.15, FLIGHT_VIEW_DISTANCE);
    aviation.updateCamera(camera, 1);
    assert(camera.position.toArray().every(Number.isFinite), "Invalid cockpit camera");
    aviation.toggleView();
    aviation.updateCamera(camera, 1);
    assert(camera.position.distanceTo(aviation.plane.position) > 5, "Chase camera is inside aircraft");
  });

  test("Aircraft collision shows one crash, locks controls and recovers only after four seconds", () => {
    const impacts: AircraftImpact[] = [];
    const position = aviation.plane.position.clone();
    const message = aviation.update(0.04, new Set(["KeyW"]), () => 0, () => true, impact => impacts.push(impact));
    assert(typeof message === "string" && message.length > 0, "Collision not reported");
    assert(impacts.length === 1 && !impacts[0].ground, "Object impact not delivered exactly once");
    assert(aviation.crashRemaining === 4 && !aviation.plane.visible && !aviation.cockpit, "Crash is not visible in external view");
    assert(aviation.exit(() => false) === null, "Can exit during crash");
    aviation.toggleView();
    aviation.update(0, new Set(), () => 0, () => true);
    assert(aviation.crashRemaining === 4 && !aviation.cockpit, "Pause or view key alters crash");
    for (let i = 0; i < 7; i++) aviation.update(0.5, new Set(["KeyW"]), () => 0, () => true, impact => impacts.push(impact));
    assert(aviation.plane.position.equals(position) && impacts.length === 1, "Crash moves or repeats");
    aviation.update(0.5, new Set(), () => 0, () => false);
    assert(aviation.grounded && aviation.speed === 0 && aviation.plane.visible, "Collision did not recover safely");
  });

  test("Off-runway ground crashes report the actual impact site at different frame rates", () => {
    for (const dt of [1 / 60, 0.04, 0.1]) {
      const aircraft = new Aviation();
      aircraft.enter();
      aircraft.grounded = false;
      aircraft.speed = 50;
      aircraft.plane.position.set(740, 1.56, 750);
      const impacts: AircraftImpact[] = [];
      for (let i = 0; i < 40 && !impacts.length; i++) {
        aircraft.update(dt, new Set(["ArrowUp"]), () => 0, () => false, impact => impacts.push(impact));
      }
      assert(impacts.length === 1 && impacts[0].ground, `Missing ground crash at dt=${dt}`);
      assert(impacts[0].contact.x === 740 && impacts[0].contact.z >= 750, "Scorch moved to airport spawn");
    }
  });

  test("Fire and smoke animate, while ground soot persists and follows the terrain", () => {
    const effects = new CrashEffects();
    const scene = new THREE.Scene();
    scene.add(effects.group);
    effects.impact({ position: new THREE.Vector3(30, 4, 40), contact: new THREE.Vector3(30, 2, 40), ground: true },
      scene, [], x => x * 0.1);
    const scar = effects.group.children[0];
    const soot = scar.children[0];
    assert(soot instanceof THREE.Mesh, "Missing ground soot");
    const points = soot.geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      assert(Math.abs(points.getY(i) - points.getX(i) * 0.1 - 0.085) < 0.00001, "Soot floats above sloping ground");
    }
    const fire = effects.group.children[1];
    assert(fire.children.length > 30, "Missing fireball particles");
    const before = fire.children[0].position.clone();
    effects.update(0);
    assert(fire.children[0].position.equals(before), "Paused fire moves");
    effects.update(0.5);
    assert(!fire.children[0].position.equals(before), "Fire does not animate");
    effects.update(12);
    assert(effects.group.children.length === 1 && scar.parent === effects.group, "Soot vanished with the smoke");
  });

  test("Building damage projects onto rotated instanced geometry without removing the building", () => {
    const scene = new THREE.Scene();
    const building = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 20, 12), new THREE.MeshBasicMaterial(), 1);
    building.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 10, 0));
    const district = new THREE.Group();
    district.position.set(40, 0, 60);
    district.rotation.y = Math.PI / 3;
    district.add(building);
    scene.add(district);
    scene.updateMatrixWorld(true);
    const contact = district.localToWorld(new THREE.Vector3(0, 10, -6.5));
    const effects = new CrashEffects();
    scene.add(effects.group);
    effects.impact({ position: contact, contact, ground: false }, scene, [], () => 0);
    const scar = effects.group.children[0];
    const decal = scar.children[0];
    assert(decal instanceof THREE.Mesh && decal.geometry.attributes.position.count > 0, "No projected building damage");
    assert(scar.children.length > 10 && building.parent === district, "Missing debris or removed building");
    decal.geometry.computeBoundingBox();
    const center = decal.geometry.boundingBox!.getCenter(new THREE.Vector3());
    assert(center.distanceTo(contact) < 2, "Building scar uses the wrong coordinate system");
  });

  test("A wing hitting the real airport hangar produces fire and damage at the collision", () => {
    const aircraft = new Aviation();
    const effects = new CrashEffects();
    const scene = new THREE.Scene();
    scene.add(aircraft.group, effects.group);
    aircraft.enter();
    aircraft.grounded = false;
    aircraft.speed = 70;
    aircraft.plane.position.set(813, 7, 700);
    const message = aircraft.update(0.04, new Set(), () => 0, () => false,
      impact => effects.impact(impact, scene, [aircraft.plane], () => 0));
    assert(message?.startsWith("Krasch!") === true, "Wing passed through hangar");
    assert(effects.group.children.length === 2, "Real crash did not create effects");
    const decal = effects.group.children[0].children[0];
    assert(decal instanceof THREE.Mesh && decal.geometry.attributes.position.count > 0, "Real hangar has no damage");
  });

  test("Low flying aircraft collide with street lamps and traffic-light poles, but can fly above them", () => {
    assert(city.flightBlocked(-281, 4, -300, 0.3), "Street lamp is not solid in flight");
    assert(city.flightBlocked(-339, 4, -339, 0.3), "Traffic-light pole is not solid in flight");
    assert(!city.flightBlocked(-339, 7, -339, 0.3), "Traffic-light pole blocks empty sky");
  });

  test("Automatic takeoff can be followed by runway landing, braking and exit", () => {
    const aircraft = new Aviation();
    aircraft.enter();
    for (let i = 0; i < 240; i++) aircraft.update(1 / 60, new Set(["KeyW"]), () => 0, () => false);
    assert(!aircraft.grounded, "Automatic takeoff failed");
    const messages: string[] = [];
    for (let i = 0; i < 300; i++) {
      const message = aircraft.update(1 / 60, new Set(["KeyS", "ArrowUp"]), () => 0, () => false);
      if (message) messages.push(message);
    }
    assert(messages.some(message => message.includes("Mjuk landning")), `Did not land: ${messages.join("; ")}`);
    assert(aircraft.grounded && aircraft.speed === 0, "Did not stop after landing");
    assert(aircraft.exit(() => true) === null && aircraft.active, "Can exit into an obstacle");
    assert(aircraft.exit(() => false) !== null && !aircraft.active, "Cannot exit parked aircraft");
  });

  test("Braking and descending flare safely at different frame rates", () => {
    for (const dt of [1 / 60, 0.04, 0.1]) {
      const aircraft = new Aviation();
      aircraft.enter();
      for (let t = 0; t < 5; t += dt) aircraft.update(dt, new Set(["KeyW", "ArrowDown"]), () => 0, () => false);
      aircraft.plane.position.set(790, 15, 700);
      aircraft.plane.rotation.set(0, 0, 0);
      const messages: string[] = [];
      for (let t = 0; t < 10; t += dt) {
        const message = aircraft.update(dt, new Set(["KeyS", "ArrowUp"]), () => 0, () => false);
        if (message) messages.push(message);
      }
      assert(messages.some(message => message.includes("Mjuk landning")), `Landing failed at dt=${dt}: ${messages.join("; ")}`);
      assert(!messages.some(message => message.includes("återställning")), "Nose or wing hits terrain before the landing gear");
      assert(aircraft.grounded && aircraft.speed === 0 && aircraft.plane.position.z > 700, "Landing reset instead of parking");
    }
  });

  test("Unsafe high-speed touchdown reports a safe recovery", () => {
    const aircraft = new Aviation();
    aircraft.enter();
    for (let i = 0; i < 250; i++) aircraft.update(0.04, new Set(["KeyW", "ArrowDown"]), () => 0, () => false);
    aircraft.plane.position.set(790, 15, 700);
    aircraft.plane.rotation.set(0, 0, 0);
    const messages: string[] = [];
    for (let i = 0; i < 250; i++) {
      const message = aircraft.update(0.04, new Set(["ArrowUp"]), () => 0, () => false);
      if (message) messages.push(message);
    }
    assert(messages.some(message => message.includes("Säker återställning")), "Unsafe touchdown was not reported");
    assert(!messages.some(message => message.includes("Mjuk landning")), "Unsafe touchdown accepted as a landing");
    assert(aircraft.grounded && aircraft.speed === 0 && aircraft.plane.position.z === 640, "Unsafe touchdown did not recover at the airport");
  });

  test("Aircraft steering changes course and flight limits do not teleport", () => {
    const aircraft = new Aviation();
    aircraft.enter();
    for (let i = 0; i < 125; i++) aircraft.update(0.04, new Set(["KeyW", "ArrowDown"]), () => 0, () => false);
    const startX = aircraft.plane.position.x;
    for (let i = 0; i < 40; i++) aircraft.update(0.04, new Set(["ArrowLeft"]), () => 0, () => false);
    assert(Math.abs(aircraft.plane.position.x - startX) > 5, "Steering does not change course");
    aircraft.plane.position.set(790, FLIGHT_CEILING - 1, 970);
    let previous = aircraft.plane.position.clone();
    for (let i = 0; i < 150; i++) {
      aircraft.update(0.04, new Set(["KeyW", "ArrowDown"]), () => 0, () => false);
      const p = aircraft.plane.position;
      assert(p.y <= FLIGHT_CEILING && p.x >= -230 && p.x <= 900 && p.z >= -240 && p.z <= 980, "Aircraft left flight limits");
      assert(p.distanceTo(previous) < 4, "Boundary teleports aircraft");
      previous.copy(p);
    }
  });

  test("Flight arrow keys control pitch and steering, not throttle or brakes", () => {
    const parked = new Aviation();
    parked.enter();
    for (const code of ["ArrowUp", "ArrowDown"]) {
      for (let i = 0; i < 20; i++) parked.update(0.04, new Set([code]), () => 0, () => false);
      assert(parked.speed === 0 && parked.grounded, `${code} unexpectedly supplies throttle`);
    }
    const simulate = (codes: string[]): Aviation => {
      const aircraft = new Aviation();
      aircraft.enter();
      for (let i = 0; i < 125; i++) aircraft.update(0.04, new Set(["KeyW", "ArrowDown"]), () => 0, () => false);
      for (let i = 0; i < 50; i++) aircraft.update(0.04, new Set(["KeyW", ...codes]), () => 0, () => false);
      return aircraft;
    };
    const level = simulate([]);
    const climbing = simulate(["ArrowDown"]);
    const descending = simulate(["ArrowUp"]);
    assert(climbing.plane.position.y > level.plane.position.y + 10, "Down arrow does not climb");
    assert(descending.plane.position.y < level.plane.position.y - 10, "Up arrow does not descend");
    assert(climbing.speed === level.speed && descending.speed === level.speed, "Pitch keys alter throttle");
    assert(simulate(["ArrowLeft"]).plane.position.x > level.plane.position.x + 5, "Left steering reversed");
    assert(simulate(["ArrowRight"]).plane.position.x < level.plane.position.x - 5, "Right steering reversed");
    const legacy = simulate(["Space", "ShiftLeft", "KeyA", "KeyD"]);
    assert(legacy.plane.position.distanceTo(level.plane.position) < 0.001, "Old flight controls are still active");
  });

  test("Aircraft can actually climb from the runway to 10,000 m and descend again", () => {
    assert(FLIGHT_CEILING === 10_000, "Requested ceiling is not 10,000 m");
    const aircraft = new Aviation();
    aircraft.enter();
    for (let i = 0; i < 1800; i++) {
      aircraft.update(0.5, new Set(["KeyW", "ArrowDown"]), () => 0, () => false);
      assert(aircraft.plane.position.y <= 10_000, "Aircraft exceeds ceiling");
    }
    assert(aircraft.plane.position.y > 9999.9 && !aircraft.grounded, "Cannot reach 10,000 m from the runway");
    const camera = new THREE.PerspectiveCamera(52, 1.6, 0.1, FLIGHT_VIEW_DISTANCE);
    aircraft.updateCamera(camera, 1);
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    assert(frustum.containsPoint(new THREE.Vector3(304, 0, 570)), "Actual chase camera cannot see the city from 10,000 m");
    assert(frustum.containsPoint(new THREE.Vector3(0, 0, 0)), "Actual chase camera cannot see the forest from 10,000 m");
    for (let i = 0; i < 10; i++) aircraft.update(0.5, new Set(["ArrowUp"]), () => 0, () => false);
    assert(aircraft.plane.position.y < 9970, "Cannot descend from the ceiling");
  });

  test("High-altitude viewing distance and fog keep city and forest visible", () => {
    const camera = new THREE.PerspectiveCamera(52, 1.6, 0.1, FLIGHT_VIEW_DISTANCE);
    camera.position.set(304, 10_000, 570);
    camera.lookAt(304, 0, 570);
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    assert(frustum.containsPoint(new THREE.Vector3(304, 0, 570)), "City is beyond the clipping plane");
    assert(frustum.containsPoint(new THREE.Vector3(0, 0, 0)), "Forest is beyond the clipping plane");
    const transmission = Math.exp(-((flightFogDensity(10_000) * 10_000) ** 2));
    assert(transmission > 0.8, "Fog completely hides the landscape at 10,000 m");
  });

  test("Building and tree flight collisions are height-aware", () => {
    const h = world.houses[0].entrance;
    assert(!world.flightBlocked(h.x, 250, h.z, 3), "High flight blocked by a house");
    assert(!city.cameraBlocked(120, 250, 120), "High flight blocked by city");
    assert(world.flightBlocked(h.x, world.heightAt(h.x, h.z) + 2, h.z, 8), "Low flight can pass through house");
  });

  test("Default patrols navigate the live city and catch a distant stopped offender without teleporting", () => withDriver(driver => {
    driver.group.position.set(334, 0, 0);
    driver.group.rotation.y = 0;
    driver.speed = 25;
    traffic.observeDriving(driver.group.position.clone(), driver, 1);
    driver.speed = 0;
    const patrols = city.vehicles.filter(vehicle => vehicle.policeDuty);
    let event: string | null = null;
    for (let i = 0; i < 1500 && !event; i++) {
      const previous = patrols.map(vehicle => vehicle.group.position.clone());
      city.update(0.04, 1, driver.group.position);
      event = traffic.update(0.04, { position: driver.group.position, vehicle: driver, available: true });
      for (const [index, patrol] of patrols.entries()) {
        assert(patrol.group.position.distanceTo(previous[index]) <= 55 * 0.04 + 0.01, "A pursuit car teleported");
      }
    }
    assert(event === "arrest", "Default patrols cannot navigate around real city obstacles to catch the driver");
  }));

  results.textContent = `${lines.join("\n")}\n\n${lines.length - failed}/${lines.length} passed`;
  document.body.dataset.result = failed ? "failed" : "passed";
}

void run().catch(error => {
  console.error(error);
  results.textContent += `\nERROR ${String(error)}`;
  document.body.dataset.result = "failed";
});
