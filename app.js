"use strict";
// =====================================================================
//  PvZ — seleção de personagem + jogo em terceira pessoa (three.js)
//  Dica: abra o jogo com  ?lite  no endereço para o modo leve
//  (sem pós-processamento, menos grama e sombras menores).
// =====================================================================

const $ = (id) => document.getElementById(id);
const LITE = /[?&]lite\b/.test(location.search);

// ---------------------------------------------------------------------
// Dados dos personagens
// ---------------------------------------------------------------------
const characters = [
  {
    id: "peashooter",
    name: "Peashooter",
    role: "Soldado",
    rarity: "Super Rara",
    level: [6, 7],
    model: "models/Pea/peashooter.glb",
    idle: "Idle",          // nome da animação de descanso dentro do .glb
    // muzzleY: 0.72,      // (opcional) altura da boca, de 0 a 1 da altura do modelo, se o tiro sair do lugar errado
    icon: "🌱",
    weapon: "Ervilhas",
    desc: "Equilibrado e confiável. Atira ervilhas em rajada pela boca e funciona bem em qualquer situação.",
    stats: { Vida: 3, Dano: 3, Mobilidade: 4 },
  },
  {
    id: "sunflower",
    name: "Sunflower",
    role: "Curandeira",
    rarity: "Rara",
    level: [4, 5],
    model: "models/pvz_garden_warfare_2_-_sunflower_deluxe.glb",
    icon: "🌻",
    weapon: "Raio solar",
    desc: "Dispara raios solares finos e rápidos pela boca. Frágil sozinha, valiosa em grupo.",
    stats: { Vida: 2, Dano: 2, Mobilidade: 3 },
  },
  {
    id: "citron",
    name: "Citron",
    role: "Tanque",
    rarity: "Épica",
    level: [8, 9],
    model: "models/pvz_garden_warfare_2_-_citron.glb",
    icon: "🍋",
    weapon: "Laser",
    desc: "Resistente e perigoso: dispara um laser potente da sua arma. Segura a linha de frente.",
    stats: { Vida: 5, Dano: 4, Mobilidade: 2 },
  },
];

const MAX_STAT = 5;
const START_ORBIT = "25deg 80deg auto"; // ângulo inicial ao trocar de personagem

// ---------------------------------------------------------------------
// Tela de seleção
// ---------------------------------------------------------------------
const roster = $("roster");
const stage = $("stage-viewer");
const dName = $("d-name");
const dRole = $("d-role");
const dRarity = $("d-rarity");
const dLvlA = $("d-lvl-a");
const dLvlB = $("d-lvl-b");
const dDesc = $("d-desc");
const dStats = $("d-stats");
const playBtn = $("play");

if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) stage.removeAttribute("auto-rotate");

let selected = null;
let game = null;

characters.forEach((c) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "thumb";
  btn.dataset.id = c.id;
  btn.setAttribute("role", "radio");
  btn.setAttribute("aria-checked", "false");
  // personagens com animação "Idle" já aparecem animados na lista
  btn.innerHTML = `
    <model-viewer
      src="${c.model}"
      alt="${c.name}"
      camera-orbit="20deg 80deg auto"
      interaction-prompt="none"
      loading="eager"
      ${c.idle ? `animation-name="${c.idle}" autoplay` : ""}>
    </model-viewer>
    <span>${c.name}</span>
  `;
  btn.addEventListener("click", () => select(c.id));
  roster.appendChild(btn);
});

function select(id) {
  if (selected && selected.id === id) return;
  selected = characters.find((c) => c.id === id);

  document.querySelectorAll(".thumb").forEach((b) => b.setAttribute("aria-checked", b.dataset.id === id));

  // Troca o modelo do palco com um fade
  stage.classList.add("loading");
  if (selected.idle) {
    stage.setAttribute("animation-name", selected.idle);
    stage.setAttribute("autoplay", "");
  } else {
    stage.removeAttribute("animation-name");
    stage.removeAttribute("autoplay");
  }
  stage.src = selected.model;
  stage.cameraOrbit = START_ORBIT;
  stage.alt = `Modelo 3D de ${selected.name}`;

  dName.textContent = selected.name;
  dRole.textContent = selected.role;
  dRarity.textContent = selected.rarity;
  dLvlA.textContent = selected.level[0];
  dLvlB.textContent = selected.level[1];
  dDesc.textContent = selected.desc;
  dStats.innerHTML = Object.entries(selected.stats)
    .map(([label, value]) => `
      <li>${label}
        <div class="bar"><span style="width:${(value / MAX_STAT) * 100}%"></span></div>
      </li>`)
    .join("");
  playBtn.textContent = `Jogar com ${selected.name}`;
}

stage.addEventListener("load", () => stage.classList.remove("loading"));

playBtn.addEventListener("click", () => {
  if (!selected) return;
  localStorage.setItem("pvz:character", selected.id);
  startGame(selected);
});

// ↑/↓ trocam, Enter joga
window.addEventListener("keydown", (e) => {
  if (game) return;
  const i = characters.findIndex((c) => c.id === selected.id);
  if (e.code === "ArrowDown") select(characters[(i + 1) % characters.length].id);
  if (e.code === "ArrowUp") select(characters[(i - 1 + characters.length) % characters.length].id);
  if (e.code === "Enter") playBtn.click();
});

select(characters[0].id);

// =====================================================================
//  JOGO
// =====================================================================
const gameEl = $("game");
const screenEl = document.querySelector(".screen");
const gameCanvasWrap = $("game-canvas");
const gameLoading = $("game-loading");
const joyEl = $("joy");
const joyKnob = $("joy-knob");

// Se o modelo estiver olhando para o lado errado, mude aqui (ex.: Math.PI, Math.PI / 2)
const MODEL_YAW_OFFSET = 0;
const PLAYER_HEIGHT = 1.8;   // altura da planta no mundo (m)
const MOVE_SPEED = 6;        // m/s
const JUMP_SPEED = 8.6;      // impulso do pulo (m/s)  → altura ≈ 1,5 m
const GRAVITY = 24;          // m/s²
const JUMP_BUFFER = 0.12;    // aperta Espaço um pouco antes de pousar: pula assim que tocar o chão
const COYOTE_TIME = 0.08;    // ainda pode pular um instante depois de sair da borda
const CAM_DISTANCE = 3.2;    // câmera bem perto, como no PvZ GW2
const CAM_SHOULDER = 0.8;    // desloca a câmera para a direita
const MAP_HALF = 50;         // o mapa vai de -50 a 50
const MOUSE_SENS = 0.0025;
const SUN_ELEVATION = 38;    // graus
const SUN_AZIMUTH = 150;     // graus

$("game-back").addEventListener("click", () => stopGame());

