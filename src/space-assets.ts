import * as THREE from "three";

const BASE = new URL("assets/space/", document.baseURI).href;

export type RockSet = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; aoMap: THREE.Texture };

export interface SpaceAssets {
  earthDay: THREE.Texture;
  earthNight: THREE.Texture;
  earthClouds: THREE.Texture;
  earthNormal: THREE.Texture;
  earthSpecular: THREE.Texture;
  moon: THREE.Texture;
  mercury: THREE.Texture;
  venus: THREE.Texture;
  mars: THREE.Texture;
  jupiter: THREE.Texture;
  saturn: THREE.Texture;
  saturnRing: THREE.Texture;
  uranus: THREE.Texture;
  neptune: THREE.Texture;
  sun: THREE.Texture;
  milkyWay: THREE.Texture;
  rocks: RockSet[];
}

let pending: Promise<SpaceAssets> | null = null;

/** Starts (once) and returns the lazy space texture download; nothing is fetched until the spaceport needs it. */
export function loadSpaceAssets(maxAnisotropy = 8): Promise<SpaceAssets> {
  pending ??= load(maxAnisotropy).catch(error => {
    pending = null;
    throw error;
  });
  return pending;
}

async function load(maxAnisotropy: number): Promise<SpaceAssets> {
  // ImageBitmap decoding happens off the main thread, which keeps the countdown smooth while 8K maps arrive.
  const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "flipY" });
  const texture = async (file: string, color = true, repeat = false): Promise<THREE.Texture> => {
    const bitmap = await loader.loadAsync(BASE + file);
    const result = new THREE.Texture(bitmap as unknown as HTMLImageElement);
    result.flipY = false;
    result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    result.anisotropy = maxAnisotropy;
    result.wrapS = THREE.RepeatWrapping;
    result.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true;
    result.needsUpdate = true;
    return result;
  };
  const rock = async (name: string): Promise<RockSet> => {
    const [map, normalMap, roughnessMap, aoMap] = await Promise.all([
      texture(`rock/${name}_Color.jpg`, true, true),
      texture(`rock/${name}_NormalGL.jpg`, false, true),
      texture(`rock/${name}_Roughness.jpg`, false, true),
      texture(`rock/${name}_AmbientOcclusion.jpg`, false, true),
    ]);
    return { map, normalMap, roughnessMap, aoMap };
  };
  const [
    earthDay, earthNight, earthClouds, earthNormal, earthSpecular, moon, mercury, venus, mars,
    jupiter, saturn, saturnRing, uranus, neptune, sun, milkyWay, rockA, rockB,
  ] = await Promise.all([
    texture("earth_day_8k.jpg"), texture("earth_night_8k.jpg"), texture("earth_clouds_8k.jpg", false),
    texture("earth_normal_4k.jpg", false), texture("earth_specular_4k.jpg", false),
    texture("moon_8k.jpg"), texture("mercury_4k.jpg"), texture("venus_4k.jpg"), texture("mars_8k.jpg"),
    texture("jupiter_4k.jpg"), texture("saturn_4k.jpg"), texture("saturn_ring.png"),
    texture("uranus_2k.jpg"), texture("neptune_2k.jpg"), texture("sun_2k.jpg"), texture("milky_way_8k.jpg"),
    rock("Rock030"), rock("Rock035"),
  ]);
  milkyWay.mapping = THREE.EquirectangularReflectionMapping;
  return {
    earthDay, earthNight, earthClouds, earthNormal, earthSpecular, moon, mercury, venus, mars,
    jupiter, saturn, saturnRing, uranus, neptune, sun, milkyWay, rocks: [rockA, rockB],
  };
}
