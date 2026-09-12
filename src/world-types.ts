import type * as THREE from 'three';

export interface House {
  id: string;
  name: string;
  entrance: THREE.Vector3;
  rotation: number;
}

export interface Landmark {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  x: number;
  z: number;
  radius: number;
}

export const WORLD_SIZE = 420;
export const WORLD_LIMIT = 198;
export const CITY_TRAIL = [{ x: 0, z: 67 }, { x: 0, z: 130 }, { x: 0, z: WORLD_LIMIT + 12 }] as const;
export const FOREST_CITY_EXIT = { x: 0, z: WORLD_LIMIT - 2 };
export const FOREST_CITY_RETURN = { x: 0, z: WORLD_LIMIT - 10 };
export const SPAWN = { x: 0, z: 30 };
export const LAKE = { x: 69, z: -13, rx: 32, rz: 43 };
export const LANDMARKS: Landmark[] = [
  {
    id: "bjorkby",
    name: "Björkby",
    subtitle: "EN PLATS ATT BÖRJA",
    description: "Mellan gamla ekar och varma stugor börjar din vandring.",
    x: 0,
    z: 0,
    radius: 23,
  },
  {
    id: "sjoglantan",
    name: "Sjögläntan",
    subtitle: "VID DET STILLA VATTNET",
    description: "Ett litet fiskeläge där skogen möter sjön.",
    x: 99,
    z: -60,
    radius: 23,
  },
  {
    id: "tallvik",
    name: "Tallvik",
    subtitle: "BLAND HÖGA TALLAR",
    description: "Följ stigen västerut till byn på den gröna höjden.",
    x: -99,
    z: -85,
    radius: 23,
  },
  {
    id: "lindangen",
    name: "Lindängen",
    subtitle: "SÖDER OM SKOGEN",
    description: "En slingrande stig leder till varma hem på ängen i sydväst.",
    x: -87,
    z: 85,
    radius: 23,
  },
];
