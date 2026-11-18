const canvas = document.getElementById('gameCanvas');
const context = canvas.getContext('2d');
context.imageSmoothingEnabled = false;

// ============================================================
// CONFIGURAÇÕES
// ============================================================
const HUD_HEIGHT = 80;
const MAP_SOURCE = { x: 0, y: 80, width: 1536, height: 944 };
const WORLD = { width: canvas.width, height: canvas.height - HUD_HEIGHT };

// Tamanho dos personagens na tela (os quadros originais têm 64x64 px).
// Tudo que depende do tamanho do sprite (alcance, barra de vida) deriva destes valores.
const PLAYER_SIZE = 112;
const ZOMBIE_SIZE = 94;
const MONSTER_SIZE = 120;   // o monstro (ogro) é bem maior que o zumbi
const PLAYER_ATTACK_RANGE = PLAYER_SIZE * 1.4;     // alcance do golpe do jogador
// Raio dos pés de cada personagem na colisão com o cenário (proporcional ao sprite).
const PLAYER_FOOT_RADIUS = PLAYER_SIZE * 0.15;
const ZOMBIE_FOOT_RADIUS = ZOMBIE_SIZE * 0.16;
const MONSTER_FOOT_RADIUS = MONSTER_SIZE * 0.16;

// Coração de cura dropado no chão.
// Ondas de drop: 2, 5, 9, 14, 20... (o intervalo entre drops cresce +1 a cada coração).
const HEART_PICKUP = {
  size: 30,
  heal: 20,                       // 20 de vida = 1 coração no HUD
  pickupDistance: PLAYER_SIZE * 0.35 + 15,
  minDistanceFromPlayer: 180      // evita o coração cair em cima do jogador
};

// Pontos livres do mapa (centro do objeto, em coordenadas do mundo).
// Escolhidos sobre grama e trilha, longe de árvores, rochas, penhascos e do lago.
// São usados para sortear onde nascem os corações e os zumbis.
const OPEN_SPOTS = [
  [160, 160], [330, 180], [430, 100], [620, 120], [720, 210], [860, 250],
  [250, 400], [470, 340], [290, 480], [560, 440], [690, 410], [400, 540],
  [480, 130], [620, 360], [950, 365], [1050, 385], [320, 625], [690, 600],
  [230, 520]
];

// ============================================================
// COLISÃO COM O CENÁRIO
// ============================================================
// Coloque true para desenhar os colisores (troncos, objetos, lago) e calibrar o mapa.
const DEBUG_COLLIDERS = false;

// Os pés do personagem (não o sprite inteiro) é que colidem com o cenário.
// Isso permite passar "por trás" da árvore, como em qualquer RPG top-down.
// Proporções do tamanho do sprite: posição/raio dos pés e até onde vai a parte visível (sombra).
const FOOT = { offsetY: 0.66, contentBottom: 0.72 };

const rect = (x, y, w, h) => ({
  type: 'polygon',
  points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
});

// Fração do raio da copa que também bloqueia (0 = só o tronco bloqueia).
// Com a copa sólida ninguém consegue ficar "dentro" ou escondido atrás da árvore.
const TREE_CROWN_SOLID = 0.7;

// Árvores: [x do tronco, y do tronco, raio do colisor, centro X da copa, centro Y da copa, raio X, raio Y]
const TREES = [
  [49, 130, 18, 50, 68, 47, 46],
  [291, 100, 18, 286, 45, 45, 48],
  [582, 94, 16, 582, 47, 38, 40],
  [72, 264, 18, 72, 207, 48, 45],
  [48, 392, 17, 46, 352, 40, 42],
  [413, 421, 19, 411, 372, 46, 52],
  [1161, 193, 18, 1155, 137, 39, 45],
  [952, 329, 17, 952, 285, 38, 36],
  [1024, 321, 17, 1024, 277, 34, 36],
  [1165, 352, 17, 1165, 315, 36, 38],
  [115, 650, 19, 114, 590, 49, 48],
  [747, 492, 15, 745, 455, 30, 30],
  [618, 648, 18, 615, 600, 42, 42],
  [1165, 645, 18, 1165, 592, 38, 40],
  [1122, 716, 22, 1122, 704, 42, 42]
].map(([x, y, r, cx, cy, rx, ry]) => {
  // Cadeia de círculos do tronco até o centro da copa, sem vãos entre eles.
  const colliders = [{ type: 'circle', x, y, r }];
  const crownR = Math.min(rx, ry) * TREE_CROWN_SOLID;
  if (crownR > 0) {
    const links = Math.max(1, Math.ceil(Math.hypot(cx - x, cy - y) / crownR));
    for (let i = 1; i <= links; i++) {
      const t = i / links;
      colliders.push({ type: 'circle', x: x + (cx - x) * t, y: y + (cy - y) * t, r: r + (crownR - r) * t });
    }
  }
  return { colliders, crown: { cx, cy, rx, ry }, sortY: y - 2 };
});

// Objetos sólidos do cenário (rochas, caixas, baú, placa, cerca, casa).
const SOLID_OBJECTS = [
  rect(216, 113, 41, 36),   // baú
  rect(89, 265, 70, 55),    // caixas da esquerda
  rect(206, 303, 26, 28),   // placa
  rect(168, 220, 50, 32),   // rocha grande
  rect(307, 325, 32, 20),   // rocha
  rect(547, 119, 32, 19),   // rocha
  rect(704, 72, 54, 32),    // rocha
  rect(845, 10, 165, 152),  // casa
  rect(787, 176, 76, 26),   // cerca
  rect(1013, 132, 40, 38),  // caixa da direita
  rect(357, 490, 32, 22),   // rocha
  rect(489, 640, 32, 20),   // rocha
  rect(777, 658, 30, 20),   // rocha
  rect(1055, 634, 52, 32),  // rocha grande
  rect(1086, 594, 30, 20)   // rocha
];

// Lago (com o paredão do penhasco). O trecho recortado é a ponte, que continua transitável.
const POND = {
  type: 'polygon',
  points: [
    [885, 422], [1080, 422], [1100, 460], [1130, 500], [1160, 530], [1185, 552],
    [1160, 572], [1130, 582], [1060, 608], [1035, 622], [1028, 642], [1015, 665],
    [918, 667], [918, 646], [862, 646], [862, 667], [835, 665], [820, 636],
    [790, 622], [770, 597], [767, 560], [780, 535], [795, 521], [810, 511],
    [860, 500], [868, 470], [872, 462], [880, 440]
  ]
};

