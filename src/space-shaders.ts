import * as THREE from "three";

/** All planet shaders work in world space relative to the floating origin (the player's ship). */

const common = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
`;

const sphereVertex = /* glsl */`
  ${common}
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vTangentW;
  varying vec3 vBitangentW;
  varying vec3 vPosW;
  varying vec3 vObj;
  void main() {
    vUv = uv;
    vec3 n = normalize(position);
    vObj = n;
    vec3 t = normalize(vec3(n.z, 0.0, -n.x) + vec3(1e-6, 0.0, 0.0));
    vec3 b = cross(n, t);
    mat3 m = mat3(modelMatrix);
    vNormalW = normalize(m * n);
    vTangentW = normalize(m * t);
    vBitangentW = normalize(m * b);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const earthFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D cloudMap;
  uniform sampler2D normalMap;
  uniform sampler2D specMap;
  uniform vec3 sunDir;
  uniform float sunIntensity;
  uniform float cloudOffset;
  uniform float nightIntensity;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vTangentW;
  varying vec3 vBitangentW;
  varying vec3 vPosW;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 N0 = normalize(vNormalW);
    vec3 T = normalize(vTangentW);
    vec3 B = normalize(vBitangentW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 L = normalize(sunDir);
    float ocean = smoothstep(0.35, 0.65, texture2D(specMap, vUv).r);
    vec3 nm = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    nm.xy *= 2.2 * (1.0 - ocean);
    vec3 N = normalize(T * nm.x + B * nm.y + N0 * max(nm.z, 0.2));
    float mu0 = dot(N0, L);
    float lit = max(dot(N, L), 0.0);
    vec3 albedo = texture2D(dayMap, vUv).rgb;
    // Deep oceans are darker and bluer from orbit than the stylised source map.
    albedo = mix(albedo, albedo * vec3(0.55, 0.75, 1.0) * 0.75, ocean * 0.6);
    vec2 cuv = vec2(vUv.x + cloudOffset, vUv.y);
    vec2 sunTangent = vec2(dot(L, T), dot(L, B));
    float shadow = texture2D(cloudMap, cuv - sunTangent * 0.0016).r;
    float cloud = texture2D(cloudMap, cuv).r;
    float twilight = smoothstep(-0.12, 0.25, mu0);
    vec3 sunset = mix(vec3(1.0, 0.45, 0.2), vec3(1.0), smoothstep(0.0, 0.35, mu0));
    vec3 color = albedo * lit * twilight * sunset * sunIntensity * (1.0 - shadow * 0.55);
    // Ocean sun glint: a tight core and a broad, Fresnel-weighted sheen.
    vec3 H = normalize(L + V);
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(N0, V), 0.0), 5.0);
    float glint = pow(max(dot(N0, H), 0.0), 220.0) * 7.0 + pow(max(dot(N0, H), 0.0), 18.0) * 0.18;
    color += vec3(1.0, 0.92, 0.78) * glint * ocean * (0.25 + fresnel) * twilight * sunIntensity * (1.0 - cloud);
    color += vec3(0.25, 0.45, 0.85) * fresnel * ocean * 0.12 * twilight * sunIntensity;
    // City lights fade in across the terminator and are dimmed by overlying clouds.
    vec3 lights = texture2D(nightMap, vUv).rgb;
    float dark = smoothstep(0.08, -0.18, mu0);
    color += lights * lights * vec3(1.0, 0.82, 0.55) * dark * (1.0 - cloud * 0.85) * nightIntensity;
    // Faint airglow and a cool rim so the night side is never a flat black hole.
    float rim = pow(1.0 - max(dot(N0, V), 0.0), 3.0);
    color += vec3(0.02, 0.05, 0.12) * rim * 0.4;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const cloudFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D cloudMap;
  uniform vec3 sunDir;
  uniform float sunIntensity;
  uniform float cloudOffset;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vTangentW;
  varying vec3 vBitangentW;
  varying vec3 vPosW;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 L = normalize(sunDir);
    vec2 cuv = vec2(vUv.x + cloudOffset, vUv.y);
    float c = texture2D(cloudMap, cuv).r;
    // Fake relief: brighter on sun-facing slopes of thick cloud using the density gradient.
    vec2 texel = vec2(1.0 / 8192.0, 1.0 / 4096.0) * 6.0;
    float dx = texture2D(cloudMap, cuv + vec2(texel.x, 0.0)).r - texture2D(cloudMap, cuv - vec2(texel.x, 0.0)).r;
    float dy = texture2D(cloudMap, cuv + vec2(0.0, texel.y)).r - texture2D(cloudMap, cuv - vec2(0.0, texel.y)).r;
    vec3 bumped = normalize(N - (normalize(vTangentW) * dx + normalize(vBitangentW) * dy) * 0.5);
    float mu0 = dot(N, L);
    // Thick cloud scatters light in all directions, so shading is soft: mostly ambient sky plus a gentle slope term.
    float lit = clamp(mix(max(mu0, 0.0), dot(bumped, L), 0.35) * 0.55 + 0.45 * smoothstep(-0.05, 0.3, mu0), 0.0, 1.0) * smoothstep(-0.15, 0.15, mu0);
    vec3 sunset = mix(vec3(1.0, 0.5, 0.28), vec3(1.0), smoothstep(-0.02, 0.3, mu0));
    float grazing = 1.0 - max(dot(N, V), 0.0);
    float alpha = smoothstep(0.08, 0.85, c) * (0.92 + grazing * 0.08);
    vec3 color = vec3(0.98, 0.99, 1.0) * lit * sunset * sunIntensity * 0.95 + vec3(0.004, 0.006, 0.012);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const atmosphereVertex = /* glsl */`
  ${common}
  uniform float uAtmoRadius;
  varying vec3 vLocal;
  void main() {
    vLocal = position * uAtmoRadius;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

/** Single-scattering Rayleigh + Mie, ray-marched in units of the planet radius. */
const atmosphereFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uCamLocal;
  uniform vec3 uSunDir;
  uniform float uAtmoRadius;
  uniform vec3 uBetaR;
  uniform float uBetaM;
  uniform vec3 uMieColor;
  uniform float uHR;
  uniform float uHM;
  uniform float uG;
  uniform float uSunIntensity;
  varying vec3 vLocal;
  #define PRIMARY 28
  #define LIGHT 6
  vec2 raySphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float d = b * b - c;
    if (d < 0.0) return vec2(1e9, -1e9);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 ro = uCamLocal;
    vec3 rd = normalize(vLocal - uCamLocal);
    vec2 atmo = raySphere(ro, rd, uAtmoRadius);
    if (atmo.x > atmo.y || atmo.y < 0.0) discard;
    vec2 ground = raySphere(ro, rd, 1.0);
    float t0 = max(atmo.x, 0.0);
    float t1 = atmo.y;
    if (ground.x < ground.y && ground.x > 0.0) t1 = min(t1, ground.x);
    // Non-uniform steps concentrate samples near the dense lower layers along long limb rays.
    float mu = dot(rd, uSunDir);
    float phaseR = 0.0596831 * (1.0 + mu * mu);
    float g2 = uG * uG;
    float phaseM = 0.1193662 * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * uG * mu, 1.5));
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    float odR = 0.0;
    float odM = 0.0;
    float prev = t0;
    for (int i = 0; i < PRIMARY; i++) {
      float f = (float(i) + 1.0) / float(PRIMARY);
      float t = mix(t0, t1, f);
      float ds = t - prev;
      vec3 p = ro + rd * (prev + ds * 0.5);
      prev = t;
      float h = max(length(p) - 1.0, 0.0);
      float hr = exp(-h / uHR) * ds;
      float hm = exp(-h / uHM) * ds;
      odR += hr;
      odM += hm;
      vec2 sunGround = raySphere(p, uSunDir, 1.0);
      float sunlit = (sunGround.x < sunGround.y && sunGround.y > 0.0) ? 0.0 : 1.0;
      if (sunlit == 0.0) continue;
      float tl = raySphere(p, uSunDir, uAtmoRadius).y;
      float dsl = tl / float(LIGHT);
      float odRl = 0.0;
      float odMl = 0.0;
      for (int j = 0; j < LIGHT; j++) {
        vec3 q = p + uSunDir * dsl * (float(j) + 0.5);
        float hl = max(length(q) - 1.0, 0.0);
        odRl += exp(-hl / uHR) * dsl;
        odMl += exp(-hl / uHM) * dsl;
      }
      vec3 tau = uBetaR * (odR + odRl) + uBetaM * 1.1 * (odM + odMl);
      vec3 attenuation = exp(-tau);
      sumR += hr * attenuation;
      sumM += hm * attenuation;
    }
    vec3 color = uSunIntensity * (sumR * uBetaR * phaseR + sumM * uBetaM * uMieColor * phaseM);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const planetFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D map;
  uniform vec3 sunDir;
  uniform float sunIntensity;
  uniform float bumpScale;
  uniform vec2 texel;
  uniform float lunar;
  uniform vec3 rimColor;
  uniform float rimStrength;
  uniform vec3 center;
  uniform float radius;
  uniform float hasRings;
  uniform sampler2D ringMap;
  uniform vec3 ringNormal;
  uniform vec2 ringRadii;
  uniform float detail;
  uniform float detailScale;
  uniform float albedoScale;
  uniform float contrast;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vTangentW;
  varying vec3 vBitangentW;
  varying vec3 vPosW;
  varying vec3 vObj;
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  // Crater-like relief: inverted ridged noise forms rounded pits with sharp rims at several scales.
  float relief(vec3 p) {
    float h = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      float n = vnoise(p);
      h += (1.0 - abs(n * 2.0 - 1.0)) * a;
      p = p * 2.13 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return h;
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 N0 = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 L = normalize(sunDir);
    vec3 albedo = texture2D(map, vUv).rgb * albedoScale;
    if (contrast != 1.0) {
      float mean = luma(albedo);
      albedo = max(vec3(0.0), mix(vec3(mean), albedo, 1.15) + (mean - 0.62) * (contrast - 1.0));
    }
    vec3 N = N0;
    vec3 T = normalize(vTangentW);
    vec3 B = normalize(vBitangentW);
    if (bumpScale > 0.0) {
      // Height from albedo: craters and ridges catch the low sun. Central differences over a few texels avoid texel noise.
      vec2 o = texel * 2.5;
      float hx = luma(texture2D(map, vUv + vec2(o.x, 0.0)).rgb) - luma(texture2D(map, vUv - vec2(o.x, 0.0)).rgb);
      float hy = luma(texture2D(map, vUv + vec2(0.0, o.y)).rgb) - luma(texture2D(map, vUv - vec2(0.0, o.y)).rgb);
      N = normalize(N0 - (T * hx + B * hy) * bumpScale);
    }
    if (detail > 0.0) {
      // Procedural regolith detail fades in below a few hundred km, where the photo map runs out of resolution.
      float altitudeRadii = length(cameraPosition - center) / radius - 1.0;
      float fade = detail * (1.0 - smoothstep(0.08, 0.6, altitudeRadii));
      if (fade > 0.001) {
        vec3 p = vObj * detailScale;
        float e = 0.35;
        // Same tangent frame as the vertex shader, so object-space offsets map straight onto T and B.
        vec3 tl = normalize(vec3(vObj.z, 0.0, -vObj.x) + vec3(1e-6, 0.0, 0.0));
        vec3 bl = cross(vObj, tl);
        float h0 = relief(p);
        float h1 = relief(p + tl * e);
        float h2 = relief(p + bl * e);
        float fine = vnoise(p * 9.0) * 0.5 + vnoise(p * 23.0) * 0.25;
        N = normalize(N - (T * (h1 - h0) + B * (h2 - h0)) / e * 0.3 * fade);
        albedo *= mix(1.0, 0.86 + h0 * 0.16 + fine * 0.08, fade);
      }
    }
    float mu0 = max(dot(N, L), 0.0);
    float mu = max(dot(N0, V), 0.0);
    // Lommel-Seeliger keeps the full Moon evenly bright to its limb, as in real photographs.
    float lommel = 2.0 * mu0 / (mu0 + mu + 1e-4);
    float shade = mix(mu0, lommel * smoothstep(0.0, 0.08, dot(N0, L)), lunar);
    if (hasRings > 0.5) {
      float denom = dot(L, ringNormal);
      if (abs(denom) > 1e-4) {
        float t = dot(center - vPosW, ringNormal) / denom;
        if (t > 0.0) {
          float r = length(vPosW + L * t - center) / radius;
          float u = (r - ringRadii.x) / (ringRadii.y - ringRadii.x);
          if (u > 0.0 && u < 1.0) shade *= 1.0 - texture2D(ringMap, vec2(u, 0.5)).a * 0.85;
        }
      }
    }
    vec3 color = albedo * shade * sunIntensity;
    float rim = pow(1.0 - mu, 2.5) * smoothstep(-0.25, 0.3, dot(N0, L));
    color += rimColor * rim * rimStrength * sunIntensity;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ringVertex = /* glsl */`
  ${common}
  varying vec3 vLocal;
  varying vec3 vPosW;
  void main() {
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const ringFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D ringMap;
  uniform vec2 ringRadii;
  uniform vec3 sunDir;
  uniform float sunIntensity;
  uniform vec3 center;
  uniform float radius;
  uniform vec3 ringNormal;
  varying vec3 vLocal;
  varying vec3 vPosW;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vLocal.xy);
    float u = (r - ringRadii.x) / (ringRadii.y - ringRadii.x);
    if (u < 0.0 || u > 1.0) discard;
    vec4 tex = texture2D(ringMap, vec2(u, 0.5));
    vec3 L = normalize(sunDir);
    vec3 V = normalize(cameraPosition - vPosW);
    // Planet shadow across the rings.
    vec3 oc = vPosW - center;
    float b = dot(oc, L);
    float c = dot(oc, oc) - radius * radius;
    float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.04 : 1.0;
    float sunSide = sign(dot(ringNormal, L));
    float viewSide = sign(dot(ringNormal, V));
    float lit = sunSide == viewSide ? 1.0 : 0.35 + 0.65 * (1.0 - tex.a);
    float forward = pow(max(dot(-V, L), 0.0), 8.0) * 1.5;
    vec3 color = tex.rgb * (lit + forward) * shadow * sunIntensity * 0.9;
    gl_FragColor = vec4(color, tex.a * 0.95);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const starVertex = /* glsl */`
  ${common}
  attribute float size;
  attribute vec3 tint;
  uniform float pixelRatio;
  uniform float brightness;
  varying vec3 vColor;
  void main() {
    vColor = tint * brightness;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const starFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(d, d);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 6.0);
    float halo = exp(-r2 * 2.0) * 0.12;
    gl_FragColor = vec4(vColor * (core + halo), 1.0);
  }
`;

