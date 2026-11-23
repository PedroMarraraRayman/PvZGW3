// ----- Dados dos personagens (ajuste depois à vontade) -----
const characters = [
  {
    id: "peashooter",
    name: "Peashooter",
    role: "Soldado",
    rarity: "Super Rara",
    level: [6, 7],
    model: "models/pvz_garden_warfare_2_-_peashooter_deluxe.glb",
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
    desc: "Resistente e perigoso: dispara um laser potente da sua arma. Segura a linha de frente.",
    stats: { Vida: 5, Dano: 4, Mobilidade: 2 },
  },
];

const MAX_STAT = 5;
const START_ORBIT = "25deg 80deg auto"; // ângulo inicial ao trocar de personagem

const roster = document.getElementById("roster");
const stage = document.getElementById("stage-viewer");
const dName = document.getElementById("d-name");
const dRole = document.getElementById("d-role");
const dRarity = document.getElementById("d-rarity");
const dLvlA = document.getElementById("d-lvl-a");
const dLvlB = document.getElementById("d-lvl-b");
const dDesc = document.getElementById("d-desc");
const dStats = document.getElementById("d-stats");
const playBtn = document.getElementById("play");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (reduceMotion) stage.removeAttribute("auto-rotate");

let selected = null;

// ----- Lista lateral (ícone de cada personagem) -----
characters.forEach((c) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "thumb";
  btn.dataset.id = c.id;
  btn.setAttribute("role", "radio");
  btn.setAttribute("aria-checked", "false");
  btn.innerHTML = `
    <model-viewer
      src="${c.model}"
      alt="${c.name}"
      camera-orbit="20deg 80deg auto"
      interaction-prompt="none"
      loading="eager">
    </model-viewer>
    <span>${c.name}</span>
  `;
  btn.addEventListener("click", () => select(c.id));
  roster.appendChild(btn);
});

// ----- Seleção -----
function select(id) {
  if (selected && selected.id === id) return;
  selected = characters.find((c) => c.id === id);

  document.querySelectorAll(".thumb").forEach((b) =>
    b.setAttribute("aria-checked", b.dataset.id === id)
  );

  // Troca o modelo do palco com um fade
  stage.classList.add("loading");
  stage.src = selected.model;
  stage.cameraOrbit = START_ORBIT;
  stage.alt = `Modelo 3D de ${selected.name}`;

  // Painel de informações
  dName.textContent = selected.name;
  dRole.textContent = selected.role;
  dRarity.textContent = selected.rarity;
  dLvlA.textContent = selected.level[0];
  dLvlB.textContent = selected.level[1];
  dDesc.textContent = selected.desc;
  dStats.innerHTML = Object.entries(selected.stats)
    .map(
      ([label, value]) => `
      <li>${label}
        <div class="bar"><span style="width:${(value / MAX_STAT) * 100}%"></span></div>
      </li>`
    )
    .join("");
  playBtn.textContent = `Jogar com ${selected.name}`;
}

stage.addEventListener("load", () => stage.classList.remove("loading"));

// ----- Confirmar -----
playBtn.addEventListener("click", () => {
  if (!selected) return;
  localStorage.setItem("pvz:character", selected.id);
  console.log("Personagem escolhido:", selected.id);
  startGame(selected);
});

// Atalhos de teclado na seleção: ↑/↓ trocam, Enter joga
window.addEventListener("keydown", (e) => {
  if (game) return;
  const i = characters.findIndex((c) => c.id === selected.id);
  if (e.code === "ArrowDown") select(characters[(i + 1) % characters.length].id);
  if (e.code === "ArrowUp") select(characters[(i - 1 + characters.length) % characters.length].id);
  if (e.code === "Enter") playBtn.click();
});

// Começa com o primeiro selecionado
select(characters[0].id);

// =====================================================================
// ----- JOGO: terceira pessoa, câmera nas costas da planta -----------
// =====================================================================
const gameEl = document.getElementById("game");
const screenEl = document.querySelector(".screen");
const gameCanvasWrap = document.getElementById("game-canvas");
const gameLoading = document.getElementById("game-loading");
const joyEl = document.getElementById("joy");
const joyKnob = document.getElementById("joy-knob");
const backBtn = document.getElementById("game-back");

