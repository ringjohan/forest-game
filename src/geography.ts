import * as THREE from "three";

// The western city entrance faces the southern forest trail.
export const CITY_ORIGIN = new THREE.Vector3(304, 0, 570);
export const CITY_ROTATION = -Math.PI / 2;
export const FOREST_JOIN = 210;

export function cityToWorld(point: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(CITY_ORIGIN.x - point.z, point.y, CITY_ORIGIN.z + point.x);
}

export function worldToCity(point: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(point.z - CITY_ORIGIN.z, point.y, CITY_ORIGIN.x - point.x);
}

export function onForestApproach(x: number, z: number, radius = 0): boolean {
  return Math.abs(x) + radius < 7 && z >= 190 && z <= 224;
}

export function onAirportApproach(x: number, z: number, radius = 0): boolean {
  return x >= 648 && x <= 700 && z - radius >= 638 && z + radius <= 672;
}