// ---------------------------------------------------------------------
// Carregamento das bibliotecas (uma vez só)
// ---------------------------------------------------------------------
let libsPromise = null;
function loadLibs() {
  return (libsPromise ||= Promise.all([
    import("three"),
    import("three/addons/loaders/GLTFLoader.js"),
    import("three/addons/objects/Sky.js"),
    import("three/addons/postprocessing/EffectComposer.js"),
    import("three/addons/postprocessing/RenderPass.js"),
    import("three/addons/postprocessing/UnrealBloomPass.js"),
    import("three/addons/postprocessing/OutputPass.js"),
  ])
    .then(([THREE, gl, sky, ec, rp, ub, op]) => ({
      THREE,
      GLTFLoader: gl.GLTFLoader,
      Sky: sky.Sky,
      EffectComposer: ec.EffectComposer,
      RenderPass: rp.RenderPass,
      UnrealBloomPass: ub.UnrealBloomPass,
      OutputPass: op.OutputPass,
    }))
    .catch((e) => { libsPromise = null; throw e; }));
}

// ---------------------------------------------------------------------
// Utilidades: ruído, texturas procedurais
// ---------------------------------------------------------------------
function rng(seed) {                          // gerador pseudoaleatório repetível
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash3 = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w
  );
}
function fbm3(x, y, z, octaves = 4) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < octaves; i++) { s += a * vnoise3(x * f, y * f, z * f); f *= 2; a *= 0.5; }
  return s;
}

// ruído 2D que se repete (sem emenda) — base das texturas
function tileNoise(size, cx, cy, rand) {
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(size * size);
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cy, y0 = Math.floor(fy), ty = sm(fy - y0);
    const r0 = (y0 % cy) * cx, r1 = ((y0 + 1) % cy) * cx;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cx, x0 = Math.floor(fx), tx = sm(fx - x0);
      const xa = x0 % cx, xb = (x0 + 1) % cx;
      const a = lat[r0 + xa], b = lat[r0 + xb], c = lat[r1 + xa], d = lat[r1 + xb];
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

// gera textura de cor + mapa de relevo (bump) a partir de camadas de ruído
function makeTex(THREE, aniso, { size = 256, layers, colors, seed = 1, repeat = [1, 1], contrast = 1.8 }) {
  const rand = rng(seed);
  const h = new Float32Array(size * size);
  let wsum = 0;
  for (const [cx, cy, w] of layers) {
    const n = tileNoise(size, cx, cy, rand);
    for (let i = 0; i < h.length; i++) h[i] += n[i] * w;
    wsum += w;
  }
  const cols = colors.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
  const last = cols.length - 1;
  const canvasOf = () => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    return { c, ctx, img: ctx.createImageData(size, size) };
  };
  const cm = canvasOf(), cb = canvasOf();
  for (let i = 0; i < h.length; i++) {
    const v = Math.min(1, Math.max(0, (h[i] / wsum - 0.5) * contrast + 0.5));
    const t = v * last, k = Math.min(last - 1, Math.floor(t)), f = t - k;
    const a = cols[k], b = cols[k + 1], o = i * 4;
    cm.img.data[o] = a[0] + (b[0] - a[0]) * f;
    cm.img.data[o + 1] = a[1] + (b[1] - a[1]) * f;
    cm.img.data[o + 2] = a[2] + (b[2] - a[2]) * f;
    cm.img.data[o + 3] = 255;
    const g = v * 255;
    cb.img.data[o] = cb.img.data[o + 1] = cb.img.data[o + 2] = g;
    cb.img.data[o + 3] = 255;
  }
  cm.ctx.putImageData(cm.img, 0, 0);
  cb.ctx.putImageData(cb.img, 0, 0);
  const finish = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: finish(cm.c, true), bump: finish(cb.c, false) };
}

// esfera deformada por ruído (folhagem, pedras): cor por vértice + normais suaves
function makeBlob(THREE, { r, ws = 32, hs = 22, seed = 1, amp = 0.5, freq = 1.3, sy = 1, ridged = false, lo = 0x2a5e20, hi = 0x5fa83a }) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  const p = g.attributes.position, n = p.count;
  const colors = new Float32Array(n * 3);
  const cLo = new THREE.Color(lo), cHi = new THREE.Color(hi), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let d = fbm3(x * freq + seed, y * freq + seed * 1.7, z * freq + seed * 0.3, 4);
    if (ridged) d = 0.75 - Math.abs(d - 0.42) * 2.2;
    const k = 1 + (d - 0.45) * amp;
    p.setXYZ(i, x * k, y * k * sy, z * k);
    const t = Math.min(1, Math.max(0, 0.5 + (y / r) * 0.35 + (d - 0.45) * 1.2));
    c.copy(cLo).lerp(cHi, t);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

function disposeScene(scene) {
  const disposeMat = (m) => {
    for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
    m.dispose();
  };
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMat);
  });
}

// ---------------------------------------------------------------------
// Gráficos: renderizador, pós-processamento, céu, luz
// ---------------------------------------------------------------------
function createGraphics(L) {
  const { THREE } = L;
  const w = window.innerWidth, h = window.innerHeight;

  // pós-processamento precisa de render em ponto flutuante (HDR)
  const probe = document.createElement("canvas").getContext("webgl2");
  const hdr = !!probe && !!(probe.getExtension("EXT_color_buffer_float") || probe.getExtension("EXT_color_buffer_half_float"));
  probe?.getExtension("WEBGL_lose_context")?.loseContext();
  const post = hdr && !LITE;

  const renderer = new THREE.WebGLRenderer({ antialias: !post, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);

  let composer = null;
  if (post) {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });   // MSAA 4x
    composer = new L.EffectComposer(renderer, rt);
    composer.addPass(new L.RenderPass(scene, camera));
    composer.addPass(new L.UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.55, 0.92));       // brilho suave (laser, sol, tiros)
    composer.addPass(new L.OutputPass());                                                      // tone mapping + sRGB
  }

  const gfx = { renderer, scene, camera, composer, post, maxPR: Math.min(window.devicePixelRatio || 1, LITE ? 1 : 2), pr: 1 };
  gfx.resize = () => {
    const W = window.innerWidth, H = window.innerHeight;
    renderer.setSize(W, H);
    composer?.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  };
  gfx.setPixelRatio = (pr) => {
    gfx.pr = pr;
    renderer.setPixelRatio(pr);
    composer?.setPixelRatio(pr);
    gfx.resize();
  };
  gfx.render = (dt) => (composer ? composer.render(dt) : renderer.render(scene, camera));
  gfx.setPixelRatio(gfx.maxPR);
  gameCanvasWrap.appendChild(renderer.domElement);
  return gfx;
}

