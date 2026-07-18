"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import EndlessLeaderboard, { EndlessScoreSubmit } from "./endless-leaderboard";

import {
  BEACONS,
  GAME_LEVEL_VERSION,
  GAME_VIEW_H,
  GAME_VIEW_W,
  HATCH_DURATION_MS,
  MOONWELLS,
  PLAYER_H,
  PLAYER_W,
  RUNE,
  SANCTUARY,
  WISP,
  createGameWorld,
  currentSegment,
  getClosedGates,
  getCollectibles,
  getContextAction,
  getHazards,
  getPlatforms,
  hazardRect,
  interactionProgress,
  platformRect,
  selectEndlessUpgrade,
  stepGame,
  type GameBadge,
  type GameDifficulty,
  type GameEvent,
  type GameInput,
  type GameMode,
  type GameRecord,
  type GameResult,
  type GameWorld,
  type InteractionKind,
  type UpgradeId,
  type WeaponId,
} from "./game-engine";

const CELL_W = 192;
const CELL_H = 208;
const COLS = 8;
const SOUND_KEY = "hatchframe-game-muted";
const PREFERENCE_KEY = "hatchframe-game-preferences";

const clips: Record<string, { row: number; count: number; fps: number }> = {
  idle: { row: 0, count: 6, fps: 6 }, "running-right": { row: 1, count: 8, fps: 11 }, "running-left": { row: 2, count: 8, fps: 11 },
  waving: { row: 3, count: 4, fps: 7 }, jumping: { row: 4, count: 5, fps: 9 }, failed: { row: 5, count: 8, fps: 7 },
  waiting: { row: 6, count: 6, fps: 5 }, working: { row: 7, count: 6, fps: 9 }, review: { row: 8, count: 6, fps: 6 },
};

const badgeCopy: Record<GameBadge, { label: string; detail: string }> = {
  "steady-heart": { label: "Steady heart", detail: "Finish without a checkpoint failure" },
  glowkeeper: { label: "Glowkeeper", detail: "Find every optional Glowbit" },
  "sky-runner": { label: "Sky runner", detail: "Complete a revealed upper shortcut" },
  "triune-heart": { label: "Triune heart", detail: "Cleanse with every guardian tool" },
};
const weaponCopy: Record<WeaponId, string> = { "wisp-bolt": "Wisp Bolt", "moon-arc": "Moon Arc", "beacon-pulse": "Beacon Pulse" };
const weaponDetails: Record<WeaponId, { code: string; role: string; detail: string }> = {
  "wisp-bolt": { code: "WB-01", role: "Rapid precision", detail: "Fast cyan spark for mobile single targets." },
  "moon-arc": { code: "MA-02", role: "Piercing control", detail: "Wide violet crescent that crosses entire formations." },
  "beacon-pulse": { code: "BP-03", role: "Ward breaker", detail: "Amber radial ward that breaks armor and clears hostile shots." },
};
const upgradeCopy: Record<UpgradeId, { label: string; detail: string }> = {
  "bolt-tempo": { label: "Quick spark", detail: "Wisp Bolt recharges 15% faster" }, "bolt-force": { label: "Bright spark", detail: "Wisp Bolt gains one damage" }, "bolt-fork": { label: "Forked spark", detail: "Wisp Bolt launches a second shot" },
  "arc-tempo": { label: "Moon rhythm", detail: "Moon Arc recharges 20% faster" }, "arc-width": { label: "Full moon", detail: "Moon Arc grows 30% wider" }, "arc-return": { label: "Returning moon", detail: "Moon Arc remains active longer" },
  "pulse-tempo": { label: "Beacon rhythm", detail: "Beacon Pulse recharges 20% faster" }, "pulse-radius": { label: "Wide beacon", detail: "Beacon Pulse grows 25% wider" }, "pulse-aegis": { label: "Guardian light", detail: "Guardian cleanses restore a shield" },
  "field-mend": { label: "Field mend", detail: "Recover one heart" }, "field-shield": { label: "Wisp ward", detail: "Restore the Wisp shield" }, "field-score": { label: "Radiant cache", detail: "Gain 500 score" },
};
const zoneNames = ["Moonlit Grove", "Rune Ruins", "Sky Workshop"];

export type GamePet = { id: string; description: string; petUrl: string; hatchUrl: string; gameRecord?: GameRecord };
type GameUi = {
  phase: GameWorld["phase"];
  mode: GameMode;
  difficulty: GameDifficulty;
  elapsedMs: number;
  failures: number;
  hearts: number;
  maxHearts: number;
  shield: number;
  repaired: boolean[];
  glowbits: number;
  segment: number;
  room: number;
  roomsCleared: number;
  score: number;
  combo: number;
  selectedWeapon: WeaponId;
  unlockedWeapons: WeaponId[];
  cooldown: number;
  context: ReturnType<typeof getContextAction>;
  progress: number;
  hintSegment: number | null;
  upgrades: UpgradeId[];
  seed: number;
  result?: GameResult;
};
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };

