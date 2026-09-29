import * as THREE from "three";
import { loadCityAssets } from "./city-assets";
import { Character } from "./character";
import { ForestAudio } from "./audio";
import { World, PATHS } from "./world";
import type { House } from "./world";
import { Interior } from "./interior";
import { VenueInterior } from "./venue-interior";
import { Survival, Werewolves } from "./survival";
import { PLAYER_RADIUS } from "./combat";
import { City, CITY_SPAWN } from "./city";
import type { CityVenue } from "./city";
import { FOREST_CITY_EXIT, LANDMARKS, LAKE, SPAWN, WORLD_SIZE } from "./world-types";
import { CITY_ORIGIN, CITY_ROTATION, FOREST_JOIN, cityToWorld, worldToCity, onAirportApproach } from "./geography";
import { Aviation, AIRPORT_BOUNDS, FLIGHT_VIEW_DISTANCE, flightFogDensity } from "./aviation";
import { CrashEffects } from "./crash-effects";
import { TrafficPolice, SPEED_LIMIT_KMH, JAIL_SECONDS, ESCAPE_SECONDS } from "./police";
import { Jail } from "./jail";
import "./style.css";

const icons = {
  tree: '<path d="m12 2-6 9h4l-6 8h6v3h4v-3h6l-6-8h4L12 2Z"/><path d="M12 8v11"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  sound: '<path d="m11 4-5 4H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 4-5 4H3v8h3l5 4V4Zm5 5 5 6m0-6-5 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
};
function icon(name: keyof typeof icons): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
}
function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Gränssnittselement saknas: ${id}`);
  return result as T;
}

element("app").innerHTML = `
  <canvas id="scene" tabindex="0" aria-label="3D-världen Grönved. Använd piltangenterna för att gå."></canvas>
  <div class="vignette"></div><div class="grain"></div>
  <header class="topbar">
    <div class="brand">${icon("tree")}<span>Skogsvandrare</span></div>
    <div class="top-actions">
      <div id="day-status" class="status-chip">En värld att upptäcka</div>
      <button id="audio" class="icon-button" title="Slå på naturljud" aria-label="Slå på naturljud" aria-pressed="false">${icon("muted")}</button>
      <button id="fullscreen" class="icon-button" title="Helskärm" aria-label="Växla helskärm">${icon("expand")}</button>
      <button id="help" class="icon-button" title="Kontroller och paus" aria-label="Kontroller och paus">${icon("help")}</button>
    </div>
  </header>
  <section id="intro" class="intro" aria-labelledby="intro-title">
    <div class="intro-content">
      <div class="eyebrow">Ett äventyr i Grönved</div>
      <h1 id="intro-title">Gå vilse.<br>Hitta <em>hem.</em></h1>
      <p class="intro-copy">Från stilla skogar till levande stadskvarter.<br>Upptäck fyra byar och följ stigen söderut<br>till Norrhamn City utanför skogen.</p>
      <button id="start" class="primary" disabled><span>Världen vaknar ...</span>${icon("arrow")}</button>
      <div class="intro-controls"><span class="keys"><kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd></span><span>Piltangenterna tar dig framåt</span></div>
      <p id="loading" class="loading-note" role="status">Planterar skogen och tänder morgonljuset ...</p>
    </div>
  </section>
  <div id="intro-bottom" class="intro-bottom">
    <div class="coordinates"><span>Fri utforskning</span><span>Fyra byar. En megastad. Din egen väg.</span></div>
    <div class="scene-caption"><strong>Grönved</strong>En stilla morgon · Sensommar</div>
  </div>
  <div id="hud" class="hud" hidden>
    <div class="compass"><div id="compass-line" class="compass-line"></div><div class="compass-marker"></div></div>
    <div class="location"><div class="small-label">Du befinner dig i</div><h2 id="location">Grönvedsskogen</h2><p id="location-detail">Mellan träden finns nya vägar.</p></div>
    <button id="travel" class="travel-button"><kbd>C</kbd><span id="travel-label">Snabbresa till Norrhamn City</span></button>
    <div id="vehicle-hud" class="vehicle-hud" hidden><span id="vehicle-name"></span><strong id="vehicle-speed">0 <small>km/h</small></strong><p>Hastighetsgräns ${SPEED_LIMIT_KMH} km/h · Stanna vid rött<br>↑ / W Gas · ↓ / S Bromsa / backa<br>← → / A D Styr · Space Handbroms · E Kliv ur</p></div>
    <div id="police-hud" class="police-hud" role="status" hidden><strong id="police-title"></strong><p id="police-detail"></p></div>
    <div id="flight-hud" class="vehicle-hud" hidden><span id="flight-name">Grönved Air</span><strong id="flight-speed"></strong><p id="flight-altitude"></p><p>W Gas · S Bromsa · ← → Sväng<br>↓ Stig · ↑ Sjunk · Flygtak 10 000 m<br>V Cockpit / följkamera · E Kliv ur när du parkerat</p></div>
    <div class="quest"><div class="small-label">Din första vandring</div><div id="quest-title" class="quest-title">Lär känna Grönved</div><p id="quest-text">Besök skogens ${LANDMARKS.length} byar <span id="visited-count">0 / ${LANDMARKS.length}</span></p><div id="quest-progress" class="quest-progress">${LANDMARKS.map(() => "<span></span>").join("")}</div></div>
    <div class="minimap-wrap"><button id="open-map" class="minimap-button" title="Öppna kartan (M)" aria-label="Öppna kartan"><canvas id="minimap" width="300" height="300"></canvas><span class="map-n">N</span></button><div class="map-hint"><kbd>M</kbd> Visa kartan</div></div>
    <div class="survival-hud"><div><span id="health-label">Hälsa 100 / 100</span><progress id="health" max="100" value="100" aria-label="Hälsa"></progress></div><p id="safety-status">Utforska i dagsljuset.</p><button id="open-inventory"><kbd>B</kbd> Ryggsäck</button><span id="weapon-status">Svärdet ligger i ryggsäcken</span></div>
    <div id="bottom-controls" class="bottom-controls"><span><kbd>Space</kbd> Hoppa</span><span><kbd>Shift</kbd> Spring</span><span><kbd>F</kbd> Svärdshugg</span></div>
    <div id="interaction" class="interaction" hidden><kbd>E</kbd><span id="interaction-text"></span></div>
    <div id="discovery" class="discovery" role="status"><div class="small-label">Ny plats upptäckt</div><h2 id="discovery-name"></h2><div class="discovery-line"></div><p id="discovery-description"></p></div>
  </div>
  <section id="help-overlay" class="overlay" role="dialog" aria-modal="true" aria-labelledby="help-title" hidden>
    <div class="panel">
      <button id="close-help" class="icon-button close" aria-label="Stäng">${icon("close")}</button>
      <div class="small-label">Ta det i din egen takt</div><h2 id="help-title">Skog och storstad.</h2>
      <p>Följ stigen söderut från Björkby. Träden glesnar och Norrhamns silhuett växer fram: skog och stad är samma sammanhängande landskap. Följ stigen tillbaka när du vill. Alla fyra byar finns kvar. C är valfri snabbresa. Utforska stadsdelar, caféer och restauranger. Vid bussterminalen finns taxi, sportbil, buss, polisbil, skåpbil och BMW Sport. BMW:n är snabbast: 400 km/h, kraftiga bromsar och stabilare styrning i hög fart. Gå nära ett stillastående fordon och tryck E. Kör med WASD eller pilarna, bromsa med Space och stanna innan du kliver ur med E.</p>
      <p>I staden gäller ${SPEED_LIMIT_KMH} km/h. Fortkörning och att köra över stopplinjen vid rött startar en polisjakt. Patrullerna följer gatorna och kan fånga dig när de kommer nära och du står stilla eller kör långsamt. Håll avstånd från alla patruller i ${ESCAPE_SECONDS} sekunder för att komma undan. Om du blir fångad hamnar du i häktet i ${JAIL_SECONDS} sekunder och släpps sedan automatiskt ut vid terminalens polisstation. Snabbresa är avstängd under jakten och i häktet; öppna paneler pausar även jakten och fängelsetiden. Polisbilar i tjänst går inte att låna.</p>
      <p>Flygplatsen ligger på stadens östra sida och är markerad på världskartan (M). Gå till planet och tryck E. W ger gas, S bromsar, vänster / höger pil svänger. Dra upp nosen med pil ned (↓) för att stiga, och sänk nosen med pil upp (↑) för att sjunka. Accelerera längs banan för att lyfta. Du kan flyga upp till 10 000 meters höjd över både staden och skogen. V växlar cockpit / följkamera. Återvänd längs banan och håll S + ↑ för att landa. E låter dig kliva ur först när planet står stilla på marken. Paneler och paus stoppar även flygningen.</p>
      <p>Utforska skogens fyra byar. Dagen varar i tre minuter och natten i en och en halv. När varulvarna kommer kan du springa undan, försvara dig eller gå in i ett hus. Inomhus är du trygg och återhämtar hälsa. Tryck E vid sängen för att lägga dig och sova till nästa morgon. Efter en kort sovanimation kliver du upp automatiskt med full hälsa. Spelet pausas när en panel är öppen.</p>
      <div class="control-list">
        <div class="control-row"><span>Gå i kamerans riktning</span><span class="keys"><kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd></span></div>
        <div class="control-row"><span>Spring</span><kbd>Shift</kbd></div>
        <div class="control-row"><span>Se dig omkring / zooma</span><span>Dra musen / scrolla</span></div>
        <div class="control-row"><span>Hoppa</span><kbd>Space</kbd></div>
        <div class="control-row"><span>Prata / gå in eller ut / sova vid sängen</span><kbd>E</kbd></div>
        <div class="control-row"><span>Valfri snabbresa till staden / skogen</span><kbd>C</kbd></div>
        <div class="control-row"><span>Kliv i / ur stillastående fordon</span><kbd>E</kbd></div>
        <div class="control-row"><span>Kör / styr · handbroms</span><span>WASD / pilar · Space</span></div>
        <div class="control-row"><span>Flyg: gas / broms · sväng</span><span>W / S · ← / →</span></div>
        <div class="control-row"><span>Flyg: stig / sjunk · byt vy</span><span>↓ / ↑ · V</span></div>
        <div class="control-row"><span>Ryggsäck / utrusta svärdet</span><span class="keys"><kbd>B</kbd><kbd>1</kbd></span></div>
        <div class="control-row"><span>Hugg med utrustat svärd</span><kbd>F</kbd></div>
        <div class="control-row"><span>Karta / paus</span><span class="keys"><kbd>M</kbd><kbd>Esc</kbd></span></div>
      </div>
      <p>Vid den gröna skogsporten intill terminalen: fortsätt gå norrut längs stigen för att återvända till skogen. E låter dig prata med stadsbor. Stadens caféer, restauranger och butiker har öppna dörrar: tryck E vid skylten ÖPPET för att gå in. Utforska inredningen och prata med personal och gäster. E vid utgångsmattan tar dig tillbaka till samma gata. Gå ut innan du snabbreser.</p>
      <p>Spelresurser: ambientCG och Poly Haven (CC0), Car Concept av Eric Chadwick / DGG (CC BY 4.0). <a href="./assets/city/CREDITS.txt" target="_blank" rel="noopener">Källor och licenser</a>.</p>
      <button id="resume" class="primary"><span>Tillbaka till äventyret</span>${icon("arrow")}</button>
    </div>
  </section>
  <section id="map-overlay" class="overlay" role="dialog" aria-modal="true" aria-labelledby="map-title" hidden>
    <div class="panel map-panel">
      <button id="close-map" class="icon-button close" aria-label="Stäng kartan">${icon("close")}</button>
      <div class="small-label">Din värld att upptäcka</div><h2 id="map-title">Grönved</h2>
      <canvas id="large-map" width="720" height="610" aria-label="Karta över Grönved med din position och alla byar"></canvas>
      <div id="map-legend" class="map-legend"><span><i class="map-dot player"></i> Du är här</span><span><i class="map-dot filled"></i> Besökt by</span><span><i class="map-dot"></i> Outforskad by</span></div>
    </div>
  </section>
  <section id="inventory-overlay" class="overlay" role="dialog" aria-modal="true" aria-labelledby="inventory-title" hidden>
    <div class="panel">
      <button id="close-inventory" class="icon-button close" aria-label="Stäng ryggsäcken">${icon("close")}</button>
      <div class="small-label">Din utrustning · Spelet är pausat</div><h2 id="inventory-title">Ryggsäcken</h2>
      <div class="inventory-item"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M47 5 56 8 32 42 24 35Z" fill="#c8d8dc"/><path d="m18 32 19 13M25 41 15 55" stroke="#d4c49a" stroke-width="6"/></svg><div><h3>Vandrarsvärd <span>× 1</span></h3><p>Två träffar driver bort en varulv. Vänd dig mot den och tryck F.</p></div></div>
      <button id="equip-sword" class="primary" aria-pressed="false">Utrusta svärdet</button>
      <p>Snabbval: <kbd>1</kbd> utrustar eller stoppar undan svärdet. Hälsan återhämtas i dagsljus och inomhus.</p>
    </div>
  </section>
  <section id="dialogue" class="dialogue-panel" role="dialog" aria-modal="true" aria-labelledby="speaker" hidden>
    <div class="small-label" id="speaker-role"></div><h3 id="speaker"></h3><p id="dialogue-text"></p>
    <button id="close-dialogue">Fortsätt vandra <kbd>E</kbd></button>
  </section>
  <div id="toast" class="toast" role="status" hidden></div>