const OBSTACLES = [...TREES.flatMap(t => t.colliders), ...SOLID_OBJECTS, POND];

// Caixa envolvente de cada polígono, usada para descartar testes desnecessários.
OBSTACLES.forEach(o => {
  if (o.type !== 'polygon') return;
  const xs = o.points.map(p => p[0]);
  const ys = o.points.map(p => p[1]);
  o.bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
});

function getFoot(entity) {
  return {
    x: entity.x + entity.width / 2,
    y: entity.y + entity.height * (entity.footOffset ?? FOOT.offsetY),
    r: entity.footRadius
  };
}

function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Retorna o deslocamento necessário para tirar o pé de dentro do obstáculo (ou null).
function pushFromCircle(foot, c) {
  const dx = foot.x - c.x;
  const dy = foot.y - c.y;
  const dist = Math.hypot(dx, dy);
  const minDist = foot.r + c.r;
  if (dist >= minDist) return null;

  const nx = dist > 0.0001 ? dx / dist : 0;
  const ny = dist > 0.0001 ? dy / dist : 1;
  const depth = minDist - dist;
  return { x: nx * depth, y: ny * depth, nx, ny };
}

function pushFromPolygon(foot, poly) {
  const b = poly.bounds;
  if (foot.x + foot.r < b.minX || foot.x - foot.r > b.maxX ||
      foot.y + foot.r < b.minY || foot.y - foot.r > b.maxY) return null;

  // Ponto mais próximo do centro do pé sobre as arestas do polígono.
  const pts = poly.points;
  let best = { dist: Infinity, x: 0, y: 0 };
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const abx = bx - ax;
    const aby = by - ay;
    const t = Math.max(0, Math.min(1, ((foot.x - ax) * abx + (foot.y - ay) * aby) / (abx * abx + aby * aby)));
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    const d = Math.hypot(foot.x - cx, foot.y - cy);
    if (d < best.dist) best = { dist: d, x: cx, y: cy };
  }

  const inside = pointInPolygon(foot.x, foot.y, pts);
  if (!inside && best.dist >= foot.r) return null;

  let nx;
  let ny;
  let depth;
  if (inside) {
    // Centro dentro do obstáculo: sai pela borda mais próxima.
    nx = best.dist > 0.0001 ? (best.x - foot.x) / best.dist : 0;
    ny = best.dist > 0.0001 ? (best.y - foot.y) / best.dist : -1;
    depth = best.dist + foot.r;
  } else {
    nx = (foot.x - best.x) / best.dist;
    ny = (foot.y - best.y) / best.dist;
    depth = foot.r - best.dist;
  }
  return { x: nx * depth, y: ny * depth, nx, ny };
}

// Empurra a entidade para fora de qualquer obstáculo. Retorna a normal do último
// contato (usada pelos zumbis para contornar o obstáculo) ou null se não houve colisão.
function resolveCollisions(entity) {
  let contact = null;

  for (let pass = 0; pass < 3; pass++) {
    const foot = getFoot(entity);
    let moved = false;

    for (const obstacle of OBSTACLES) {
      const push = obstacle.type === 'circle'
        ? pushFromCircle(foot, obstacle)
        : pushFromPolygon(foot, obstacle);
      if (!push) continue;

      entity.x += push.x;
      entity.y += push.y;
      foot.x += push.x;
      foot.y += push.y;
      contact = { x: push.nx, y: push.ny };
      moved = true;
    }

    if (!moved) break;
  }
  return contact;
}

// Mantém o personagem dentro do mundo. O limite inferior considera só a parte visível do sprite
// (a faixa transparente de baixo pode passar da borda), para o jogador alcançar a margem inferior.
function clampToWorld(entity) {
  entity.x = Math.max(0, Math.min(WORLD.width - entity.width, entity.x));
  entity.y = Math.max(0, Math.min(WORLD.height - entity.height * (entity.contentBottom ?? FOOT.contentBottom), entity.y));
}

function footIsFree(x, y, r) {
  const foot = { x, y, r };
  return OBSTACLES.every(o => !(o.type === 'circle' ? pushFromCircle(foot, o) : pushFromPolygon(foot, o)));
}

// ============================================================
// TIPOS DE INIMIGO
// ============================================================
// Cada tipo define tamanho, colisão, sprites, recompensa e atributos (que crescem com a onda).
// Para criar outro inimigo basta adicionar um perfil aqui e incluí-lo em waveComposition().
const ENEMY_PROFILES = {
  zombie: {
    size: ZOMBIE_SIZE,
    footRadius: ZOMBIE_FOOT_RADIUS,
    footOffset: FOOT.offsetY,
    contentBottom: FOOT.contentBottom,
    attackDistance: ZOMBIE_SIZE * 0.7,                         // alcance do ataque (entre os pés)
    bar: { width: ZOMBIE_SIZE * 0.74, height: 6, offsetY: -11 }, // offsetY: a partir do topo do sprite
    reward: { score: 10, coins: 1 },
    sprites: { walk: 'zombieWalk', attack: 'zombieAttack', walkMs: 100, attackMs: 75, attackSheet: null },
    stats: s => ({
      speed: 55 + s * 5 + Math.random() * 25,
      life: Math.min(100, 40 + s * 6),
      damage: 8 + Math.floor(s * 1.2),
      attackDelay: Math.max(620, 900 - s * 20)
    })
  },
  monster: {
    size: MONSTER_SIZE,
    footRadius: MONSTER_FOOT_RADIUS,
    footOffset: 0.8,        // o ogro apoia os pés mais abaixo no quadro
    contentBottom: 0.86,
    attackDistance: MONSTER_SIZE * 0.78,
    bar: { width: MONSTER_SIZE * 0.55, height: 7, offsetY: MONSTER_SIZE * 0.125 - 12 },
    reward: { score: 30, coins: 3 },
    // A folha de ataque tem células maiores (448x320) que a de caminhada (256x256) para o machado caber.
    sprites: {
      walk: 'monsterWalk', attack: 'monsterAttack', walkMs: 130, attackMs: 110,
      attackSheet: { cellW: 448, cellH: 320, padX: 96, padTop: 80 }
    },
    // Mais lento, resistente e forte que o zumbi.
    stats: s => ({
      speed: 40 + s * 2.5 + Math.random() * 10,
      life: Math.min(200, 100 + s * 8),
      damage: 16 + Math.floor(s),
      attackDelay: Math.max(900, 1250 - s * 25)
    })
  }
};