// Se o modelo estiver olhando para o lado errado, mude aqui (ex.: Math.PI, Math.PI / 2)
const MODEL_YAW_OFFSET = 0;
const PLAYER_HEIGHT = 1.8;   // altura da planta no mundo
const MOVE_SPEED = 6;        // unidades por segundo
const CAM_DISTANCE = 3.2;    // câmera bem perto, como no PvZ GW2
const CAM_SHOULDER = 0.8;    // desloca a câmera para a direita (planta fica à esquerda)
const MAP_HALF = 50;         // o mapa vai de -50 a 50
const MOUSE_SENS = 0.0025;   // sensibilidade do mouse travado

let game = null;

backBtn.addEventListener("click", () => stopGame());

async function startGame(character) {
  if (game) return;
  game = { stopped: false };
  screenEl.style.display = "none";
  gameEl.classList.add("active");
  gameEl.classList.toggle("laser", character.id === "citron");
  gameLoading.textContent = `Carregando ${character.name}...`;
  gameLoading.style.display = "block";

  let THREE, GLTFLoader;
  try {
    THREE = await import("three");
    ({ GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js"));
  } catch (e) {
    gameLoading.textContent = "Não foi possível carregar o three.js (verifique a internet).";
    console.error(e);
    return;
  }
  if (game.stopped) return;

  const ac = new AbortController();
  const sig = { signal: ac.signal };
  game.ac = ac;

  // ----- Renderer / cena -----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  gameCanvasWrap.appendChild(renderer.domElement);
  game.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe8ff);
  scene.fog = new THREE.Fog(0xbfe8ff, 40, 110);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a7a3a, 1.1));
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  const sc = sunLight.shadow.camera;
  sc.left = -25; sc.right = 25; sc.top = 25; sc.bottom = -25; sc.near = 1; sc.far = 120;
  scene.add(sunLight, sunLight.target);

  // ----- Mapa simples: gramado listrado, cerca, árvores, moitas e pedras -----
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const cx = cv.getContext("2d");
  cx.fillStyle = "#4fae3a"; cx.fillRect(0, 0, 64, 128);
  cx.fillStyle = "#58b843"; cx.fillRect(64, 0, 64, 128);
  const grassTex = new THREE.CanvasTexture(cv);
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(MAP_HALF / 4, MAP_HALF / 4);
  grassTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2),
    new THREE.MeshStandardMaterial({ map: grassTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const colliders = []; // círculos {x, z, r}
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b });
  const fenceH = 1.2, fenceT = 0.5, L = MAP_HALF * 2 + fenceT;
  [[0, -MAP_HALF, L, fenceT], [0, MAP_HALF, L, fenceT], [-MAP_HALF, 0, fenceT, L], [MAP_HALF, 0, fenceT, L]]
    .forEach(([x, z, w, d]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, fenceH, d), woodMat);
      m.position.set(x, fenceH / 2, z);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    });

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7a2a });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x3d9a35 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d8d8d });

  function addTree(x, z) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 3, 10), trunkMat);
    t.position.set(x, 1.5, z);
    const l = new THREE.Mesh(new THREE.SphereGeometry(2, 14, 12), leafMat);
    l.position.set(x, 4.2, z);
    t.castShadow = l.castShadow = true;
    scene.add(t, l);
    colliders.push({ x, z, r: 0.7, hr: 2.0, h: 6.2 });
  }
  function addBush(x, z) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), bushMat);
    b.position.set(x, 0.8, z);
    b.scale.y = 0.8;
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
    colliders.push({ x, z, r: 1.0, hr: 1.1, h: 1.6 });
  }
  function addRock(x, z) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2), rockMat);
    r.position.set(x, 0.8, z);
    r.castShadow = r.receiveShadow = true;
    scene.add(r);
    colliders.push({ x, z, r: 1.1, hr: 1.2, h: 2.0 });
  }
  [[-12, -10], [15, -18], [-25, 12], [22, 20], [-8, 30], [35, -5], [-35, -25], [5, -35]].forEach(([x, z]) => addTree(x, z));
  [[6, -6], [-5, 8], [12, 10], [-18, -4], [25, -25], [-30, 30], [0, 22], [-14, 22]].forEach(([x, z]) => addBush(x, z));
  [[-4, -14], [18, 2], [-22, -18], [30, 12]].forEach(([x, z]) => addRock(x, z));

  // ----- Jogador -----
  const player = new THREE.Group();
  scene.add(player);
  let mixer = null, overheatAction = null;   // animação "Superaquecer" (Citron)
  try {
    const gltf = await new GLTFLoader().loadAsync(character.model);
    if (game.stopped) { renderer.dispose(); return; }
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const k = PLAYER_HEIGHT / size.y;
    model.scale.setScalar(k);
    model.position.set(-center.x * k, -box.min.y * k, -center.z * k);
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    const pivot = new THREE.Group();
    pivot.add(model);
    pivot.rotation.y = MODEL_YAW_OFFSET;
    const holder = new THREE.Group();
    holder.add(pivot);
    player.add(holder);
    game.holder = holder;
    const clip = THREE.AnimationClip.findByName(gltf.animations, "Superaquecer");
    if (clip) {
      mixer = new THREE.AnimationMixer(model);
      overheatAction = mixer.clipAction(clip);
      overheatAction.setLoop(THREE.LoopOnce, 1);
      overheatAction.clampWhenFinished = true;      // segura a última pose até a arma esfriar
    }
  } catch (e) {
    gameLoading.textContent = "Erro ao carregar o modelo. Confira a pasta models e abra o jogo por um servidor local.";
    console.error(e);
    return;
  }
  gameLoading.style.display = "none";

  // ----- Entrada -----
  const keys = {};
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "Space") e.preventDefault();
    // Com o mouse travado o navegador já usa o Esc para soltá-lo.
    // Com o mouse solto, o Esc volta para a seleção.
    if (e.code === "Escape" && !document.pointerLockElement) stopGame();
  }, sig);
  window.addEventListener("keyup", (e) => { keys[e.code] = false; }, sig);
  window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; }, sig);

  let mouseFire = false, touchFire = false; // botão do mouse / botão de tela
  let camYaw = 0;     // 0 = câmera olhando para -Z (nas costas da planta)
  let camPitch = 0.15;

  function rotateCam(dx, dy) {
    camYaw -= dx * MOUSE_SENS;
    camPitch = Math.min(0.9, Math.max(-0.15, camPitch + dy * MOUSE_SENS));
  }

  const canvas = renderer.domElement;

  // Mouse: clique trava o ponteiro; com ele travado, mover o mouse gira a câmera
  let camPointer = null; // usado só para toque (celular)
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
    if (e.pointerId !== camPointer) return;
    rotateCam(e.movementX * 2, e.movementY * 1.6);
  }, sig);

  canvas.addEventListener("pointerup", (e) => { if (e.pointerType === "mouse" && e.button === 0) mouseFire = false; }, sig);
  document.addEventListener("pointerlockchange", () => { mouseFire = false; }, sig);
  window.addEventListener("blur", () => { mouseFire = false; touchFire = false; }, sig);
  const fireBtn = document.getElementById("fire");
  fireBtn.addEventListener("pointerdown", (e) => { touchFire = true; fireBtn.setPointerCapture(e.pointerId); }, sig);
  fireBtn.addEventListener("pointerup", () => { touchFire = false; }, sig);
  fireBtn.addEventListener("pointercancel", () => { touchFire = false; }, sig);

  const endCam = (e) => { if (e.pointerId === camPointer) camPointer = null; };
  canvas.addEventListener("pointerup", endCam, sig);
  canvas.addEventListener("pointercancel", endCam, sig);

  // Tenta travar o mouse logo ao entrar (se o navegador negar, basta clicar na tela)
  try {
    const p = canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  } catch (_) {}

  // joystick (celular)
  const joy = { x: 0, y: 0 };
  let joyPointer = null;
  const JOY_R = 50;
  function joyUpdate(e) {
    const r = joyEl.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
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
  joyEl.addEventListener("pointerdown", (e) => {
    joyPointer = e.pointerId;
    joyEl.setPointerCapture(e.pointerId);
    joyUpdate(e);
  }, sig);
  joyEl.addEventListener("pointermove", (e) => { if (e.pointerId === joyPointer) joyUpdate(e); }, sig);
  joyEl.addEventListener("pointerup", joyEnd, sig);
  joyEl.addEventListener("pointercancel", joyEnd, sig);

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }, sig);

  // =====================================================================
  // ----- ATAQUES -------------------------------------------------------
  // =====================================================================
  const V3 = THREE.Vector3;
  const muzzleLocal = findMuzzle(THREE, player, character.id); // boca / cano, em coordenadas da planta
  const camDir = new V3(), _o = new V3(), _t = new V3();
  const projectiles = [], parts = [], beams = [];

  // Distância até o primeiro obstáculo (chão, cerca, árvore, moita, pedra)
  function castWorld(o, d, max) {
    let best = max;
    if (d.y < -1e-4) { const t = -o.y / d.y; if (t > 0 && t < best) best = t; }
    for (const [ax, dv, ov] of [["x", d.x, o.x], ["z", d.z, o.z]]) {
      if (Math.abs(dv) < 1e-4) continue;
      const t = ((dv > 0 ? MAP_HALF : -MAP_HALF) - ov) / dv;
      if (t > 0 && t < best) best = t;
    }
    for (const c of colliders) {
      const ox = o.x - c.x, oz = o.z - c.z;
      const a2 = d.x * d.x + d.z * d.z;
      if (a2 < 1e-6) continue;
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
  const muzzleWorld = () => player.localToWorld(muzzleLocal.clone());

  // partículas e clarões
  const sparkGeo = new THREE.IcosahedronGeometry(0.07, 0);
  const flashGeo = new THREE.SphereGeometry(1, 12, 8);
  const mats = {};
  const basic = (hex, add) => (mats[hex + (add ? "a" : "")] ||= new THREE.MeshBasicMaterial(
    add ? { color: hex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false } : { color: hex }
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

  // ervilha: esfera verde
  const peaGeo = new THREE.SphereGeometry(0.15, 12, 10);
  const peaMat = new THREE.MeshStandardMaterial({ color: 0x57c93a, emissive: 0x1d6a12, emissiveIntensity: 0.6, roughness: 0.4 });
  function shootPea() {
    const o = muzzleWorld(), d = aim(o, new V3());
    d.x += (Math.random() - 0.5) * 0.012; d.y += (Math.random() - 0.5) * 0.012; d.normalize();
    const m = new THREE.Mesh(peaGeo, peaMat);
    m.position.copy(o);
    m.castShadow = true;
    scene.add(m);
    projectiles.push({ m, d, speed: 42, life: 2, hex: 0x7bdc4a, n: 7, size: 1 });
    flash(o, 0xb6ff8a, 0.22);
  }

  // raio solar: feixe fino e comprido, com núcleo claro e brilho dourado
  const rayCore = new THREE.CylinderGeometry(0.018, 0.018, 1.6, 6).rotateX(Math.PI / 2).translate(0, 0, -0.8);
  const rayGlow = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8).rotateX(Math.PI / 2).translate(0, 0, -0.8);
  function shootSun() {
    const o = muzzleWorld(), d = aim(o, new V3());
    d.x += (Math.random() - 0.5) * 0.008; d.y += (Math.random() - 0.5) * 0.008; d.normalize();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(rayCore, new THREE.MeshBasicMaterial({ color: 0xfffbd0 })));
    g.add(new THREE.Mesh(rayGlow, basic(0xffb820, true)));
    g.position.copy(o);
    g.lookAt(o.clone().add(d)); // o eixo +Z do feixe aponta para o alvo
    scene.add(g);
    projectiles.push({ m: g, d, speed: 95, life: 1.3, hex: 0xffd23f, n: 6, size: 0.8 });
    flash(o, 0xffe27a, 0.28);
  }

  // laser contínuo: um único feixe que acompanha a mira enquanto o botão está apertado
  const LASER_MAX = 4.9;     // segundos de disparo contínuo até superaquecer
  const LASER_LOCK = 2.5;    // segundos inutilizada até esfriar
  const LASER_SIDE = 0.35;   // deslocamento do disparo para a direita (visão do jogador)
  const heatEl = document.getElementById("heat");
  const heatFill = heatEl && heatEl.firstElementChild;
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const laser = { g: null, core: null, glow: null, on: false, time: 0, lock: 0, fx: 0 };
  const _right = new V3();
  function laserOrigin() {
    const o = muzzleWorld();
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _right.y = 0;
    if (_right.lengthSq() > 1e-6) _right.normalize();
    return o.addScaledVector(_right, LASER_SIDE);
  }
  function laserOn() {
    if (laser.on) return;
    laser.g = new THREE.Group();
    laser.core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
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
  function updateLaser(dt, wantFire) {
    if (laser.lock > 0) {                       // superaquecida: não atira
      laser.lock -= dt;
      laserOff();
      if (laser.lock <= 0) {
        laser.lock = 0; laser.time = 0;
        if (overheatAction) overheatAction.stop();   // volta a arma à pose normal
      }
      if (heatFill) heatFill.style.width = (laser.lock / LASER_LOCK) * 100 + "%";
      if (heatEl) heatEl.classList.toggle("hot", laser.lock > 0);
      return;
    }
    if (!wantFire) {
      laserOff();
      laser.time = 0;
      if (heatFill) heatFill.style.width = "0%";
      if (heatEl) heatEl.classList.remove("hot");
      return;
    }
    laser.time += dt;
    if (laser.time >= LASER_MAX) {              // superaqueceu
      laser.lock = LASER_LOCK;
      laserOff();
      if (overheatAction) {                                // animação "Superaquecer"
        overheatAction.timeScale = overheatAction.getClip().duration / LASER_LOCK;   // dura o tempo do resfriamento
        overheatAction.reset().play();
      }
      const o = laserOrigin();
      burst(o, 0xff5a1f, 18, 6, 1.4, 0.6);
      flash(o, 0xff7a00, 0.6, 0.25);
      return;
    }
    laserOn();
    const o = laserOrigin(), d = aim(o, new V3());
    const dist = castWorld(o, d, 120);
    const end = o.clone().addScaledVector(d, dist);
    const pulse = 1 + Math.sin(performance.now() * 0.05) * 0.12;
    laser.core.scale.set(0.035, 0.035, dist);
    laser.glow.scale.set(0.12 * pulse, 0.12 * pulse, dist);
    laser.g.position.copy(o);
    laser.g.lookAt(end);
    laser.fx -= dt;
    if (laser.fx <= 0) {                        // faíscas no muzzle e no ponto de impacto
      laser.fx = 0.06;
      flash(o, 0xffa940, 0.35, 0.08);
      if (dist < 119) {
        flash(end, 0xffb347, 0.5, 0.1);
        burst(end, 0xff8a1f, 4, 7, 1.3, 0.4);
      }
    }
    if (heatFill) heatFill.style.width = (laser.time / LASER_MAX) * 100 + "%";
    if (heatEl) heatEl.classList.remove("hot");
  }

  const ATTACKS = {
    peashooter: { rate: 0.12, fire: shootPea },
    sunflower: { rate: 0.12, fire: shootSun },
  };
  const attack = ATTACKS[character.id];
  let cooldown = 0;

  // ----- Munição / recarga (Peashooter e Sunflower) -----
  const MAG_SIZE = { peashooter: 50, sunflower: 40 }[character.id] || 0;
  const RELOAD_TIME = 1.6;
  const mag = { ammo: MAG_SIZE, reload: 0 };

  // ----- HUD -----
  const $ = (id) => document.getElementById(id);
  const hud = {
    root: $("hud"), ico: $("hud-ico"), name: $("hud-name"), cname: $("hud-cname"), lvl: $("hud-lvl"),
    hpNum: $("hud-hp-num"), hpFill: $("hud-hp-fill"), ammo: $("hud-ammo"), ammoNum: $("hud-ammo-num"),
    ammoLabel: $("hud-ammo-label"), weapon: $("hud-weapon"),
  };
  const HUD_ICON = { peashooter: "🌱", sunflower: "🌻", citron: "🍋" };
  const HUD_WEAPON = { peashooter: "Ervilhas", sunflower: "Raio solar", citron: "Laser" };
  const maxHp = 50 * (character.stats?.Vida || 3);   // Peashooter 150, Sunflower 100, Citron 250
  let hp = maxHp;
  hud.ico.textContent = HUD_ICON[character.id] || "🌿";
  hud.name.textContent = document.querySelector(".playerbar .pname")?.textContent || "Jogador";
  hud.cname.textContent = character.name;
  hud.lvl.textContent = character.level[0];
  hud.weapon.textContent = HUD_WEAPON[character.id] || "";
  const hudCache = {};
  const hudSet = (key, el, value, prop = "textContent") => {
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    if (prop === "textContent") el.textContent = value; else el.style.setProperty(prop, value);
  };
  function setHealth(v) {              // chame setHealth(novoValor) quando houver dano/cura
    hp = Math.max(0, Math.min(maxHp, v));
    hudSet("hp", hud.hpNum, Math.round(hp));
    hudSet("hpw", hud.hpFill, (hp / maxHp) * 100 + "%", "width");
    hud.hpFill.parentElement.classList.toggle("low", hp / maxHp < 0.3);
  }
  setHealth(hp);
  game.setHealth = setHealth;
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
        player.updateMatrixWorld(true);
        attack.fire();
        cooldown = attack.rate;
        if (--mag.ammo <= 0) mag.reload = RELOAD_TIME;   // acabou: recarrega sozinho
      }
    }
    updateHud();

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;
      const len = p.speed * dt;
      const t = castWorld(p.m.position, p.d, len);
      if (t < len) {
        const hit = p.m.position.clone().addScaledVector(p.d, t);
        burst(hit, p.hex, p.n, 5, p.size, 0.45);
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
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      b.life -= dt;
      if (b.life <= 0) { scene.remove(b.g); beams.splice(i, 1); continue; }
      const k = b.life / b.max;
      b.g.scale.set(k, k, 1);
    }
  }

  // ----- Loop -----
  let facing = Math.PI; // de costas para a câmera (olhando para -Z)
  const clock = new THREE.Clock();

  function loop() {
    if (game.stopped) return;
    game.raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (mixer) mixer.update(dt);

    // entrada: ix (direita +), iz (frente +)
    let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    ix += joy.x; iz -= joy.y;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }

    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw); // frente da câmera
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);  // direita da câmera
    const mx = rx * ix + fx * iz;
    const mz = rz * ix + fz * iz;
    const moving = il > 0.05;

    if (moving) {
      player.position.x += mx * MOVE_SPEED * dt;
      player.position.z += mz * MOVE_SPEED * dt;
    }

    // a planta sempre olha para onde a câmera olha (como no GW2); andar de lado = strafe
    {
      const target = Math.atan2(fx, fz);
      let diff = target - facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      facing += diff * Math.min(1, dt * 15);
    }

    // limites do mapa e colisões
    const lim = MAP_HALF - 1;
    player.position.x = Math.max(-lim, Math.min(lim, player.position.x));
    player.position.z = Math.max(-lim, Math.min(lim, player.position.z));
    for (const c of colliders) {
      const dx = player.position.x - c.x, dz = player.position.z - c.z;
      const d = Math.hypot(dx, dz), min = c.r + 0.5;
      if (d < min && d > 0.0001) {
        player.position.x = c.x + (dx / d) * min;
        player.position.z = c.z + (dz / d) * min;
      }
    }

    player.rotation.y = facing;
    // (sem pulinhos ao andar)

    // câmera nas costas da planta
    const tx = player.position.x, ty = PLAYER_HEIGHT * 1.0, tz = player.position.z;
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const ox = rx * CAM_SHOULDER, oz = rz * CAM_SHOULDER;
    camera.position.set(tx + ox - fx * cp * CAM_DISTANCE, ty + sp * CAM_DISTANCE, tz + oz - fz * cp * CAM_DISTANCE);
    camera.lookAt(tx + ox, ty, tz + oz);

    player.updateMatrixWorld(true);
    updateAttacks(dt, keys.Space || mouseFire || touchFire);

    sunLight.position.set(tx + 20, 40, tz + 15);
    sunLight.target.position.set(tx, 0, tz);

    renderer.render(scene, camera);
  }
  loop();
}