`;

const canvas = element<HTMLCanvasElement>("scene");
const keys = new Set<string>();
const visited = new Set<string>();
const audio = new ForestAudio();
let started = false;
let overlay: "help" | "map" | "dialogue" | "inventory" | null = null;
let focusBeforeOverlay: HTMLElement | null = null;
let toastTimer = 0;
let discoveryTimer = 0;

function toast(message: string): void {
  element("toast").textContent = message;
  element("toast").hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { element("toast").hidden = true; }, 4500);
}

function showOverlay(next: typeof overlay): void {
  if (!overlay && next) {
    focusBeforeOverlay = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  overlay = next;
  keys.clear();
  element("help-overlay").hidden = next !== "help";
  element("map-overlay").hidden = next !== "map";
  element("dialogue").hidden = next !== "dialogue";
  element("inventory-overlay").hidden = next !== "inventory";
  if (next) {
    element(`close-${next}`).focus();
  } else {
    (started ? canvas : focusBeforeOverlay)?.focus();
  }
}

element("help").addEventListener("click", () => showOverlay("help"));
element("close-help").addEventListener("click", () => showOverlay(null));
element("resume").addEventListener("click", () => showOverlay(null));
element("close-map").addEventListener("click", () => showOverlay(null));
element("close-dialogue").addEventListener("click", () => showOverlay(null));
element("close-inventory").addEventListener("click", () => showOverlay(null));
element("audio").addEventListener("click", async () => {
  try {
    const enabled = await audio.toggle();
    const button = element("audio");
    button.innerHTML = icon(enabled ? "sound" : "muted");
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "Stäng av naturljud" : "Slå på naturljud");
    button.title = enabled ? "Stäng av naturljud" : "Slå på naturljud";
  } catch (error) {
    console.error("Kunde inte starta naturljud:", error);
    toast("Webbläsaren kunde inte starta ljudet. Prova igen.");
  }
});
element("fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    console.error("Kunde inte växla helskärm:", error);
    toast("Helskärm stöds inte i den här vyn. Öppna spelet i en egen webbläsarflik.");
  }
});

async function init(): Promise<void> {
  // Let the loading screen paint before generating the world.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb5c6ba);
  const outdoorFog = new THREE.FogExp2(0xb5c6ba, 0.0013);
  scene.fog = outdoorFog;
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.15, FLIGHT_VIEW_DISTANCE);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(FLIGHT_VIEW_DISTANCE * 0.8, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(0x6b99b3) },
        horizon: { value: new THREE.Color(0xd0d4b9) },
        daylight: { value: 1 },
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <logdepthbuf_pars_fragment>
        uniform vec3 zenith; uniform vec3 horizon; uniform float daylight; varying vec3 vPosition;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 direction = normalize(vPosition);
          float h = pow(max(direction.y, 0.), .55);
          vec3 color = mix(horizon, zenith, h);
          float sun = pow(max(dot(direction, normalize(vec3(-60.,90.,35.))),0.), 420.);
          color += vec3(1.,.75,.35) * sun * 2. * daylight;
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  scene.add(sky);
  const ambient = new THREE.HemisphereLight(0xc3d5df, 0x566341, 2.4);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffe0a5, 3.3);
  sun.position.set(-60, 90, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -48;
  sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48;
  sun.shadow.camera.bottom = -48;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 230;
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.00012;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  element("loading").textContent = "Laddar stadens material, bilmodell och uteserveringar ...";
  const cityAssets = await loadCityAssets();
  const world = new World(scene);
  const city = new City(cityAssets);
  const police = new TrafficPolice(city);
  const jail = new Jail();
  let jailed = false;
  let jailRemaining = 0;
  let releaseWaiting = false;
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  city.scene.environment = environmentGenerator.fromEquirectangular(cityAssets.environment).texture;
  cityAssets.environment.dispose();
  environmentGenerator.dispose();
  scene.environment = city.scene.environment;
  city.scene.position.copy(CITY_ORIGIN);
  city.scene.rotation.y = CITY_ROTATION;
  scene.add(city.scene);
  city.scene.updateMatrixWorld(true);
  const aviation = new Aviation();
  const crashEffects = new CrashEffects();
  scene.add(crashEffects.group);
  scene.add(aviation.group);
  const landscape = new THREE.Mesh(
    new THREE.PlaneGeometry(FLIGHT_VIEW_DISTANCE * 2, FLIGHT_VIEW_DISTANCE * 2),
    new THREE.MeshStandardMaterial({ color: 0x547044, roughness: 1 }),
  );
  landscape.rotation.x = -Math.PI / 2;
  landscape.position.set(335, -0.13, 370);
  landscape.receiveShadow = true;
  scene.add(landscape);
  const airportRoad = new THREE.InstancedMesh(new THREE.BoxGeometry(52, 0.06, 34), cityAssets.asphalt, 1);
  airportRoad.setMatrixAt(0, new THREE.Matrix4());
  airportRoad.position.set(674, -0.01, 655);
  airportRoad.receiveShadow = true;
  scene.add(airportRoad);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  city.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const textures = material instanceof THREE.MeshStandardMaterial
        ? [material.map, material.normalMap, material.roughnessMap, material.bumpMap, material.emissiveMap]
        : material instanceof THREE.MeshBasicMaterial ? [material.map] : [];
      for (const texture of textures) {
        if (texture) texture.anisotropy = anisotropy;
      }
    }
  });
  let inCity = false;
  const forestPosition = new THREE.Vector3();
  let forestHeading = 0;
  let forestYaw = 0;
  const interior = new Interior();
  const venueInterior = new VenueInterior(cityAssets.furniture, city.scene.environment);
  const survival = new Survival();
  const werewolves = new Werewolves(scene, world);
  let currentHouse: House | null = null;
  let currentVenue: CityVenue | null = null;
  let outsideVenueHeading = 0;
  let nearHouse: House | undefined;
  const outsidePosition = new THREE.Vector3();
  let outsideYaw = 0;
  let verticalVelocity = 0;
  let grounded = true;
  let jumpPreparation = 0;
  let sleep: { time: number; position: THREE.Vector3; rotation: THREE.Quaternion; heading: number } | null = null;
  const sleepTransition = 0.65;
  const wakeTime = sleepTransition + 1.8;
  const sleepDuration = wakeTime + sleepTransition;
  const player = new Character();
  player.group.position.set(SPAWN.x, world.heightAt(SPAWN.x, SPAWN.z), SPAWN.z);
  player.group.rotation.y = Math.PI;
  scene.add(player.group);

  const npcData = [
    { name: "Alva", role: "Björkbys trädgårdsmästare", color: 0x987957, line: "Välkommen till Björkby, vandrare. Stigen åt höger leder mot Sjögläntan och det stilla vattnet. Åt vänster, uppe bland tallarna, hittar du Tallvik. Men glöm inte att stanna och lyssna på skogen ibland." },
    { name: "Nils", role: "Fiskare i Sjögläntan", color: 0x637b87, line: "God morgon! Det är något särskilt med ljuset över sjön i dag. Här i Sjögläntan låter vi dagarna ta sin tid. Följ stranden en stund om du vill ha en fin utsikt — men vattnet är för djupt för att vada i." },
    { name: "Edda", role: "Tallviks skogsvaktare", color: 0x9a6554, line: "Du hittade hela vägen hit! De äldsta träden står bortom byn. Där finns ingen stig, men du kan vandra fritt mellan stammarna. Grönved är som vackrast när man inte har bråttom någonstans." },
    { name: "Liv", role: "Värd i den södra byn", color: 0x807499, line: "Här finns alltid ett hus att vila i. När mörkret faller stryker varulvar mellan träden. Gå fram till en dörr och tryck E för att söka skydd. Ditt svärd ligger i ryggsäcken — öppna den med B." },
  ];
  const npcs = npcData.map((data, i) => {
    const landmark = LANDMARKS[i];
    const character = new Character(data.color, false);
    const x = landmark.x + 2.4;
    const z = landmark.z + 2;
    character.group.position.set(x, world.heightAt(x, z), z);
    character.group.rotation.y = 0.3;
    scene.add(character.group);
    return { ...data, character };
  });
  let nearNpc: (typeof npcs)[number] | undefined;
  let yaw = 0;
  let pitch = 0.43;
  let distance = 10;
  let dragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  const velocity = new THREE.Vector3();
  const moveDirection = new THREE.Vector3();
  const target = new THREE.Vector3();
  const desiredCamera = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3();
  const npcDirection = new THREE.Vector3();
  const shadowCenter = new THREE.Vector3();
  const sunOffset = new THREE.Vector3(-60, 90, 35);
  const shadowStep = 96 / 2048;
  let elapsed = 0;
  let lastTime = performance.now();
  let lastMapUpdate = 0;
  let locationId = "";
  let cinematicTransition = 0;
  const indoors = () => jailed || currentHouse !== null || currentVenue !== null;
  const inAirport = (x: number, z: number) => x >= AIRPORT_BOUNDS.minX && x <= AIRPORT_BOUNDS.maxX
    && z >= AIRPORT_BOUNDS.minZ && z <= AIRPORT_BOUNDS.maxZ;
  const globalPosition = () => inCity ? cityToWorld(mapPosition()) : mapPosition().clone();
  const globalHeight = (x: number, z: number) =>
    Math.abs(x) <= WORLD_SIZE / 2 && Math.abs(z) <= WORLD_SIZE / 2 ? world.heightAt(x, z) : 0;
  const globalBlocked = (x: number, z: number, radius = PLAYER_RADIUS): boolean => {
    if (inAirport(x, z)) return aviation.blocked(x, z, radius);
    if (onAirportApproach(x, z, radius)) return false;
    if (z < FOREST_JOIN) return world.blocked(x, z, radius);
    const p = worldToCity(new THREE.Vector3(x, 0, z));
    return city.blocked(p.x, p.z, radius) || city.vehicleBlocked(p.x, p.z, radius)
      || city.pedestrianBlocked(p.x, p.z, radius);
  };
  const globalFlightBlocked = (x: number, y: number, z: number, radius: number): boolean => {
    if (aviation.flightBlocked(x, y, z, radius) || world.flightBlocked(x, y, z, radius)) return true;
    const p = worldToCity(new THREE.Vector3(x, y, z));
    return city.flightBlocked(p.x, p.y, p.z, radius);
  };
  const outdoorTerrain = {
    heightAt(x: number, z: number): number {
      const p = inCity ? cityToWorld(new THREE.Vector3(x, 0, z)) : new THREE.Vector3(x, 0, z);
      return globalHeight(p.x, p.z);
    },
    blocked(x: number, z: number, radius = PLAYER_RADIUS): boolean {
      const p = inCity ? cityToWorld(new THREE.Vector3(x, 0, z)) : new THREE.Vector3(x, 0, z);
      return globalBlocked(p.x, p.z, radius);
    },
  };
  const terrain = () => jailed ? jail : currentVenue ? venueInterior : currentHouse ? interior : outdoorTerrain;
  const outsideScene = () => scene;
  const mapPosition = () => indoors() ? outsidePosition : player.group.position;
  const daySky = new THREE.Color(0x6b99b3);
  const nightSky = new THREE.Color(0x071125);
  const dayHorizon = new THREE.Color(0xd0d4b9);
  const nightHorizon = new THREE.Color(0x1b2948);
  const dayFog = new THREE.Color(0xb5c6ba);
  const nightFog = new THREE.Color(0x111d33);

  function equipSword(): void {
    if (inCity || aviation.active) { toast("Svärdet vilar i staden och under flygningen."); return; }
    survival.equipped = !survival.equipped;
    player.equipSword(survival.equipped);
    element("equip-sword").textContent = survival.equipped ? "Stoppa undan svärdet" : "Utrusta svärdet";
    element("equip-sword").setAttribute("aria-pressed", String(survival.equipped));
    element("weapon-status").textContent = survival.equipped ? "Svärd utrustat · F för att hugga" : "Svärdet ligger i ryggsäcken";
  }
  element("equip-sword").addEventListener("click", equipSword);
  const openInventory = () => { if (started) showOverlay(overlay === "inventory" ? null : "inventory"); };
  element("open-inventory").addEventListener("click", openInventory);

  function resetMovement(): void {
    velocity.set(0, 0, 0);
    verticalVelocity = 0;
    grounded = true;
    jumpPreparation = 0;
    keys.clear();
    dragging = false;
    nearNpc = undefined;
    nearHouse = undefined;
    cinematicTransition = 0;
  }

  function enterHouse(house: House): void {
    outsidePosition.copy(house.entrance);
    outsideYaw = yaw;
    currentHouse = house;
    interior.enter(house);
    interior.scene.add(player.group);
    player.group.position.copy(interior.spawn);
    player.group.rotation.y = Math.PI;
    yaw = 0;
    resetMovement();
    updateCamera(1);
    toast("Du är trygg här. Tryck E vid sängen för att sova till morgonen, eller vid dörren för att gå ut.");
  }

  function leaveHouse(): void {
    currentHouse = null;
    scene.add(player.group);
    player.group.position.copy(outsidePosition);
    yaw = outsideYaw;
    resetMovement();
    locationId = "";
    updateCamera(1);
  }

  function enterVenue(venue: CityVenue): void {
    venueInterior.enter(venue);
    outsidePosition.copy(venue.entrance);
    outsideYaw = yaw;
    outsideVenueHeading = player.group.rotation.y;
    currentVenue = venue;
    venueInterior.scene.add(player.group);
    player.group.position.copy(venueInterior.spawn);
    player.group.rotation.y = Math.PI;
    yaw = 0;
    resetMovement();
    updateCamera(1);
    toast(`Välkommen till ${venue.name}! Utforska lokalen och prata med människor med E. E vid dörren tar dig ut igen.`);
  }

  function leaveVenue(): void {
    if (!currentVenue) throw new Error("Ingen stadslokal är öppen.");
    const exit = city.venueExit(currentVenue);
    if (!exit) {
      toast("Det är trångt framför dörren. Vänta en stund och försök gå ut igen.");
      return;
    }
    currentVenue = null;
    city.scene.add(player.group);
    player.group.position.copy(exit);
    player.group.rotation.y = outsideVenueHeading;
    yaw = outsideYaw;
    resetMovement();
    locationId = "";
    updateCamera(1);
  }

  function updateRegion(next: boolean): void {
    if (next === inCity) return;
    const position = globalPosition();
    const rotation = next ? -CITY_ROTATION : CITY_ROTATION;
    inCity = next;
    (inCity ? city.scene : scene).add(player.group);
    player.group.position.copy(inCity ? worldToCity(position) : position);
    player.group.rotation.y += rotation;
    yaw += rotation;
    velocity.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
    nearHouse = undefined;
    nearNpc = undefined;
    if (inCity) werewolves.clear();
    player.equipSword(!inCity && !aviation.active && survival.equipped);
    document.body.classList.toggle("in-city", inCity);
    element("travel-label").textContent = inCity ? "Snabbresa till Grönved" : "Snabbresa till Norrhamn City";
    element("weapon-status").textContent = inCity ? "Trygg stad · Svärdet vilar" : survival.equipped ? "Svärd utrustat · F för att hugga" : "Svärdet ligger i ryggsäcken";
    element("bottom-controls").innerHTML = inCity
      ? "<span><kbd>E</kbd> Fordon / prata</span><span><kbd>M</kbd> Världskarta / flygplats</span>"
      : "<span><kbd>Space</kbd> Hoppa</span><span><kbd>Shift</kbd> Spring</span><span><kbd>F</kbd> Svärdshugg</span>";
    element<HTMLButtonElement>("equip-sword").disabled = inCity || aviation.active;
    locationId = "";
  }

  function travel(): void {
    if (!started || overlay) return;
    if (jailed) { toast("Du kan resa igen när fängelsetiden är slut."); return; }
    if (police.wanted) { toast("Snabbresa är avstängd under polisjakten. Kom undan polisen först."); return; }
    if (indoors() || sleep) { toast("Gå ut ur byggnaden innan du reser."); return; }
    if (city.activeVehicle || aviation.active) { toast("Stanna och kliv ur fordonet med E innan du reser."); return; }
    if (!grounded || jumpPreparation > 0) { toast("Landa innan du reser."); return; }
    if (!inCity) {
      forestPosition.copy(player.group.position);
      forestHeading = player.group.rotation.y;
      forestYaw = yaw;
      updateRegion(true);
      player.group.position.copy(CITY_SPAWN);
      player.group.rotation.y = Math.PI / 2;
      yaw = -Math.PI / 2;
      werewolves.clear();
      player.equipSword(false);
    } else {
      updateRegion(false);
      player.group.position.copy(forestPosition.lengthSq() > 0 ? forestPosition : new THREE.Vector3(SPAWN.x, world.heightAt(SPAWN.x, SPAWN.z), SPAWN.z));
      player.group.rotation.y = forestHeading;
      yaw = forestYaw;
      player.equipSword(survival.equipped);
    }
    locationId = "";
    resetMovement();
    updateCamera(1);
    toast(inCity ? "Välkommen till Norrhamn City! Fortsätt till terminalen och stadens kvarter. Stigen norrut leder tillbaka till skogen. M visar flygplatsen." : "Välkommen tillbaka till skogen! Alla fyra byar, dina upptäckter och din utrustning finns kvar.");
  }
  element("travel").addEventListener("click", () => travel());

  function arrestPlayer(reason: string): void {
    if (city.activeVehicle) {
      city.activeVehicle.speed = 0;
      city.activeVehicle.automatic = false;
      city.activeVehicle = null;
    }
    updateRegion(true);
    outsidePosition.copy(CITY_SPAWN);
    jailed = true;
    jailRemaining = JAIL_SECONDS;
    releaseWaiting = false;
    police.clear();
    jail.scene.add(player.group);
    player.group.position.copy(jail.spawn);
    player.group.rotation.set(0, Math.PI, 0);
    player.group.visible = true;
    player.equipSword(false);
    yaw = 0;
    resetMovement();
    updateCamera(1);
    toast(`Polisen fångade dig: ${reason}. Fängelse i ${JAIL_SECONDS} sekunder. Du behåller dina upptäckter och din utrustning.`);
  }

  function releasePlayer(): void {
    for (let radius = 0; radius <= 24; radius += 2) {
      const samples = radius === 0 ? 1 : 16;
      for (let i = 0; i < samples; i++) {
        const x = CITY_SPAWN.x + Math.cos(i / samples * Math.PI * 2) * radius;
        const z = CITY_SPAWN.z + Math.sin(i / samples * Math.PI * 2) * radius;
        if (city.blocked(x, z) || city.vehicleBlocked(x, z, PLAYER_RADIUS) || city.pedestrianBlocked(x, z, PLAYER_RADIUS)) continue;
        jailed = false;
        city.scene.add(player.group);
        player.group.position.set(x, 0, z);
        yaw = -Math.PI / 2;
        resetMovement();
        locationId = "";
        updateCamera(1);
        toast("Du är fri igen. Kör högst 70 km/h och stanna vid rött. Din bil står kvar där du blev stoppad.");
        return;
      }
    }
    if (!releaseWaiting) {
      releaseWaiting = true;
      toast("Fängelsetiden är slut. Polisen väntar på en ledig, säker plats utanför stationen för att släppa ut dig.");
    }
  }

  function updatePolice(dt: number): void {
    if (jailed) {
      jailRemaining = Math.max(0, jailRemaining - dt);
      if (jailRemaining < 0.000001) { jailRemaining = 0; releasePlayer(); }
      return;
    }
    const reason = police.reason;
    const event = police.update(dt, {
      position: worldToCity(globalPosition()),
      vehicle: city.activeVehicle,
      available: !indoors() && !aviation.active,
    });
    if (event === "arrest") arrestPlayer(reason);
    else if (event === "escaped") toast("Du skakade av dig polisen. Efterlysningen är avskriven.");
  }

  function updateSurvival(dt: number): void {
    const wasNight = survival.night;
    survival.update(dt, currentHouse !== null || inCity || aviation.active);
    if (survival.night !== wasNight) {
      toast(survival.night ? aviation.active ? "Nattflygning · Du är trygg ombord. Följ banljusen tillbaka till flygplatsen." : inCity ? "Natt över Norrhamn. Fönstren lyser och staden är trygg." : "Natten är här! Sök skydd i ett hus eller utrusta svärdet med 1." : "Solen går upp. Varulvarna drar sig tillbaka.");
    }
    const hit = !inCity && !aviation.active && werewolves.update(dt, elapsed, mapPosition(), currentHouse !== null, survival);
    if (hit) toast("Varulven träffade dig! Spring till ett hus eller försvara dig med F.");
    if (survival.health <= 0) {
      werewolves.clear();
      survival.recover();
      const refuge = world.houses.reduce<House | undefined>((nearest, house) =>
        !nearest || house.entrance.distanceToSquared(player.group.position) < nearest.entrance.distanceToSquared(player.group.position) ? house : nearest, undefined);
      if (refuge) enterHouse(refuge);
      else throw new Error("Världen saknar ett hus att återhämta sig i.");
      toast("En bybo hjälpte dig till ett tryggt hus. Du behåller svärdet och dina upptäckter.");
    }
    const daylight = survival.daylight;
    const urbanBlend = THREE.MathUtils.smoothstep(globalPosition().z, 125, 310);
    ambient.intensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.55, 0.2, urbanBlend), THREE.MathUtils.lerp(2.4, 1.3, urbanBlend), daylight);
    sun.intensity = THREE.MathUtils.lerp(0.38, 3.3, daylight);
    sun.color.set(daylight > 0.3 ? 0xffe0a5 : 0x9abaff);
    sky.material.uniforms.daylight.value = daylight;
    sky.material.uniforms.zenith.value.copy(nightSky).lerp(daySky, daylight);
    sky.material.uniforms.horizon.value.copy(nightHorizon).lerp(dayHorizon, daylight);
    scene.fog!.color.copy(nightFog).lerp(dayFog, daylight);
    city.scene.fog!.color.copy(scene.fog!.color);
    outdoorFog.density = THREE.MathUtils.damp(outdoorFog.density,
      aviation.active ? flightFogDensity(aviation.plane.position.y) : 0.0013, 2, dt);
    scene.environmentIntensity = THREE.MathUtils.lerp(0.12, 0.8, daylight);
    const minutes = Math.floor(survival.remaining / 60);
    const seconds = String(survival.remaining % 60).padStart(2, "0");
    element("day-status").textContent = `${survival.night ? "Natt" : "Dag"} · ${minutes}:${seconds} till ${survival.night ? "gryning" : "natt"}`;
    element<HTMLProgressElement>("health").value = survival.health;
    element("health-label").textContent = `Hälsa ${Math.ceil(survival.health)} / 100`;
    element("safety-status").textContent = aviation.crashRemaining > 0 ? "Flygkrasch · Återvänder snart till flygplatsen" : aviation.active ? "Ombord · Trygg flygning" : indoors() ? "Inomhus · Hälsan återhämtas" : inCity ? "Trygg stad · Hälsan återhämtas" : survival.night ? `Natt · ${werewolves.count} varulvar i närheten` : "Dagsljus · Hälsan återhämtas";
  }

  const mapBase = document.createElement("canvas");
  mapBase.width = 600;
  mapBase.height = 600;
  const baseContext = mapBase.getContext("2d");
  if (!baseContext) throw new Error("Kunde inte skapa kartan.");
  const toMap = (value: number) => (value / WORLD_SIZE + 0.5) * 600;
  for (let z = 0; z < 150; z++) {
    for (let x = 0; x < 150; x++) {
      const wx = (x / 150 - 0.5) * WORLD_SIZE;
      const wz = (z / 150 - 0.5) * WORLD_SIZE;
      const h = world.heightAt(wx, wz);
      const variation = Math.sin(wx * 1.7 + wz * 2.9) * 3;
      const lightness = THREE.MathUtils.clamp(23 + h * 0.65 + variation, 17, 39);
      baseContext.fillStyle = `hsl(111, 19%, ${lightness}%)`;
      baseContext.fillRect(x * 4, z * 4, 4, 4);
    }
  }
  baseContext.strokeStyle = "#bbc49413";
  baseContext.lineWidth = 1;
  for (let n = 30; n < 600; n += 60) {
    baseContext.beginPath();
    baseContext.moveTo(n, 0); baseContext.lineTo(n, 600);
    baseContext.moveTo(0, n); baseContext.lineTo(600, n);
    baseContext.stroke();
  }
  baseContext.fillStyle = "#688a8d";
  baseContext.strokeStyle = "#b2c1a877";
  baseContext.lineWidth = 2;
  baseContext.beginPath();
  baseContext.ellipse(toMap(LAKE.x), toMap(LAKE.z), LAKE.rx / WORLD_SIZE * 600, LAKE.rz / WORLD_SIZE * 600, 0, 0, Math.PI * 2);
  baseContext.fill();
  baseContext.stroke();
  baseContext.strokeStyle = "#d4c49a99";
  baseContext.lineWidth = 2;
  for (const path of PATHS) {
    baseContext.beginPath();
    path.forEach((point, index) => {
      if (index === 0) baseContext.moveTo(toMap(point.x), toMap(point.z));
      else baseContext.lineTo(toMap(point.x), toMap(point.z));
    });
    baseContext.stroke();
  }
  baseContext.fillStyle = "#ffe2a6";
  baseContext.beginPath();
  baseContext.arc(toMap(FOREST_CITY_EXIT.x), toMap(FOREST_CITY_EXIT.z), 5, 0, Math.PI * 2);
  baseContext.fill();

  const miniContext = element<HTMLCanvasElement>("minimap").getContext("2d");
  const largeContext = element<HTMLCanvasElement>("large-map").getContext("2d");
  if (!miniContext || !largeContext) throw new Error("Kunde inte rita kartan.");

  function drawWorldMap(ctx: CanvasRenderingContext2D, large: boolean): void {
    const { width, height } = ctx.canvas;
    const position = globalPosition();
    const scale = large ? Math.min(width, height) / 1280 : aviation.active ? 0.45 : 1.45;
    ctx.fillStyle = "#233c30";
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2 - (large ? 330 : position.x) * scale, height / 2 - (large ? 370 : position.z) * scale);
    ctx.scale(scale, scale);
    ctx.drawImage(mapBase, -210, -210, 420, 420);
    city.drawWorldMap(ctx);
    ctx.fillStyle = "#86958d";
    ctx.fillRect(648, 638, 52, 34);
    ctx.fillRect(AIRPORT_BOUNDS.minX, AIRPORT_BOUNDS.minZ,
      AIRPORT_BOUNDS.maxX - AIRPORT_BOUNDS.minX, AIRPORT_BOUNDS.maxZ - AIRPORT_BOUNDS.minZ);
    ctx.fillStyle = "#263641";
    ctx.fillRect(775, 605, 30, 310);
    ctx.strokeStyle = "#ffe2a6";
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    ctx.moveTo(0, 190); ctx.lineTo(0, 240);
    ctx.stroke();
    if (large) {
      ctx.font = `${12 / scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff3ce";
      ctx.fillText("GRÖNVED", 0, -230);
      ctx.fillText("NORRHAMN CITY", 304, 550);
      ctx.fillText("FLYGPLATS · E VID PLANET", 735, 970);
      ctx.font = `${10 / scale}px sans-serif`;
      ctx.fillText("Gamla stan", 484, 400);
      ctx.fillText("Centrum", 484, 740);
      ctx.fillText("Magasinskvarteren", 144, 400);
      ctx.fillText("Lindkvarteren", 144, 740);
      ctx.fillText("Centralparken", 304, 610);
      ctx.fillText("Terminalen", 0, 275);
      for (const place of LANDMARKS) {
        ctx.fillStyle = visited.has(place.id) ? "#ffe2a6" : "#aec5b1";
        ctx.beginPath();
        ctx.arc(place.x, place.z, 4 / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `${10 / scale}px sans-serif`;
        ctx.fillText(place.name, place.x, place.z - 16 / scale);
      }
    }
    ctx.fillStyle = "#ffd878";
    ctx.beginPath();
    ctx.arc(aviation.plane.position.x, aviation.plane.position.z, 4 / scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(position.x, position.z);
    ctx.rotate(-((currentVenue ? outsideVenueHeading : player.group.rotation.y) + (inCity ? CITY_ROTATION : 0)) + Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, -8 / scale); ctx.lineTo(5 / scale, 5 / scale);
    ctx.lineTo(0, 2 / scale); ctx.lineTo(-5 / scale, 5 / scale); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawMap(ctx: CanvasRenderingContext2D, large: boolean): void {
    if (large || inCity || aviation.active) { drawWorldMap(ctx, large); return; }
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#233c30";
    ctx.fillRect(0, 0, width, height);
    const scale = large ? width / 600 : 1.45;
    const px = toMap(mapPosition().x);
    const pz = toMap(mapPosition().z);
    const ox = large ? 0 : width / 2 - px * scale;
    const oy = large ? (height - 600 * scale) / 2 : height / 2 - pz * scale;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.drawImage(mapBase, 0, 0);
    for (const landmark of LANDMARKS) {
      const x = toMap(landmark.x);
      const z = toMap(landmark.z);
      ctx.fillStyle = "#dccc9e1c";
      ctx.beginPath();
      ctx.arc(x, z, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, z, 5, 0, Math.PI * 2);
      ctx.fillStyle = visited.has(landmark.id) ? "#e1d1a6" : "#304836";
      ctx.strokeStyle = "#e1d1a6";
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      if (large) {
        ctx.font = "15px Georgia";
        ctx.textAlign = "center";
        ctx.fillStyle = "#f2e9cf";
        ctx.shadowColor = "#132d22";
        ctx.shadowBlur = 7;
        ctx.fillText(landmark.name, x, z - 14);
        ctx.shadowBlur = 0;
      }
    }
    if (large) {
      ctx.fillStyle = "#ffe2a6";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Till Norrhamn City · Följ stigen söderut", toMap(0), toMap(180));
      ctx.fillStyle = "#d1decd88";
      ctx.font = "italic 12px Georgia";
      ctx.textAlign = "center";
      ctx.fillText("Spegelvattnet", toMap(LAKE.x), toMap(LAKE.z));
      ctx.fillStyle = "#cad6b94a";
      ctx.font = "11px sans-serif";
      ctx.fillText("G R Ö N V E D S S K O G E N", toMap(-45), toMap(92));
    }
    ctx.translate(px, pz);
    ctx.rotate(-player.group.rotation.y + Math.PI);
    ctx.shadowColor = "#f7f4ce";
    ctx.shadowBlur = 7;
    ctx.fillStyle = "#fff9df";
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (large) {
      ctx.fillStyle = "#e1d1a6";
      ctx.font = "12px Georgia";
      ctx.textAlign = "center";
      ctx.fillText("N", width - 32, 26);
      ctx.beginPath();
      ctx.moveTo(width - 32, 34); ctx.lineTo(width - 36, 46); ctx.lineTo(width - 28, 46);
      ctx.closePath(); ctx.fill();
    }
  }

  function openMap(): void {
    if (!started) return;
    element("map-title").textContent = "Grönved · Norrhamn · Flygplatsen";
    element("large-map").setAttribute("aria-label", "Sammanhängande världskarta med skogens byar, staden, flygplatsen, planet och din position");
    element("map-legend").innerHTML = "<span>Vit pil: du / lokalens dörr</span><span>Gul punkt: planet</span><span>Gult: café / fordon</span><span>Rosa: restaurang</span><span>Turkos: butik</span>";
    drawMap(largeContext!, true);
    showOverlay(overlay === "map" ? null : "map");
  }
  element("open-map").addEventListener("click", openMap);
  element("start").addEventListener("click", () => {
    started = true;
    cinematicTransition = 1;
    element("intro").classList.add("leaving");
    element("intro-bottom").hidden = true;
    element("hud").hidden = false;
    canvas.focus();
  });

  function interiorInteraction(): "sleep" | "exit" | null {
    if (sleep) return null;
    if (grounded && jumpPreparation === 0 && interior.nearBed(player.group.position.x, player.group.position.z)) return "sleep";
    if (player.group.position.distanceTo(interior.exit) < 3) return "exit";
    return null;
  }

  function talk(): void {
    if (overlay === "dialogue") { showOverlay(null); return; }
    if (overlay || !started) return;
    if (sleep) return;
    if (jailed) { toast(`Du blir frigiven om ${Math.ceil(jailRemaining)} sekunder. Öppna paneler pausar tiden.`); return; }
    if (aviation.active) {
      if (aviation.crashRemaining > 0) { toast("Planet har kraschat. Du återvänder snart till flygplatsen."); return; }
      const exit = aviation.exit(globalBlocked);
      if (!exit) { toast("Landa på banan och bromsa till stillastående innan du kliver ur."); return; }
      player.group.position.copy(inCity ? worldToCity(exit) : exit);
      updateRegion(exit.z >= FOREST_JOIN);
      player.group.visible = true;
      player.equipSword(!inCity && survival.equipped);
      element<HTMLButtonElement>("equip-sword").disabled = inCity;
      resetMovement();
      updateCamera(1);
      toast("Planet är parkerat. Tryck E vid planet för att flyga igen.");
      return;
    }
    if (!indoors() && !city.activeVehicle && aviation.nearPlane(globalPosition())) {
      if (!grounded || jumpPreparation > 0) { toast("Landa innan du kliver ombord."); return; }
      aviation.enter();
      werewolves.clear();
      resetMovement();
      player.equipSword(false);
      element<HTMLButtonElement>("equip-sword").disabled = true;
      element("weapon-status").textContent = "Ombord · Svärdet vilar";
      player.group.visible = false;
      player.group.position.copy(inCity ? worldToCity(aviation.plane.position) : aviation.plane.position);
      toast("Välkommen ombord! W ger gas, S bromsar, ← → svänger, ↓ stiger och ↑ sjunker. V byter vy.");
      return;
    }
    if (currentVenue) {
      if (venueInterior.nearExit(player.group.position)) {
        if (!grounded || jumpPreparation > 0) { toast("Landa innan du går ut."); return; }
        leaveVenue();
        return;
      }
      const resident = venueInterior.nearResident(player.group.position);
      if (resident) {
        element("speaker").textContent = resident.name;
        element("speaker-role").textContent = resident.role;
        element("dialogue-text").textContent = resident.line;
        showOverlay("dialogue");
      } else toast("Gå närmare en person för att prata, eller till dörren för att gå ut.");
      return;
    }
    if (inCity) {
      if (city.activeVehicle) {
        const exit = city.exit();
        if (!exit) { toast("Stanna helt med Space och lämna plats bredvid fordonet för att kliva ur."); return; }
        player.group.position.copy(exit);
        player.group.visible = true;
        resetMovement();
        toast("Du har parkerat. Fordonet står kvar tills du vill köra igen.");
        return;
      }
      const venue = city.nearVenue(player.group.position);
      if (venue) {
        if (!grounded || jumpPreparation > 0) { toast("Landa innan du går in."); return; }
        enterVenue(venue);
        return;
      }
      const vehicle = city.nearVehicle(player.group.position);
      if (vehicle) {
        if (!grounded || jumpPreparation > 0) { toast("Landa innan du kliver in i fordonet."); return; }
        city.enter(vehicle);
        resetMovement();
        player.group.visible = false;
        player.group.position.copy(vehicle.group.position);
        player.group.rotation.y = vehicle.group.rotation.y;
        yaw = vehicle.group.rotation.y + Math.PI;
        updateCamera(1);
        toast(`${city.vehicleName(vehicle)} · Kör med WASD eller pilarna. Space bromsar, E kliver ur när du står still.`);
        return;
      }
      const officer = city.nearOfficer(player.group.position);
      const citizen = city.nearCitizen(player.group.position);
      if (officer) {
        element("speaker").textContent = `Polis ${officer.name}`;
        element("speaker-role").textContent = "Norrhamns vänliga trafikpolis";
        element("dialogue-text").textContent = "Välkommen! Du kan låna parkerade fordon, men inte polispatruller i tjänst. Kör högst 70 km/h och stanna vid rött. Bryter du mot reglerna jagar patrullerna dig; blir du fångad får du sitta en minut i häktet. Vid terminalen finns också en BMW Sport med 400 km/h i toppfart, så var försiktig med gasen. Följ stigen norrut tillbaka till skogen, eller besök flygplatsen öster om staden.";
        showOverlay("dialogue");
      } else if (citizen) {
        element("speaker").textContent = citizen.name;
        element("speaker-role").textContent = city.districtAt(player.group.position.x, player.group.position.z);
        element("dialogue-text").textContent = citizen.line;
        citizen.character.group.lookAt(globalPosition());
        showOverlay("dialogue");
      } else toast("Gå närmare en dörr, stadsbo eller ett stillastående fordon och tryck E. Följ stigen till fots för att gå till skogen.");
      return;
    }
    if (currentHouse) {
      const interaction = interiorInteraction();
      if (interaction === "sleep") {
        sleep = { time: 0, position: player.group.position.clone(), rotation: player.group.quaternion.clone(), heading: player.group.rotation.y };
        resetMovement();
        player.setSleeping(true);
        toast("Du lägger dig i sängen och somnar ...");
      } else if (interaction === "exit") leaveHouse();
      else toast("Gå närmare sängen för att sova eller dörren för att gå ut.");
      return;
    }
    if (nearHouse) { enterHouse(nearHouse); return; }
    if (!nearNpc) return;
    element("speaker").textContent = nearNpc.name;
    element("speaker-role").textContent = nearNpc.role;
    element("dialogue-text").textContent = nearNpc.line;
    showOverlay("dialogue");
  }
  window.addEventListener("keydown", (event) => {
    if (event.code === "Tab" && overlay) {
      const container = element(overlay === "dialogue" ? "dialogue" : `${overlay}-overlay`);
      const focusable = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code) && started && !overlay) event.preventDefault();
    if (event.repeat) return;
    if (event.code === "Escape") { showOverlay(overlay ? null : "help"); return; }
    if (event.code === "KeyM" && started && overlay !== "dialogue") { openMap(); return; }
    if (event.code === "KeyE") { talk(); return; }
    if (event.code === "KeyC") { travel(); return; }
    if (event.code === "KeyB" && started && (!overlay || overlay === "inventory")) { openInventory(); return; }
    if (event.code === "KeyV" && started && !overlay && aviation.active) { aviation.toggleView(); return; }
    if (sleep) return;
    if (started && !overlay) {
      if (event.code === "Space" && !city.activeVehicle && !aviation.active && grounded && jumpPreparation === 0) {
        jumpPreparation = 0.1;
        player.prepareJump();
        return;
      }
      if (event.code === "Digit1") { equipSword(); return; }
      if (event.code === "KeyF") {
        if (aviation.active) { toast("Svärdet vilar under flygningen."); return; }
        if (inCity) { toast("Staden är en trygg plats. Här kör vi och utforskar utan strider."); return; }
        if (!survival.equipped) toast("Utrusta svärdet med 1 eller öppna ryggsäcken med B.");
        else if (survival.attack()) {
          player.attack();
          if (!currentHouse) werewolves.strike(player.group.position, player.group.rotation.y);
        }
        return;
      }
    }
    if (started && !overlay) keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => {
    keys.clear();
    dragging = false;
    if (started && !overlay) showOverlay("help");
  });
  document.addEventListener("visibilitychange", () => {
    keys.clear();
    lastTime = performance.now();
    if (document.hidden && started && !overlay) showOverlay("help");
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (!started || overlay || event.button !== 0) return;
    dragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging || overlay) return;
    yaw -= (event.clientX - lastPointerX) * 0.005;
    pitch = THREE.MathUtils.clamp(pitch + (event.clientY - lastPointerY) * 0.004, 0.13, 0.95);
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("lostpointercapture", () => { dragging = false; });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (started && !overlay) distance = THREE.MathUtils.clamp(distance + event.deltaY * 0.01, 4, 18);
  }, { passive: false });
  window.addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  });
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    showOverlay("help");
    toast("Grafiken avbröts. Ladda om sidan för att starta världen igen.");
  });

  function updateSleep(dt: number): void {
    if (!sleep) return;
    const previousTime = sleep.time;
    sleep.time += dt;
    if (previousTime < wakeTime && sleep.time >= wakeTime) {
      survival.sleepUntilMorning();
      werewolves.clear();
    }
    const progress = sleep.time < wakeTime
      ? THREE.MathUtils.smoothstep(sleep.time, 0, sleepTransition)
      : 1 - THREE.MathUtils.smoothstep(sleep.time, wakeTime, sleepDuration);
    player.group.position.lerpVectors(sleep.position, interior.sleepingPosition, progress);
    player.group.quaternion.slerpQuaternions(sleep.rotation, interior.sleepingRotation, progress);
    player.update(dt, 0, elapsed);
    if (sleep.time >= sleepDuration) {
      player.group.position.copy(sleep.position);
      // Quaternion interpolation can leave equivalent X/Z half-turns that invert yaw steering.
      player.group.rotation.set(0, sleep.heading, 0);
      player.setSleeping(false);
      sleep = null;
      resetMovement();
      toast("Du sov till nästa morgon och vaknar utvilad med full hälsa.");
    }
  }

  function updatePlayer(dt: number): void {
    if (aviation.active) {
      const message = aviation.update(dt, keys, globalHeight, globalFlightBlocked,
        impact => crashEffects.impact(impact, scene, [aviation.plane, player.group], globalHeight));
      if (message) toast(message);
      player.group.position.copy(inCity ? worldToCity(aviation.plane.position) : aviation.plane.position);
      updateRegion(aviation.plane.position.z >= FOREST_JOIN);
      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(aviation.plane.quaternion);
      const heading = Math.atan2(direction.x, direction.z);
      player.group.rotation.y = heading - (inCity ? CITY_ROTATION : 0);
      yaw = player.group.rotation.y + Math.PI;
      return;
    }
    if (inCity && city.activeVehicle) {
      const throttle = Number(keys.has("ArrowUp") || keys.has("KeyW")) - Number(keys.has("ArrowDown") || keys.has("KeyS"));
      const steering = Number(keys.has("ArrowRight") || keys.has("KeyD")) - Number(keys.has("ArrowLeft") || keys.has("KeyA"));
      const previous = city.activeVehicle.group.position.clone();
      city.drive(dt, throttle, steering, keys.has("Space"), shape => police.checkContact({
        position: player.group.position, vehicle: city.activeVehicle, available: true,
      }, shape));
      const offence = police.observeDriving(previous, city.activeVehicle, dt);
      if (offence) toast(offence);
      player.group.position.copy(city.activeVehicle.group.position);
      player.group.rotation.y = city.activeVehicle.group.rotation.y;
      if (!dragging && Math.abs(city.activeVehicle.speed) > 1) {
        const heading = player.group.rotation.y + Math.PI;
        yaw += Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw)) * (1 - Math.exp(-dt * 3));
      }
      return;
    }
    if (jumpPreparation > 0) {
      jumpPreparation = Math.max(0, jumpPreparation - dt);
      if (jumpPreparation === 0) {
        verticalVelocity = 8;
        grounded = false;
      }
    }
    const forward = Number(keys.has("ArrowUp") || keys.has("KeyW")) - Number(keys.has("ArrowDown") || keys.has("KeyS"));
    const right = Number(keys.has("ArrowRight") || keys.has("KeyD")) - Number(keys.has("ArrowLeft") || keys.has("KeyA"));
    moveDirection.set(right * Math.cos(yaw) - forward * Math.sin(yaw), 0, -forward * Math.cos(yaw) - right * Math.sin(yaw));
    if (moveDirection.lengthSq() > 0) moveDirection.normalize();
    const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 10 : 5.5;
    velocity.lerp(moveDirection.multiplyScalar(speed), 1 - Math.exp(-dt * 12));
    const pos = player.group.position;
    const oldX = pos.x;
    const oldZ = pos.z;
    const ground = terrain();
    const canStep = (x: number, z: number) => !(inCity && !indoors() && police.checkContact({
      position: new THREE.Vector3(x, pos.y, z), vehicle: null, available: true,
    })) && !ground.blocked(x, z, PLAYER_RADIUS)
      && (indoors() || (inCity ? !city.vehicleBlocked(x, z, PLAYER_RADIUS) && !city.pedestrianBlocked(x, z, PLAYER_RADIUS)
        : !werewolves.blocked(x, z)))
      && ground.heightAt(x, z) - ground.heightAt(pos.x, pos.z) < 0.7;
    // Resolve axes separately so the player slides along obstacles instead of sticking.
    const newX = pos.x + velocity.x * dt;
    if (canStep(newX, pos.z)) pos.x = newX;
    const newZ = pos.z + velocity.z * dt;
    if (canStep(pos.x, newZ)) pos.z = newZ;
    const floor = ground.heightAt(pos.x, pos.z);
    if (!grounded) {
      verticalVelocity -= 22 * dt;
      pos.y += verticalVelocity * dt;
      if (pos.y <= floor) {
        pos.y = floor;
        verticalVelocity = 0;
        grounded = true;
        player.land();
      }
    } else pos.y = floor;
    const actualSpeed = Math.hypot(pos.x - oldX, pos.z - oldZ) / Math.max(dt, 0.001);
    if (velocity.lengthSq() > 0.05) {
      const angle = Math.atan2(velocity.x, velocity.z);
      const delta = Math.atan2(Math.sin(angle - player.group.rotation.y), Math.cos(angle - player.group.rotation.y));
      player.group.rotation.y += delta * (1 - Math.exp(-dt * 14));
    }
    player.update(dt, actualSpeed, elapsed, !grounded, verticalVelocity);
    if (!indoors()) updateRegion(globalPosition().z >= FOREST_JOIN);
  }

  function updateDiscovery(): void {
    element("police-hud").hidden = !jailed && !police.wanted;
    const policeTitle = jailed ? `Fängelse · ${Math.ceil(jailRemaining)} s kvar` : `Efterlyst · ${police.reason}`;
    const policeDetail = jailed ? "Frigivning efter en minut · Paneler pausar tiden."
      : police.escapeRemaining < ESCAPE_SECONDS ? `Polisen tappar dig om ${Math.ceil(police.escapeRemaining)} s. Håll avstånd!`
      : `Polisen jagar dig · Minsta kontakt med en polisbil leder till fängelse. Håll avstånd i ${ESCAPE_SECONDS} s.`;
    if (element("police-title").textContent !== policeTitle) element("police-title").textContent = policeTitle;
    if (element("police-detail").textContent !== policeDetail) element("police-detail").textContent = policeDetail;
    element("flight-hud").hidden = !aviation.active || aviation.crashRemaining > 0;
    element("vehicle-hud").hidden = !city.activeVehicle;
    element("travel").hidden = indoors() || aviation.active;
    element("bottom-controls").hidden = jailed || city.activeVehicle !== null || aviation.active;
    if (jailed) {
      nearNpc = undefined;
      nearHouse = undefined;
      element("location").textContent = "Norrhamns häkte";
      element("location-detail").textContent = "Du blir automatiskt frigiven när tiden är slut.";
      element("interaction").hidden = true;
      return;
    }
    if (aviation.active) {
      nearNpc = undefined;
      nearHouse = undefined;
      element("location").textContent = "Grönved Air";
      element("location-detail").textContent = aviation.cockpit ? "Cockpit · V för följkamera" : "Följkamera · V för cockpit";
      element("flight-speed").textContent = `${Math.round(aviation.speed * 3.6)} km/h`;
      element("flight-altitude").textContent = `${Math.max(0, Math.round(aviation.plane.position.y - globalHeight(aviation.plane.position.x, aviation.plane.position.z)))} m över mark · ${aviation.grounded ? "På marken" : "I luften"}`;
      element("interaction").hidden = overlay !== null || !aviation.grounded || aviation.speed > 0.5;
      element("interaction-text").textContent = "Kliv ur planet";
      return;
    }
    const position = globalPosition();
    if (!indoors() && !city.activeVehicle && (inAirport(position.x, position.z) || aviation.nearPlane(position))) {
      nearNpc = undefined;
      nearHouse = undefined;
      element("location").textContent = "Norrhamns flygplats";
      element("location-detail").textContent = "Grönved Air · Gå till planet på startbanan";
      element("interaction").hidden = overlay !== null || !aviation.nearPlane(position);
      element("interaction-text").textContent = "Kliv ombord · Flyg över Grönved och Norrhamn";
      return;
    }
    if (currentVenue) {
      nearNpc = undefined;
      nearHouse = undefined;
      element("location").textContent = currentVenue.name;
      element("location-detail").textContent = currentVenue.kind === "cafe" ? "Inomhus · Café och kaffebar"
        : currentVenue.kind === "restaurant" ? "Inomhus · Restaurang och kök" : "Inomhus · Butik";
      const exit = venueInterior.nearExit(player.group.position);
      const resident = venueInterior.nearResident(player.group.position);
      element("interaction").hidden = overlay !== null || (!exit && !resident);
      element("interaction-text").textContent = exit ? "Gå ut till gatan" : resident ? `Prata med ${resident.name} · ${resident.role}` : "";
      return;
    }
    if (inCity) {
      nearNpc = undefined;
      nearHouse = undefined;
      const vehicle = city.activeVehicle ?? city.nearVehicle(player.group.position);
      const officer = city.nearOfficer(player.group.position);
      const citizen = city.nearCitizen(player.group.position);
      const venue = !city.activeVehicle ? city.nearVenue(player.group.position) : undefined;
      element("location").textContent = "Norrhamn City";
      element("location-detail").textContent = city.districtAt(player.group.position.x, player.group.position.z);
      element("interaction").hidden = overlay !== null || (!venue && !vehicle && !officer && !citizen);
      element("interaction-text").textContent = city.activeVehicle ? "Stanna och kliv ur fordonet"
        : venue ? `Gå in i ${venue.name}` : vehicle ? `Kör ${city.vehicleName(vehicle).toLocaleLowerCase("sv")}`
        : officer ? `Prata med polis ${officer.name}` : citizen ? `Prata med ${citizen.name}` : "";
      if (city.activeVehicle) {
        element("vehicle-name").textContent = city.vehicleName(city.activeVehicle);
        element("vehicle-speed").innerHTML = `${Math.round(Math.abs(city.activeVehicle.speed) * 3.6)} <small>km/h${city.activeVehicle.speed < -0.1 ? " · R" : ""}</small>`;
      }
      return;
    }
    if (currentHouse) {
      element("location").textContent = currentHouse.name;
      element("location-detail").textContent = "Inomhus · Ett tryggt gömställe";
      nearNpc = undefined;
      nearHouse = undefined;
      const interaction = interiorInteraction();
      element("interaction").hidden = overlay !== null || interaction === null;
      element("interaction-text").textContent = interaction === "sleep" ? "Sov till nästa morgon · Full hälsa" : "Gå ut ur huset";
      return;
    }
    const pos = player.group.position;
    const landmark = LANDMARKS.find((place) => Math.hypot(pos.x - place.x, pos.z - place.z) < place.radius);
    const besideLake = ((pos.x - LAKE.x) / (LAKE.rx + 14)) ** 2 + ((pos.z - LAKE.z) / (LAKE.rz + 14)) ** 2 < 1;
    const onCityTrail = Math.abs(pos.x) < 12 && pos.z > 60;
    const id = landmark?.id ?? (besideLake ? "lake" : onCityTrail ? "city-trail" : "forest");
    if (id !== locationId) {
      locationId = id;
      element("location").textContent = landmark?.name ?? (besideLake ? "Spegelvattnet" : "Grönvedsskogen");
      element("location-detail").textContent = landmark?.subtitle.toLocaleLowerCase("sv-SE") ?? (besideLake ? "Där himlen möter skogen." : onCityTrail ? "Stigen till Norrhamn City · Fortsätt söderut" : "Mellan träden finns nya vägar.");
    }
    if (landmark && !visited.has(landmark.id)) {
      visited.add(landmark.id);
      element("visited-count").textContent = `${visited.size} / ${LANDMARKS.length}`;
      element("quest-progress").children[LANDMARKS.indexOf(landmark)].classList.add("done");
      element("discovery-name").textContent = landmark.name;
      element("discovery-description").textContent = landmark.description;
      element("discovery").classList.add("visible");
      window.clearTimeout(discoveryTimer);
      discoveryTimer = window.setTimeout(() => element("discovery").classList.remove("visible"), 5200);
      if (visited.size === LANDMARKS.length) {
        element("quest-title").textContent = "Nu känner du Grönved";
        element("quest-text").textContent = "Alla byar upptäckta. Äventyret fortsätter.";
      }
    }
    nearNpc = npcs.find((npc) => npc.character.group.position.distanceTo(pos) < 3.8);
    nearHouse = world.nearHouse(pos.x, pos.z);
    element("interaction").hidden = (!nearNpc && !nearHouse) || overlay !== null;
    if (nearHouse) element("interaction-text").textContent = `Gå in i ${nearHouse.name}`;
    else if (nearNpc) element("interaction-text").textContent = `Prata med ${nearNpc.name}`;
  }

  function updateCamera(dt: number): void {
    if (aviation.active) {
      aviation.updateCamera(camera, overlay ? 0 : dt);
      if (!aviation.cockpit) {
        cameraOffset.copy(camera.position).sub(aviation.plane.position);
        const followDistance = cameraOffset.length();
        cameraOffset.normalize();
        for (let d = 1.5; d < followDistance; d += 0.5) {
          desiredCamera.copy(aviation.plane.position).addScaledVector(cameraOffset, d);
          if (desiredCamera.y < globalHeight(desiredCamera.x, desiredCamera.z) + 0.5
            || globalFlightBlocked(desiredCamera.x, desiredCamera.y, desiredCamera.z, 0.3)) {
            camera.position.copy(aviation.plane.position).addScaledVector(cameraOffset, Math.max(1, d - 0.5));
            camera.lookAt(aviation.plane.position);
            break;
          }
        }
      }
      return;
    }
    camera.up.set(0, 1, 0);
    if (!started) {
      camera.position.set(18 + Math.sin(elapsed * 0.035) * 3, world.heightAt(18, 40) + 10.5, 40);
      camera.lookAt(-1, world.heightAt(0, 0) + 3, -3);
      return;
    }
    target.copy(player.group.position);
    target.y += city.activeVehicle ? 2 : 1.4;
    if (indoors()) {
      const roomPitch = Math.max(0.85, pitch);
      cameraOffset.set(Math.sin(yaw) * Math.cos(roomPitch), Math.sin(roomPitch), Math.cos(yaw) * Math.cos(roomPitch));
      desiredCamera.copy(target).addScaledVector(cameraOffset, THREE.MathUtils.clamp(distance, 8, 16));
      camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * 9));
      camera.lookAt(target);
      return;
    }
    cameraOffset.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const followDistance = city.activeVehicle ? Math.max(12, distance + 5) : distance;
    let safeDistance = followDistance;
    for (let d = 1.5; d <= followDistance; d += 0.45) {
      desiredCamera.copy(target).addScaledVector(cameraOffset, d);
      const ground = terrain().heightAt(desiredCamera.x, desiredCamera.z);
      const p = inCity ? cityToWorld(desiredCamera) : desiredCamera;
      const local = worldToCity(p);
      if (desiredCamera.y < ground + 0.6 || city.cameraBlocked(local.x, local.y, local.z)
        || aviation.flightBlocked(p.x, p.y, p.z, 0.2)
        || (p.z < FOREST_JOIN && desiredCamera.y < ground + 5 && world.blocked(p.x, p.z, 0.15))) {
        safeDistance = Math.max(1.2, d - 0.5);
        break;
      }
    }
    desiredCamera.copy(target).addScaledVector(cameraOffset, safeDistance);
    desiredCamera.y = Math.max(desiredCamera.y, terrain().heightAt(desiredCamera.x, desiredCamera.z) + 0.7);
    if (inCity) {
      desiredCamera.copy(cityToWorld(desiredCamera));
      target.copy(cityToWorld(target));
    }
    cinematicTransition = Math.max(0, cinematicTransition - dt * 0.55);
    camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * (cinematicTransition > 0 ? 2.2 : 9)));
    camera.position.y = Math.max(camera.position.y, globalHeight(camera.position.x, camera.position.z) + 0.5);
    camera.lookAt(target);
  }

  function frame(time: number): void {
    const dt = Math.min((time - lastTime) / 1000, 0.04);
    lastTime = time;
    if (!document.hidden) {
      elapsed += dt;
      if (started && !overlay) {
        crashEffects.update(dt);
        if (sleep) {
          updateSleep(dt);
          updateSurvival(0);
        } else {
          updatePlayer(dt);
          updateSurvival(dt);
          city.update(dt, survival.daylight, worldToCity(globalPosition()));
          updatePolice(dt);
          if (currentVenue) venueInterior.update(dt, player.group.position);
        }
      }
      else {
        velocity.set(0, 0, 0);
        if (!started) player.update(dt, 0, elapsed);
      }
      world.update(elapsed, dt);
      audio.update(elapsed, survival.night, inCity, aviation.active ? aviation.speed : city.activeVehicle?.speed,
        started && !overlay && !currentVenue && !jailed, aviation.active, police.wanted && !indoors());
      for (let i = 0; i < npcs.length; i++) {
        const npc = npcs[i];
        npc.character.update(dt, 0, elapsed + i * 3);
        if (nearNpc === npc) {
          npcDirection.copy(player.group.position).sub(npc.character.group.position);
          npc.character.group.rotation.y = Math.atan2(npcDirection.x, npcDirection.z);
        }
      }
      updateCamera(dt);
      shadowCenter.copy(globalPosition());
      shadowCenter.x = Math.round(shadowCenter.x / shadowStep) * shadowStep;
      shadowCenter.z = Math.round(shadowCenter.z / shadowStep) * shadowStep;
      sun.position.copy(shadowCenter).add(sunOffset);
      sun.target.position.copy(shadowCenter);
      sky.position.copy(camera.position);
      if (started) {
        updateDiscovery();
        if (elapsed - lastMapUpdate > 0.12) {
          lastMapUpdate = elapsed;
          drawMap(miniContext!, false);
          const directions = ["N", "NV", "V", "SV", "S", "SÖ", "Ö", "NÖ"];
          const index = ((Math.round((yaw + (inCity ? CITY_ROTATION : 0)) / (Math.PI / 4)) % 8) + 8) % 8;
          element("compass-line").innerHTML = `<span>${directions[(index + 1) % 8]}</span><i></i><i></i><b>${directions[index]}</b><i></i><i></i><span>${directions[(index + 7) % 8]}</span>`;
        }
      }
      renderer.render(jailed ? jail.scene : currentVenue ? venueInterior.scene : currentHouse ? interior.scene : outsideScene(), camera);
    }
    requestAnimationFrame(frame);
  }
  updateCamera(0);
  city.update(0, survival.daylight, worldToCity(globalPosition()));
  renderer.render(scene, camera);
  element<HTMLButtonElement>("start").disabled = false;
  element("start").innerHTML = `<span>Börja din vandring</span>${icon("arrow")}`;
  element("loading").hidden = true;
  requestAnimationFrame(frame);
}

void init().catch((error: unknown) => {
  console.error("Kunde inte skapa Grönved:", error);
  element("loading").hidden = false;
  element("loading").textContent = "Världen eller dess spelresurser kunde inte laddas. Ladda om sidan och kontrollera att spelservern körs och WebGL 2 är aktiverat. Mer information finns i konsolen.";
  element("start").innerHTML = "<span>Kunde inte starta världen</span>";
});