// ============================================================
// NAVEGAÇÃO DOS INIMIGOS
// ============================================================
// O mundo é dividido numa grade. A cada 250 ms calculamos, a partir do jogador, a distância (em
// células) até cada ponto livre. Quando o caminho reto até o jogador está bloqueado, o inimigo
// segue as células de menor distância e contorna árvores, rochas, casa e lago sem travar.
// Cada tamanho de inimigo tem a sua grade, porque o monstro não passa por vãos que o zumbi passa.
const NAV_NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class NavGrid {
  constructor(profile) {
    this.cell = 16;
    this.cols = Math.ceil(WORLD.width / this.cell);
    this.rows = Math.ceil(WORLD.height / this.cell);
    this.footRadius = profile.footRadius + 1.5; // margem de segurança em volta dos obstáculos

    const total = this.cols * this.rows;
    this.walkable = new Array(total);
    this.dist = new Array(total).fill(-1);
    this.queue = new Array(total);

    // Limites dos pés deste tipo de inimigo (equivalentes ao clampToWorld).
    const minX = profile.size / 2;
    const maxX = WORLD.width - profile.size / 2;
    const minY = profile.size * profile.footOffset;
    const maxY = WORLD.height - profile.size * profile.contentBottom + profile.size * profile.footOffset;

    for (let i = 0; i < total; i++) {
      const { x, y } = this.center(i);
      const inside = x >= minX && x <= maxX && y >= minY && y <= maxY;
      this.walkable[i] = inside && footIsFree(x, y, this.footRadius);
    }
  }

  index(x, y) {
    const c = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cell)));
    const r = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cell)));
    return r * this.cols + c;
  }

  center(index) {
    return {
      x: (index % this.cols + 0.5) * this.cell,
      y: (Math.floor(index / this.cols) + 0.5) * this.cell
    };
  }

  // Vizinhos acessíveis (diagonal só se as duas células laterais estiverem livres).
  neighbors(index) {
    const c = index % this.cols;
    const r = Math.floor(index / this.cols);
    const result = [];
    for (const [dc, dr] of NAV_NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
      const n = nr * this.cols + nc;
      if (!this.walkable[n]) continue;
      if (dc !== 0 && dr !== 0 && (!this.walkable[r * this.cols + nc] || !this.walkable[nr * this.cols + c])) continue;
      result.push(n);
    }
    return result;
  }

  // Célula livre mais próxima de um ponto (útil quando o pé está encostado num obstáculo).
  nearestWalkable(x, y, mustBeReachable = false) {
    const c0 = Math.floor(x / this.cell);
    const r0 = Math.floor(y / this.cell);
    let best = -1;
    let bestDist = Infinity;

    for (let radius = 0; radius <= 6 && best < 0; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const i = r * this.cols + c;
          if (!this.walkable[i] || (mustBeReachable && this.dist[i] < 0)) continue;
          const center = this.center(i);
          const d = Math.hypot(center.x - x, center.y - y);
          if (d < bestDist) { bestDist = d; best = i; }
        }
      }
    }
    return best;
  }

  // Busca em largura a partir do jogador: preenche a distância até cada célula livre.
  update(targetFoot) {
    this.dist.fill(-1);
    const start = this.nearestWalkable(targetFoot.x, targetFoot.y);
    if (start < 0) return;

    let head = 0;
    let tail = 0;
    this.dist[start] = 0;
    this.queue[tail++] = start;
    while (head < tail) {
      const current = this.queue[head++];
      for (const n of this.neighbors(current)) {
        if (this.dist[n] >= 0) continue;
        this.dist[n] = this.dist[current] + 1;
        this.queue[tail++] = n;
      }
    }
  }

  // Direção (vetor unitário) para a próxima parte do caminho até o jogador, ou null.
  pathDirection(foot) {
    let index = this.index(foot.x, foot.y);
    if (this.dist[index] < 0) index = this.nearestWalkable(foot.x, foot.y, true);
    if (index < 0) return null;

    // Segue até 2 células à frente para o movimento ficar suave nas quinas.
    for (let i = 0; i < 2; i++) {
      let best = -1;
      for (const n of this.neighbors(index)) {
        if (this.dist[n] >= 0 && this.dist[n] < this.dist[index] && (best < 0 || this.dist[n] < this.dist[best])) best = n;
      }
      if (best < 0) break;
      index = best;
    }

    const target = this.center(index);
    const dx = target.x - foot.x;
    const dy = target.y - foot.y;
    const len = Math.hypot(dx, dy);
    return len > 1 ? { x: dx / len, y: dy / len } : null;
  }
}

const NAVS = {
  zombie: new NavGrid(ENEMY_PROFILES.zombie),
  monster: new NavGrid(ENEMY_PROFILES.monster)
};
let navTimer = 0;

function updateFlowField(dt) {
  navTimer -= dt;
  if (navTimer > 0) return;
  navTimer = 250;
  const foot = getFoot(player);
  Object.values(NAVS).forEach(nav => nav.update(foot));
}

function pathDirection(entity) {
  return entity.nav.pathDirection(getFoot(entity));
}

// Verdadeiro se um personagem pode ir em linha reta de A até B sem esbarrar em obstáculos.
function hasClearPath(a, b, radius) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.ceil(dist / 10);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!footIsFree(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius)) return false;
  }
  return true;
}

// Regras das ondas.
const WAVE_RULES = {
  spawnInterval: 800,                      // ms entre o surgimento de um zumbi e o próximo
  clearDelay: 1500,                        // pausa depois de matar o último, antes da próxima onda
  zombiesFor: n => Math.min(3 + n, 14)     // onda 1 = 4 zumbis, onda 2 = 5... máximo de 14
};