function createSky(L, gfx) {
  const { THREE, Sky } = L;
  const { renderer, scene } = gfx;
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1, THREE.MathUtils.degToRad(90 - SUN_ELEVATION), THREE.MathUtils.degToRad(SUN_AZIMUTH)
  );
  u.sunPosition.value.copy(sunDir);

  // o próprio céu vira a iluminação ambiente e os reflexos (PBR realista)
  const envScene = new THREE.Scene();
  envScene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene);
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.add(sky);
  scene.fog = new THREE.FogExp2(0xc6dbec, 0.006);

  // luz do sol com sombras suaves + um pouco de luz rebatida do chão
  const shadowSize = LITE ? 2048 : 4096;
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  const EXT = 22;
  sc.left = -EXT; sc.right = EXT; sc.top = EXT; sc.bottom = -EXT; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfe8ff, 0x5a7a40, 0.35));
  const texel = (EXT * 2) / shadowSize;

  // nuvens: sprites macios que derivam devagar
  const cc = document.createElement("canvas");
  cc.width = 256; cc.height = 128;
  const cx = cc.getContext("2d");
  const rand = rng(99);
  for (let i = 0; i < 46; i++) {
    const x = 40 + rand() * 176, y = 40 + rand() * 48, rad = 18 + rand() * 30;
    const grd = cx.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, "rgba(255,255,255,0.16)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    cx.fillStyle = grd;
    cx.fillRect(0, 0, 256, 128);
  }
  const cloudTex = new THREE.CanvasTexture(cc);
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  const clouds = [];
  for (let i = 0; i < 12; i++) {
    const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.85 });
    m.color.setScalar(1.5);
    const s = new THREE.Sprite(m);
    const a = rand() * Math.PI * 2, rr = 170 + rand() * 170;
    s.position.set(Math.cos(a) * rr, 70 + rand() * 50, Math.sin(a) * rr);
    s.scale.set(130 + rand() * 90, 55 + rand() * 30, 1);
    scene.add(s);
    clouds.push(s);
  }

  return {
    envRT,
    // segue o jogador; a posição é "encaixada" na grade do shadow map para a sombra não tremer
    follow(x, z) {
      const sx = Math.round(x / texel) * texel, sz = Math.round(z / texel) * texel;
      sun.target.position.set(sx, 0, sz);
      sun.position.set(sx, 0, sz).addScaledVector(sunDir, 80);
    },
    drift(t) {
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        c.position.x += 0.6 * (1 + (i % 3) * 0.3) * t;
        if (c.position.x > 340) c.position.x = -340;
      }
    },
  };
}

