export const GAME_LEVEL_VERSION = 2;
export const GAME_VIEW_W = 960;
export const GAME_VIEW_H = 540;
export const GAME_WORLD_W = 2880;
export const PLAYER_W = 46;
export const PLAYER_H = 76;
export const HATCH_DURATION_MS = 1992;

export type GameBadge = "steady-heart" | "glowkeeper" | "sky-runner";
export type GameRecord = {
  levelVersion: number;
  bestTimeMs?: number;
  badges: GameBadge[];
  completions: number;
};
export type GameResult = {
  elapsedMs: number;
  failures: number;
  glowbits: number;
  usedRiskyShortcut: boolean;
  badges: GameBadge[];
};
export type GamePhase = "hatching" | "playing" | "failed" | "won";
export type InteractionKind = "wave" | "wait" | "review" | "work" | "sanctuary";
export type GameInput = { left: boolean; right: boolean; jump: boolean; interact: boolean };
export type GameEvent =
  | { type: "hatched" | "jump" | "wisp" | "charged" | "reviewed" | "shield-broken" | "failed" | "glowbit" | "beacon" | "won" }
  | { type: "hint"; segment: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Platform = Rect & { shortcut?: boolean; moving?: "x" | "y"; amplitude?: number; speed?: number; phase?: number };
export type Hazard = Rect & { axis: "x" | "y"; amplitude: number; speed: number; phase: number };
export type GameWorld = {
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
  shield: 0 | 1;
  invulnerableMs: number;
  wispRecruited: boolean;
  moonwellCharged: boolean;
  reviewed: boolean;
  revealRemainingMs: number;
  repaired: boolean[];
  glowbits: Set<number>;
  usedRiskyShortcut: boolean;
  interaction: InteractionKind | null;
  interactionProgressMs: number;
  gesture: InteractionKind | null;
  gestureRemainingMs: number;
  segmentFailures: number[];
  hintSegment: number | null;
  result?: GameResult;
};

export const BASE_PLATFORMS: Platform[] = [
  { x: 0, y: 480, width: 920, height: 60 },
  { x: 980, y: 480, width: 850, height: 60 },
  { x: 1900, y: 480, width: 980, height: 60 },
  { x: 150, y: 390, width: 170, height: 18 },
  { x: 480, y: 350, width: 150, height: 18 },
  { x: 750, y: 398, width: 130, height: 18 },
  { x: 1030, y: 382, width: 165, height: 18 },
  { x: 1240, y: 315, width: 150, height: 18 },
  { x: 1465, y: 385, width: 170, height: 18 },
  { x: 1680, y: 330, width: 120, height: 18 },
  { x: 1960, y: 390, width: 160, height: 18 },
  { x: 2220, y: 350, width: 150, height: 18 },
  { x: 2470, y: 390, width: 170, height: 18 },
  { x: 2680, y: 315, width: 135, height: 18 },
  { x: 920, y: 425, width: 70, height: 16, moving: "y", amplitude: 38, speed: 0.0021, phase: 0 },
  { x: 1825, y: 425, width: 82, height: 16, moving: "y", amplitude: 42, speed: 0.0018, phase: 1.2 },
];

export const SHORTCUT_PLATFORMS: Platform[] = [
  { x: 1190, y: 225, width: 120, height: 15, shortcut: true },
  { x: 1360, y: 185, width: 118, height: 15, shortcut: true, moving: "x", amplitude: 24, speed: 0.002, phase: 0.5 },
  { x: 1530, y: 225, width: 120, height: 15, shortcut: true },
  { x: 2110, y: 245, width: 120, height: 15, shortcut: true },
  { x: 2280, y: 205, width: 120, height: 15, shortcut: true, moving: "y", amplitude: 28, speed: 0.0022, phase: 1 },
  { x: 2450, y: 245, width: 120, height: 15, shortcut: true },
];

export const HAZARDS: Hazard[] = [
  { x: 1040, y: 444, width: 34, height: 36, axis: "x", amplitude: 105, speed: 0.0016, phase: 0 },
  { x: 1520, y: 349, width: 34, height: 36, axis: "x", amplitude: 72, speed: 0.0021, phase: 1.8 },
  { x: 2050, y: 444, width: 36, height: 36, axis: "x", amplitude: 130, speed: 0.0018, phase: 0.7 },
  { x: 2380, y: 300, width: 34, height: 34, axis: "y", amplitude: 65, speed: 0.002, phase: 2.4 },
  { x: 2670, y: 444, width: 36, height: 36, axis: "x", amplitude: 72, speed: 0.0024, phase: 1.1 },
];

export const GLOWBITS = [
  { x: 275, y: 350 },
  { x: 1310, y: 270 },
  { x: 1420, y: 140 },
  { x: 2325, y: 158 },
  { x: 2745, y: 270 },
];

export const WISP = { x: 355, y: 424 };
export const MOONWELLS = [{ x: 675, y: 430 }, { x: 2015, y: 430 }];
export const RUNE = { x: 1110, y: 425 };
export const BEACONS = [{ x: 830, y: 420 }, { x: 1740, y: 270 }, { x: 2550, y: 330 }];
export const SANCTUARY = { x: 2790, y: 255 };

const interactionDurations: Record<InteractionKind, number> = {
  wave: 0,
  wait: 1250,
  review: 900,
  work: 1500,
  sanctuary: 0,
};

export function createGameWorld(): GameWorld {
  return {
    x: 62, y: 404, vx: 0, vy: 0, grounded: true, standingPlatform: 0, facing: 1,
    phase: "hatching", hatchElapsedMs: 0, elapsedMs: 0, failures: 0, failRemainingMs: 0,
    checkpoint: { x: 62, y: 404 }, shield: 0, invulnerableMs: 0,
    wispRecruited: false, moonwellCharged: false, reviewed: false, revealRemainingMs: 0,
    repaired: [false, false, false], glowbits: new Set(), usedRiskyShortcut: false,
    interaction: null, interactionProgressMs: 0, gesture: null, gestureRemainingMs: 0,
    segmentFailures: [0, 0, 0], hintSegment: null,
  };
}

export function currentSegment(world: GameWorld) {
  return Math.max(0, Math.min(2, Math.floor(world.x / 960)));
}

export function getPlatforms(world: GameWorld): Platform[] {
  return world.reviewed || world.hintSegment !== null ? [...BASE_PLATFORMS, ...SHORTCUT_PLATFORMS] : BASE_PLATFORMS;
}

export function platformRect(platform: Platform, elapsedMs: number): Rect {
  const offset = Math.sin(elapsedMs * (platform.speed ?? 0) + (platform.phase ?? 0)) * (platform.amplitude ?? 0);
  return {
    x: platform.x + (platform.moving === "x" ? offset : 0),
    y: platform.y + (platform.moving === "y" ? offset : 0),
    width: platform.width,
    height: platform.height,
  };
}

export function hazardRect(hazard: Hazard, elapsedMs: number): Rect {
  const offset = Math.sin(elapsedMs * hazard.speed + hazard.phase) * hazard.amplitude;
  return {
    x: hazard.x + (hazard.axis === "x" ? offset : 0),
    y: hazard.y + (hazard.axis === "y" ? offset : 0),
    width: hazard.width,
    height: hazard.height,
  };
}

function near(world: GameWorld, point: { x: number; y: number }, radius = 72) {
  const centerX = world.x + PLAYER_W / 2;
  const centerY = world.y + PLAYER_H / 2;
  return Math.hypot(centerX - point.x, centerY - point.y) <= radius;
}

export function getContextAction(world: GameWorld): { kind: InteractionKind; label: string; durationMs: number; index?: number } | null {
  if (world.phase !== "playing") return null;
  if (!world.wispRecruited && near(world, WISP, 82)) return { kind: "wave", label: "Wave to the Wisp", durationMs: 0 };
  const moonwell = MOONWELLS.findIndex((point) => near(world, point, 78));
  if (moonwell >= 0 && (!world.moonwellCharged || world.shield === 0)) return { kind: "wait", label: "Recharge at moonwell", durationMs: interactionDurations.wait, index: moonwell };
  if (!world.reviewed && near(world, RUNE, 78)) return { kind: "review", label: "Review the rune", durationMs: interactionDurations.review };
  const beacon = BEACONS.findIndex((point, index) => !world.repaired[index] && near(world, point, 84));
  if (beacon >= 0) return { kind: "work", label: `Repair beacon ${beacon + 1}`, durationMs: interactionDurations.work, index: beacon };
  if (world.repaired.every(Boolean) && near(world, SANCTUARY, 96)) return { kind: "sanctuary", label: "Awaken the sanctuary", durationMs: 0 };
  return null;
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function getClosedGates(world: GameWorld) {
  const gates: number[] = [];
  if (!world.wispRecruited) gates.push(445);
  if (!world.moonwellCharged) gates.push(735);
  if (!world.repaired[0]) gates.push(955);
  if (!world.reviewed) gates.push(1215);
  if (!world.repaired[1]) gates.push(1915);
  if (!world.repaired[2]) gates.push(2680);
  return gates;
}

function applyInteraction(world: GameWorld, kind: InteractionKind, index: number | undefined, events: GameEvent[]) {
  if (kind === "wave") {
    world.wispRecruited = true;
    world.shield = 1;
    world.gesture = "wave";
    world.gestureRemainingMs = 620;
    events.push({ type: "wisp" });
  } else if (kind === "wait") {
    world.moonwellCharged = true;
    world.shield = 1;
    events.push({ type: "charged" });
  } else if (kind === "review") {
    world.reviewed = true;
    world.revealRemainingMs = 10000;
    events.push({ type: "reviewed" });
  } else if (kind === "work" && typeof index === "number") {
    world.repaired[index] = true;
    world.checkpoint = { x: Math.max(40, BEACONS[index].x - 76), y: BEACONS[index].y - PLAYER_H };
    events.push({ type: "beacon" });
  } else if (kind === "sanctuary") {
    world.phase = "won";
    const badges: GameBadge[] = [];
    if (world.failures === 0) badges.push("steady-heart");
    if (world.glowbits.size === GLOWBITS.length) badges.push("glowkeeper");
    if (world.usedRiskyShortcut) badges.push("sky-runner");
    world.result = {
      elapsedMs: Math.round(world.elapsedMs), failures: world.failures, glowbits: world.glowbits.size,
      usedRiskyShortcut: world.usedRiskyShortcut, badges,
    };
    events.push({ type: "won" });
  }
}

function fail(world: GameWorld, events: GameEvent[]) {
  const segment = currentSegment(world);
  world.phase = "failed";
  world.failRemainingMs = 850;
  world.failures += 1;
  world.elapsedMs += 5000;
  world.segmentFailures[segment] += 1;
  if (world.segmentFailures[segment] === 3) {
    world.hintSegment = segment;
    events.push({ type: "hint", segment });
  }
  world.vx = 0;
  world.vy = 0;
  world.grounded = false;
  world.standingPlatform = null;
  events.push({ type: "failed" });
}

export function stepGame(world: GameWorld, input: GameInput, deltaMs: number): GameEvent[] {
  const events: GameEvent[] = [];
  const dtMs = Math.max(0, Math.min(40, deltaMs));
  const dt = dtMs / 1000;
  if (world.phase === "won") return events;
  if (world.phase === "hatching") {
    world.hatchElapsedMs += dtMs;
    if (world.hatchElapsedMs >= HATCH_DURATION_MS) {
      world.phase = "playing";
      events.push({ type: "hatched" });
    }
    return events;
  }
  if (world.phase === "failed") {
    world.elapsedMs += dtMs;
    world.failRemainingMs -= dtMs;
    if (world.failRemainingMs <= 0) {
      world.phase = "playing";
      world.x = world.checkpoint.x;
      world.y = world.checkpoint.y;
      world.grounded = false;
      world.standingPlatform = null;
      world.invulnerableMs = 1100;
    }
    return events;
  }

  world.elapsedMs += dtMs;
  world.invulnerableMs = Math.max(0, world.invulnerableMs - dtMs);
  world.revealRemainingMs = Math.max(0, world.revealRemainingMs - dtMs);
  world.gestureRemainingMs = Math.max(0, world.gestureRemainingMs - dtMs);
  if (world.gestureRemainingMs === 0) world.gesture = null;
  const activePlatforms = getPlatforms(world);
  if (world.grounded && world.standingPlatform !== null) {
    const platform = activePlatforms[world.standingPlatform];
    if (platform) {
      const previousRect = platformRect(platform, world.elapsedMs - dtMs);
      const currentRect = platformRect(platform, world.elapsedMs);
      world.x = Math.max(0, Math.min(GAME_WORLD_W - PLAYER_W, world.x + currentRect.x - previousRect.x));
      world.y += currentRect.y - previousRect.y;
    } else {
      world.grounded = false;
      world.standingPlatform = null;
    }
  }
  const action = getContextAction(world);
  if (world.gestureRemainingMs > 0) {
    world.vx = 0;
    world.interaction = null;
    world.interactionProgressMs = 0;
  } else if (input.interact && action) {
    world.vx = 0;
    if (world.interaction !== action.kind) world.interactionProgressMs = 0;
    world.interaction = action.kind;
    world.interactionProgressMs += dtMs;
    if (world.interactionProgressMs >= action.durationMs) {
      applyInteraction(world, action.kind, action.index, events);
      world.interaction = null;
      world.interactionProgressMs = 0;
    }
  } else {
    world.interaction = null;
    world.interactionProgressMs = 0;
    const direction = Number(input.right) - Number(input.left);
    world.vx = direction * 235;
    if (direction) world.facing = direction > 0 ? 1 : -1;
    if (input.jump && world.grounded) {
      world.vy = -515;
      world.grounded = false;
      world.standingPlatform = null;
      events.push({ type: "jump" });
    }
  }

  const previousX = world.x;
  const previousBottom = world.y + PLAYER_H;
  world.vy += 1180 * dt;
  world.x = Math.max(0, Math.min(GAME_WORLD_W - PLAYER_W, world.x + world.vx * dt));
  for (const gateX of getClosedGates(world)) {
    if (previousX + PLAYER_W <= gateX && world.x + PLAYER_W > gateX) world.x = gateX - PLAYER_W;
    if (previousX >= gateX + 18 && world.x < gateX + 18) world.x = gateX + 18;
  }
  world.y += world.vy * dt;
  world.grounded = false;
  world.standingPlatform = null;
  if (world.vy >= 0) {
    const nextBottom = world.y + PLAYER_H;
    for (const [index, platform] of activePlatforms.entries()) {
      const rect = platformRect(platform, world.elapsedMs);
      const overX = world.x + PLAYER_W > rect.x + 5 && world.x < rect.x + rect.width - 5;
      if (overX && previousBottom <= rect.y && nextBottom >= rect.y) {
        world.y = rect.y - PLAYER_H;
        world.vy = 0;
        world.grounded = true;
        world.standingPlatform = index;
        if (platform.shortcut) world.usedRiskyShortcut = true;
        break;
      }
    }
  }

  GLOWBITS.forEach((bit, index) => {
    if (!world.glowbits.has(index) && overlaps({ x: world.x, y: world.y, width: PLAYER_W, height: PLAYER_H }, { x: bit.x - 14, y: bit.y - 14, width: 28, height: 28 })) {
      world.glowbits.add(index);
      events.push({ type: "glowbit" });
    }
  });

  if (world.invulnerableMs <= 0) {
    const player = { x: world.x + 6, y: world.y + 8, width: PLAYER_W - 12, height: PLAYER_H - 8 };
    const hit = HAZARDS.some((hazard) => overlaps(player, hazardRect(hazard, world.elapsedMs)));
    if (hit) {
      if (world.shield) {
        world.shield = 0;
        world.invulnerableMs = 1500;
        world.vx = -world.facing * 150;
        world.vy = -210;
        world.grounded = false;
        world.standingPlatform = null;
        events.push({ type: "shield-broken" });
      } else fail(world, events);
    }
  }
  if (world.y > GAME_VIEW_H + 90 && world.phase === "playing") fail(world, events);
  return events;
}

export function interactionProgress(world: GameWorld) {
  if (!world.interaction) return 0;
  return Math.min(1, world.interactionProgressMs / interactionDurations[world.interaction]);
}

export function mergeGameRecord(previous: GameRecord | undefined, result: GameResult): GameRecord {
  const prior = previous?.levelVersion === GAME_LEVEL_VERSION
    ? previous
    : { levelVersion: GAME_LEVEL_VERSION, badges: [], completions: 0 };
  return {
    levelVersion: GAME_LEVEL_VERSION,
    bestTimeMs: typeof prior.bestTimeMs === "number" ? Math.min(prior.bestTimeMs, result.elapsedMs) : result.elapsedMs,
    badges: Array.from(new Set([...prior.badges, ...result.badges])),
    completions: prior.completions + 1,
  };
}