// Entrada gradual dos monstros: a partir da onda `firstWave` eles substituem parte dos zumbis da onda
// (começam com `startCount` e ganham `perWave` por onda), nunca passando de `maxShare` do total.
// Assim, mais adiante, cada onda fica metade zumbis e metade monstros.
const MONSTER_RULES = { firstWave: 4, startCount: 2, perWave: 1, maxShare: 0.5 };

// Aviso de nova onda (animação em milissegundos).
const WAVE_BANNER = {
  duration: 2800,   // tempo total na tela
  fadeIn: 0.22,     // fração inicial da duração usada para aparecer
  fadeOut: 0.35,    // fração final da duração usada para desaparecer
  riseDistance: 70, // quantos pixels o texto sobe durante a animação
  centerY: HUD_HEIGHT + WORLD.height / 2
};

const keys = {};
let paused = false;
let gameOver = false;
let lastTime = 0;
let score = 0;
let crystals = 0;
let coins = 0;
let enemiesDefeated = 0;
let wave = 1;
// Estado da onda: intro (aviso) -> spawning (zumbis surgindo) -> fighting -> cleared (pausa).
let waveState = 'intro';
let waveSpawnQueue = []; // tipos de inimigo que ainda vão surgir nesta onda ('zombie' | 'monster')
let waveTimer = 0;
let waveBanner = { active: false, elapsed: 0, wave: 1 };
let heartPickups = [];
let floatingTexts = [];
let heartsDropped = 0;
let nextHeartWave = 2;
let heartClock = 0;

const images = {};
let loaded = 0;
const imageFiles = {
  map: 'assets/mapa.png',
  playerWalk: 'assets/player_walk.png',
  playerAttack: 'assets/player_attack.png',
  zombieWalk: 'assets/zombie_walk.png',
  zombieAttack: 'assets/zombie_attack.png',
  monsterWalk: 'assets/monster_walk.png',
  monsterAttack: 'assets/monster_attack.png'
};

function loadImages(callback) {
  const names = Object.keys(imageFiles);
  names.forEach(name => {
    images[name] = new Image();
    images[name].src = imageFiles[name];
    images[name].onload = () => {
      loaded++;
      if (loaded === names.length) callback();
    };
    images[name].onerror = () => {
      console.error('Não foi possível carregar:', imageFiles[name]);
    };
  });
}

// ============================================================
// TECLADO
// ============================================================
document.addEventListener('keydown', event => {
  keys[event.code] = true;

  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Enter'].includes(event.code)) {
    event.preventDefault();
  }

  if (event.code === 'Space' && !event.repeat && !paused && !gameOver) {
    player.attack();
  }

  if (event.code === 'Enter' && !event.repeat && !gameOver) {
    paused = !paused;
  }

  if (event.code === 'KeyR' && gameOver) {
    restartGame();
  }
});

document.addEventListener('keyup', event => {
  keys[event.code] = false;
});

// ============================================================
// SPRITE
// ============================================================
class SpriteAnimation {
  constructor(image, columns, rows, frameDuration = 100) {
    this.image = image;
    this.columns = columns;
    this.rows = rows;
    this.frameWidth = image.width / columns;
    this.frameHeight = image.height / rows;
    this.frame = 0;
    this.frameDuration = frameDuration;
    this.elapsed = 0;
    this.direction = 0;
  }

  update(dt, row, playing = true) {
    this.direction = row;
    if (!playing) return;

    this.elapsed += dt;
    if (this.elapsed >= this.frameDuration) {
      this.elapsed = 0;
      this.frame = (this.frame + 1) % this.columns;
    }
  }

  draw(x, y, width, height) {
    context.drawImage(
      this.image,
      this.frame * this.frameWidth,
      this.direction * this.frameHeight,
      this.frameWidth,
      this.frameHeight,
      x,
      y,
      width,
      height
    );
  }
}

// ============================================================
// JOGADOR
// ============================================================
class Player {
  constructor() {
    this.width = PLAYER_SIZE;
    this.height = PLAYER_SIZE;
    this.footRadius = PLAYER_FOOT_RADIUS;
    this.x = WORLD.width / 2 - this.width / 2;
    this.y = WORLD.height / 2 - this.height / 2;
    this.speed = 220;
    this.life = 100;
    this.maxLife = 100;
    this.direction = 0;
    this.attacking = false;
    this.attackTime = 0;
    this.attackDuration = 430;
    this.attackCooldown = 0;
    this.invulnerable = 0;

    this.walk = new SpriteAnimation(images.playerWalk, 12, 4, 80);
    this.attackAnimation = new SpriteAnimation(images.playerAttack, 8, 4, 55);
  }

  update(dt) {
    if (this.invulnerable > 0) this.invulnerable -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    let dx = 0;
    let dy = 0;

    if (keys.KeyW) { dy -= 1; this.direction = 3; }
    if (keys.KeyS) { dy += 1; this.direction = 0; }
    if (keys.KeyA) { dx -= 1; this.direction = 1; }
    if (keys.KeyD) { dx += 1; this.direction = 2; }

    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      dx /= length;
      dy /= length;
      this.x += dx * this.speed * dt / 1000;
      this.y += dy * this.speed * dt / 1000;
    }

    resolveCollisions(this);
    clampToWorld(this);

    if (this.attacking) {
      this.attackTime -= dt;
      this.attackAnimation.update(dt, this.direction, true);
      if (this.attackTime <= 0) this.attacking = false;
    } else {
      this.walk.update(dt, this.direction, dx !== 0 || dy !== 0);
    }
  }

  attack() {
    if (this.attackCooldown > 0 || this.attacking) return;
    this.attacking = true;
    this.attackTime = this.attackDuration;
    this.attackCooldown = 520;
    this.attackAnimation.frame = 0;
    this.attackAnimation.elapsed = 0;

    // O dano acontece no meio da animação.
    setTimeout(() => {
      if (!gameOver) checkPlayerAttack();
    }, 170);
  }

  draw() {
    // Pequeno efeito de piscar quando recebe dano.
    if (this.invulnerable > 0 && Math.floor(this.invulnerable / 70) % 2 === 0) return;

    if (this.attacking) {
      this.attackAnimation.draw(this.x, this.y + HUD_HEIGHT, this.width, this.height);
    } else {
      this.walk.draw(this.x, this.y + HUD_HEIGHT, this.width, this.height);
    }
  }

  takeDamage(amount) {
    if (this.invulnerable > 0 || gameOver) return;
    this.life -= amount;
    this.invulnerable = 650;
    if (this.life <= 0) {
      this.life = 0;
      endGame();
    }
  }
}

