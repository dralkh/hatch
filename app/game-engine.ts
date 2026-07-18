import { generateEndlessRoom, type EndlessEnemyKind, type EndlessRoom } from "./endless-generator.ts";

export const GAME_LEVEL_VERSION = 3;
export const GAME_VIEW_W = 960;
export const GAME_VIEW_H = 540;
export const GAME_WORLD_W = 2880;
export const PLAYER_W = 46;
export const PLAYER_H = 76;
export const HATCH_DURATION_MS = 1992;

export type GameMode = "story" | "endless";
export type GameDifficulty = "explorer" | "adventure" | "expert";
export type WeaponId = "wisp-bolt" | "moon-arc" | "beacon-pulse";
export type GameBadge = "steady-heart" | "glowkeeper" | "sky-runner" | "triune-heart";
export type StoryRecord = { bestTimeMs?: number; badges: GameBadge[]; completions: number };
export type EndlessRecord = { bestScore: number; bestRooms: number; bestSeed?: number; runs: number };
export type LegacyGameRecord = { levelVersion: number; bestTimeMs?: number; badges: GameBadge[]; completions: number };
export type GameRecord = {
  levelVersion: typeof GAME_LEVEL_VERSION;
  story: Partial<Record<GameDifficulty, StoryRecord>>;
  endless: Partial<Record<GameDifficulty, EndlessRecord>>;
  legacy?: LegacyGameRecord;
};
export type StoryResult = {
  mode: "story";
  difficulty: GameDifficulty;
  elapsedMs: number;
  failures: number;
  glowbits: number;
  cleansed: number;
  usedRiskyShortcut: boolean;
  badges: GameBadge[];
};
export type EndlessResult = {
  mode: "endless";
  difficulty: GameDifficulty;
  elapsedMs: number;
  score: number;
  rooms: number;
  cleansed: number;
  seed: number;
};
export type GameResult = StoryResult | EndlessResult;
export type GamePhase = "hatching" | "playing" | "failed" | "upgrade" | "won" | "gameover";
export type InteractionKind = "wave" | "wait" | "review" | "work" | "sanctuary";
export type GameInput = {
  left: boolean;
  right: boolean;
  jump: boolean;
  interact: boolean;
  fire: boolean;
  nextWeapon: boolean;
  weaponSelect: WeaponId | null;
};
export type UpgradeId =
  | "bolt-tempo" | "bolt-force" | "bolt-fork"
  | "arc-tempo" | "arc-width" | "arc-return"
  | "pulse-tempo" | "pulse-radius" | "pulse-aegis"
  | "field-mend" | "field-shield" | "field-score";