// ---------------------------------------------------------------------
// Mundo: chão, grama animada pelo vento, árvores, moitas, pedras, cerca
// ---------------------------------------------------------------------
function createWorld(L, gfx) {
  const { THREE } = L;
  const { scene, renderer } = gfx;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const colliders = [];                         // { x, z, r (corpo), hr (tiro), h (altura) }
  const tex = (o) => makeTex(THREE, aniso, o);
  const rand = rng(2024);
  const windU = { value: 0 };

  // ----- chão -----
  const gt = tex({
    size: 512, layers: [[4, 4, 0.35], [10, 10, 0.3], [32, 32, 0.2], [128, 128, 0.15]],
    colors: [0x2c5a22, 0x417f2d, 0x6aa63a, 0x8aa544], seed: 7, repeat: [MAP_HALF / 5, MAP_HALF / 5], contrast: 2.2,
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2),
    new THREE.MeshStandardMaterial({ map: gt.map, bumpMap: gt.bump, bumpScale: 2, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const outer = new THREE.Mesh(
    new THREE.CircleGeometry(420, 48),
    new THREE.MeshStandardMaterial({ color: 0x3f6d2c, roughness: 1 })
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.04;
  scene.add(outer);

  // ----- grama: milhares de folhas instanciadas, balançando com o vento -----
  {
    const BLADES = LITE ? 14000 : 36000;
    const w = 0.045;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
      -w, 0, 0,  w, 0, 0,  -w * 0.7, 0.5, 0,  w * 0.7, 0.5, 0,  0, 1, 0,
    ]), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array([
      0.35, 0.35, 0.35,  0.35, 0.35, 0.35,  0.7, 0.7, 0.7,  0.7, 0.7, 0.7,  1, 1, 1,
    ]), 3));
    // frente + verso (normais iguais para cima: iluminação uniforme, sem lado escuro)
    geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 0, 2, 1, 1, 2, 3, 2, 4, 3]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = windU;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec2 ip = instanceMatrix[3].xz;
            float sway = sin(uTime * 1.7 + ip.x * 0.31 + ip.y * 0.23) * 0.6 + sin(uTime * 3.1 + ip.x * 0.83 - ip.y * 0.47) * 0.25;
            float bend = position.y * position.y;
            transformed.x += sway * bend * 0.45;
            transformed.z += cos(uTime * 1.3 + ip.y * 0.29) * bend * 0.12;
          #endif`);
    };
    const grass = new THREE.InstancedMesh(geo, mat, BLADES);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const side = Math.ceil(Math.sqrt(BLADES)), cell = (MAP_HALF * 2) / side;
    for (let i = 0; i < BLADES; i++) {           // grade com variação: distribui sem formar falhas
      const gx = i % side, gz = Math.floor(i / side);
      pos.set(-MAP_HALF + (gx + rand()) * cell, 0, -MAP_HALF + (gz + rand()) * cell);
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      const hgt = 0.25 + rand() * 0.35;
      scl.set(0.7 + rand() * 0.8, hgt, 1);
      grass.setMatrixAt(i, m4.compose(pos, q, scl));
      grass.setColorAt(i, col.setHSL(0.22 + rand() * 0.06, 0.5 + rand() * 0.2, 0.28 + rand() * 0.14));
    }
    grass.receiveShadow = true;
    grass.frustumCulled = false;
    scene.add(grass);
  }

  // ----- flores espalhadas -----
  {
    const N = LITE ? 150 : 500;
    const palette = [0xffffff, 0xffe45c, 0xff7ab0, 0xb48cff];
    const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 1), new THREE.MeshStandardMaterial({ roughness: 0.6 }), N);
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      flowers.setMatrixAt(i, m4.makeTranslation((rand() * 2 - 1) * (MAP_HALF - 2), 0.3 + rand() * 0.12, (rand() * 2 - 1) * (MAP_HALF - 2)));
      flowers.setColorAt(i, c.set(palette[Math.floor(rand() * palette.length)]));
    }
    flowers.frustumCulled = false;
    scene.add(flowers);
  }

  // ----- materiais dos objetos -----
  const bark = tex({ layers: [[2, 24, 0.5], [4, 64, 0.3], [8, 128, 0.2]], colors: [0x3a2a1c, 0x5a4330, 0x7a6249], seed: 3, repeat: [2, 2] });
  const leaf = tex({ layers: [[16, 16, 0.4], [48, 48, 0.4], [128, 128, 0.2]], colors: [0xa9c79a, 0xc4dfb0, 0xdaf0c8], seed: 5, repeat: [6, 4] });
  const stone = tex({ layers: [[6, 6, 0.4], [16, 16, 0.3], [48, 48, 0.3]], colors: [0x6c6c68, 0x8f8e88, 0xb0aea6], seed: 9, repeat: [2, 2] });
  const wood = tex({ layers: [[2, 32, 0.5], [4, 96, 0.5]], colors: [0x6e4a2a, 0x8a6038, 0x9d7447], seed: 4, repeat: [1, 1] });
  const barkMat = new THREE.MeshStandardMaterial({ map: bark.map, bumpMap: bark.bump, bumpScale: 3, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: leaf.map, bumpMap: leaf.bump, bumpScale: 1.5, roughness: 0.8 });
  const rockMat = new THREE.MeshStandardMaterial({ map: stone.map, bumpMap: stone.bump, bumpScale: 3, roughness: 0.92 });
  const woodMat = new THREE.MeshStandardMaterial({ map: wood.map, bumpMap: wood.bump, bumpScale: 1.5, roughness: 0.9 });

  // ----- árvores -----
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.5, 3.4, 14, 4);
  const CROWN = [[0, 4.9, 0, 1.9], [1.2, 4.3, 0.3, 1.4], [-1.1, 4.4, -0.4, 1.5], [0.2, 5.9, 0.1, 1.3], [0.4, 4.1, -1.3, 1.3], [-0.5, 4.2, 1.2, 1.3]];
  const crownGeos = CROWN.map(([, , , r], i) => makeBlob(THREE, { r, seed: 3 + i * 5.3, amp: 0.55, freq: 1.3, ws: 36, hs: 26 }));
  function addTree(x, z) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, barkMat);
    trunk.position.y = 1.7;
    trunk.castShadow = trunk.receiveShadow = true;
    g.add(trunk);
    CROWN.forEach(([cx, cy, cz], i) => {
      const m = new THREE.Mesh(crownGeos[i], leafMat);
      m.position.set(cx, cy, cz);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    });
    g.position.set(x, 0, z);
    g.rotation.y = rand() * Math.PI * 2;
    g.scale.setScalar(0.92 + rand() * 0.22);
    scene.add(g);
    colliders.push({ x, z, r: 0.7, hr: 2.0, h: 6.2 });
  }

  // ----- moitas -----
  const BUSH = [[0, 0.55, 0, 0.85], [0.7, 0.45, 0.2, 0.6], [-0.65, 0.45, -0.1, 0.62], [0.1, 0.5, 0.7, 0.58], [-0.1, 0.45, -0.7, 0.55]];
  const bushGeos = BUSH.map(([, , , r], i) => makeBlob(THREE, { r, seed: 20 + i * 3.1, amp: 0.5, freq: 2, ws: 24, hs: 16, lo: 0x2d6b25, hi: 0x62b03e }));
  function addBush(x, z) {
    const g = new THREE.Group();
    BUSH.forEach(([bx, by, bz], i) => {
      const m = new THREE.Mesh(bushGeos[i], leafMat);
      m.position.set(bx, by, bz);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    });
    g.position.set(x, 0, z);
    g.rotation.y = rand() * Math.PI * 2;
    scene.add(g);
    colliders.push({ x, z, r: 1.0, hr: 1.1, h: 1.5 });
  }

  // ----- pedras -----
  const rockGeo = makeBlob(THREE, { r: 1.2, seed: 11, amp: 0.9, freq: 1.8, sy: 0.78, ridged: true, ws: 30, hs: 22 });
  function addRock(x, z) {
    const m = new THREE.Mesh(rockGeo, rockMat);
    const s = 0.9 + rand() * 0.3;
    m.position.set(x, 0.5, z);
    m.rotation.y = rand() * Math.PI * 2;
    m.scale.set(s, s, s);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    colliders.push({ x, z, r: 1.1, hr: 1.2, h: 1.7 });
  }

  [[-12, -10], [15, -18], [-25, 12], [22, 20], [-8, 30], [35, -5], [-35, -25], [5, -35]].forEach(([x, z]) => addTree(x, z));
  [[6, -6], [-5, 8], [12, 10], [-18, -4], [25, -25], [-30, 30], [0, 22], [-14, 22]].forEach(([x, z]) => addBush(x, z));
  [[-4, -14], [18, 2], [-22, -18], [30, 12]].forEach(([x, z]) => addRock(x, z));

  // ----- cerca: postes + duas travessas em cada lado -----
  {
    const STEP = 2.5, L2 = MAP_HALF * 2 + 0.5;
    const perSide = Math.floor((MAP_HALF * 2) / STEP) + 1;
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 1.35, 0.22), woodMat, perSide * 4);
    const m4 = new THREE.Matrix4();
    let n = 0;
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([sx, sz]) => {
      for (let i = 0; i < perSide; i++) {
        const t = -MAP_HALF + i * STEP;
        posts.setMatrixAt(n++, m4.makeTranslation(sx ? sx * MAP_HALF : t, 0.675, sz ? sz * MAP_HALF : t));
      }
      for (const y of [0.55, 1.0]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(L2, 0.12, 0.08), woodMat);
        rail.position.set(sx * MAP_HALF, y, sz * MAP_HALF);
        if (sx) rail.rotation.y = Math.PI / 2;
        rail.castShadow = rail.receiveShadow = true;
        scene.add(rail);
      }
    });
    posts.castShadow = posts.receiveShadow = true;
    scene.add(posts);
  }

  return { colliders, update: (t) => { windU.value = t; } };
}

// ---------------------------------------------------------------------
// Jogador: carrega o .glb, ajusta tamanho/materiais e prepara a animação "Idle"
// ---------------------------------------------------------------------
async function loadPlayer(L, gfx, character) {
  const { THREE } = L;
  const gltf = await new L.GLTFLoader().loadAsync(character.model);
  const model = gltf.scene;

  // remove luzes/câmeras que o Blender possa ter exportado junto (bagunçam a iluminação)
  const extras = [];
  model.traverse((o) => { if (o.isLight || o.isCamera) extras.push(o); });
  extras.forEach((o) => o.parent && o.parent.remove(o));

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const targetH = character.modelHeight || PLAYER_HEIGHT;
  const k = targetH / size.y;
  console.log(`[${character.id}] GLB ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} → escala ${k.toFixed(3)} (altura final ${targetH} m)`);

  const aniso = gfx.renderer.capabilities.getMaxAnisotropy();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    o.frustumCulled = false;                       // malhas com esqueleto não somem ao animar
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"]) {
        if (m[key]) m[key].anisotropy = aniso;     // texturas nítidas em ângulo
      }
    });
  });

  model.scale.setScalar(k);
  model.position.set(-center.x * k, -box.min.y * k, -center.z * k);
  const pivot = new THREE.Group();
  pivot.add(model);
  pivot.rotation.y = MODEL_YAW_OFFSET;
  const player = new THREE.Group();
  player.add(pivot);

  // animações
  const clips = gltf.animations || [];
  console.log(`[${character.id}] animações no GLB:`, clips.length ? clips.map((c) => `"${c.name}" (${c.duration.toFixed(2)}s)`).join(", ") : "nenhuma");
  const mixer = clips.length ? new THREE.AnimationMixer(model) : null;
  let idleAction = null, overheatAction = null;
  if (mixer && character.idle) {
    const clip = THREE.AnimationClip.findByName(clips, character.idle) || clips.find((c) => /idle/i.test(c.name));
    if (clip) {
      idleAction = mixer.clipAction(clip);
      idleAction.setLoop(THREE.LoopRepeat, Infinity);
      idleAction.play();
    } else {
      console.warn(`[${character.id}] animação "${character.idle}" não encontrada no GLB.`);
    }
  }
  const heat = mixer && THREE.AnimationClip.findByName(clips, "Superaquecer");   // arma do Citron
  if (heat) {
    overheatAction = mixer.clipAction(heat);
    overheatAction.setLoop(THREE.LoopOnce, 1);
    overheatAction.clampWhenFinished = true;       // segura a última pose até a arma esfriar
  }
  return { player, model, mixer, idleAction, overheatAction };
}