// ============================================================
// ZUMBI
// ============================================================
// Inimigo genérico: o comportamento é o mesmo para todos os tipos; o que muda vem do perfil
// (ENEMY_PROFILES). Mantém o nome Zombie e a lista `zombies` por compatibilidade.
class Zombie {
  constructor(x, y, kind = 'zombie') {
    const profile = ENEMY_PROFILES[kind];
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.width = profile.size;
    this.height = profile.size;
    this.footRadius = profile.footRadius;
    this.footOffset = profile.footOffset;
    this.contentBottom = profile.contentBottom;
    this.nav = NAVS[kind];
    this.attackDistance = profile.attackDistance;
    this.bar = profile.bar;
    this.reward = profile.reward;
    this.attackSheet = profile.sprites.attackSheet;
    this.age = 0; // tempo de vida em ms, usado no efeito de surgimento

    // A cada onda os inimigos ficam um pouco mais fortes, mas o crescimento é controlado.
    const strength = Math.min(wave - 1, 12);
    const stats = profile.stats(strength);
    this.speed = stats.speed;
    this.life = stats.life;
    this.maxLife = this.life;
    this.damage = stats.damage;
    this.attackDelay = stats.attackDelay;

    this.direction = 0;
    this.attacking = false;
    this.attackTime = 0;
    this.attackCooldown = 0;
    this.dead = false;
    this.clearPath = true;  // há linha reta livre até o jogador?
    this.pathTimer = 0;     // a checagem é refeita a cada 120 ms, não a cada quadro

    this.walk = new SpriteAnimation(images[profile.sprites.walk], 6, 4, profile.sprites.walkMs);
    this.attackAnimation = new SpriteAnimation(images[profile.sprites.attack], 6, 4, profile.sprites.attackMs);
  }

  update(dt) {
    if (this.dead) return;
    this.age += dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // Distâncias medidas entre os pés, para valer igual a qualquer tamanho de sprite.
    const playerFoot = getFoot(player);
    const selfFoot = getFoot(this);
    let dx = playerFoot.x - selfFoot.x;
    let dy = playerFoot.y - selfFoot.y;
    const distance = Math.hypot(dx, dy);

    if (distance > 0) {
      dx /= distance;
      dy /= distance;
    }

    // Direção do movimento: reta até o jogador ou, se houver obstáculo no meio, pelo caminho.
    let mx = dx;
    let my = dy;

    if (distance < this.attackDistance) {
      this.attacking = true;
      if (this.attackCooldown <= 0) {
        this.attackCooldown = this.attackDelay;
        player.takeDamage(this.damage);
      }
    } else {
      this.attacking = false;

      this.pathTimer -= dt;
      if (this.pathTimer <= 0) {
        this.pathTimer = 120;
        this.clearPath = hasClearPath(getFoot(this), getFoot(player), getFoot(this).r + 1);
      }
      if (!this.clearPath) {
        const route = pathDirection(this);
        if (route) {
          mx = route.x;
          my = route.y;
        }
      }

      const step = this.speed * dt / 1000;
      this.x += mx * step;
      this.y += my * step;
      resolveCollisions(this); // se ainda encostar em algo, apenas desliza pela borda
    }

    // O zumbi olha para onde anda; ao atacar, olha para o jogador.
    const lookX = this.attacking ? dx : mx;
    const lookY = this.attacking ? dy : my;
    if (Math.abs(lookX) > Math.abs(lookY)) {
      this.direction = lookX < 0 ? 1 : 2;
    } else {
      this.direction = lookY < 0 ? 3 : 0;
    }

    clampToWorld(this);

    if (this.attacking) {
      this.attackTime += dt;
      this.attackAnimation.update(dt, this.direction, true);
    } else {
      this.walk.update(dt, this.direction, true);
    }
  }

  takeDamage(amount) {
    if (this.dead) return;
    this.life -= amount;
    if (this.life <= 0) {
      this.life = 0;
      this.dead = true;
      score += this.reward.score * wave;
      coins += this.reward.coins;
      enemiesDefeated++;
      // A onda só avança quando todos os zumbis dela forem derrotados (ver updateWave).
    }
  }

  draw() {
    if (this.dead) return;

    context.save();
    context.globalAlpha = Math.min(1, this.age / 450); // surge com um fade-in curto
    const sprite = this.attacking ? this.attackAnimation : this.walk;
    if (this.attacking && this.attackSheet) {
      // A folha de ataque tem células maiores; mantém a mesma escala e o mesmo ponto de apoio.
      const k = this.width / 256;
      const sheet = this.attackSheet;
      sprite.draw(this.x - sheet.padX * k, this.y + HUD_HEIGHT - sheet.padTop * k, sheet.cellW * k, sheet.cellH * k);
    } else {
      sprite.draw(this.x, this.y + HUD_HEIGHT, this.width, this.height);
    }

    // Barra de vida do inimigo.
    const barWidth = this.bar.width;
    const barHeight = this.bar.height;
    const barX = this.x + (this.width - barWidth) / 2;
    const barY = this.y + HUD_HEIGHT + this.bar.offsetY;

    context.fillStyle = '#1a1a1a';
    context.fillRect(barX, barY, barWidth, barHeight);
    context.fillStyle = '#e53935';
    context.fillRect(barX, barY, barWidth * (this.life / this.maxLife), barHeight);
    context.restore();
  }
}

// ============================================================
// INSTÂNCIAS
// ============================================================
let player;
let zombies = [];

// Pontos de spawn livres para cada tipo (o monstro é maior e precisa de mais espaço). Calculado uma vez.
const SPAWN_SPOTS = {};
function spawnSpotsFor(kind) {
  if (!SPAWN_SPOTS[kind]) {
    const profile = ENEMY_PROFILES[kind];
    const nav = NAVS[kind];
    SPAWN_SPOTS[kind] = OPEN_SPOTS.filter(([cx, cy]) => {
      const footY = cy + ZOMBIE_SIZE * 0.16;
      return footIsFree(cx, footY, profile.footRadius + 1) && nav.walkable[nav.index(cx, footY)];
    });
    if (SPAWN_SPOTS[kind].length === 0) SPAWN_SPOTS[kind] = OPEN_SPOTS;
  }
  return SPAWN_SPOTS[kind];
}

