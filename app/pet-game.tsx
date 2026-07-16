"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BEACONS,
  GAME_LEVEL_VERSION,
  GAME_VIEW_H,
  GAME_VIEW_W,
  GAME_WORLD_W,
  GLOWBITS,
  HAZARDS,
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
  getContextAction,
  getPlatforms,
  hazardRect,
  interactionProgress,
  platformRect,
  stepGame,
  type GameBadge,
  type GameEvent,
  type GameInput,
  type GameRecord,
  type GameResult,
  type GameWorld,
  type InteractionKind,
} from "./game-engine";

const CELL_W = 192;
const CELL_H = 208;
const COLS = 8;
const SOUND_KEY = "hatchframe-game-muted";

const clips: Record<string, { row: number; count: number; fps: number }> = {
  idle: { row: 0, count: 6, fps: 6 },
  "running-right": { row: 1, count: 8, fps: 11 },
  "running-left": { row: 2, count: 8, fps: 11 },
  waving: { row: 3, count: 4, fps: 7 },
  jumping: { row: 4, count: 5, fps: 9 },
  failed: { row: 5, count: 8, fps: 7 },
  waiting: { row: 6, count: 6, fps: 5 },
  working: { row: 7, count: 6, fps: 9 },
  review: { row: 8, count: 6, fps: 6 },
};

const badgeCopy: Record<GameBadge, { label: string; detail: string }> = {
  "steady-heart": { label: "Steady heart", detail: "Finish without a checkpoint failure" },
  glowkeeper: { label: "Glowkeeper", detail: "Find every optional Glowbit" },
  "sky-runner": { label: "Sky runner", detail: "Complete a revealed upper shortcut" },
};

const zoneNames = ["Moonlit Grove", "Rune Ruins", "Sky Workshop"];

export type GamePet = {
  id: string;
  description: string;
  petUrl: string;
  hatchUrl: string;
  gameRecord?: GameRecord;
};

type GameUi = {
  phase: GameWorld["phase"];
  elapsedMs: number;
  failures: number;
  shield: number;
  repaired: boolean[];
  glowbits: number;
  wispRecruited: boolean;
  segment: number;
  context: ReturnType<typeof getContextAction>;
  progress: number;
  hintSegment: number | null;
  result?: GameResult;
};

type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };

function snapshot(world: GameWorld): GameUi {
  return {
    phase: world.phase,
    elapsedMs: world.elapsedMs,
    failures: world.failures,
    shield: world.shield,
    repaired: [...world.repaired],
    glowbits: world.glowbits.size,
    wispRecruited: world.wispRecruited,
    segment: currentSegment(world),
    context: getContextAction(world),
    progress: interactionProgress(world),
    hintSegment: world.hintSegment,
    result: world.result,
  };
}

function formatTime(milliseconds?: number) {
  if (typeof milliseconds !== "number") return "—";
  const total = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return minutes ? `${minutes}:${seconds.toFixed(1).padStart(4, "0")}` : `${seconds.toFixed(1)}s`;
}

function objective(world: GameUi) {
  if (world.phase === "hatching") return "A new adventure is hatching…";
  if (!world.repaired[0]) return world.wispRecruited ? "Recharge at the moonwell, then restore the grove beacon." : "Wave to the Wisp and earn its shield.";
  if (!world.repaired[1]) return "Review the rune, choose a route, and restore the ruins beacon.";
  if (!world.repaired[2]) return "Cross the workshop and restore the final beacon.";
  return "Reach the sanctuary and awaken it.";
}

function interactionState(kind: InteractionKind | null) {
  if (kind === "wave" || kind === "sanctuary") return "waving";
  if (kind === "wait") return "waiting";
  if (kind === "review") return "review";
  if (kind === "work") return "working";
  return null;
}