export type GameEvent =
  | { type: "hatched" | "jump" | "wisp" | "charged" | "reviewed" | "shield-broken" | "failed" | "glowbit" | "beacon" | "won" | "fired" | "enemy-hit" | "enemy-cleansed" | "player-hit" | "room-entered" | "upgrade" | "gameover" }
  | { type: "hint"; segment: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Platform = Rect & { shortcut?: boolean; moving?: "x" | "y"; amplitude?: number; speed?: number; phase?: number };
export type Hazard = Rect & { axis: "x" | "y"; amplitude: number; speed: number; phase: number };
export type Enemy = Rect & {
  id: string;
  kind: EndlessEnemyKind;
  room: number;
  originX: number;
  hp: number;
  maxHp: number;
  vx: number;
  cooldownMs: number;
  phase: number;
  armored: boolean;
};
export type Projectile = Rect & {
  id: number;
  owner: "player" | "enemy";
  weapon?: WeaponId;
  vx: number;
  vy: number;
  damage: number;
  remainingMs: number;
  hitIds: Set<string>;
};

export const DIFFICULTY_CONFIG = {
  explorer: { hearts: 4, enemyBudget: 0.75, enemySpeed: 0.9, hazardSpeed: 0.9, hintFailures: 2 },
  adventure: { hearts: 3, enemyBudget: 1, enemySpeed: 1, hazardSpeed: 1, hintFailures: 3 },
  expert: { hearts: 2, enemyBudget: 1.3, enemySpeed: 1.15, hazardSpeed: 1.15, hintFailures: 4 },
} satisfies Record<GameDifficulty, { hearts: number; enemyBudget: number; enemySpeed: number; hazardSpeed: number; hintFailures: number }>;

export type GameWorld = {
  mode: GameMode;
  difficulty: GameDifficulty;
  seed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  standingPlatform: number | null;
  facing: 1 | -1;
  phase: GamePhase;
  hatchElapsedMs: number;
  elapsedMs: number;
  failures: number;
  failRemainingMs: number;
  checkpoint: { x: number; y: number };
  hearts: number;
  maxHearts: number;
  shield: 0 | 1;
  invulnerableMs: number;
  wispRecruited: boolean;
  moonwellCharged: boolean;
  reviewed: boolean;
  revealRemainingMs: number;
  repaired: boolean[];
  glowbits: Set<string>;
  usedRiskyShortcut: boolean;
  interaction: InteractionKind | null;
  interactionProgressMs: number;
  gesture: InteractionKind | null;
  gestureRemainingMs: number;
  segmentFailures: number[];
  hintSegment: number | null;
  selectedWeapon: WeaponId;
  unlockedWeapons: Set<WeaponId>;
  weaponCooldowns: Record<WeaponId, number>;
  globalFireLockMs: number;
  weaponsUsed: Set<WeaponId>;
  projectiles: Projectile[];
  enemies: Enemy[];
  cleansed: number;
  guardianCleaned: boolean;
  endlessRooms: EndlessRoom[];
  spawnedRooms: Set<number>;
  clearedRooms: Set<number>;
  roomIndex: number;
  roomsCleared: number;
  score: number;
  combo: number;
  pendingUpgrades: UpgradeId[];
  upgradeStacks: Partial<Record<UpgradeId, number>>;
  projectileSerial: number;
  result?: GameResult;
};

export const BASE_PLATFORMS: Platform[] = [
  { x: 0, y: 480, width: 920, height: 60 }, { x: 980, y: 480, width: 850, height: 60 }, { x: 1900, y: 480, width: 980, height: 60 },
  { x: 150, y: 390, width: 170, height: 18 }, { x: 480, y: 350, width: 150, height: 18 }, { x: 750, y: 398, width: 130, height: 18 },
  { x: 1030, y: 382, width: 165, height: 18 }, { x: 1240, y: 315, width: 150, height: 18 }, { x: 1465, y: 385, width: 170, height: 18 },
  { x: 1680, y: 330, width: 120, height: 18 }, { x: 1960, y: 390, width: 160, height: 18 }, { x: 2220, y: 350, width: 150, height: 18 },
  { x: 2470, y: 390, width: 170, height: 18 }, { x: 2680, y: 315, width: 135, height: 18 },
  { x: 920, y: 425, width: 70, height: 16, moving: "y", amplitude: 38, speed: 0.0021, phase: 0 },
  { x: 1825, y: 425, width: 82, height: 16, moving: "y", amplitude: 42, speed: 0.0018, phase: 1.2 },
];
export const SHORTCUT_PLATFORMS: Platform[] = [
  { x: 1190, y: 225, width: 120, height: 15, shortcut: true }, { x: 1360, y: 185, width: 118, height: 15, shortcut: true, moving: "x", amplitude: 24, speed: 0.002, phase: 0.5 },
  { x: 1530, y: 225, width: 120, height: 15, shortcut: true }, { x: 2110, y: 245, width: 120, height: 15, shortcut: true },
  { x: 2280, y: 205, width: 120, height: 15, shortcut: true, moving: "y", amplitude: 28, speed: 0.0022, phase: 1 }, { x: 2450, y: 245, width: 120, height: 15, shortcut: true },
];
export const HAZARDS: Hazard[] = [
  { x: 1040, y: 444, width: 34, height: 36, axis: "x", amplitude: 105, speed: 0.0016, phase: 0 },
  { x: 1520, y: 349, width: 34, height: 36, axis: "x", amplitude: 72, speed: 0.0021, phase: 1.8 },
  { x: 2050, y: 444, width: 36, height: 36, axis: "x", amplitude: 130, speed: 0.0018, phase: 0.7 },
  { x: 2380, y: 300, width: 34, height: 34, axis: "y", amplitude: 65, speed: 0.002, phase: 2.4 },
  { x: 2670, y: 444, width: 36, height: 36, axis: "x", amplitude: 72, speed: 0.0024, phase: 1.1 },
];
export const GLOWBITS = [{ x: 275, y: 350 }, { x: 1310, y: 270 }, { x: 1420, y: 140 }, { x: 2325, y: 158 }, { x: 2745, y: 270 }];
export const WISP = { x: 355, y: 424 };
export const MOONWELLS = [{ x: 675, y: 430 }, { x: 2015, y: 430 }];
export const RUNE = { x: 1110, y: 425 };
export const BEACONS = [{ x: 830, y: 420 }, { x: 1740, y: 270 }, { x: 2550, y: 330 }];
export const SANCTUARY = { x: 2790, y: 255 };

const interactionDurations: Record<InteractionKind, number> = { wave: 0, wait: 1250, review: 900, work: 1500, sanctuary: 0 };
const weaponOrder: WeaponId[] = ["wisp-bolt", "moon-arc", "beacon-pulse"];
const upgradePool: UpgradeId[] = ["bolt-tempo", "bolt-force", "bolt-fork", "arc-tempo", "arc-width", "arc-return", "pulse-tempo", "pulse-radius", "pulse-aegis"];

function enemySize(kind: EndlessEnemyKind) {
  if (kind === "flock") return { width: 25, height: 25, hp: 1 };
  if (kind === "shell") return { width: 48, height: 43, hp: 4 };
  if (kind === "spitter") return { width: 34, height: 42, hp: 2 };
  if (kind === "guardian") return { width: 88, height: 108, hp: 18 };
  return { width: 38, height: 38, hp: 2 };
}

function makeEnemy(kind: EndlessEnemyKind, x: number, y: number, room: number, serial: number): Enemy {
  const size = enemySize(kind);
  return { id: `${room}:${serial}:${kind}`, kind, room, x: x - size.width / 2, y: y - size.height, originX: x, width: size.width, height: size.height, hp: size.hp, maxHp: size.hp, vx: kind === "drifter" ? 58 : kind === "shell" ? 35 : 0, cooldownMs: 700 + serial * 170, phase: serial * 1.7, armored: kind === "shell" };
}

function storyEnemies(difficulty: GameDifficulty) {
  let placements: Array<[EndlessEnemyKind, number, number]> = [
    ["drifter", 570, 480], ["flock", 790, 375], ["spitter", 1380, 315], ["flock", 1550, 350],
    ["shell", 2070, 480], ["spitter", 2310, 350], ["flock", 2500, 350], ["guardian", 2760, 315],
  ];
  if (difficulty === "explorer") placements = placements.filter((_, index) => index !== 1 && index !== 5);
  if (difficulty === "expert") placements = [...placements, ["flock", 900, 360], ["drifter", 1820, 480], ["shell", 2600, 390]];
  return placements.map(([kind, x, y], index) => makeEnemy(kind, x, y, Math.floor(x / 960), index));
}

function spawnEndlessRooms(world: GameWorld) {
  const min = Math.max(0, world.roomIndex - 2);
  const max = world.roomIndex + 5;
  world.endlessRooms = [];
  for (let index = min; index <= max; index += 1) {
    const room = generateEndlessRoom(world.seed, index, world.difficulty);
    world.endlessRooms.push(room);
    if (!world.spawnedRooms.has(index)) {
      room.spawns.forEach((spawn, spawnIndex) => world.enemies.push(makeEnemy(spawn.kind, spawn.x, spawn.y, index, spawnIndex)));
      world.spawnedRooms.add(index);
    }
  }
  world.enemies = world.enemies.filter((enemy) => enemy.room >= min && enemy.room <= max);
  world.projectiles = world.projectiles.filter((projectile) => projectile.x > min * GAME_VIEW_W - 100 && projectile.x < (max + 1) * GAME_VIEW_W + 100);
  for (const room of world.spawnedRooms) if (room < min) world.spawnedRooms.delete(room);
  for (const room of world.clearedRooms) if (room < min) world.clearedRooms.delete(room);
  for (const collectible of world.glowbits) {
    const room = collectible.startsWith("room:") ? Number(collectible.slice(5)) : Number.NaN;
    if (Number.isFinite(room) && room < min) world.glowbits.delete(collectible);
  }
}

export function createGameWorld(options: { mode?: GameMode; difficulty?: GameDifficulty; seed?: number } = {}): GameWorld {
  const mode = options.mode ?? "story";
  const difficulty = options.difficulty ?? "adventure";
  const maxHearts = DIFFICULTY_CONFIG[difficulty].hearts;
  const world: GameWorld = {
    mode, difficulty, seed: options.seed ?? 41721,
    x: 62, y: 404, vx: 0, vy: 0, grounded: true, standingPlatform: 0, facing: 1,
    phase: "hatching", hatchElapsedMs: 0, elapsedMs: 0, failures: 0, failRemainingMs: 0,
    checkpoint: { x: 62, y: 404 }, hearts: maxHearts, maxHearts, shield: 0, invulnerableMs: 0,
    wispRecruited: mode === "endless", moonwellCharged: mode === "endless", reviewed: mode === "endless", revealRemainingMs: 0,
    repaired: [false, false, false], glowbits: new Set(), usedRiskyShortcut: false,
    interaction: null, interactionProgressMs: 0, gesture: null, gestureRemainingMs: 0,
    segmentFailures: [0, 0, 0], hintSegment: null,
    selectedWeapon: "wisp-bolt", unlockedWeapons: new Set(mode === "endless" ? weaponOrder : []),
    weaponCooldowns: { "wisp-bolt": 0, "moon-arc": 0, "beacon-pulse": 0 }, globalFireLockMs: 0, weaponsUsed: new Set(),
    projectiles: [], enemies: mode === "story" ? storyEnemies(difficulty) : [], cleansed: 0, guardianCleaned: false,
    endlessRooms: [], spawnedRooms: new Set(), clearedRooms: new Set(), roomIndex: 0, roomsCleared: 0, score: 0, combo: 1,
    pendingUpgrades: [], upgradeStacks: {}, projectileSerial: 0,
  };
  if (mode === "endless") spawnEndlessRooms(world);
  return world;
}

export function currentSegment(world: GameWorld) {
  return world.mode === "endless" ? Math.abs(world.roomIndex) % 3 : Math.max(0, Math.min(2, Math.floor(world.x / 960)));
}

export function getPlatforms(world: GameWorld): Platform[] {
  if (world.mode === "endless") return world.endlessRooms.flatMap((room) => room.platforms);
  return world.reviewed || world.hintSegment !== null ? [...BASE_PLATFORMS, ...SHORTCUT_PLATFORMS] : BASE_PLATFORMS;
}

export function getHazards(world: GameWorld): Hazard[] {
  return world.mode === "endless" ? world.endlessRooms.flatMap((room) => room.hazards) : HAZARDS.map((hazard) => ({ ...hazard, speed: hazard.speed * DIFFICULTY_CONFIG[world.difficulty].hazardSpeed }));
}

export function getCollectibles(world: GameWorld) {
  if (world.mode === "story") return GLOWBITS.map((point, index) => ({ ...point, id: `story:${index}` }));
  return world.endlessRooms.flatMap((room) => room.collectible ? [{ ...room.collectible, id: `room:${room.index}` }] : []);
}

export function platformRect(platform: Platform, elapsedMs: number): Rect {
  const offset = Math.sin(elapsedMs * (platform.speed ?? 0) + (platform.phase ?? 0)) * (platform.amplitude ?? 0);
  return { x: platform.x + (platform.moving === "x" ? offset : 0), y: platform.y + (platform.moving === "y" ? offset : 0), width: platform.width, height: platform.height };
}

export function hazardRect(hazard: Hazard, elapsedMs: number): Rect {
  const offset = Math.sin(elapsedMs * hazard.speed + hazard.phase) * hazard.amplitude;
  return { x: hazard.x + (hazard.axis === "x" ? offset : 0), y: hazard.y + (hazard.axis === "y" ? offset : 0), width: hazard.width, height: hazard.height };
}

function near(world: GameWorld, point: { x: number; y: number }, radius = 72) {
  return Math.hypot(world.x + PLAYER_W / 2 - point.x, world.y + PLAYER_H / 2 - point.y) <= radius;
}

export function getContextAction(world: GameWorld): { kind: InteractionKind; label: string; durationMs: number; index?: number } | null {
  if (world.phase !== "playing" || world.mode === "endless") return null;
  if (!world.wispRecruited && near(world, WISP, 82)) return { kind: "wave", label: "Wave to the Wisp", durationMs: 0 };
  const moonwell = MOONWELLS.findIndex((point) => near(world, point, 78));
  if (moonwell >= 0 && (!world.moonwellCharged || world.shield === 0 || world.hearts < world.maxHearts)) return { kind: "wait", label: "Recover at moonwell", durationMs: interactionDurations.wait, index: moonwell };
  if (!world.reviewed && near(world, RUNE, 78)) return { kind: "review", label: "Review the rune", durationMs: interactionDurations.review };
  const beacon = BEACONS.findIndex((point, index) => !world.repaired[index] && near(world, point, 84) && !world.enemies.some((enemy) => enemy.room === index && enemy.kind !== "guardian"));
  if (beacon >= 0) return { kind: "work", label: `Restore beacon ${beacon + 1}`, durationMs: interactionDurations.work, index: beacon };
  if (world.repaired.every(Boolean) && world.guardianCleaned && near(world, SANCTUARY, 96)) return { kind: "sanctuary", label: "Awaken the sanctuary", durationMs: 0 };
  return null;
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function getClosedGates(world: GameWorld) {
  if (world.mode === "endless") {
    const roomHasEnemies = world.enemies.some((enemy) => enemy.room === world.roomIndex);
    return roomHasEnemies ? [(world.roomIndex + 1) * GAME_VIEW_W - 18] : [];
  }
  const gates: number[] = [];
  if (!world.wispRecruited) gates.push(445);
  if (!world.moonwellCharged) gates.push(735);
  if (!world.repaired[0]) gates.push(955);
  if (!world.reviewed) gates.push(1215);
  if (!world.repaired[1]) gates.push(1915);
  if (!world.repaired[2]) gates.push(2680);
  return gates;
}

function finishStory(world: GameWorld, events: GameEvent[]) {
  const badges: GameBadge[] = [];
  if (world.failures === 0) badges.push("steady-heart");
  if ([...world.glowbits].filter((id) => id.startsWith("story:")).length === GLOWBITS.length) badges.push("glowkeeper");
  if (world.usedRiskyShortcut) badges.push("sky-runner");
  if (world.weaponsUsed.size === weaponOrder.length) badges.push("triune-heart");
  world.phase = "won";
  world.result = { mode: "story", difficulty: world.difficulty, elapsedMs: Math.round(world.elapsedMs), failures: world.failures, glowbits: world.glowbits.size, cleansed: world.cleansed, usedRiskyShortcut: world.usedRiskyShortcut, badges };
  events.push({ type: "won" });
}

function applyInteraction(world: GameWorld, kind: InteractionKind, index: number | undefined, events: GameEvent[]) {
  if (kind === "wave") {
    world.wispRecruited = true; world.shield = 1; world.unlockedWeapons.add("wisp-bolt"); world.gesture = "wave"; world.gestureRemainingMs = 620; events.push({ type: "wisp" });
  } else if (kind === "wait") {
    world.moonwellCharged = true; world.shield = 1; world.hearts = world.maxHearts; events.push({ type: "charged" });
  } else if (kind === "review") {
    world.reviewed = true; world.unlockedWeapons.add("moon-arc"); world.revealRemainingMs = 10000; events.push({ type: "reviewed" });
  } else if (kind === "work" && typeof index === "number") {
    world.repaired[index] = true; world.checkpoint = { x: Math.max(40, BEACONS[index].x - 76), y: BEACONS[index].y - PLAYER_H }; world.hearts = world.maxHearts;
    if (index === 1) world.unlockedWeapons.add("beacon-pulse");
    events.push({ type: "beacon" });
  } else if (kind === "sanctuary") finishStory(world, events);
}

function failStory(world: GameWorld, events: GameEvent[]) {
  const segment = currentSegment(world);
  world.phase = "failed"; world.failRemainingMs = 850; world.failures += 1; world.elapsedMs += 5000; world.segmentFailures[segment] += 1;
  if (world.segmentFailures[segment] === DIFFICULTY_CONFIG[world.difficulty].hintFailures) { world.hintSegment = segment; events.push({ type: "hint", segment }); }
  world.vx = 0; world.vy = 0; world.grounded = false; world.standingPlatform = null; events.push({ type: "failed" });
}

function endEndless(world: GameWorld, events: GameEvent[]) {
  world.phase = "gameover";
  world.result = { mode: "endless", difficulty: world.difficulty, elapsedMs: Math.round(world.elapsedMs), score: world.score, rooms: world.roomsCleared, cleansed: world.cleansed, seed: world.seed };
  events.push({ type: "gameover" });
}

function hitPlayer(world: GameWorld, events: GameEvent[]) {
  if (world.invulnerableMs > 0) return;
  world.combo = 1;
  if (world.shield) { world.shield = 0; world.invulnerableMs = 1500; events.push({ type: "shield-broken" }); }
  else { world.hearts -= 1; world.invulnerableMs = 900; events.push({ type: "player-hit" }); }
  world.vx = -world.facing * 150; world.vy = -210; world.grounded = false; world.standingPlatform = null;
  if (world.hearts <= 0) { if (world.mode === "story") failStory(world, events); else endEndless(world, events); }
}

function stack(world: GameWorld, id: UpgradeId) { return world.upgradeStacks[id] ?? 0; }

function fireWeapon(world: GameWorld, events: GameEvent[]) {
  const weapon = world.selectedWeapon;
  if (!world.unlockedWeapons.has(weapon) || world.globalFireLockMs > 0 || world.weaponCooldowns[weapon] > 0) return;
  const direction = world.facing;
  const x = world.x + PLAYER_W / 2 + direction * 20;
  const y = world.y + 28;
  const serial = ++world.projectileSerial;
  if (weapon === "wisp-bolt") {
    const damage = 1 + Math.min(1, stack(world, "bolt-force"));
    world.projectiles.push({ id: serial, owner: "player", weapon, x, y, width: 18, height: 8, vx: direction * 620, vy: 0, damage, remainingMs: 1100, hitIds: new Set() });
    if (stack(world, "bolt-fork")) world.projectiles.push({ id: ++world.projectileSerial, owner: "player", weapon, x, y, width: 14, height: 7, vx: direction * 560, vy: -95, damage: 1, remainingMs: 900, hitIds: new Set() });
    world.weaponCooldowns[weapon] = 240 * Math.max(0.55, 1 - stack(world, "bolt-tempo") * 0.15);
  } else if (weapon === "moon-arc") {
    const width = 42 * (1 + stack(world, "arc-width") * 0.3);
    world.projectiles.push({ id: serial, owner: "player", weapon, x, y: y - width / 3, width, height: width, vx: direction * 380, vy: 0, damage: 1, remainingMs: stack(world, "arc-return") ? 1450 : 950, hitIds: new Set() });
    world.weaponCooldowns[weapon] = 700 * Math.max(0.55, 1 - stack(world, "arc-tempo") * 0.2);
  } else {
    const radius = 140 * (1 + stack(world, "pulse-radius") * 0.25);
    world.projectiles.push({ id: serial, owner: "player", weapon, x: x - radius, y: y - radius, width: radius * 2, height: radius * 2, vx: 0, vy: 0, damage: 2, remainingMs: 180, hitIds: new Set() });
    world.projectiles = world.projectiles.filter((projectile) => projectile.owner === "player" || !overlaps(projectile, { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 }));
    world.weaponCooldowns[weapon] = 1500 * Math.max(0.55, 1 - stack(world, "pulse-tempo") * 0.2);
  }
  world.weaponsUsed.add(weapon); world.globalFireLockMs = 150; events.push({ type: "fired" });
}

function updateEnemies(world: GameWorld, dtMs: number, events: GameEvent[]) {
  const speedScale = DIFFICULTY_CONFIG[world.difficulty].enemySpeed;
  for (const enemy of world.enemies) {
    if (Math.abs(enemy.x - world.x) > 900) continue;
    enemy.cooldownMs -= dtMs;
    if (enemy.kind === "drifter" || enemy.kind === "shell") {
      enemy.x += enemy.vx * speedScale * dtMs / 1000;
      if (Math.abs(enemy.x + enemy.width / 2 - enemy.originX) > 72) enemy.vx *= -1;
    } else if (enemy.kind === "flock") {
      enemy.y += Math.sin(world.elapsedMs * 0.006 + enemy.phase) * 0.35 * speedScale;
    } else if (enemy.kind === "guardian" && enemy.cooldownMs <= 0) {
      for (let index = -1; index <= 1; index += 1) world.projectiles.push({ id: ++world.projectileSerial, owner: "enemy", x: enemy.x + enemy.width / 2, y: enemy.y + 35, width: 12, height: 12, vx: (world.x < enemy.x ? -1 : 1) * 190, vy: index * 105, damage: 1, remainingMs: 2400, hitIds: new Set() });
      enemy.cooldownMs = 1200 / speedScale;
    } else if (enemy.kind === "spitter" && enemy.cooldownMs <= 0) {
      const dx = world.x + PLAYER_W / 2 - (enemy.x + enemy.width / 2); const dy = world.y + PLAYER_H / 2 - (enemy.y + enemy.height / 2); const length = Math.max(1, Math.hypot(dx, dy));
      world.projectiles.push({ id: ++world.projectileSerial, owner: "enemy", x: enemy.x + enemy.width / 2, y: enemy.y + 10, width: 10, height: 10, vx: dx / length * 210 * speedScale, vy: dy / length * 210 * speedScale, damage: 1, remainingMs: 2600, hitIds: new Set() });
      enemy.cooldownMs = 1550 / speedScale;
    }
    if (overlaps({ x: world.x + 7, y: world.y + 8, width: PLAYER_W - 14, height: PLAYER_H - 8 }, enemy)) hitPlayer(world, events);
  }
}

function updateProjectiles(world: GameWorld, dtMs: number, events: GameEvent[]) {
  const player = { x: world.x + 7, y: world.y + 8, width: PLAYER_W - 14, height: PLAYER_H - 8 };
  for (const projectile of world.projectiles) {
    projectile.x += projectile.vx * dtMs / 1000; projectile.y += projectile.vy * dtMs / 1000; projectile.remainingMs -= dtMs;
    if (projectile.owner === "enemy") { if (overlaps(projectile, player)) { projectile.remainingMs = 0; hitPlayer(world, events); } continue; }
    for (const enemy of world.enemies) {
      if (projectile.hitIds.has(enemy.id) || !overlaps(projectile, enemy)) continue;
      projectile.hitIds.add(enemy.id);
      if (enemy.armored && projectile.weapon !== "beacon-pulse") { projectile.remainingMs = 0; continue; }
      if (enemy.armored) enemy.armored = false;
      let damage = projectile.damage;
      if (enemy.kind === "guardian") {
        const preferred: WeaponId = enemy.hp > 12 ? "wisp-bolt" : enemy.hp > 6 ? "moon-arc" : "beacon-pulse";
        if (projectile.weapon === preferred) damage *= 2;
      }
      enemy.hp -= damage; events.push({ type: "enemy-hit" });
      if (projectile.weapon !== "moon-arc" && projectile.weapon !== "beacon-pulse") projectile.remainingMs = 0;
    }
  }
  const cleansed = world.enemies.filter((enemy) => enemy.hp <= 0);
  for (const enemy of cleansed) {
    world.cleansed += 1;
    if (world.mode === "endless") { world.score += 100 * world.combo; world.combo = Math.min(5, world.combo + 1); }
    if (enemy.kind === "guardian" && world.mode === "story") world.guardianCleaned = true;
    if (enemy.kind === "guardian" && stack(world, "pulse-aegis") && world.weaponsUsed.has("beacon-pulse")) world.shield = 1;
    events.push({ type: "enemy-cleansed" });
  }
  world.enemies = world.enemies.filter((enemy) => enemy.hp > 0);
  world.projectiles = world.projectiles.filter((projectile) => projectile.remainingMs > 0);
}

function upgradeOptions(world: GameWorld) {
  const available = upgradePool.filter((id) => stack(world, id) < 3);
  if (available.length < 3) return ["field-mend", "field-shield", "field-score"] as UpgradeId[];
  const start = Math.abs((world.seed ^ Math.imul(world.roomIndex, 2654435761))) % available.length;
  const choices: UpgradeId[] = [];
  for (let offset = 0; choices.length < 3; offset += 1) {
    const choice = available[(start + offset * 4) % available.length];
    if (!choices.includes(choice)) choices.push(choice);
  }
  return choices;
}

export function selectEndlessUpgrade(world: GameWorld, upgrade: UpgradeId) {
  if (world.phase !== "upgrade" || !world.pendingUpgrades.includes(upgrade)) return false;
  if (upgrade === "field-mend") world.hearts = Math.min(world.maxHearts, world.hearts + 1);
  else if (upgrade === "field-shield") world.shield = 1;
  else if (upgrade === "field-score") world.score += 500;
  else world.upgradeStacks[upgrade] = stack(world, upgrade) + 1;
  world.pendingUpgrades = []; world.phase = "playing"; return true;
}

function updateEndlessProgress(world: GameWorld, events: GameEvent[]) {
  const nextRoom = Math.max(0, Math.floor((world.x + PLAYER_W / 2) / GAME_VIEW_W));
  if (nextRoom === world.roomIndex) return;
  if (nextRoom > world.roomIndex) {
    const previous = world.roomIndex;
    if (!world.clearedRooms.has(previous)) { world.clearedRooms.add(previous); world.roomsCleared += 1; world.score += 1000; }
    world.roomIndex = nextRoom; spawnEndlessRooms(world); events.push({ type: "room-entered" });
    if (nextRoom > 0 && nextRoom % 5 === 0) { world.pendingUpgrades = upgradeOptions(world); world.phase = "upgrade"; events.push({ type: "upgrade" }); }
  } else world.roomIndex = nextRoom;
}

export function stepGame(world: GameWorld, input: GameInput, deltaMs: number): GameEvent[] {
  const events: GameEvent[] = [];
  const dtMs = Math.max(0, Math.min(40, deltaMs)); const dt = dtMs / 1000;
  if (["won", "gameover", "upgrade"].includes(world.phase)) return events;
  if (world.phase === "hatching") { world.hatchElapsedMs += dtMs; if (world.hatchElapsedMs >= HATCH_DURATION_MS) { world.phase = "playing"; events.push({ type: "hatched" }); } return events; }
  if (world.phase === "failed") {
    world.elapsedMs += dtMs; world.failRemainingMs -= dtMs;
    if (world.failRemainingMs <= 0) { world.phase = "playing"; world.x = world.checkpoint.x; world.y = world.checkpoint.y; world.hearts = world.maxHearts; world.grounded = false; world.standingPlatform = null; world.invulnerableMs = 1100; }
    return events;
  }

  world.elapsedMs += dtMs; world.invulnerableMs = Math.max(0, world.invulnerableMs - dtMs); world.revealRemainingMs = Math.max(0, world.revealRemainingMs - dtMs); world.gestureRemainingMs = Math.max(0, world.gestureRemainingMs - dtMs);
  world.globalFireLockMs = Math.max(0, world.globalFireLockMs - dtMs); weaponOrder.forEach((weapon) => { world.weaponCooldowns[weapon] = Math.max(0, world.weaponCooldowns[weapon] - dtMs); });
  if (world.gestureRemainingMs === 0) world.gesture = null;
  if (input.weaponSelect && world.unlockedWeapons.has(input.weaponSelect)) { world.selectedWeapon = input.weaponSelect; world.globalFireLockMs = Math.max(150, world.globalFireLockMs); }
  if (input.nextWeapon) {
    const available = weaponOrder.filter((weapon) => world.unlockedWeapons.has(weapon)); const current = available.indexOf(world.selectedWeapon); if (available.length) world.selectedWeapon = available[(current + 1) % available.length]; world.globalFireLockMs = Math.max(150, world.globalFireLockMs);
  }
  if (input.fire) fireWeapon(world, events);

  const activePlatforms = getPlatforms(world);
  if (world.grounded && world.standingPlatform !== null) {
    const platform = activePlatforms[world.standingPlatform];
    if (platform) { const before = platformRect(platform, world.elapsedMs - dtMs); const after = platformRect(platform, world.elapsedMs); world.x += after.x - before.x; world.y += after.y - before.y; }
  }
  const action = getContextAction(world);
  if (world.gestureRemainingMs > 0) { world.vx = 0; world.interaction = null; world.interactionProgressMs = 0; }
  else if (input.interact && action) {
    world.vx = 0; if (world.interaction !== action.kind) world.interactionProgressMs = 0; world.interaction = action.kind; world.interactionProgressMs += dtMs;
    if (world.interactionProgressMs >= action.durationMs) { applyInteraction(world, action.kind, action.index, events); world.interaction = null; world.interactionProgressMs = 0; }
  } else {
    world.interaction = null; world.interactionProgressMs = 0; const direction = Number(input.right) - Number(input.left); world.vx = direction * 235; if (direction) world.facing = direction > 0 ? 1 : -1;
    if (input.jump && world.grounded) { world.vy = -515; world.grounded = false; world.standingPlatform = null; events.push({ type: "jump" }); }
  }

  const previousX = world.x; const previousBottom = world.y + PLAYER_H; world.vy += 1180 * dt;
  const maxX = world.mode === "story" ? GAME_WORLD_W - PLAYER_W : Number.POSITIVE_INFINITY;
  const minX = world.mode === "endless" ? Math.max(0, (world.roomIndex - 2) * GAME_VIEW_W) : 0;
  world.x = Math.max(minX, Math.min(maxX, world.x + world.vx * dt));
  for (const gateX of getClosedGates(world)) { if (previousX + PLAYER_W <= gateX && world.x + PLAYER_W > gateX) world.x = gateX - PLAYER_W; if (previousX >= gateX + 18 && world.x < gateX + 18) world.x = gateX + 18; }
  world.y += world.vy * dt; world.grounded = false; world.standingPlatform = null;
  if (world.vy >= 0) {
    const nextBottom = world.y + PLAYER_H;
    for (const [index, platform] of activePlatforms.entries()) {
      const rect = platformRect(platform, world.elapsedMs); const overX = world.x + PLAYER_W > rect.x + 5 && world.x < rect.x + rect.width - 5;
      if (overX && previousBottom <= rect.y && nextBottom >= rect.y) { world.y = rect.y - PLAYER_H; world.vy = 0; world.grounded = true; world.standingPlatform = index; if (platform.shortcut) world.usedRiskyShortcut = true; break; }
    }
  }

  for (const collectible of getCollectibles(world)) {
    if (!world.glowbits.has(collectible.id) && overlaps({ x: world.x, y: world.y, width: PLAYER_W, height: PLAYER_H }, { x: collectible.x - 14, y: collectible.y - 14, width: 28, height: 28 })) {
      world.glowbits.add(collectible.id); if (world.mode === "endless") world.score += 250; events.push({ type: "glowbit" });
    }
  }

  updateEnemies(world, dtMs, events); updateProjectiles(world, dtMs, events);
  if (world.phase === "playing" && world.invulnerableMs <= 0) {
    const player = { x: world.x + 6, y: world.y + 8, width: PLAYER_W - 12, height: PLAYER_H - 8 };
    if (getHazards(world).some((hazard) => overlaps(player, hazardRect(hazard, world.elapsedMs)))) hitPlayer(world, events);
  }
  if (world.y > GAME_VIEW_H + 90 && world.phase === "playing") { if (world.mode === "story") failStory(world, events); else endEndless(world, events); }
  if (world.mode === "endless" && world.phase === "playing") updateEndlessProgress(world, events);
  return events;
}

export function interactionProgress(world: GameWorld) {
  if (!world.interaction) return 0;
  return Math.min(1, world.interactionProgressMs / Math.max(1, interactionDurations[world.interaction]));
}

export function mergeGameRecord(previous: GameRecord | LegacyGameRecord | undefined, result: GameResult): GameRecord {
  const current: GameRecord = previous?.levelVersion === GAME_LEVEL_VERSION
    ? { ...(previous as GameRecord), story: { ...(previous as GameRecord).story }, endless: { ...(previous as GameRecord).endless } }
    : { levelVersion: GAME_LEVEL_VERSION, story: {}, endless: {}, ...(previous ? { legacy: previous as LegacyGameRecord } : {}) };
  if (result.mode === "story") {
    const prior = current.story[result.difficulty] ?? { badges: [], completions: 0 };
    current.story[result.difficulty] = { bestTimeMs: typeof prior.bestTimeMs === "number" ? Math.min(prior.bestTimeMs, result.elapsedMs) : result.elapsedMs, badges: Array.from(new Set([...prior.badges, ...result.badges])), completions: prior.completions + 1 };
  } else {
    const prior = current.endless[result.difficulty] ?? { bestScore: 0, bestRooms: 0, runs: 0 };
    current.endless[result.difficulty] = { bestScore: Math.max(prior.bestScore, result.score), bestRooms: Math.max(prior.bestRooms, result.rooms), bestSeed: result.score >= prior.bestScore ? result.seed : prior.bestSeed, runs: prior.runs + 1 };
  }
  return current;
}