function randomSpawnPosition(kind = 'zombie') {
  // Sorteia um ponto livre do mapa, longe do jogador e de outros inimigos. Retorna o canto do sprite.
  const profile = ENEMY_PROFILES[kind];
  const playerFoot = getFoot(player);
  const footOf = ([cx, cy]) => ({ x: cx, y: cy + ZOMBIE_SIZE * 0.16 });

  const spots = spawnSpotsFor(kind);
  const farFromPlayer = spots.filter(spot => {
    const f = footOf(spot);
    return Math.hypot(f.x - playerFoot.x, f.y - playerFoot.y) > 230;
  });
  const notCrowded = farFromPlayer.filter(spot => {
    const f = footOf(spot);
    return zombies.every(z => { const zf = getFoot(z); return Math.hypot(f.x - zf.x, f.y - zf.y) > ZOMBIE_SIZE; });
  });

  const list = notCrowded.length ? notCrowded : (farFromPlayer.length ? farFromPlayer : spots);
  const chosen = list[Math.floor(Math.random() * list.length)];
  const foot = footOf(chosen);
  return [foot.x - profile.size / 2, foot.y - profile.size * profile.footOffset];
}

// Quantos zumbis e monstros tem a onda `n` (o total vem de WAVE_RULES.zombiesFor).
function waveComposition(n) {
  const total = WAVE_RULES.zombiesFor(n);
  let monsters = 0;
  if (n >= MONSTER_RULES.firstWave) {
    monsters = MONSTER_RULES.startCount + (n - MONSTER_RULES.firstWave) * MONSTER_RULES.perWave;
    monsters = Math.min(monsters, Math.floor(total * MONSTER_RULES.maxShare));
  }
  return { zombies: total - monsters, monsters };
}

// Lista embaralhada com a ordem de surgimento, para os monstros virem misturados aos zumbis.
function buildSpawnQueue(n) {
  const { zombies: z, monsters: m } = waveComposition(n);
  const queue = [...Array(z).fill('zombie'), ...Array(m).fill('monster')];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue;
}

// Inicia uma onda: mostra o aviso e define quantos zumbis ela terá.
// Os zumbis só começam a surgir depois que o aviso termina.
function beginWave(waveNumber) {
  wave = waveNumber;
  waveState = 'intro';
  waveSpawnQueue = buildSpawnQueue(waveNumber);
  waveTimer = 0;
  onWaveStart(waveNumber);
}

function updateWave(dt) {
  switch (waveState) {
    case 'intro':
      if (!waveBanner.active) {
        waveState = 'spawning';
        waveTimer = 0;
      }
      break;

    case 'spawning':
      waveTimer -= dt;
      if (waveTimer <= 0) {
        const kind = waveSpawnQueue.pop();
        const [x, y] = randomSpawnPosition(kind);
        zombies.push(new Zombie(x, y, kind));
        waveTimer = WAVE_RULES.spawnInterval;
        if (waveSpawnQueue.length === 0) waveState = 'fighting';
      }
      break;

    case 'fighting':
      // Só passa para a próxima onda quando não resta nenhum zumbi vivo.
      if (zombies.length === 0) {
        waveState = 'cleared';
        waveTimer = WAVE_RULES.clearDelay;
      }
      break;

    case 'cleared':
      waveTimer -= dt;
      if (waveTimer <= 0) beginWave(wave + 1);
      break;
  }
}

// Impede que zumbis fiquem empilhados no mesmo ponto.
function separateZombies() {
  for (let i = 0; i < zombies.length; i++) {
    for (let j = i + 1; j < zombies.length; j++) {
      const a = zombies[i];
      const b = zombies[j];
      const fa = getFoot(a);
      const fb = getFoot(b);
      let dx = fb.x - fa.x;
      let dy = fb.y - fa.y;
      let dist = Math.hypot(dx, dy);
      const minDist = fa.r + fb.r + 6;
      if (dist >= minDist) continue;

      if (dist < 0.001) {
        const angle = Math.random() * Math.PI * 2;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        dist = 1;
      }
      const push = (minDist - dist) / 2;
      a.x -= (dx / dist) * push;
      a.y -= (dy / dist) * push;
      b.x += (dx / dist) * push;
      b.y += (dy / dist) * push;
    }
  }
  // O empurrão nunca pode jogar um zumbi para dentro de um obstáculo.
  zombies.forEach(z => {
    resolveCollisions(z);
    clampToWorld(z);
  });
}

// ============================================================
// COLISÃO / ATAQUE
// ============================================================
function distanceBetween(a, b) {
  // Entre os pés, para o alcance valer igual a qualquer tamanho de sprite.
  const fa = getFoot(a);
  const fb = getFoot(b);
  return Math.hypot(fa.x - fb.x, fa.y - fb.y);
}

function checkPlayerAttack() {
  zombies.forEach(zombie => {
    if (!zombie.dead && distanceBetween(player, zombie) <= PLAYER_ATTACK_RANGE) {
      zombie.takeDamage(20);
    }
  });
}

// ============================================================
// FUNDO / HUD
// ============================================================
function drawMap() {
  context.drawImage(
    images.map,
    MAP_SOURCE.x,
    MAP_SOURCE.y,
    MAP_SOURCE.width,
    MAP_SOURCE.height,
    0,
    HUD_HEIGHT,
    WORLD.width,
    WORLD.height
  );
}

// Redesenha um pedaço do mapa na mesma posição em que ele já foi desenhado.
function drawMapRegion(x, y, w, h) {
  const kx = MAP_SOURCE.width / WORLD.width;
  const ky = MAP_SOURCE.height / WORLD.height;
  context.drawImage(
    images.map,
    MAP_SOURCE.x + x * kx, MAP_SOURCE.y + y * ky, w * kx, h * ky,
    x, y + HUD_HEIGHT, w, h
  );
}

