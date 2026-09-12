import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

const BASE = new URL("assets/city/", document.baseURI).href;

export interface CityAssets {
  asphalt: THREE.MeshStandardMaterial;
  bricks: THREE.MeshStandardMaterial;
  pavement: THREE.MeshStandardMaterial;
  furniture: THREE.Group;
  lamp: THREE.Group;
  car: THREE.Group;
  environment: THREE.DataTexture;
}

async function surface(name: string, meters: number): Promise<THREE.MeshStandardMaterial> {
  const loader = new THREE.TextureLoader();
  const [map, normalMap, roughnessMap] = await Promise.all(
    ["Color", "NormalGL", "Roughness"].map(channel =>
      loader.loadAsync(`${BASE}materials/${name}_2K-JPG_${channel}.jpg`)),
  );
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, normalMap, roughnessMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  }
  const material = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, roughness: 1 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", `
      #include <uv_vertex>
      vec3 surfacePosition = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
      vec3 faceNormal = abs(normal);
      vec2 surfaceUv = faceNormal.y > 0.5 ? surfacePosition.xz :
        (faceNormal.x > 0.5 ? surfacePosition.zy : surfacePosition.xy);
      surfaceUv /= ${meters.toFixed(1)};
      vMapUv = surfaceUv;
      vNormalMapUv = surfaceUv;
      vRoughnessMapUv = surfaceUv;
    `);
  };
  material.customProgramCacheKey = () => `city-surface-${meters}`;
  return material;
}

export async function loadCityAssets(): Promise<CityAssets> {
  const loader = new GLTFLoader();
  const [asphalt, bricks, pavement, furniture, lamp, car, environment] = await Promise.all([
    surface("Asphalt012", 4),
    surface("Bricks059", 2),
    surface("PavingStones119", 3),
    loader.loadAsync(`${BASE}outdoor_table_chair_set_01/outdoor_table_chair_set_01.gltf`),
    loader.loadAsync(`${BASE}street_lamp_01/street_lamp_01.gltf`),
    loader.loadAsync(`${BASE}CarConcept.glb`),
    new RGBELoader().loadAsync(`${BASE}urban_courtyard_02_1k.hdr`),
  ]);
  for (const model of [furniture.scene, lamp.scene, car.scene]) {
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0) {
          // Tinted glazing avoids a separate full-scene transmission render for every car.
          material.transmission = 0;
          material.transparent = true;
          material.opacity = 0.65;
          material.depthWrite = false;
        }
      }
    });
  }
  environment.mapping = THREE.EquirectangularReflectionMapping;
  return { asphalt, bricks, pavement, furniture: furniture.scene, lamp: lamp.scene, car: car.scene, environment };
}