export function earthMaterial(maps: { day: THREE.Texture; night: THREE.Texture; clouds: THREE.Texture; normal: THREE.Texture; spec: THREE.Texture }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: maps.day }, nightMap: { value: maps.night }, cloudMap: { value: maps.clouds },
      normalMap: { value: maps.normal }, specMap: { value: maps.spec },
      sunDir: { value: new THREE.Vector3(1, 0, 0) }, sunIntensity: { value: 1.6 }, cloudOffset: { value: 0 },
      nightIntensity: { value: 2.2 },
    },
    vertexShader: sphereVertex,
    fragmentShader: earthFragment,
  });
}

export function cloudMaterial(clouds: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { cloudMap: { value: clouds }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, sunIntensity: { value: 1.6 }, cloudOffset: { value: 0 } },
    vertexShader: sphereVertex,
    fragmentShader: cloudFragment,
    transparent: true,
    depthWrite: false,
  });
}

export type AtmosphereOptions = {
  /** Shell radius in planet radii. */
  radius: number;
  /** Rayleigh coefficients per planet radius. */
  betaR: [number, number, number];
  betaM: number;
  mieColor?: number;
  /** Scale heights in planet radii. */
  hr: number;
  hm: number;
  g?: number;
  intensity: number;
};

export function atmosphereMaterial(options: AtmosphereOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCamLocal: { value: new THREE.Vector3(0, 0, 3) }, uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uAtmoRadius: { value: options.radius }, uBetaR: { value: new THREE.Vector3(...options.betaR) },
      uBetaM: { value: options.betaM }, uMieColor: { value: new THREE.Color(options.mieColor ?? 0xffffff) },
      uHR: { value: options.hr }, uHM: { value: options.hm }, uG: { value: options.g ?? 0.76 },
      uSunIntensity: { value: options.intensity },
    },
    vertexShader: atmosphereVertex,
    fragmentShader: atmosphereFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export type PlanetOptions = {
  map: THREE.Texture;
  bump?: number;
  lunar?: number;
  rim?: number;
  rimStrength?: number;
  rings?: { map: THREE.Texture; inner: number; outer: number };
  /** Strength of close-range procedural surface detail (rocky bodies). */
  detail?: number;
  /** Feature frequency per planet radius for the detail layer. */
  detailScale?: number;
  /** Albedo multiplier (the source maps are brightened for display). */
  albedo?: number;
  /** Contrast around mid-grey; >1 brings out faint cloud bands. */
  contrast?: number;
};