// A copa é redesenhada por cima de quem está atrás do tronco, dando a noção de profundidade.
function drawTreeCrown(tree) {
  const { cx, cy, rx, ry } = tree.crown;
  const x0 = Math.max(0, cx - rx);
  const y0 = Math.max(0, cy - ry);
  const x1 = Math.min(WORLD.width, cx + rx);
  const y1 = Math.min(WORLD.height, cy + ry);

  context.save();
  context.beginPath();
  context.ellipse(cx, cy + HUD_HEIGHT, rx * 0.92, ry * 0.92, 0, 0, Math.PI * 2);
  context.clip();
  drawMapRegion(x0, y0, x1 - x0, y1 - y0);
  context.restore();
}

// Desenha zumbis, jogador e copas das árvores ordenados pela posição dos pés.
function drawWorldObjects() {
  const items = [
    ...zombies.map(z => ({ y: getFoot(z).y, draw: () => z.draw() })),
    { y: getFoot(player).y, draw: () => player.draw() },
    ...TREES.map(t => ({ y: t.sortY, draw: () => drawTreeCrown(t) }))
  ];
  items.sort((a, b) => a.y - b.y);
  items.forEach(item => item.draw());
}

function drawColliders() {
  context.save();
  context.lineWidth = 2;
  context.strokeStyle = 'rgba(255, 0, 255, 0.9)';
  context.fillStyle = 'rgba(255, 0, 255, 0.18)';

  OBSTACLES.forEach(o => {
    context.beginPath();
    if (o.type === 'circle') {
      context.arc(o.x, o.y + HUD_HEIGHT, o.r, 0, Math.PI * 2);
    } else {
      o.points.forEach(([x, y], i) => (i ? context.lineTo(x, y + HUD_HEIGHT) : context.moveTo(x, y + HUD_HEIGHT)));
      context.closePath();
    }
    context.fill();
    context.stroke();
  });

  context.strokeStyle = 'rgba(0, 255, 255, 0.95)';
  [player, ...zombies].forEach(e => {
    const foot = getFoot(e);
    context.beginPath();
    context.arc(foot.x, foot.y + HUD_HEIGHT, foot.r, 0, Math.PI * 2);
    context.stroke();
  });
  context.restore();
}

function drawHeart(x, y, size) {
  context.save();
  context.fillStyle = '#ef3030';
  context.strokeStyle = '#571010';
  context.lineWidth = 2;
  context.beginPath();
  const top = y + size * 0.25;
  context.moveTo(x + size / 2, y + size);
  context.bezierCurveTo(x, y + size * 0.62, x, top, x + size * 0.25, top);
  context.bezierCurveTo(x + size * 0.43, top, x + size / 2, top + size * 0.18, x + size / 2, top + size * 0.18);
  context.bezierCurveTo(x + size / 2, top + size * 0.18, x + size * 0.57, top, x + size * 0.75, top);
  context.bezierCurveTo(x + size, top, x + size, y + size * 0.62, x + size / 2, y + size);
  context.fill();
  context.stroke();
  context.restore();
}

function drawHUD() {
  context.fillStyle = '#08090d';
  context.fillRect(0, 0, canvas.width, HUD_HEIGHT);

  const fullHearts = 5;
  const hearts = Math.ceil(player.life / 20);
  for (let i = 0; i < fullHearts; i++) {
    if (i < hearts) drawHeart(25 + i * 40, 17, 30);
  }

  context.fillStyle = 'white';
  context.font = 'bold 28px Arial';
  context.fillText(`Vida: ${player.life}`, 235, 50);

  context.fillStyle = '#65d83b';
  context.font = 'bold 32px Arial';
  context.fillText('♦', 515, 50);
  context.fillStyle = 'white';
  context.font = 'bold 28px Arial';
  context.fillText(`x ${crystals}`, 550, 50);

  context.fillStyle = '#ffd32a';
  context.font = 'bold 32px Arial';
  context.fillText('●', 690, 50);
  context.fillStyle = 'white';
  context.font = 'bold 28px Arial';
  context.fillText(`x ${coins}`, 730, 50);

  context.fillStyle = '#ddd';
  context.font = 'bold 20px Arial';
  context.fillText(`Pontuação: ${score}`, 900, 50);
  context.fillText(`Onda: ${wave}`, 1130, 50);
}

// ============================================================
// CORAÇÕES DE CURA
// ============================================================
// Onda em que cai o n-ésimo coração: n(n+3)/2 -> 2, 5, 9, 14, 20, 27...
function heartDropWave(n) {
  return (n * (n + 3)) / 2;
}

// Centraliza tudo o que acontece quando uma onda começa.
function onWaveStart(waveNumber) {
  startWaveBanner(waveNumber);

  // O while garante que nenhum drop se perca caso a onda avance mais de uma vez.
  while (waveNumber >= nextHeartWave) {
    spawnHeart();
    heartsDropped++;
    nextHeartWave = heartDropWave(heartsDropped + 1);
  }
}

function spawnHeart() {
  const playerCenter = {
    x: player.x + player.width / 2,
    y: player.y + player.height / 2
  };

  const free = OPEN_SPOTS.filter(([x, y]) => {
    const farFromPlayer = Math.hypot(x - playerCenter.x, y - playerCenter.y) >= HEART_PICKUP.minDistanceFromPlayer;
    const notOccupied = heartPickups.every(h => Math.hypot(h.x - x, h.y - y) > HEART_PICKUP.size * 2);
    return farFromPlayer && notOccupied;
  });

  const spots = free.length ? free : OPEN_SPOTS;
  const [x, y] = spots[Math.floor(Math.random() * spots.length)];
  heartPickups.push({ x, y });
}

function updateHearts(dt) {
  heartClock += dt;

  // O coração só é coletado se o jogador precisar de vida; caso contrário, fica no chão.
  if (player.life < player.maxLife) {
    const playerCx = player.x + player.width / 2;
    const playerCy = player.y + player.height / 2;

    for (let i = heartPickups.length - 1; i >= 0; i--) {
      const heart = heartPickups[i];
      if (Math.hypot(heart.x - playerCx, heart.y - playerCy) > HEART_PICKUP.pickupDistance) continue;

      const healed = Math.min(HEART_PICKUP.heal, player.maxLife - player.life);
      player.life += healed;
      floatingTexts.push({ x: heart.x, y: heart.y, text: `+${healed} HP`, elapsed: 0 });
      heartPickups.splice(i, 1);
      if (player.life >= player.maxLife) break;
    }
  }

  floatingTexts.forEach(t => { t.elapsed += dt; });
  floatingTexts = floatingTexts.filter(t => t.elapsed < 900);
}