// Descobre onde ficam a boca/arma (em coordenadas da planta).
function findMuzzle(THREE, root, character) {
  const id = character.id;
  root.updateMatrixWorld(true);
  const whole = new THREE.Box3().setFromObject(root);
  const wc = whole.getCenter(new THREE.Vector3());
  const H = whole.max.y - whole.min.y;
  const boxOf = (...keys) => {
    const b = new THREE.Box3();
    let any = false;
    root.traverse((o) => {
      if (o.isMesh && keys.some((k) => o.name.toLowerCase().includes(k))) { b.expandByObject(o); any = true; }
    });
    return any ? b : null;
  };
  const dirTo = (b) => {
    const c = b.getCenter(new THREE.Vector3());
    const v = new THREE.Vector3(c.x - wc.x, 0, c.z - wc.z);
    return v.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, 1) : v.normalize();
  };
  // ponto da caixa mais avançado na direção F (mantém a altura do centro)
  const tip = (b, F) => {
    const c = b.getCenter(new THREE.Vector3());
    let best = -Infinity;
    for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) best = Math.max(best, x * F.x + z * F.z);
    return c.addScaledVector(F, best - (c.x * F.x + c.z * F.z));
  };

  let p = null;
  if (id === "peashooter") {
    // 1) um nó vazio chamado "Muzzle"/"Boca" no Blender tem prioridade
    let node = null;
    root.traverse((o) => { if (!node && !o.isMesh && !o.isBone && /^(muzzle|mouth|boca|cano|barrel)/i.test(o.name)) node = o; });
    if (node) {
      p = root.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
    } else {
      // 2) malha da boca/cano; 3) plano B: frente do modelo, na altura configurada
      const b = boxOf("headprop", "muzzle", "mouth", "boca", "barrel", "cano");
      if (b) { const F = dirTo(b); p = tip(b, F).addScaledVector(F, 0.08); }
      else p = new THREE.Vector3(wc.x, whole.min.y + H * (character.muzzleY ?? 0.72), whole.max.z + 0.05);
    }
  } else if (id === "citron") {          // ponta da arma
    const gl = boxOf("glasses"), w = boxOf("weapon");
    if (gl && w) { const F = dirTo(gl); p = tip(w, F).addScaledVector(F, 0.05); }
  } else if (id === "sunflower") {       // boca: logo abaixo dos olhos
    const e = boxOf("eye");
    if (e) {
      const F = dirTo(e);
      p = tip(e, F).addScaledVector(F, 0.03);
      p.y = e.getCenter(new THREE.Vector3()).y - 0.11 * H;
    }
  }
  return p || new THREE.Vector3(0, H * 0.7, whole.max.z);
}

// Prende a boca a um osso da cabeça: assim os tiros acompanham a animação "Idle".
function attachMuzzleToBone(THREE, player, model, point) {
  let bone = null;
  model.traverse((o) => { if (!bone && o.isBone && /head|cabe[cç]a|mouth|boca|jaw/i.test(o.name)) bone = o; });
  if (!bone) return null;
  player.updateMatrixWorld(true);
  const node = new THREE.Object3D();
  node.position.copy(bone.worldToLocal(player.localToWorld(point.clone())));
  bone.add(node);
  return node;
}