const emptyInput = (): GameInput => ({ left: false, right: false, jump: false, interact: false, fire: false, nextWeapon: false, weaponSelect: null });

function snapshot(world: GameWorld): GameUi {
  return {
    phase: world.phase, mode: world.mode, difficulty: world.difficulty, elapsedMs: world.elapsedMs, failures: world.failures,
    hearts: world.hearts, maxHearts: world.maxHearts, shield: world.shield, repaired: [...world.repaired], glowbits: world.glowbits.size,
    segment: currentSegment(world), room: world.roomIndex, roomsCleared: world.roomsCleared, score: world.score, combo: world.combo,
    selectedWeapon: world.selectedWeapon, unlockedWeapons: [...world.unlockedWeapons], cooldown: world.weaponCooldowns[world.selectedWeapon],
    context: getContextAction(world), progress: interactionProgress(world), hintSegment: world.hintSegment,
    upgrades: [...world.pendingUpgrades], seed: world.seed, result: world.result,
  };
}

function formatTime(milliseconds?: number) {
  if (typeof milliseconds !== "number") return "—";
  const total = Math.max(0, milliseconds) / 1000; const minutes = Math.floor(total / 60); const seconds = total - minutes * 60;
  return minutes ? `${minutes}:${seconds.toFixed(1).padStart(4, "0")}` : `${seconds.toFixed(1)}s`;
}

function objective(world: GameUi) {
  if (world.phase === "hatching") return "A new adventure is hatching…";
  if (world.mode === "endless") return world.phase === "upgrade" ? "Choose one temporary field upgrade." : `Cleanse room ${world.room + 1}, protect your streak, and keep moving.`;
  if (!world.repaired[0]) return world.unlockedWeapons.includes("wisp-bolt") ? "Cleanse the grove and restore its beacon." : "Wave to the Wisp and earn its shield.";
  if (!world.repaired[1]) return "Review the rune, master Moon Arc, and restore the ruins beacon.";
  if (!world.repaired[2]) return "Use all three guardian tools to cross the workshop.";
  return "Cleanse the Sanctuary Guardian and awaken the sanctuary.";
}

function interactionState(kind: InteractionKind | null) {
  if (kind === "wave" || kind === "sanctuary") return "waving";
  if (kind === "wait") return "waiting";
  if (kind === "review") return "review";
  if (kind === "work") return "working";
  return null;
}

function randomSeed() {
  const value = new Uint32Array(1); crypto.getRandomValues(value); return value[0] || 41721;
}