function drawHearts() {
  heartPickups.forEach(heart => {
    const bob = Math.sin(heartClock / 280) * 4;
    const size = HEART_PICKUP.size;
    const screenY = heart.y + HUD_HEIGHT;

    // Sombra no chão (diminui levemente quando o coração sobe).
    context.save();
    context.fillStyle = `rgba(0, 0, 0, ${0.28 - bob * 0.015})`;
    context.beginPath();
    context.ellipse(heart.x, screenY + size / 2 + 4, size * 0.4, size * 0.14, 0, 0, Math.PI * 2);
    context.fill();

    // Brilho pulsante para destacar o item no cenário.
    context.shadowColor = 'rgba(255, 90, 90, 0.9)';
    context.shadowBlur = 12 + Math.sin(heartClock / 280) * 4;
    drawHeart(heart.x - size / 2, screenY - size / 2 - 6 + bob, size);
    context.restore();
  });
}

function drawFloatingTexts() {
  floatingTexts.forEach(t => {
    const progress = t.elapsed / 900;
    context.save();
    context.globalAlpha = 1 - progress;
    context.textAlign = 'center';
    context.font = 'bold 24px Arial';
    context.lineWidth = 4;
    context.strokeStyle = 'black';
    context.fillStyle = '#7dff7d';
    const y = t.y + HUD_HEIGHT - 30 - progress * 40;
    context.strokeText(t.text, t.x, y);
    context.fillText(t.text, t.x, y);
    context.restore();
  });
}

// ============================================================
// AVISO DE NOVA ONDA
// ============================================================
function startWaveBanner(waveNumber) {
  // Se uma nova onda começar com o aviso anterior ainda visível, ele é reiniciado.
  waveBanner = { active: true, elapsed: 0, wave: waveNumber };
}

function updateWaveBanner(dt) {
  if (!waveBanner.active) return;
  waveBanner.elapsed += dt;
  if (waveBanner.elapsed >= WAVE_BANNER.duration) waveBanner.active = false;
}

const easeOutSine = t => Math.sin((t * Math.PI) / 2);

function drawWaveBanner() {
  if (!waveBanner.active) return;

  const t = Math.min(waveBanner.elapsed / WAVE_BANNER.duration, 1);

  // Opacidade: aparece, permanece e some suavemente.
  let alpha = 1;
  if (t < WAVE_BANNER.fadeIn) {
    alpha = t / WAVE_BANNER.fadeIn;
  } else if (t > 1 - WAVE_BANNER.fadeOut) {
    alpha = (1 - t) / WAVE_BANNER.fadeOut;
  }

  // Movimento: sobe devagar, desacelerando ao final.
  const offsetY = WAVE_BANNER.riseDistance / 2 - WAVE_BANNER.riseDistance * easeOutSine(t);
  const y = WAVE_BANNER.centerY + offsetY;

  context.save();
  context.globalAlpha = alpha;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';

  context.font = 'bold 76px Arial';
  context.lineWidth = 8;
  context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  context.fillStyle = '#ffd32a';
  context.strokeText(`ONDA ${waveBanner.wave}`, canvas.width / 2, y);
  context.fillText(`ONDA ${waveBanner.wave}`, canvas.width / 2, y);
  context.restore();
}

function drawPause() {
  context.fillStyle = 'rgba(0,0,0,.55)';
  context.fillRect(0, HUD_HEIGHT, canvas.width, WORLD.height);
  context.fillStyle = 'white';
  context.strokeStyle = 'black';
  context.lineWidth = 5;
  context.font = 'bold 64px Arial';
  context.textAlign = 'center';
  context.strokeText('PAUSADO', canvas.width / 2, 330);
  context.fillText('PAUSADO', canvas.width / 2, 330);
  context.font = '22px Arial';
  context.fillText('Pressione ENTER para continuar', canvas.width / 2, 375);
  context.textAlign = 'left';
}

function drawGameOver() {
  context.fillStyle = 'rgba(0,0,0,.65)';
  context.fillRect(0, HUD_HEIGHT, canvas.width, WORLD.height);
  context.fillStyle = 'white';
  context.strokeStyle = 'black';
  context.lineWidth = 6;
  context.textAlign = 'center';
  context.font = 'bold 72px Arial';
  context.strokeText('GAME OVER', canvas.width / 2, 330);
  context.fillText('GAME OVER', canvas.width / 2, 330);
  context.font = '24px Arial';
  context.fillText(`Pontuação: ${score}`, canvas.width / 2, 380);
  context.fillText('Pressione R para reiniciar', canvas.width / 2, 425);
  context.textAlign = 'left';
}

// ============================================================
// JOGO
// ============================================================
function update(dt) {
  if (paused || gameOver) return;
  player.update(dt);
  updateFlowField(dt);
  zombies.forEach(zombie => zombie.update(dt));
  separateZombies();
  zombies = zombies.filter(zombie => !zombie.dead);
  updateHearts(dt);
  updateWaveBanner(dt);
  updateWave(dt);
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawMap();
  drawHearts();
  drawWorldObjects();
  if (DEBUG_COLLIDERS) drawColliders();
  drawFloatingTexts();
  drawHUD();
  drawWaveBanner();

  if (paused) drawPause();
  if (gameOver) drawGameOver();
}

function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min(timestamp - lastTime, 50);
  lastTime = timestamp;
  update(dt);
  draw();
  requestAnimationFrame(gameLoop);
}

function endGame() {
  gameOver = true;
  paused = false;
  waveBanner.active = false;
}

function restartGame() {
  score = 0;
  crystals = 0;
  coins = 0;
  enemiesDefeated = 0;
  wave = 1;
  gameOver = false;
  paused = false;
  player = new Player();
  zombies = [];
  navTimer = 0;
  waveSpawnQueue = [];
  heartPickups = [];
  floatingTexts = [];
  heartsDropped = 0;
  nextHeartWave = heartDropWave(1);
  beginWave(1);
}

loadImages(() => {
  restartGame();
  requestAnimationFrame(gameLoop);
});