// =====================================================================
//  startGame
// =====================================================================
async function startGame(character) {
  if (game) return;
  const g = (game = { stopped: false });
  screenEl.style.display = "none";
  gameEl.classList.add("active");
  gameEl.classList.toggle("laser", character.id === "citron");
  gameLoading.textContent = `Carregando ${character.name}...`;
  gameLoading.style.display = "block";

  let L;
  try {
    L = await loadLibs();
  } catch (e) {
    gameLoading.textContent = "Não foi possível carregar o three.js (verifique a internet).";
    console.error(e);
    return;
  }
  if (g.stopped) return;
  const { THREE } = L;
  const V3 = THREE.Vector3;

  const ac = new AbortController();
  const sig = { signal: ac.signal };
  g.ac = ac;

  // ----- gráficos / mundo -----
  const gfx = createGraphics(L);
  const { scene, camera, renderer } = gfx;
  const sky = createSky(L, gfx);
  g.cleanup = () => {
    disposeScene(scene);
    sky.envRT.dispose();
    gfx.composer?.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
    renderer.domElement.remove();
  };
  const world = createWorld(L, gfx);
  const colliders = world.colliders;

  // ----- jogador -----
  let P;
  try {
    P = await loadPlayer(L, gfx, character);
  } catch (e) {
    if (g.stopped) return;
    gameLoading.textContent = "Erro ao carregar o modelo. Confira a pasta models e abra o jogo por um servidor local.";
    console.error(e);
    return;
  }
  if (g.stopped) return;
  const { player, model, mixer, overheatAction } = P;
  scene.add(player);
  gameLoading.style.display = "none";

  // ----- entrada -----
  const keys = {};
  let jumpQueued = false;
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) jumpQueued = true;
    }
    // Com o mouse travado o navegador já usa o Esc para soltá-lo; com ele solto, o Esc volta à seleção.
    if (e.code === "Escape" && !document.pointerLockElement) stopGame();
  }, sig);
  window.addEventListener("keyup", (e) => { keys[e.code] = false; }, sig);

  let mouseFire = false, touchFire = false;
  let camYaw = 0;      // 0 = câmera olhando para -Z (nas costas da planta)
  let camPitch = 0.15;
  const rotateCam = (dx, dy) => {
    camYaw -= dx * MOUSE_SENS;
    camPitch = Math.min(0.9, Math.max(-0.15, camPitch + dy * MOUSE_SENS));
  };

  const canvas = renderer.domElement;
  let camPointer = null;     // só toque (celular)
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") {
      if (!document.pointerLockElement) canvas.requestPointerLock?.();
      else if (e.button === 0) mouseFire = true;
      return;
    }
    if (camPointer !== null) return;
    camPointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
  }, sig);
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") {
      if (document.pointerLockElement === canvas) rotateCam(e.movementX, e.movementY);
      return;
    }
    if (e.pointerId === camPointer) rotateCam(e.movementX * 2, e.movementY * 1.6);
  }, sig);
  const endCam = (e) => {
    if (e.pointerType === "mouse" && e.button === 0) mouseFire = false;
    if (e.pointerId === camPointer) camPointer = null;
  };
  canvas.addEventListener("pointerup", endCam, sig);
  canvas.addEventListener("pointercancel", endCam, sig);
  document.addEventListener("pointerlockchange", () => { mouseFire = false; }, sig);
  window.addEventListener("blur", () => {
    for (const k in keys) keys[k] = false;
    mouseFire = touchFire = false;
  }, sig);

  const fireBtn = $("fire");
  fireBtn.addEventListener("pointerdown", (e) => { touchFire = true; fireBtn.setPointerCapture(e.pointerId); }, sig);
  fireBtn.addEventListener("pointerup", () => { touchFire = false; }, sig);
  fireBtn.addEventListener("pointercancel", () => { touchFire = false; }, sig);
  const jumpBtn = $("jump");
  jumpBtn?.addEventListener("pointerdown", (e) => { e.preventDefault(); jumpQueued = true; }, sig);

  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch (_) { /* basta clicar na tela */ }

  // joystick (celular)
  const joy = { x: 0, y: 0 };
  let joyPointer = null;
  const JOY_R = 50;
  function joyUpdate(e) {
    const r = joyEl.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx = (dx / len) * JOY_R; dy = (dy / len) * JOY_R; }
    joy.x = dx / JOY_R; joy.y = dy / JOY_R;
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  function joyEnd(e) {
    if (e.pointerId !== joyPointer) return;
    joyPointer = null; joy.x = joy.y = 0;
    joyKnob.style.transform = "translate(0,0)";
  }
  joyEl.addEventListener("pointerdown", (e) => { joyPointer = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyUpdate(e); }, sig);
  joyEl.addEventListener("pointermove", (e) => { if (e.pointerId === joyPointer) joyUpdate(e); }, sig);
  joyEl.addEventListener("pointerup", joyEnd, sig);
  joyEl.addEventListener("pointercancel", joyEnd, sig);

  window.addEventListener("resize", () => gfx.resize(), sig);

  // =====================================================================
  //  ATAQUES
  // =====================================================================
  const muzzleLocal = findMuzzle(THREE, player, character);
  const muzzleNode = character.idle ? attachMuzzleToBone(THREE, player, model, muzzleLocal) : null;
  const muzzleWorld = (out) => (muzzleNode ? muzzleNode.getWorldPosition(out) : player.localToWorld(out.copy(muzzleLocal)));
  const camDir = new V3(), _o = new V3(), _t = new V3(), _m = new V3(), _right = new V3();
  const projectiles = [], parts = [];

  // clarão de luz no cano a cada disparo
  const fireLight = new THREE.PointLight(0xffffff, 0, 10, 2);
  scene.add(fireLight);
  let fireLightHold = false;

  // Distância até o primeiro obstáculo (chão, cerca, árvore, moita, pedra)
  function castWorld(o, d, max) {
    let best = max;
    if (d.y < -1e-4) { const t = -o.y / d.y; if (t > 0 && t < best) best = t; }
    if (Math.abs(d.x) > 1e-4) { const t = ((d.x > 0 ? MAP_HALF : -MAP_HALF) - o.x) / d.x; if (t > 0 && t < best) best = t; }
    if (Math.abs(d.z) > 1e-4) { const t = ((d.z > 0 ? MAP_HALF : -MAP_HALF) - o.z) / d.z; if (t > 0 && t < best) best = t; }
    const a2 = d.x * d.x + d.z * d.z;
    if (a2 < 1e-6) return best;
    for (const c of colliders) {
      const ox = o.x - c.x, oz = o.z - c.z;
      const b = ox * d.x + oz * d.z, cc = ox * ox + oz * oz - c.hr * c.hr;
      const disc = b * b - a2 * cc;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / a2;
      if (t < 0 || t >= best) continue;
      const y = o.y + d.y * t;
      if (y >= 0 && y <= c.h) best = t;
    }
    return best;
  }

  // Direção do tiro: sai da boca/arma e vai até onde a mira (centro da tela) aponta
  function aim(origin, out) {
    camera.getWorldDirection(camDir);
    _o.copy(camera.position).addScaledVector(camDir, CAM_DISTANCE);
    const t = castWorld(_o, camDir, 120);
    _t.copy(_o).addScaledVector(camDir, t);
    out.copy(_t).sub(origin);
    if (out.lengthSq() < 0.01) out.copy(camDir); else out.normalize();
    if (out.dot(camDir) < 0.5) out.copy(camDir);
    return out;
  }

  // partículas e clarões (cores "HDR" → o bloom faz brilhar)
  const sparkGeo = new THREE.IcosahedronGeometry(0.07, 0);
  const flashGeo = new THREE.SphereGeometry(1, 12, 8);
  const mats = {};
  const basic = (hex, add) => (mats[hex + (add ? "a" : "")] ||= new THREE.MeshBasicMaterial(
    add ? { color: new THREE.Color(hex).multiplyScalar(2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }
        : { color: hex }
  ));
  function burst(pos, hex, n, speed, size, life) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(sparkGeo, basic(hex));
      m.position.copy(pos);
      const s = size * (0.6 + Math.random() * 0.8);
      m.scale.setScalar(s);
      const v = new V3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5)
        .normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      scene.add(m);
      parts.push({ m, v, g: 9, life, max: life, s });
    }
  }
  function flash(pos, hex, size, life = 0.09) {
    const m = new THREE.Mesh(flashGeo, basic(hex, true));
    m.position.copy(pos);
    m.scale.setScalar(size);
    scene.add(m);
    parts.push({ m, v: null, g: 0, life, max: life, s: size });
  }
  function pulseLight(pos, hex, intensity) {
    fireLight.position.copy(pos);
    fireLight.color.set(hex);
    fireLight.intensity = intensity;
  }

  // ervilha
  const peaGeo = new THREE.SphereGeometry(0.15, 16, 12);
  const peaMat = new THREE.MeshStandardMaterial({ color: 0x57c93a, emissive: 0x1d6a12, emissiveIntensity: 0.6, roughness: 0.35 });
  function shootPea() {
    const o = muzzleWorld(new V3()), d = aim(o, new V3());
    d.x += (Math.random() - 0.5) * 0.012; d.y += (Math.random() - 0.5) * 0.012; d.normalize();
    const m = new THREE.Mesh(peaGeo, peaMat);
    m.position.copy(o);
    m.castShadow = true;
    scene.add(m);
    projectiles.push({ m, d, speed: 42, life: 2, hex: 0x7bdc4a, n: 7, size: 1 });
    flash(o, 0xb6ff8a, 0.22);
    pulseLight(o, 0xb6ff8a, 14);
  }

  // raio solar: feixe fino e comprido, com núcleo claro e brilho dourado
  const rayCore = new THREE.CylinderGeometry(0.018, 0.018, 1.6, 6).rotateX(Math.PI / 2).translate(0, 0, -0.8);
  const rayGlow = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8).rotateX(Math.PI / 2).translate(0, 0, -0.8);
  const rayCoreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfffbd0).multiplyScalar(2) });
  function shootSun() {
    const o = muzzleWorld(new V3()), d = aim(o, new V3());
    d.x += (Math.random() - 0.5) * 0.008; d.y += (Math.random() - 0.5) * 0.008; d.normalize();
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(rayCore, rayCoreMat), new THREE.Mesh(rayGlow, basic(0xffb820, true)));
    grp.position.copy(o);
    grp.lookAt(o.clone().add(d));             // o eixo +Z do feixe aponta para o alvo
    scene.add(grp);
    projectiles.push({ m: grp, d, speed: 95, life: 1.3, hex: 0xffd23f, n: 6, size: 0.8 });
    flash(o, 0xffe27a, 0.28);
    pulseLight(o, 0xffd23f, 16);
  }

  // laser contínuo (Citron): um único feixe que acompanha a mira enquanto o botão está apertado
  const LASER_MAX = 4.9;     // s de disparo contínuo até superaquecer
  const LASER_LOCK = 2.5;    // s inutilizada até esfriar
  const LASER_SIDE = 0.35;   // deslocamento do disparo para a direita
  const heatEl = $("heat");
  const heatFill = heatEl && heatEl.firstElementChild;
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const beamCoreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1d6).multiplyScalar(2.5) });
  const laser = { g: null, core: null, glow: null, on: false, time: 0, lock: 0, fx: 0 };
  function laserOrigin(out) {
    muzzleWorld(out);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _right.y = 0;
    if (_right.lengthSq() > 1e-6) _right.normalize();
    return out.addScaledVector(_right, LASER_SIDE);
  }
  function laserOn() {
    if (laser.on) return;
    laser.g = new THREE.Group();
    laser.core = new THREE.Mesh(beamGeo, beamCoreMat);
    laser.glow = new THREE.Mesh(beamGeo, basic(0xff7a00, true));
    laser.g.add(laser.core, laser.glow);
    scene.add(laser.g);
    laser.on = true;
  }
  function laserOff() {
    if (!laser.on) return;
    scene.remove(laser.g);
    laser.g = null;
    laser.on = false;
  }
  const setHeat = (pct, hot) => {
    if (heatFill) heatFill.style.width = pct + "%";
    if (heatEl) heatEl.classList.toggle("hot", hot);
  };
  function updateLaser(dt, wantFire) {
    if (laser.lock > 0) {                         // superaquecida: não atira
      laser.lock -= dt;
      laserOff();
      if (laser.lock <= 0) {
        laser.lock = 0; laser.time = 0;
        overheatAction?.stop();                   // volta a arma à pose normal
      }
      setHeat((laser.lock / LASER_LOCK) * 100, laser.lock > 0);
      return;
    }
    if (!wantFire) {
      laserOff();
      laser.time = 0;
      setHeat(0, false);
      return;
    }
    laser.time += dt;
    if (laser.time >= LASER_MAX) {                // superaqueceu
      laser.lock = LASER_LOCK;
      laserOff();
      if (overheatAction) {                       // animação "Superaquecer"
        overheatAction.timeScale = overheatAction.getClip().duration / LASER_LOCK;
        overheatAction.reset().play();
      }
      const o = laserOrigin(new V3());
      burst(o, 0xff5a1f, 18, 6, 1.4, 0.6);
      flash(o, 0xff7a00, 0.6, 0.25);
      return;
    }
    laserOn();
    const o = laserOrigin(new V3()), d = aim(o, new V3());
    const dist = castWorld(o, d, 120);
    const end = o.clone().addScaledVector(d, dist);
    const pulse = 1 + Math.sin(performance.now() * 0.05) * 0.12;
    laser.core.scale.set(0.035, 0.035, dist);
    laser.glow.scale.set(0.12 * pulse, 0.12 * pulse, dist);
    laser.g.position.copy(o);
    laser.g.lookAt(end);
    pulseLight(o, 0xff8a2a, 14);
    fireLightHold = true;
    laser.fx -= dt;
    if (laser.fx <= 0) {                          // faíscas na boca e no ponto de impacto
      laser.fx = 0.06;
      flash(o, 0xffa940, 0.35, 0.08);
      if (dist < 119) {
        flash(end, 0xffb347, 0.5, 0.1);
        burst(end, 0xff8a1f, 4, 7, 1.3, 0.4);
      }
    }
    setHeat((laser.time / LASER_MAX) * 100, false);
  }

  const ATTACKS = {
    peashooter: { rate: 0.12, fire: shootPea },
    sunflower: { rate: 0.12, fire: shootSun },
  };
  const attack = ATTACKS[character.id];
  let cooldown = 0;

  // ----- Munição / recarga -----
  const MAG_SIZE = { peashooter: 50, sunflower: 40 }[character.id] || 0;
  const RELOAD_TIME = 1.6;
  const mag = { ammo: MAG_SIZE, reload: 0 };

  // ----- HUD -----
  const hud = {
    ico: $("hud-ico"), name: $("hud-name"), cname: $("hud-cname"), lvl: $("hud-lvl"),
    hpNum: $("hud-hp-num"), hpFill: $("hud-hp-fill"), ammo: $("hud-ammo"), ammoNum: $("hud-ammo-num"),
    ammoLabel: $("hud-ammo-label"), weapon: $("hud-weapon"),
  };
  const maxHp = 50 * (character.stats?.Vida || 3);   // Peashooter 150, Sunflower 100, Citron 250
  let hp = maxHp;
  hud.ico.textContent = character.icon || "🌿";
  hud.name.textContent = document.querySelector(".playerbar .pname")?.textContent || "Jogador";
  hud.cname.textContent = character.name;
  hud.lvl.textContent = character.level[0];
  hud.weapon.textContent = character.weapon || "";
  const hudCache = {};
  const hudSet = (key, el, value, prop = "textContent") => {   // só mexe no DOM quando o valor muda
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    if (prop === "textContent") el.textContent = value; else el.style.setProperty(prop, value);
  };
  function setHealth(v) {                      // chame g.setHealth(novoValor) quando houver dano/cura
    hp = Math.max(0, Math.min(maxHp, v));
    hudSet("hp", hud.hpNum, Math.round(hp));
    hudSet("hpw", hud.hpFill, (hp / maxHp) * 100 + "%", "width");
    hud.hpFill.parentElement.classList.toggle("low", hp / maxHp < 0.3);
  }
  setHealth(hp);
  g.setHealth = setHealth;
  function updateHud() {
    let pct, num, label;
    if (character.id === "citron") {
      const locked = laser.lock > 0;
      pct = locked ? (1 - laser.lock / LASER_LOCK) * 100 : 100 - (laser.time / LASER_MAX) * 100;
      num = Math.round(pct);
      label = locked ? "SUPERAQUECIDO" : "CARGA";
      hud.ammo.classList.toggle("warn", locked);
    } else {
      const reloading = mag.reload > 0;
      pct = reloading ? (1 - mag.reload / RELOAD_TIME) * 100 : (mag.ammo / MAG_SIZE) * 100;
      num = mag.ammo;
      label = reloading ? "RECARREGANDO" : (mag.ammo < MAG_SIZE ? "R: RECARREGAR" : "MUNIÇÃO");
      hud.ammo.classList.toggle("warn", reloading || mag.ammo <= MAG_SIZE * 0.2);
    }
    hudSet("ap", hud.ammo, pct.toFixed(1), "--p");
    hudSet("an", hud.ammoNum, num);
    hudSet("al", hud.ammoLabel, label);
  }

  function updateAttacks(dt, wantFire) {
    fireLightHold = false;
    if (character.id === "citron") updateLaser(dt, wantFire);
    cooldown -= dt;
    if (attack) {
      if (mag.reload > 0) {
        mag.reload -= dt;
        if (mag.reload <= 0) { mag.reload = 0; mag.ammo = MAG_SIZE; }
      } else if (keys.KeyR && mag.ammo < MAG_SIZE) {
        mag.reload = RELOAD_TIME;
      }
      if (wantFire && cooldown <= 0 && mag.reload <= 0 && mag.ammo > 0) {
        attack.fire();
        cooldown = attack.rate;
        if (--mag.ammo <= 0) mag.reload = RELOAD_TIME;   // acabou: recarrega sozinho
      }
    }
    updateHud();
    if (!fireLightHold) fireLight.intensity *= Math.exp(-dt * 28);   // o clarão some rápido

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;
      const len = p.speed * dt;
      const t = castWorld(p.m.position, p.d, len);
      if (t < len) {
        burst(_m.copy(p.m.position).addScaledVector(p.d, t), p.hex, p.n, 5, p.size, 0.45);
        p.life = 0;
      } else {
        p.m.position.addScaledVector(p.d, len);
      }
      if (p.life <= 0) { scene.remove(p.m); projectiles.splice(i, 1); }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { scene.remove(p.m); parts.splice(i, 1); continue; }
      if (p.v) { p.v.y -= p.g * dt; p.m.position.addScaledVector(p.v, dt); }
      p.m.scale.setScalar(p.s * (p.life / p.max));
    }
  }

  // =====================================================================
  //  Loop principal
  // =====================================================================
  const pos = player.position;
  const playerH = character.modelHeight || PLAYER_HEIGHT;
  let facing = Math.PI;       // de costas para a câmera (olhando para -Z)
  let vy = 0, grounded = true, coyote = 0, jumpBuf = 0, camY = 0;
  const clock = new THREE.Clock();
  const perf = { t: 0, acc: 0, n: 0, good: 0 };

  // resolução dinâmica: se o FPS cair, reduz a nitidez um pouco; se sobrar, devolve
  function adaptQuality(raw) {
    if (raw > 0.5) return;                      // aba ficou em segundo plano
    perf.t += raw;
    if (perf.t < 3) return;                     // ignora o início (compilação de shaders)
    perf.acc += raw; perf.n++;
    if (perf.acc < 1.5) return;
    const avg = perf.acc / perf.n;
    perf.acc = 0; perf.n = 0;
    if (avg > 1 / 40 && gfx.pr > 0.6) { gfx.setPixelRatio(Math.max(0.6, gfx.pr - 0.25)); perf.good = 0; }
    else if (avg < 1 / 50 && gfx.pr < gfx.maxPR) { if (++perf.good >= 4) { gfx.setPixelRatio(Math.min(gfx.maxPR, gfx.pr + 0.25)); perf.good = 0; } }
    else perf.good = 0;
  }

  function loop() {
    if (g.stopped) return;
    g.raf = requestAnimationFrame(loop);
    const raw = clock.getDelta();
    const dt = Math.min(raw, 0.05);
    adaptQuality(raw);
    mixer?.update(dt);

    // entrada: ix (direita +), iz (frente +)
    let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    ix += joy.x; iz -= joy.y;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }

    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);   // frente da câmera
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);    // direita da câmera
    if (il > 0.05) {
      pos.x += (rx * ix + fx * iz) * MOVE_SPEED * dt;
      pos.z += (rz * ix + fz * iz) * MOVE_SPEED * dt;
    }

    // a planta sempre olha para onde a câmera olha (como no GW2); andar de lado = strafe
    {
      let diff = Math.atan2(fx, fz) - facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      facing += diff * Math.min(1, dt * 15);
    }

    // pulo (Espaço) + gravidade
    if (jumpQueued) { jumpBuf = JUMP_BUFFER; jumpQueued = false; }
    jumpBuf = Math.max(0, jumpBuf - dt);
    coyote = grounded ? COYOTE_TIME : Math.max(0, coyote - dt);
    if (jumpBuf > 0 && coyote > 0) { vy = JUMP_SPEED; coyote = 0; jumpBuf = 0; grounded = false; }
    const prevY = pos.y;
    vy -= GRAVITY * dt;
    pos.y += vy * dt;

    // limites do mapa
    const lim = MAP_HALF - 1;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));

    // chão: o solo ou o topo de uma pedra/moita (se já estava por cima); colisão lateral só abaixo do topo
    let floorY = 0;
    for (const c of colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz);
      if (prevY >= c.h - 0.08 && d < c.r + 0.3) { if (c.h > floorY) floorY = c.h; continue; }
      if (pos.y < c.h - 0.1) {
        const min = c.r + 0.5;
        if (d < min && d > 1e-4) { pos.x = c.x + (dx / d) * min; pos.z = c.z + (dz / d) * min; }
      }
    }
    if (pos.y <= floorY) { pos.y = floorY; if (vy < 0) vy = 0; }
    grounded = pos.y <= floorY + 1e-3;

    player.rotation.y = facing;

    // câmera nas costas da planta (a altura acompanha o pulo suavemente)
    camY += (pos.y - camY) * Math.min(1, dt * 10);
    const tx = pos.x, ty = camY + playerH, tz = pos.z;
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const ox = rx * CAM_SHOULDER, oz = rz * CAM_SHOULDER;
    camera.position.set(tx + ox - fx * cp * CAM_DISTANCE, ty + sp * CAM_DISTANCE, tz + oz - fz * cp * CAM_DISTANCE);
    camera.lookAt(tx + ox, ty, tz + oz);

    player.updateMatrixWorld(true);
    updateAttacks(dt, mouseFire || touchFire);

    sky.follow(tx, tz);
    sky.drift(dt);
    world.update(clock.elapsedTime);
    gfx.render(dt);
  }
  loop();
}

function stopGame() {
  if (!game) return;
  const g = game;
  game = null;
  g.stopped = true;
  if (document.pointerLockElement) document.exitPointerLock();
  if (g.raf) cancelAnimationFrame(g.raf);
  g.ac?.abort();
  g.cleanup?.();
  gameLoading.style.display = "none";
  joyKnob.style.transform = "translate(0,0)";
  gameEl.classList.remove("active", "laser");
  screenEl.style.display = "";
}