export function planetMaterial(options: PlanetOptions): THREE.ShaderMaterial {
  const image = options.map.image as { width?: number; height?: number } | undefined;
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: options.map }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, sunIntensity: { value: 1.6 },
      bumpScale: { value: options.bump ?? 0 },
      texel: { value: new THREE.Vector2(1 / (image?.width ?? 4096), 1 / (image?.height ?? 2048)) },
      lunar: { value: options.lunar ?? 0 }, rimColor: { value: new THREE.Color(options.rim ?? 0x000000) },
      rimStrength: { value: options.rimStrength ?? 0 }, center: { value: new THREE.Vector3() }, radius: { value: 1 },
      detail: { value: options.detail ?? 0 }, detailScale: { value: options.detailScale ?? 600 }, albedoScale: { value: options.albedo ?? 1 }, contrast: { value: options.contrast ?? 1 },
      hasRings: { value: options.rings ? 1 : 0 }, ringMap: { value: options.rings?.map ?? null },
      ringNormal: { value: new THREE.Vector3(0, 1, 0) },
      ringRadii: { value: new THREE.Vector2(options.rings?.inner ?? 0, options.rings?.outer ?? 1) },
    },
    vertexShader: sphereVertex,
    fragmentShader: planetFragment,
  });
}

export function ringMaterial(map: THREE.Texture, inner: number, outer: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ringMap: { value: map }, ringRadii: { value: new THREE.Vector2(inner, outer) },
      sunDir: { value: new THREE.Vector3(1, 0, 0) }, sunIntensity: { value: 1.6 },
      center: { value: new THREE.Vector3() }, radius: { value: 1 }, ringNormal: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** A crisp procedural star field drawn in front of the softer Milky Way panorama. */
export function createStarField(count: number, distance: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  const color = new THREE.Color();
  let seed = 1234567;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Galactic plane tilt so extra faint stars crowd along the Milky Way band of the panorama.
  const galactic = new THREE.Vector3(0.12, 0.85, 0.5).normalize();
  for (let i = 0; i < count; i++) {
    let x = 0, y = 0, z = 0;
    for (;;) {
      x = random() * 2 - 1; y = random() * 2 - 1; z = random() * 2 - 1;
      const l = x * x + y * y + z * z;
      if (l > 0.01 && l <= 1) {
        const inv = 1 / Math.sqrt(l);
        x *= inv; y *= inv; z *= inv;
        const band = Math.abs(x * galactic.x + y * galactic.y + z * galactic.z);
        if (random() > band * 0.65) break;
      }
    }
    positions.set([x * distance, y * distance, z * distance], i * 3);
    // Apparent magnitude distribution: many faint, very few bright stars.
    const m = Math.pow(random(), 7);
    sizes[i] = 1.1 + m * 2.6;
    const temperature = random();
    if (temperature < 0.12) color.setRGB(0.68, 0.78, 1.0);
    else if (temperature < 0.55) color.setRGB(0.95, 0.96, 1.0);
    else if (temperature < 0.85) color.setRGB(1.0, 0.93, 0.8);
    else color.setRGB(1.0, 0.78, 0.58);
    const brightness = 0.18 + m * 1.9;
    tints.set([color.r * brightness, color.g * brightness, color.b * brightness], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("tint", new THREE.BufferAttribute(tints, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { pixelRatio: { value: Math.min(window.devicePixelRatio, 2) }, brightness: { value: 1 } },
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -10;
  points.name = "Stjärnhimmel";
  return points;
}

export function radialGlowTexture(stops: [number, string][], size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Rymden kräver en 2D-canvas.");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
