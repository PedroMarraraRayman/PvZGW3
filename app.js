// ----- Dados dos personagens (ajuste depois à vontade) -----
const characters = [
  {
    id: "peashooter",
    name: "Peashooter",
    role: "Soldado",
    model: "pvz_garden_warfare_2_-_peashooter_deluxe.glb",
    desc: "Equilibrado e confiável. Atira ervilhas em rajada e funciona bem em qualquer situação.",
    stats: { Vida: 3, Dano: 3, Mobilidade: 4 },
  },
  {
    id: "sunflower",
    name: "Sunflower",
    role: "Curandeira",
    model: "pvz_garden_warfare_2_-_sunflower_deluxe.glb",
    desc: "Mantém a equipe de pé com curas e raios de sol. Frágil sozinha, valiosa em grupo.",
    stats: { Vida: 2, Dano: 2, Mobilidade: 3 },
  },
  {
    id: "citron",
    name: "Citron",
    role: "Tanque",
    model: "pvz_garden_warfare_2_-_citron.glb",
    desc: "Resistente e com ataques de impacto. Segura a linha de frente enquanto os aliados avançam.",
    stats: { Vida: 5, Dano: 4, Mobilidade: 2 },
  },
];

const MAX_STAT = 5;
const START_ORBIT = "25deg 80deg auto"; // ângulo inicial ao trocar de personagem

const roster = document.getElementById("roster");
const stage = document.getElementById("stage-viewer");
const dName = document.getElementById("d-name");
const dRole = document.getElementById("d-role");
const dDesc = document.getElementById("d-desc");
const dStats = document.getElementById("d-stats");
const playBtn = document.getElementById("play");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (reduceMotion) stage.removeAttribute("auto-rotate");

let selected = null;

// ----- Lista lateral (foto de cada personagem) -----
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
  // próximo passo: iniciar o jogo / trocar de tela aqui
});

// Começa com o primeiro selecionado
select(characters[0].id);