// Descobre, a partir da malha do modelo, onde ficam a boca/arma (em coordenadas da planta)
function findMuzzle(THREE, root, id) {
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
  if (id === "peashooter") {            // cano na frente da cabeça
    const b = boxOf("headprop");
    if (b) { const F = dirTo(b); p = tip(b, F).addScaledVector(F, 0.08); }
  } else if (id === "citron") {         // ponta da arma
    const gl = boxOf("glasses"), w = boxOf("weapon");
    if (gl && w) { const F = dirTo(gl); p = tip(w, F).addScaledVector(F, 0.05); }
  } else if (id === "sunflower") {      // boca: logo abaixo dos olhos
    const e = boxOf("eye");
    if (e) {
      const F = dirTo(e);
      p = tip(e, F).addScaledVector(F, 0.03);
      p.y = e.getCenter(new THREE.Vector3()).y - 0.11 * H;
    }
  }
  return p || new THREE.Vector3(0, H * 0.7, whole.max.z); // plano B
}

function stopGame() {
  if (!game) return;
  game.stopped = true;
  if (document.pointerLockElement) document.exitPointerLock();
  if (game.raf) cancelAnimationFrame(game.raf);
  if (game.ac) game.ac.abort();
  if (game.renderer) {
    game.renderer.dispose();
    game.renderer.domElement.remove();
  }
  gameLoading.style.display = "none";
  joyKnob.style.transform = "translate(0,0)";
  gameEl.classList.remove("active", "laser");
  screenEl.style.display = "";
  game = null;
}