export default function PetGame({ pet, onComplete }: { pet: GamePet; onComplete: (petId: string, result: GameResult) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<HTMLDivElement>(null);
  const petImage = useRef<HTMLImageElement | null>(null);
  const hatchImage = useRef<HTMLImageElement | null>(null);
  const worldRef = useRef(createGameWorld());
  const startedRef = useRef(false);
  const inputRef = useRef<GameInput>(emptyInput());
  const cameraRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const mutedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const completedRef = useRef(false);
  const reducedMotion = useRef(false);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<GameMode>("story");
  const [difficulty, setDifficulty] = useState<GameDifficulty>("adventure");
  const [ui, setUi] = useState<GameUi>(() => snapshot(createGameWorld()));

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || "{}") as { mode?: GameMode; difficulty?: GameDifficulty };
        if (stored.mode === "story" || stored.mode === "endless") setMode(stored.mode);
        if (["explorer", "adventure", "expert"].includes(stored.difficulty ?? "")) setDifficulty(stored.difficulty as GameDifficulty);
      } catch { /* Invalid preferences fall back safely. */ }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const ensureAudio = useCallback(() => {
    if (mutedRef.current) return null;
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    if (!audioRef.current) audioRef.current = new AudioCtor();
    void audioRef.current.resume(); return audioRef.current;
  }, []);

  const tone = useCallback((frequency: number, duration = 0.12, type: OscillatorType = "square", volume = 0.025, delay = 0) => {
    const audio = ensureAudio(); if (!audio || mutedRef.current) return;
    const oscillator = audio.createOscillator(); const gain = audio.createGain(); const start = audio.currentTime + delay;
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, start); gain.gain.setValueAtTime(volume, start); gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audio.destination); oscillator.start(start); oscillator.stop(start + duration);
  }, [ensureAudio]);

  const playEvent = useCallback((event: GameEvent) => {
    if (event.type === "jump") tone(240, 0.09, "square", 0.018);
    else if (event.type === "fired") tone(510, 0.055, "square", 0.012);
    else if (event.type === "enemy-hit") tone(170, 0.05, "square", 0.012);
    else if (event.type === "enemy-cleansed") { tone(520, 0.08); tone(780, 0.11, "sine", 0.018, 0.05); }
    else if (event.type === "wisp" || event.type === "charged") { tone(420, 0.16); tone(630, 0.2, "sine", 0.02, 0.1); }
    else if (event.type === "glowbit") { tone(720, 0.08); tone(960, 0.12, "square", 0.018, 0.06); }
    else if (event.type === "beacon" || event.type === "upgrade") { tone(220, 0.2, "sawtooth", 0.02); tone(440, 0.35, "sine", 0.03, 0.14); }
    else if (event.type === "shield-broken" || event.type === "player-hit") tone(105, 0.28, "sawtooth", 0.04);
    else if (event.type === "failed" || event.type === "gameover") tone(82, 0.42, "square", 0.04);
    else if (event.type === "won") [440, 554, 660, 880].forEach((note, index) => tone(note, 0.35, "square", 0.025, index * 0.12));
  }, [tone]);

  const spawnParticles = useCallback((event: GameEvent, world: GameWorld) => {
    if (reducedMotion.current || !["glowbit", "beacon", "wisp", "charged", "shield-broken", "player-hit", "enemy-hit", "enemy-cleansed", "won", "gameover"].includes(event.type)) return;
    const colors = event.type === "player-hit" || event.type === "gameover" ? ["#ff8f73", "#ffc38f"] : ["#c9f3a6", "#a8f0d0", "#b8a4ff"];
    const count = event.type === "won" ? 32 : event.type === "enemy-hit" ? 6 : 14;
    for (let index = 0; index < count; index += 1) {
      const angle = index * 2.399 + world.elapsedMs * 0.001; const speed = 35 + (index % 5) * 18;
      particlesRef.current.push({ x: world.x + PLAYER_W / 2, y: world.y + PLAYER_H / 2, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 25, life: 0.45 + (index % 4) * 0.1, color: colors[index % colors.length], size: 3 + index % 3 });
    }
    if (["player-hit", "shield-broken", "gameover"].includes(event.type)) shakeRef.current = event.type === "gameover" ? 12 : 7;
  }, []);

  useEffect(() => {
    let cancelled = false; const petAtlas = new Image(); const hatchAtlas = new Image(); petAtlas.decoding = "async"; hatchAtlas.decoding = "async";
    const loading = Promise.all([
      new Promise<void>((resolve, reject) => { petAtlas.onload = () => resolve(); petAtlas.onerror = reject; }),
      new Promise<void>((resolve, reject) => { hatchAtlas.onload = () => resolve(); hatchAtlas.onerror = reject; }),
    ]);
    petAtlas.src = pet.petUrl; hatchAtlas.src = pet.hatchUrl;
    loading.then(() => { if (!cancelled) { petImage.current = petAtlas; hatchImage.current = hatchAtlas; setReady(true); } }).catch(() => { if (!cancelled) setLoadError("This pet's atlases could not be loaded for the adventure."); });
    return () => { cancelled = true; petImage.current = null; hatchImage.current = null; };
  }, [pet.hatchUrl, pet.petUrl]);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const setKey = (event: KeyboardEvent, pressed: boolean) => {
      if (pressed && !gameRef.current?.contains(document.activeElement)) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (["arrowleft", "a"].includes(key)) inputRef.current.left = pressed;
      else if (["arrowright", "d"].includes(key)) inputRef.current.right = pressed;
      else if (["arrowup", "w", " "].includes(key)) { if (!event.repeat) inputRef.current.jump = pressed; }
      else if (["e", "x"].includes(key)) inputRef.current.interact = pressed;
      else if (["f", "z"].includes(key)) inputRef.current.fire = pressed;
      else if (key === "q" && pressed && !event.repeat) inputRef.current.nextWeapon = true;
      else if (["1", "2", "3"].includes(key) && pressed) inputRef.current.weaponSelect = (["wisp-bolt", "moon-arc", "beacon-pulse"] as WeaponId[])[Number(key) - 1];
      else return;
      event.preventDefault();
    };
    const down = (event: KeyboardEvent) => setKey(event, true); const up = (event: KeyboardEvent) => setKey(event, false); const clear = () => { inputRef.current = emptyInput(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", clear);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", clear); };
  }, []);

  const startGame = useCallback((seed?: number) => {
    if (!ready) return;
    const storedMuted = localStorage.getItem(SOUND_KEY) === "1"; mutedRef.current = storedMuted; setMuted(storedMuted); if (!storedMuted) ensureAudio();
    localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ mode, difficulty }));
    worldRef.current = createGameWorld({ mode, difficulty, seed: mode === "endless" ? seed ?? randomSeed() : 41721 });
    cameraRef.current = 0; particlesRef.current = []; completedRef.current = false; inputRef.current = emptyInput(); startedRef.current = true; setStarted(true); setUi(snapshot(worldRef.current));
    window.setTimeout(() => canvasRef.current?.focus(), 0);
  }, [difficulty, ensureAudio, mode, ready]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current; mutedRef.current = next; setMuted(next); localStorage.setItem(SOUND_KEY, next ? "1" : "0"); if (next) void audioRef.current?.suspend(); else ensureAudio();
  }, [ensureAudio]);
  const returnToSetup = useCallback(() => {
    startedRef.current = false;
    inputRef.current = emptyInput();
    setStarted(false);
  }, []);
  useEffect(() => () => { void audioRef.current?.close(); }, []);

  useEffect(() => {
    let raf = 0; let previous = performance.now(); let lastUi = 0;
    const render = (now: number) => {
      const canvas = canvasRef.current; const ctx = canvas?.getContext("2d"); const petAtlas = petImage.current; const hatchAtlas = hatchImage.current; const world = worldRef.current;
      const deltaMs = Math.min(40, Math.max(0, now - previous)); previous = now;
      if (startedRef.current && !document.hidden && petAtlas && hatchAtlas && !["won", "gameover", "upgrade"].includes(world.phase)) {
        const events = stepGame(world, inputRef.current, deltaMs); inputRef.current.jump = false; inputRef.current.nextWeapon = false; inputRef.current.weaponSelect = null;
        events.forEach((event) => { playEvent(event); spawnParticles(event, world); });
        if (world.result && !completedRef.current) { completedRef.current = true; onCompleteRef.current(pet.id, world.result); }
      }
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        const maxCamera = world.mode === "story" ? 1920 : Number.POSITIVE_INFINITY; const targetCamera = Math.max(0, Math.min(maxCamera, world.x - GAME_VIEW_W * 0.38));
        cameraRef.current = reducedMotion.current ? targetCamera : cameraRef.current + (targetCamera - cameraRef.current) * 0.08;
        const shake = reducedMotion.current ? 0 : shakeRef.current; const shakeX = shake ? Math.sin(now * 0.08) * shake : 0; const shakeY = shake ? Math.cos(now * 0.11) * shake * 0.55 : 0; shakeRef.current = Math.max(0, shake - deltaMs * 0.035);
        const camera = cameraRef.current - shakeX; const drawX = (x: number) => Math.round(x - camera);
        ctx.fillStyle = "#0d1713"; ctx.fillRect(0, 0, GAME_VIEW_W, GAME_VIEW_H);
        const palettes = [{ sky: "#17291f", far: "#274335", near: "#355b47", accent: "#a8f0d0" }, { sky: "#201d32", far: "#35304e", near: "#51466d", accent: "#b8a4ff" }, { sky: "#32261c", far: "#57442d", near: "#735d39", accent: "#ffc38f" }];
        const firstPanel = Math.max(0, Math.floor(camera / GAME_VIEW_W) - 1);
        for (let panel = firstPanel; panel <= firstPanel + 3; panel += 1) {
          const theme = world.mode === "story" ? Math.min(2, panel) : world.endlessRooms.find((room) => room.index === panel)?.theme ?? panel % 3; const palette = palettes[theme]; const left = panel * GAME_VIEW_W - camera;
          ctx.fillStyle = palette.sky; ctx.fillRect(left, 0, GAME_VIEW_W, GAME_VIEW_H); ctx.fillStyle = palette.far;
          for (let index = 0; index < 8; index += 1) ctx.fillRect(left + index * 145, 240 + (index * 37 % 100), 105, 240);
          ctx.fillStyle = palette.near; for (let index = 0; index < 12; index += 1) ctx.fillRect(left + index * 92, 350 + (index * 23 % 65), 64, 130);
          ctx.fillStyle = palette.accent; for (let index = 0; index < 16; index += 1) { ctx.globalAlpha = 0.25; ctx.fillRect(left + (index * 137 % GAME_VIEW_W), 55 + (index * 83 % 245), 3, 3); } ctx.globalAlpha = 1;
        }
        getPlatforms(world).forEach((platform) => { const rect = platformRect(platform, world.elapsedMs); ctx.fillStyle = platform.shortcut ? "rgba(184,164,255,.35)" : "#2f4d3d"; ctx.fillRect(drawX(rect.x), rect.y + shakeY, rect.width, rect.height); ctx.fillStyle = platform.shortcut ? "#b8a4ff" : "#a8f0d0"; ctx.fillRect(drawX(rect.x), rect.y + shakeY, rect.width, 6); });
        getClosedGates(world).forEach((gateX) => { ctx.fillStyle = "rgba(184,164,255,.24)"; ctx.fillRect(drawX(gateX), 90, 18, 390); ctx.fillStyle = "#b8a4ff"; for (let y = 110; y < 470; y += 28) ctx.fillRect(drawX(gateX + 5), y, 8, 12); });
        if (world.mode === "story") {
          MOONWELLS.forEach((well) => { ctx.fillStyle = world.shield ? "#a8f0d0" : "#36594a"; ctx.fillRect(drawX(well.x - 28), well.y + 29, 56, 12); ctx.globalAlpha = 0.22; ctx.fillRect(drawX(well.x - 20), well.y - 5, 40, 40); ctx.globalAlpha = 1; });
          ctx.fillStyle = world.reviewed ? "#c9f3a6" : "#6d6487"; ctx.fillRect(drawX(RUNE.x - 15), RUNE.y - 54, 30, 54);
          BEACONS.forEach((beacon, index) => { ctx.fillStyle = world.repaired[index] ? "#c9f3a6" : "#4c5f56"; ctx.fillRect(drawX(beacon.x - 17), beacon.y - 78, 34, 78); });
          ctx.fillStyle = world.guardianCleaned ? "#ffc38f" : "#554838"; ctx.fillRect(drawX(SANCTUARY.x - 42), SANCTUARY.y - 95, 84, 95);
          if (!world.wispRecruited) { ctx.fillStyle = "#a8f0d0"; ctx.fillRect(drawX(WISP.x - 7), WISP.y - 7, 14, 14); }
        }
        getCollectibles(world).forEach((bit, index) => { if (world.glowbits.has(bit.id)) return; const pulse = reducedMotion.current ? 0 : Math.sin(now / 160 + index) * 3; ctx.globalAlpha = 0.18; ctx.fillStyle = "#c9f3a6"; ctx.fillRect(drawX(bit.x - 17 - pulse), bit.y - 17 - pulse, 34 + pulse * 2, 34 + pulse * 2); ctx.globalAlpha = 1; ctx.fillStyle = "#f3f0dc"; ctx.fillRect(drawX(bit.x - 6), bit.y - 6, 12, 12); });
        getHazards(world).forEach((hazard, index) => { const rect = hazardRect(hazard, world.elapsedMs); ctx.fillStyle = index % 2 ? "#7b5c91" : "#8e4f57"; ctx.fillRect(drawX(rect.x), rect.y, rect.width, rect.height); ctx.fillStyle = "#ffc6b7"; ctx.fillRect(drawX(rect.x + 8), rect.y + 9, 6, 6); });
        world.enemies.forEach((enemy) => {
          const colors = { drifter: "#8e4f57", flock: "#b8a4ff", shell: "#6a766f", spitter: "#d48b61", guardian: "#ffc38f" }; ctx.fillStyle = colors[enemy.kind]; ctx.fillRect(drawX(enemy.x), enemy.y, enemy.width, enemy.height);
          if (enemy.armored) { ctx.strokeStyle = "#e2efd6"; ctx.lineWidth = 4; ctx.strokeRect(drawX(enemy.x - 3), enemy.y - 3, enemy.width + 6, enemy.height + 6); }
          ctx.fillStyle = "#111c17"; ctx.fillRect(drawX(enemy.x + enemy.width * 0.25), enemy.y + enemy.height * 0.25, 5, 5); ctx.fillRect(drawX(enemy.x + enemy.width * 0.65), enemy.y + enemy.height * 0.25, 5, 5);
          if (enemy.kind === "guardian") { ctx.fillStyle = "#111c17"; ctx.fillRect(drawX(enemy.x), enemy.y - 9, enemy.width, 5); ctx.fillStyle = "#a8f0d0"; ctx.fillRect(drawX(enemy.x), enemy.y - 9, enemy.width * enemy.hp / enemy.maxHp, 5); }
        });
        world.projectiles.forEach((projectile) => {
          const px = drawX(projectile.x);
          if (projectile.owner === "enemy") {
            ctx.fillStyle = "rgba(255,143,115,.3)"; ctx.fillRect(px - 4, projectile.y - 4, projectile.width + 8, projectile.height + 8);
            ctx.fillStyle = "#ff8f73"; ctx.fillRect(px + 2, projectile.y, projectile.width - 4, projectile.height); ctx.fillRect(px, projectile.y + 2, projectile.width, projectile.height - 4);
          } else if (projectile.weapon === "wisp-bolt") {
            const tail = projectile.vx > 0 ? px - 14 : px + projectile.width; ctx.fillStyle = "rgba(168,240,208,.35)"; ctx.fillRect(tail, projectile.y + 2, 14, 4);
            ctx.fillStyle = "#a8f0d0"; ctx.fillRect(px + 4, projectile.y, 10, 8); ctx.fillStyle = "#f3f0dc"; ctx.fillRect(px + 8, projectile.y + 2, 6, 4);
          } else if (projectile.weapon === "moon-arc") {
            ctx.globalAlpha = 0.28; ctx.fillStyle = "#b8a4ff"; ctx.fillRect(px - 5, projectile.y - 5, projectile.width + 10, projectile.height + 10); ctx.globalAlpha = 1;
            ctx.fillStyle = "#b8a4ff"; ctx.fillRect(px + projectile.width * .2, projectile.y, projectile.width * .35, projectile.height); ctx.fillRect(px, projectile.y + projectile.height * .2, projectile.width * .55, projectile.height * .6);
            ctx.fillStyle = "#f3f0dc"; ctx.fillRect(px + projectile.width * .22, projectile.y + projectile.height * .25, projectile.width * .18, projectile.height * .5);
          } else {
            const inset = Math.max(2, projectile.remainingMs / 180 * projectile.width * .35); ctx.strokeStyle = "rgba(255,195,143,.9)"; ctx.lineWidth = 5;
            ctx.strokeRect(px + inset, projectile.y + inset, Math.max(2, projectile.width - inset * 2), Math.max(2, projectile.height - inset * 2));
            ctx.strokeStyle = "rgba(92,246,255,.45)"; ctx.lineWidth = 2; ctx.strokeRect(px + inset + 8, projectile.y + inset + 8, Math.max(2, projectile.width - inset * 2 - 16), Math.max(2, projectile.height - inset * 2 - 16));
          }
          ctx.globalAlpha = 1;
        });
        if (world.wispRecruited) { const wx = world.x - 34; const wy = world.y + 18 + (reducedMotion.current ? 0 : Math.sin(now / 190) * 7); ctx.globalAlpha = 0.2; ctx.fillStyle = world.shield ? "#a8f0d0" : "#6c7b74"; ctx.fillRect(drawX(wx - 15), wy - 15, 30, 30); ctx.globalAlpha = 1; ctx.fillRect(drawX(wx - 6), wy - 6, 12, 12); }
        const atlas = world.phase === "hatching" ? hatchAtlas : petAtlas;
        if (atlas) {
          if (world.phase === "hatching") { const raw = Math.min(23, Math.floor(world.hatchElapsedMs / (HATCH_DURATION_MS / 24))); ctx.drawImage(atlas, raw % COLS * CELL_W, Math.floor(raw / COLS) * CELL_H, CELL_W, CELL_H, drawX(world.x - 25), world.y - 28, 96, 104); }
          else { let state = interactionState(world.interaction ?? world.gesture); if (!state && world.phase === "failed") state = "failed"; if (!state && !world.grounded) state = "jumping"; if (!state && Math.abs(world.vx) > 1) state = world.facing > 0 ? "running-right" : "running-left"; if (!state) state = "idle"; const clip = clips[state]; const frame = reducedMotion.current ? 0 : Math.floor(now * clip.fps / 1000) % clip.count; ctx.globalAlpha = world.invulnerableMs > 0 && Math.floor(now / 80) % 2 ? 0.45 : 1; ctx.drawImage(atlas, frame * CELL_W, clip.row * CELL_H, CELL_W, CELL_H, drawX(world.x - 25), world.y - 28 + shakeY, 96, 104); ctx.globalAlpha = 1; }
        }
        particlesRef.current = particlesRef.current.filter((particle) => particle.life > 0); particlesRef.current.forEach((particle) => { particle.life -= deltaMs / 1000; particle.x += particle.vx * deltaMs / 1000; particle.y += particle.vy * deltaMs / 1000; particle.vy += 180 * deltaMs / 1000; ctx.globalAlpha = Math.max(0, particle.life * 1.7); ctx.fillStyle = particle.color; ctx.fillRect(drawX(particle.x), particle.y, particle.size, particle.size); }); ctx.globalAlpha = 1;
      }
      if (now - lastUi > 90) { lastUi = now; setUi(snapshot(world)); }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render); return () => cancelAnimationFrame(raf);
  }, [pet.id, playEvent, spawnParticles]);

  const handleTouch = useCallback((event: React.PointerEvent<HTMLButtonElement>, key: keyof GameInput, pressed: boolean) => { event.preventDefault(); if (key === "weaponSelect") return; Object.assign(inputRef.current, { [key]: pressed }); if (pressed) canvasRef.current?.focus(); }, []);
  const chooseUpgrade = (upgrade: UpgradeId) => { if (selectEndlessUpgrade(worldRef.current, upgrade)) { setUi(snapshot(worldRef.current)); canvasRef.current?.focus(); } };
  const storyRecord = pet.gameRecord?.levelVersion === GAME_LEVEL_VERSION ? pet.gameRecord.story[difficulty] : undefined;
  const endlessRecord = pet.gameRecord?.levelVersion === GAME_LEVEL_VERSION ? pet.gameRecord.endless[difficulty] : undefined;
  const actionLabel = ui.context?.label ?? (ui.phase === "hatching" ? "Hatching…" : "Explore");

  return (
    <div className="pet-game beacon-game" ref={gameRef}>
      <div className="game-hud adventure-hud combat-hud">
        <div><span>{ui.mode === "story" ? "Beacons" : "Room"}</span><strong>{ui.mode === "story" ? `${ui.repaired.filter(Boolean).length} / 3` : ui.room + 1}</strong></div>
        <div><span>Hearts</span><strong>{"♥".repeat(ui.hearts)}<i>{"·".repeat(Math.max(0, ui.maxHearts - ui.hearts))}</i></strong></div>
        <div><span>Wisp shield</span><strong>{ui.shield ? "Ready" : "Empty"}</strong></div>
        <div><span>{ui.mode === "story" ? "Time" : "Score"}</span><strong>{ui.mode === "story" ? formatTime(ui.elapsedMs) : ui.score.toLocaleString()}</strong></div>
        <div className="weapon-hud"><span>Tool · {Math.ceil(ui.cooldown)}ms</span><strong>{weaponCopy[ui.selectedWeapon]}</strong></div>
        <button type="button" className="sound-toggle" onClick={toggleMute} aria-pressed={muted} disabled={!started}>{started ? muted ? "Sound off" : "Sound on" : "Sound on start"}</button>
      </div>
      <div className="game-objective"><span>{ui.mode === "story" ? zoneNames[ui.segment] : `${ui.difficulty} patrol · ${ui.combo}× combo`}</span><strong>{objective(ui)}</strong></div>
      <div className="game-canvas-wrap adventure-canvas-wrap">
        <canvas ref={canvasRef} className="game-canvas" width={GAME_VIEW_W} height={GAME_VIEW_H} tabIndex={0} role="img" aria-label={`${ui.mode === "story" ? "Beacon Rescue" : "Endless Patrol"} starring ${pet.description}`} />
        {started && ui.phase === "playing" && ui.mode === "story" && <div className={`context-prompt ${ui.context ? "available" : ""}`}><span>{actionLabel}</span>{ui.context && <b>Hold E / X</b>}{ui.progress > 0 && <i style={{ transform: `scaleX(${ui.progress})` }} />}</div>}
        {!started && <div className="game-overlay adventure-overlay setup-overlay">
          {loadError ? <><strong>Could not open the adventure</strong><p>{loadError}</p></> : <>
            <span className="game-kicker">Choose your run</span><strong>Beacon Wilds</strong><p>Restore the authored sanctuary or patrol an endless seeded frontier.</p>
            <div className="game-setup-group" aria-label="Game mode"><button type="button" className={mode === "story" ? "selected" : ""} onClick={() => setMode("story")}>Beacon Rescue<small>Story course + guardian</small></button><button type="button" className={mode === "endless" ? "selected" : ""} onClick={() => setMode("endless")}>Endless Patrol<small>Seeded rooms + upgrades</small></button></div>
            <div className="game-setup-group difficulty-picks" aria-label="Difficulty">{(["explorer", "adventure", "expert"] as GameDifficulty[]).map((choice) => <button type="button" className={difficulty === choice ? "selected" : ""} onClick={() => setDifficulty(choice)} key={choice}>{choice}</button>)}</div>
            <button type="button" className="begin-run" onClick={() => startGame()} disabled={!ready}>{ready ? "Begin run" : "Loading pet…"}</button>
          </>}
        </div>}
        {started && ui.phase === "upgrade" && <div className="game-overlay adventure-overlay upgrade-overlay"><span className="game-kicker">Patrol room {ui.room + 1}</span><strong>Choose one field upgrade</strong><div className="upgrade-grid">{ui.upgrades.map((upgrade) => <button type="button" onClick={() => chooseUpgrade(upgrade)} key={upgrade}><b>{upgradeCopy[upgrade].label}</b><small>{upgradeCopy[upgrade].detail}</small></button>)}</div></div>}
        {started && ui.phase === "won" && ui.result?.mode === "story" && <div className="game-overlay adventure-overlay result-overlay"><span className="game-kicker">Sanctuary restored · {ui.result.difficulty}</span><strong>{formatTime(ui.result.elapsedMs)}</strong><p>{ui.result.failures} failures · {ui.result.cleansed} shades cleansed · {ui.result.badges.length} badges</p><div className="result-badges">{(Object.keys(badgeCopy) as GameBadge[]).map((badge) => <span className={ui.result?.mode === "story" && ui.result.badges.includes(badge) ? "earned" : ""} key={badge}><b>{badgeCopy[badge].label}</b><small>{badgeCopy[badge].detail}</small></span>)}</div><div className="result-actions-inline"><button type="button" onClick={() => startGame()}>Replay story</button><button type="button" onClick={returnToSetup}>Change mode</button></div></div>}
        {started && ui.phase === "gameover" && ui.result?.mode === "endless" && <div className="game-overlay adventure-overlay result-overlay"><span className="game-kicker">Patrol ended · seed {ui.result.seed}</span><strong>{ui.result.score.toLocaleString()} points</strong><p>{ui.result.rooms} rooms · {ui.result.cleansed} shades · {formatTime(ui.result.elapsedMs)}</p><EndlessScoreSubmit result={ui.result} petName={pet.description} /><div className="result-actions-inline"><button type="button" onClick={() => startGame(ui.result?.mode === "endless" ? ui.result.seed : undefined)}>Retry seed</button><button type="button" onClick={() => startGame()}>New seed</button><button type="button" onClick={returnToSetup}>Change mode</button></div></div>}
      </div>
      <div className="game-minimap" aria-label="Adventure progress">{ui.mode === "story" ? zoneNames.map((name, index) => <span className={ui.segment === index ? "current" : ui.repaired[index] ? "complete" : ""} key={name}><i />{name}</span>) : <><span className="complete"><i />Score {ui.score.toLocaleString()}</span><span className="current"><i />Room {ui.room + 1}</span><span><i />Seed {ui.seed}</span></>}</div>
      <div className="weapon-deck" aria-label="Guardian tool designs">
        {(["wisp-bolt", "moon-arc", "beacon-pulse"] as WeaponId[]).map((weapon) => {
          const unlocked = ui.unlockedWeapons.includes(weapon);
          return <button type="button" className={`${weapon} ${ui.selectedWeapon === weapon ? "selected" : ""}`} disabled={!started || !unlocked} onClick={() => { inputRef.current.weaponSelect = weapon; canvasRef.current?.focus(); }} key={weapon}><i className="weapon-mark" aria-hidden="true" /><span><small>{weaponDetails[weapon].code} · {weaponDetails[weapon].role}</small><b>{weaponCopy[weapon]}</b><em>{unlocked ? weaponDetails[weapon].detail : "Discover this tool in Beacon Rescue."}</em></span></button>;
        })}
      </div>
      <div className="game-controls adventure-controls combat-controls" aria-label="Touch game controls">
        <button type="button" aria-label="Move left" onPointerDown={(event) => handleTouch(event, "left", true)} onPointerUp={(event) => handleTouch(event, "left", false)} onPointerCancel={(event) => handleTouch(event, "left", false)}>←</button>
        <button type="button" aria-label="Move right" onPointerDown={(event) => handleTouch(event, "right", true)} onPointerUp={(event) => handleTouch(event, "right", false)} onPointerCancel={(event) => handleTouch(event, "right", false)}>→</button>
        <button type="button" className="jump-control" onPointerDown={(event) => handleTouch(event, "jump", true)} onPointerUp={(event) => handleTouch(event, "jump", false)}>Jump</button>
        <button type="button" className="action-control" onPointerDown={(event) => handleTouch(event, "interact", true)} onPointerUp={(event) => handleTouch(event, "interact", false)}>{ui.context ? "Action" : "Use"}</button>
        <button type="button" className="fire-control" onPointerDown={(event) => handleTouch(event, "fire", true)} onPointerUp={(event) => handleTouch(event, "fire", false)} onPointerCancel={(event) => handleTouch(event, "fire", false)}>Fire</button>
        <button type="button" className="weapon-control" onClick={() => { inputRef.current.nextWeapon = true; canvasRef.current?.focus(); }}>{weaponCopy[ui.selectedWeapon]}</button>
      </div>
      <div className="game-footer-status"><p>Move A/D · Jump W/Space · Action E/X · Fire F/Z · Switch Q or 1–3</p><p>{ui.mode === "story" ? `Best ${formatTime(storyRecord?.bestTimeMs)} · Badges ${storyRecord?.badges.length ?? 0}/4 · Failures ${ui.failures}` : `Best ${endlessRecord?.bestScore.toLocaleString() ?? "—"} · Rooms ${endlessRecord?.bestRooms ?? 0}`}</p></div>
      <EndlessLeaderboard activeDifficulty={ui.difficulty} key={ui.difficulty} />
      <p className="sr-status" aria-live="polite">{objective(ui)} {ui.context?.label ?? ""}</p>
    </div>
  );
}