export default function PetGame({ pet, onComplete }: { pet: GamePet; onComplete: (petId: string, result: GameResult) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<HTMLDivElement>(null);
  const petImage = useRef<HTMLImageElement | null>(null);
  const hatchImage = useRef<HTMLImageElement | null>(null);
  const worldRef = useRef(createGameWorld());
  const startedRef = useRef(false);
  const inputRef = useRef<GameInput>({ left: false, right: false, jump: false, interact: false });
  const cameraRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const mutedRef = useRef(false);
  const nextAmbientRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  const completedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [ui, setUi] = useState<GameUi>(() => snapshot(createGameWorld()));
  const reducedMotion = useRef(false);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  const ensureAudio = useCallback(() => {
    if (mutedRef.current) return null;
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    if (!audioRef.current) audioRef.current = new AudioCtor();
    void audioRef.current.resume();
    return audioRef.current;
  }, []);

  const tone = useCallback((frequency: number, duration = 0.12, type: OscillatorType = "square", volume = 0.025, delay = 0) => {
    const audio = ensureAudio();
    if (!audio || mutedRef.current) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }, [ensureAudio]);

  const playEvent = useCallback((event: GameEvent) => {
    if (event.type === "jump") tone(240, 0.09, "square", 0.018);
    else if (event.type === "wisp") { tone(420, 0.16); tone(630, 0.2, "square", 0.02, 0.1); }
    else if (event.type === "charged") { tone(330, 0.18, "sine", 0.035); tone(660, 0.22, "sine", 0.025, 0.12); }
    else if (event.type === "reviewed") { tone(280, 0.12); tone(420, 0.12, "square", 0.02, 0.1); tone(560, 0.16, "square", 0.02, 0.2); }
    else if (event.type === "glowbit") { tone(720, 0.08); tone(960, 0.12, "square", 0.018, 0.06); }
    else if (event.type === "beacon") { tone(220, 0.2, "sawtooth", 0.02); tone(440, 0.35, "sine", 0.03, 0.14); }
    else if (event.type === "shield-broken") tone(105, 0.28, "sawtooth", 0.04);
    else if (event.type === "failed") tone(82, 0.42, "square", 0.04);
    else if (event.type === "won") { [440, 554, 660, 880].forEach((note, index) => tone(note, 0.35, "square", 0.025, index * 0.12)); }
  }, [tone]);

  const spawnParticles = useCallback((event: GameEvent, world: GameWorld) => {
    if (reducedMotion.current) return;
    const colors = event.type === "failed" ? ["#ff8f73", "#b8a4ff"] : event.type === "shield-broken" ? ["#a8f0d0", "#ffffff"] : ["#c9f3a6", "#a8f0d0", "#b8a4ff"];
    if (!["glowbit", "beacon", "wisp", "charged", "reviewed", "shield-broken", "failed", "won"].includes(event.type)) return;
    for (let index = 0; index < (event.type === "won" ? 32 : 14); index += 1) {
      const angle = index * 2.399 + world.elapsedMs * 0.001;
      const speed = 35 + (index % 5) * 18;
      particlesRef.current.push({
        x: world.x + PLAYER_W / 2, y: world.y + PLAYER_H / 2,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 25,
        life: 0.45 + (index % 4) * 0.1, color: colors[index % colors.length], size: 3 + index % 3,
      });
    }
    if (event.type === "failed" || event.type === "shield-broken") shakeRef.current = event.type === "failed" ? 12 : 7;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const petAtlas = new Image();
    const hatchAtlas = new Image();
    petAtlas.decoding = "async";
    hatchAtlas.decoding = "async";
    const loading = Promise.all([
      new Promise<void>((resolve, reject) => { petAtlas.onload = () => resolve(); petAtlas.onerror = reject; }),
      new Promise<void>((resolve, reject) => { hatchAtlas.onload = () => resolve(); hatchAtlas.onerror = reject; }),
    ]);
    petAtlas.src = pet.petUrl;
    hatchAtlas.src = pet.hatchUrl;
    loading.then(() => {
      if (cancelled) return;
      petImage.current = petAtlas;
      hatchImage.current = hatchAtlas;
      setReady(true);
    }).catch(() => { if (!cancelled) setLoadError("This pet's atlases could not be loaded for the adventure."); });
    return () => { cancelled = true; petImage.current = null; hatchImage.current = null; };
  }, [pet.hatchUrl, pet.petUrl]);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const setKey = (event: KeyboardEvent, pressed: boolean) => {
      if (pressed && !gameRef.current?.contains(document.activeElement)) return;
      const key = event.key.toLowerCase();
      if (["arrowleft", "a"].includes(key)) inputRef.current.left = pressed;
      else if (["arrowright", "d"].includes(key)) inputRef.current.right = pressed;
      else if (["arrowup", "w", " "].includes(key)) {
        if (!event.repeat) inputRef.current.jump = pressed;
      } else if (["e", "x"].includes(key)) inputRef.current.interact = pressed;
      else return;
      event.preventDefault();
    };
    const down = (event: KeyboardEvent) => setKey(event, true);
    const up = (event: KeyboardEvent) => setKey(event, false);
    const clear = () => { inputRef.current = { left: false, right: false, jump: false, interact: false }; };
    const visibility = () => {
      clear();
      if (document.hidden) void audioRef.current?.suspend();
      else if (!mutedRef.current && startedRef.current) void audioRef.current?.resume();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  const startGame = useCallback(() => {
    if (!ready) return;
    const storedMuted = localStorage.getItem(SOUND_KEY) === "1";
    mutedRef.current = storedMuted;
    setMuted(storedMuted);
    if (!storedMuted) ensureAudio();
    worldRef.current = createGameWorld();
    cameraRef.current = 0;
    particlesRef.current = [];
    completedRef.current = false;
    nextAmbientRef.current = 700;
    inputRef.current = { left: false, right: false, jump: false, interact: false };
    startedRef.current = true;
    setStarted(true);
    setUi(snapshot(worldRef.current));
    window.setTimeout(() => canvasRef.current?.focus(), 0);
  }, [ensureAudio, ready]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    localStorage.setItem(SOUND_KEY, next ? "1" : "0");
    if (next) void audioRef.current?.suspend();
    else ensureAudio();
  }, [ensureAudio]);

  useEffect(() => () => { void audioRef.current?.close(); }, []);

  useEffect(() => {
    let raf = 0;
    let previous = performance.now();
    let lastUi = 0;
    const render = (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const petAtlas = petImage.current;
      const hatchAtlas = hatchImage.current;
      const world = worldRef.current;
      const deltaMs = Math.min(40, Math.max(0, now - previous));
      previous = now;

      if (startedRef.current && !document.hidden && petAtlas && hatchAtlas && world.phase !== "won") {
        const events = stepGame(world, inputRef.current, deltaMs);
        inputRef.current.jump = false;
        events.forEach((event) => { playEvent(event); spawnParticles(event, world); });
        if (!mutedRef.current && world.phase === "playing" && world.elapsedMs >= nextAmbientRef.current) {
          const notes = [110, 165, 220, 165];
          tone(notes[Math.floor(world.elapsedMs / 700) % notes.length], 0.42, "sine", 0.009);
          nextAmbientRef.current = world.elapsedMs + 700;
        }
        if (world.result && !completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current(pet.id, world.result);
        }
      }

      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        const targetCamera = Math.max(0, Math.min(GAME_WORLD_W - GAME_VIEW_W, world.x - GAME_VIEW_W * 0.38));
        cameraRef.current = reducedMotion.current ? targetCamera : cameraRef.current + (targetCamera - cameraRef.current) * 0.08;
        const shake = reducedMotion.current ? 0 : shakeRef.current;
        const shakeX = shake ? Math.sin(now * 0.08) * shake : 0;
        const shakeY = shake ? Math.cos(now * 0.11) * shake * 0.55 : 0;
        shakeRef.current = Math.max(0, shake - deltaMs * 0.035);
        const camera = cameraRef.current - shakeX;

        ctx.fillStyle = "#0d1713";
        ctx.fillRect(0, 0, GAME_VIEW_W, GAME_VIEW_H);
        const palettes = [
          { sky: "#17291f", far: "#274335", near: "#355b47", accent: "#a8f0d0" },
          { sky: "#201d32", far: "#35304e", near: "#51466d", accent: "#b8a4ff" },
          { sky: "#32261c", far: "#57442d", near: "#735d39", accent: "#ffc38f" },
        ];
        palettes.forEach((palette, zone) => {
          const left = zone * GAME_VIEW_W - camera;
          ctx.fillStyle = palette.sky;
          ctx.fillRect(left, 0, GAME_VIEW_W, GAME_VIEW_H);
          ctx.fillStyle = palette.far;
          for (let index = 0; index < 8; index += 1) {
            const x = left + index * 145 - (reducedMotion.current ? 0 : camera * 0.035 % 145);
            const height = 70 + ((index * 37 + zone * 19) % 110);
            ctx.fillRect(x, GAME_VIEW_H - 180 - height, 105, height);
          }
          ctx.fillStyle = palette.near;
          for (let index = 0; index < 12; index += 1) {
            const x = left + index * 92;
            const height = 28 + ((index * 23 + zone * 31) % 75);
            ctx.fillRect(x, GAME_VIEW_H - 92 - height, 64, height);
          }
          ctx.fillStyle = palette.accent;
          for (let index = 0; index < 20; index += 1) {
            const x = left + ((index * 137 + zone * 71) % GAME_VIEW_W);
            const y = 55 + ((index * 83 + zone * 29) % 245);
            ctx.globalAlpha = 0.2 + (index % 3) * 0.12;
            ctx.fillRect(x, y, index % 4 === 0 ? 4 : 2, index % 4 === 0 ? 4 : 2);
          }
          ctx.globalAlpha = 1;
        });

        const drawX = (x: number) => Math.round(x - camera);
        getPlatforms(world).forEach((platform) => {
          const rect = platformRect(platform, world.elapsedMs);
          ctx.fillStyle = platform.shortcut ? "rgba(184,164,255,.35)" : "#2f4d3d";
          ctx.fillRect(drawX(rect.x), rect.y + shakeY, rect.width, rect.height);
          ctx.fillStyle = platform.shortcut ? "#b8a4ff" : "#a8f0d0";
          ctx.fillRect(drawX(rect.x), rect.y + shakeY, rect.width, 6);
        });

        getClosedGates(world).forEach((gateX) => {
          ctx.fillStyle = "rgba(184,164,255,.22)";
          ctx.fillRect(drawX(gateX), 90, 18, 390);
          ctx.fillStyle = "#b8a4ff";
          for (let y = 110; y < 470; y += 28) ctx.fillRect(drawX(gateX + 5), y, 8, 12);
        });

        MOONWELLS.forEach((well, index) => {
          ctx.fillStyle = world.shield && (index > 0 || world.moonwellCharged) ? "#a8f0d0" : "#36594a";
          ctx.fillRect(drawX(well.x - 28), well.y + 29, 56, 12);
          ctx.globalAlpha = 0.22 + Math.sin(now / 260) * 0.08;
          ctx.fillStyle = "#a8f0d0";
          ctx.fillRect(drawX(well.x - 20), well.y - 5, 40, 40);
          ctx.globalAlpha = 1;
        });

        ctx.fillStyle = world.reviewed ? "#c9f3a6" : "#6d6487";
        ctx.fillRect(drawX(RUNE.x - 15), RUNE.y - 54, 30, 54);
        ctx.fillStyle = "#f3f0dc";
        ctx.fillRect(drawX(RUNE.x - 5), RUNE.y - 42, 10, 10);

        BEACONS.forEach((beacon, index) => {
          const active = world.repaired[index];
          ctx.fillStyle = active ? "#c9f3a6" : "#4c5f56";
          ctx.fillRect(drawX(beacon.x - 17), beacon.y - 78, 34, 78);
          ctx.fillStyle = active ? "#f3f0dc" : "#22362d";
          ctx.fillRect(drawX(beacon.x - 8), beacon.y - 65, 16, 16);
          if (active) {
            ctx.globalAlpha = 0.12 + Math.sin(now / 220 + index) * 0.04;
            ctx.fillStyle = "#c9f3a6";
            ctx.fillRect(drawX(beacon.x - 42), beacon.y - 103, 84, 103);
            ctx.globalAlpha = 1;
          }
        });

        ctx.fillStyle = world.repaired.every(Boolean) ? "#ffc38f" : "#554838";
        ctx.fillRect(drawX(SANCTUARY.x - 42), SANCTUARY.y - 95, 84, 95);
        ctx.fillStyle = "#f3f0dc";
        ctx.fillRect(drawX(SANCTUARY.x - 13), SANCTUARY.y - 64, 26, 26);

        GLOWBITS.forEach((bit, index) => {
          if (world.glowbits.has(index)) return;
          const pulse = reducedMotion.current ? 0 : Math.sin(now / 160 + index) * 3;
          ctx.globalAlpha = 0.16;
          ctx.fillStyle = "#c9f3a6";
          ctx.fillRect(drawX(bit.x - 17 - pulse), bit.y - 17 - pulse, 34 + pulse * 2, 34 + pulse * 2);
          ctx.globalAlpha = 1;
          ctx.fillStyle = index % 2 ? "#b8a4ff" : "#c9f3a6";
          ctx.fillRect(drawX(bit.x - 7), bit.y - 7, 14, 14);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(drawX(bit.x - 2), bit.y - 2, 4, 4);
        });

        HAZARDS.forEach((hazard, index) => {
          const rect = hazardRect(hazard, world.elapsedMs);
          if (world.revealRemainingMs > 0 || world.hintSegment === currentSegment(world)) {
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = "#ff8f73";
            ctx.fillRect(drawX(rect.x - 12), rect.y - 12, rect.width + 24, rect.height + 24);
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = index % 2 ? "#7b5c91" : "#8e4f57";
          ctx.fillRect(drawX(rect.x), rect.y, rect.width, rect.height);
          ctx.fillStyle = "#ffc6b7";
          ctx.fillRect(drawX(rect.x + 8), rect.y + 9, 6, 6);
          ctx.fillRect(drawX(rect.x + rect.width - 14), rect.y + 9, 6, 6);
        });

        if (world.hintSegment !== null && world.hintSegment === currentSegment(world)) {
          ctx.fillStyle = "#ffc38f";
          ctx.font = "900 15px ui-monospace, monospace";
          ctx.fillText("SAFE PATH →", 32, 105);
        }

        if (world.wispRecruited) {
          const wispX = world.x - 36 - world.facing * 8;
          const wispY = world.y + 18 + (reducedMotion.current ? 0 : Math.sin(now / 190) * 8);
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = world.shield ? "#a8f0d0" : "#6c7b74";
          ctx.fillRect(drawX(wispX - 15), wispY - 15, 30, 30);
          ctx.globalAlpha = 1;
          ctx.fillRect(drawX(wispX - 6), wispY - 6, 12, 12);
        } else {
          ctx.fillStyle = "#a8f0d0";
          ctx.fillRect(drawX(WISP.x - 7), WISP.y - 7 + Math.sin(now / 180) * 5, 14, 14);
        }

        const atlas = world.phase === "hatching" ? hatchAtlas : petAtlas;
        if (atlas) {
          if (world.phase === "hatching") {
            const raw = Math.min(23, Math.floor(world.hatchElapsedMs / (HATCH_DURATION_MS / 24)));
            const col = raw % COLS;
            const row = Math.floor(raw / COLS);
            ctx.drawImage(atlas, col * CELL_W, row * CELL_H, CELL_W, CELL_H, drawX(world.x - 25), world.y - 28, 96, 104);
          } else {
            let state = interactionState(world.interaction ?? world.gesture);
            if (!state && world.phase === "failed") state = "failed";
            if (!state && world.phase === "won") state = "waving";
            if (!state && !world.grounded) state = "jumping";
            if (!state && Math.abs(world.vx) > 1) state = world.facing > 0 ? "running-right" : "running-left";
            if (!state) state = "idle";
            const clip = clips[state];
            const frame = reducedMotion.current ? 0 : Math.floor(now * clip.fps / 1000) % clip.count;
            ctx.globalAlpha = world.invulnerableMs > 0 && Math.floor(now / 80) % 2 ? 0.45 : 1;
            ctx.drawImage(atlas, frame * CELL_W, clip.row * CELL_H, CELL_W, CELL_H, drawX(world.x - 25), world.y - 28 + shakeY, 96, 104);
            ctx.globalAlpha = 1;
          }
        }

        particlesRef.current = particlesRef.current.filter((particle) => particle.life > 0);
        particlesRef.current.forEach((particle) => {
          particle.life -= deltaMs / 1000;
          particle.x += particle.vx * deltaMs / 1000;
          particle.y += particle.vy * deltaMs / 1000;
          particle.vy += 180 * deltaMs / 1000;
          ctx.globalAlpha = Math.max(0, particle.life * 1.7);
          ctx.fillStyle = particle.color;
          ctx.fillRect(drawX(particle.x), particle.y, particle.size, particle.size);
        });
        ctx.globalAlpha = 1;
      }

      if (now - lastUi > 90) {
        lastUi = now;
        setUi(snapshot(world));
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [pet.id, playEvent, spawnParticles, tone]);

  const handleTouch = useCallback((event: React.PointerEvent<HTMLButtonElement>, key: keyof GameInput, pressed: boolean) => {
    event.preventDefault();
    inputRef.current[key] = pressed;
    if (pressed) canvasRef.current?.focus();
  }, []);

  const bestTime = pet.gameRecord?.levelVersion === GAME_LEVEL_VERSION ? pet.gameRecord.bestTimeMs : undefined;
  const earned = pet.gameRecord?.levelVersion === GAME_LEVEL_VERSION ? pet.gameRecord.badges : [];
  const actionLabel = ui.context?.label ?? (ui.phase === "hatching" ? "Hatching…" : "Explore");

  return (
    <div className="pet-game beacon-game" ref={gameRef}>
      <div className="game-hud adventure-hud">
        <div><span>Beacons</span><strong>{ui.repaired.filter(Boolean).length} / 3</strong></div>
        <div><span>Wisp shield</span><strong>{ui.shield ? "Ready" : "Empty"}</strong></div>
        <div><span>Glowbits</span><strong>{ui.glowbits} / 5</strong></div>
        <div><span>Time</span><strong>{formatTime(ui.elapsedMs)}</strong></div>
        <button type="button" className="sound-toggle" onClick={toggleMute} aria-pressed={muted} disabled={!started}>{started ? muted ? "Sound off" : "Sound on" : "Sound on start"}</button>
      </div>
      <div className="game-objective"><span>{zoneNames[ui.segment]}</span><strong>{objective(ui)}</strong></div>
      <div className="game-canvas-wrap adventure-canvas-wrap">
        <canvas ref={canvasRef} className="game-canvas" width={GAME_VIEW_W} height={GAME_VIEW_H} tabIndex={0} role="img" aria-label={`Beacon Rescue starring ${pet.description}`} />
        {started && ui.phase !== "won" && <div className={`context-prompt ${ui.context ? "available" : ""}`}><span>{actionLabel}</span>{ui.context && <b>Hold E / X</b>}{ui.progress > 0 && <i style={{ transform: `scaleX(${ui.progress})` }} />}</div>}
        {!started && (
          <div className="game-overlay adventure-overlay">
            {loadError ? <><strong>Could not open Beacon Rescue</strong><p>{loadError}</p></> : <><span className="game-kicker">Three rooms · three beacons · many routes</span><strong>Beacon Rescue</strong><p>Recruit a Wisp, read the ruins, balance risk and safety, and awaken the sanctuary.</p><button type="button" onClick={startGame} disabled={!ready}>{ready ? "Begin adventure" : "Loading pet…"}</button></>}
          </div>
        )}
        {started && ui.phase === "won" && ui.result && (
          <div className="game-overlay adventure-overlay result-overlay">
            <span className="game-kicker">Sanctuary restored</span>
            <strong>{formatTime(ui.result.elapsedMs)}</strong>
            <p>{ui.result.failures} failures · {ui.result.glowbits}/5 Glowbits · {ui.result.badges.length} badges</p>
            <div className="result-badges">
              {(Object.keys(badgeCopy) as GameBadge[]).map((badge) => <span className={ui.result?.badges.includes(badge) ? "earned" : ""} key={badge}><b>{badgeCopy[badge].label}</b><small>{badgeCopy[badge].detail}</small></span>)}
            </div>
            <button type="button" onClick={startGame}>Replay adventure</button>
          </div>
        )}
      </div>
      <div className="game-minimap" aria-label="Adventure progress">
        {zoneNames.map((name, index) => <span className={ui.segment === index ? "current" : ui.repaired[index] ? "complete" : ""} key={name}><i />{name}</span>)}
      </div>
      <div className="game-controls adventure-controls" aria-label="Touch game controls">
        <button type="button" aria-label="Move left" onPointerDown={(event) => handleTouch(event, "left", true)} onPointerUp={(event) => handleTouch(event, "left", false)} onPointerCancel={(event) => handleTouch(event, "left", false)} onPointerLeave={(event) => handleTouch(event, "left", false)}>←</button>
        <button type="button" aria-label="Move right" onPointerDown={(event) => handleTouch(event, "right", true)} onPointerUp={(event) => handleTouch(event, "right", false)} onPointerCancel={(event) => handleTouch(event, "right", false)} onPointerLeave={(event) => handleTouch(event, "right", false)}>→</button>
        <button type="button" className="jump-control" aria-label="Jump" onPointerDown={(event) => handleTouch(event, "jump", true)} onPointerUp={(event) => handleTouch(event, "jump", false)} onPointerCancel={(event) => handleTouch(event, "jump", false)}>Jump ↑</button>
        <button type="button" className="action-control" aria-label={actionLabel} onPointerDown={(event) => handleTouch(event, "interact", true)} onPointerUp={(event) => handleTouch(event, "interact", false)} onPointerCancel={(event) => handleTouch(event, "interact", false)}>{ui.context ? ui.context.kind : "Action"}</button>
      </div>
      <div className="game-footer-status">
        <p>Move A/D or ←/→ · Jump W, ↑ or Space · Context action E or X</p>
        <p>Best {formatTime(bestTime)} · Badges {earned.length}/3 · Failures this run {ui.failures}</p>
      </div>
      <p className="sr-status" aria-live="polite">{objective(ui)} {ui.context?.label ?? ""}</p>
    </div>
  );
}
