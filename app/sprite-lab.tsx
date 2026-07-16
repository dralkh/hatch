"use client";

import { unzipSync } from "fflate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloudBrowserBackend,
  DEFAULT_PROVIDERS,
  DirectLocalBrowserBackend,
  FalBrowserBackend,
  LocalBrowserBackend,
  discoverProviders,
  isCloudProviderId,
  isHostedCloudProviderId,
  selectPreferredProvider,
  type BrowserGenerationBackend,
  type CloudProviderId,
  type LocalProviderId,
  type ProviderId,
  type ProviderSummary,
  type WorkflowObject,
  type WorkflowOverrides,
} from "./generation-client";
import { GAME_LEVEL_VERSION, mergeGameRecord, type GameRecord, type GameResult } from "./game-engine";
import BeaconGame from "./pet-game";
import { buildHatchPackage, buildHermesPackage } from "./pet-packages";

const CELL_W = 192;
const CELL_H = 208;
const COLS = 8;
const PET_ROWS = 9;
const HATCH_ROWS = 3;
const PET_WIDTH = CELL_W * COLS;
const PET_HEIGHT = CELL_H * PET_ROWS;
const HATCH_HEIGHT = CELL_H * HATCH_ROWS;

type ArtStyle = "pixel" | "toon" | "plush";
type StateId = "idle" | "running-right" | "running-left" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review";
type PreviewState = "hatch" | StateId;
type Stage = "idle" | "anchor" | "generating" | "packing" | "ready" | "error";
type JobStatus = "waiting" | "generating" | "cleaning" | "passed" | "warning" | "mirrored" | "error";

type RowSpec = {
  id: StateId;
  label: string;
  count: number;
  fps: number;
  loop: boolean;
  phases: string[];
  mirrorOf?: StateId;
};

type RowQa = {
  pass: boolean;
  critical: boolean;
  score: number;
  reasons: string[];
  width: number;
  height: number;
};

type RowAsset = { frames: CleanFrame[]; qa: RowQa; attempts: number };
type RowEntry = readonly [StateId, RowAsset];
type PackingCache = { rowEntries: RowEntry[]; hatchUrl: string; provider: ProviderId };
type JobState = { status: JobStatus; detail: string; score?: number };
type FrameBox = { x: number; y: number; width: number; height: number; opaque: number; edge: number; multiple: boolean };
type CleanFrame = { canvas: HTMLCanvasElement; box: FrameBox };
type Cutout = { blob: Blob; url: string; transparentRatio: number };
type SavedPet = {
  id: string;
  description: string;
  artStyle?: ArtStyle;
  createdAt: string;
  petBlob: Blob;
  hatchBlob: Blob;
  score?: number;
  hatchSource?: string;
  source?: "generated" | "imported";
  provider?: ProviderId;
  bestTimeMs?: number;
  gameRecord?: GameRecord;
};

type PlayablePet = SavedPet & { petUrl: string; hatchUrl: string };
type Artifact = PlayablePet & {
  artStyle: ArtStyle;
  score: number;
  hatchSource: "local 24-frame hatch";
  source: "generated";
  provider: ProviderId;
};

const rows: RowSpec[] = [
  { id: "idle", label: "Idle", count: 6, fps: 6, loop: true, phases: ["neutral relaxed stance", "gentle inhale with chest slightly raised", "breath crest with a tiny ear or wing response", "soft exhale", "small blink and tail response", "return to the exact neutral stance"] },
  { id: "running-right", label: "Run right", count: 8, fps: 11, loop: true, phases: ["right-facing run contact pose, front foot landing", "right-facing run recoil pose", "right-facing low passing pose", "right-facing airborne pose", "opposite foot contact pose", "opposite recoil pose", "opposite passing pose", "second airborne pose that loops to the first"] },
  { id: "running-left", label: "Run left", count: 8, fps: 11, loop: true, phases: [], mirrorOf: "running-right" },
  { id: "waving", label: "Wave", count: 4, fps: 7, loop: false, phases: ["friendly ready stance", "one paw or wing raised to begin a wave", "wave at its highest cheerful peak", "relaxed return toward neutral"] },
  { id: "jumping", label: "Jump", count: 5, fps: 9, loop: false, phases: ["anticipation crouch", "strong takeoff", "high celebratory apex", "soft landing compression", "upright recovery"] },
  { id: "failed", label: "Failed", count: 8, fps: 7, loop: false, phases: ["noticing a harmless mistake", "surprised reaction", "small backward wobble", "disappointed slump", "brief disappointed hold", "steadying the body", "recovering confidence", "calm return; no injury or gore"] },
  { id: "waiting", label: "Waiting", count: 6, fps: 5, loop: true, phases: ["patient neutral stance", "quiet glance to the side", "tiny weight shift", "single relaxed blink", "soft breath", "return to patient neutral, awake and calm"] },
  { id: "running", label: "Working", count: 6, fps: 9, loop: true, phases: ["focused work-in-place stance", "energetic forward lean without traveling", "active paw, wing or tool-free processing gesture", "peak energetic work pose", "small recoil", "return to focused stance on the same pivot"] },
  { id: "review", label: "Review", count: 6, fps: 6, loop: true, phases: ["focused review stance", "eyes scanning slightly left", "eyes scanning slightly right", "thoughtful consideration", "small approving nod", "return to focused review; no external prop"] },
];

const generatedRows = rows.filter((row) => !row.mirrorOf);

const stylePrompts: Record<ArtStyle, string> = {
  pixel: "crisp modern 32-bit pixel art, deliberate square pixel clusters, five-color maximum palette, hard clean edges, compact cute proportions, strong readable silhouette, no realism, no 3D rendering, no gradients, no blur, no painterly texture",
  toon: "soft pastel pixel art, carefully stepped pixel curves, six-color maximum palette, compact cute proportions, simple expressive face, hard clean edges, no realism, no 3D rendering, no gradients, no blur, no painterly texture",
  plush: "chunky low-resolution pixel art, large deliberate square pixel clusters, four-color maximum palette, tiny chibi proportions, bold readable silhouette, no realism, no 3D rendering, no gradients, no blur, no fabric texture",
};

const credentialFields: Record<CloudProviderId, { label: string; env: string; placeholder: string }> = {
  fal: { label: "fal API key", env: "FAL_KEY", placeholder: "Paste an API-scoped fal key" },
  openai: { label: "OpenAI API key", env: "OPENAI_API_KEY", placeholder: "Paste an OpenAI project API key" },
  xai: { label: "xAI API key", env: "XAI_API_KEY", placeholder: "Paste an xAI API key" },
  openrouter: { label: "OpenRouter API key", env: "OPENROUTER_API_KEY", placeholder: "Paste an OpenRouter API key" },
  google: { label: "Google API key", env: "GOOGLE_API_KEY", placeholder: "Paste a Gemini API key" },
};

type LocalConnection = { direct: boolean; endpoint: string; token: string };

const creatureWords = ["dragon", "hawk", "eagle", "bird", "fox", "cat", "kitten", "moth", "dog", "corgi", "wolf", "bear", "rabbit", "bunny", "otter", "frog", "turtle", "dinosaur", "griffin", "phoenix", "axolotl", "hamster", "slime"];
const colorWords = ["cyan", "green", "lime", "teal", "blue", "red", "orange", "yellow", "purple", "violet", "pink", "white", "black", "gold", "silver"];

function enhanceCharacterBrief(raw: string) {
  const compact = raw.trim().replace(/\s+/g, " ");
  const lower = compact.toLowerCase();
  const creatures = creatureWords.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
  const colors = colorWords.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
  const isDragonHawk = creatures.includes("dragon") && (creatures.includes("hawk") || creatures.includes("eagle"));

  if (isDragonHawk) {
    const primary = colors[0] || "cyan";
    const secondary = colors[1] || "green";
    return `Exactly one cohesive baby dragon-hawk hybrid: compact dragon body, expressive hawk beak and eyes, two layered feathered wings, two sturdy hind legs, one tapered dragon tail, and a small swept-back horn crest. Primary ${primary} body with ${secondary} feather and scale accents. Friendly, alert expression; symmetrical anatomy; no separate bird or second creature; no duplicated wings, heads, legs or tails.`;
  }

  if (creatures.length === 1 && compact.length < 90) {
    const palette = colors.length ? ` Primary ${colors[0]} palette${colors[1] ? ` with ${colors[1]} accents` : ""}.` : "";
    return `Exactly one friendly baby ${creatures[0]} digital pet with compact game-ready proportions, a distinctive face, a clean full-body silhouette and symmetrical anatomy.${palette} Preserve the user concept: ${compact}. No duplicate anatomy or extra creature.`;
  }

  return `Exactly one cohesive digital pet based on: ${compact}. Keep a compact full-body game silhouette, expressive face, symmetrical anatomy, consistent markings and one unmistakable visual identity. Interpret any comma-separated animals as traits of one hybrid, never as multiple creatures. No duplicate anatomy or extra creature.`;
}

function proxiedAsset(url: string) {
  return `/api/asset?url=${encodeURIComponent(url)}`;
}

function initialJobs(): Record<StateId | "hatch", JobState> {
  return Object.fromEntries([
    ...rows.map((row) => [row.id, { status: row.mirrorOf ? "mirrored" : "waiting", detail: row.mirrorOf ? "Built from run right" : `${row.count} frames` }]),
    ["hatch", { status: "waiting", detail: "24 frames" }],
  ]) as Record<StateId | "hatch", JobState>;
}

const HISTORY_DB = "hatchframe";
const HISTORY_STORE = "pets";
const HISTORY_LIMIT = 12;

function openHistoryDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HISTORY_STORE)) {
        database.createObjectStore(HISTORY_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Local history is unavailable."));
  });
}

async function listSavedPets(): Promise<SavedPet[]> {
  const database = await openHistoryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(HISTORY_STORE, "readonly");
    const request = transaction.objectStore(HISTORY_STORE).getAll();
    request.onsuccess = () => resolve((request.result as SavedPet[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(request.error || new Error("Could not read local history."));
    transaction.oncomplete = () => database.close();
  });
}

async function savePetLocally(pet: SavedPet): Promise<SavedPet[]> {
  const database = await openHistoryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(HISTORY_STORE, "readwrite");
    transaction.objectStore(HISTORY_STORE).put(pet);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not save local history."));
  });
  database.close();
  const saved = await listSavedPets();
  if (saved.length <= HISTORY_LIMIT) return saved;
  const trimmed = saved.slice(0, HISTORY_LIMIT);
  await Promise.all(saved.slice(HISTORY_LIMIT).map((entry) => deleteSavedPet(entry.id)));
  return trimmed;
}

async function deleteSavedPet(id: string) {
  const database = await openHistoryDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(HISTORY_STORE, "readwrite");
    transaction.objectStore(HISTORY_STORE).delete(id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("Could not delete local history.")); };
  });
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return output;
}

function characterPrompt(description: string, style: ArtStyle) {
  return `CANONICAL CHARACTER TURNAROUND SOURCE. ${enhanceCharacterBrief(description)} ${stylePrompts[style]}. Show the entire body centered, facing right in a clean side or slight three-quarter game view, neutral standing pose, generous empty padding on every side. Preserve every distinctive color, marking and accessory clearly. Exactly one character. Background must be one perfectly flat, uniform solid chroma magenta #FF00FF from edge to edge. No floor, ground, cast shadow, reflection, glow on background, scenery, text, label, border, crop, prop, duplicate body part or extra limb. Do not use magenta anywhere on the character. This image is the immutable identity reference for all animation poses.`;
}

function pairPosePrompt(phaseA: string, phaseB: string, style: ArtStyle, retryReasons = "") {
  return `TWO-POSE PRODUCTION STRIP. Use the single reference character as the exact identity source. Render exactly TWO separate full-body poses total in one horizontal image: pose A centered in the LEFT half and pose B centered in the RIGHT half, with a wide empty gap between. Pose A: ${phaseA}. Pose B: ${phaseB}. ${stylePrompts[style]}. Same single character identity, anatomy, proportions, palette, markings, scale, camera and lighting in both poses. Entire body and every wing, tail, ear and foot must stay visible. Background is one perfectly flat uniform solid chroma magenta #FF00FF edge to edge. No third pose, duplicate anatomy, second creature, panels, lines, labels, words, numbers, floor, shadow, scenery, prop, overlap or crop. Never use magenta on the character. ${retryReasons}`.trim();
}

function singlePosePrompt(phase: string, style: ArtStyle, retryReasons = "") {
  return `SINGLE PRODUCTION ANIMATION POSE. Use the single reference character as the exact identity source. Render exactly ONE full-body character in this motion phase: ${phase}. ${stylePrompts[style]}. Preserve the exact face, anatomy, proportions, palette, markings, camera and lighting from the reference. Center the complete body with generous padding. Background is one perfectly flat uniform solid chroma magenta #FF00FF edge to edge. No second pose, duplicate anatomy, extra creature, panel, line, label, word, number, floor, shadow, scenery, prop or crop. Never use magenta on the character. ${retryReasons}`.trim();
}

function eggPrompt(style: ArtStyle) {
  return `Using the reference character only as an identity and palette guide, render exactly one closed magical hatching egg. The shell colors, markings and one simple emblem must unmistakably match the character. ${stylePrompts[style]}. One centered complete egg, generous padding, same camera and lighting. Background must be one perfectly flat uniform solid chroma magenta #FF00FF from edge to edge. No visible creature, duplicate egg, scenery, nest, floor, shadow, reflection, text, label, border or crop. Do not use magenta on the egg.`;
}

function requireImageSource(value: unknown, label = "generated image") {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`The ${label} source is missing. Local packing stopped before export.`);
  }
  return value.trim();
}

async function loadImage(url: unknown, direct = false) {
  const source = requireImageSource(url);
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("A generated image could not be loaded for local processing."));
    image.src = direct || source.startsWith("blob:") || source.startsWith("data:") ? source : proxiedAsset(source);
  });
  return image;
}

async function removeChroma(url: string): Promise<Cutout> {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Local transparency processing is unavailable.");
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const inset = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) * 0.008));
  let keyR = 0;
  let keyG = 0;
  let keyB = 0;
  let samples = 0;

  for (let x = 0; x < canvas.width; x += inset) {
    for (const y of [inset, canvas.height - 1 - inset]) {
      const index = (y * canvas.width + x) * 4;
      keyR += pixels[index]; keyG += pixels[index + 1]; keyB += pixels[index + 2]; samples += 1;
    }
  }
  for (let y = inset; y < canvas.height; y += inset) {
    for (const x of [inset, canvas.width - 1 - inset]) {
      const index = (y * canvas.width + x) * 4;
      keyR += pixels[index]; keyG += pixels[index + 1]; keyB += pixels[index + 2]; samples += 1;
    }
  }
  keyR /= Math.max(1, samples); keyG /= Math.max(1, samples); keyB /= Math.max(1, samples);
  const looksMagenta = keyR > 150 && keyB > 150 && keyG < Math.min(keyR, keyB) * 0.65;
  if (!looksMagenta) throw new Error("The model did not return the required magenta key background. Retrying usually fixes this.");

  let transparent = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const dr = pixels[index] - keyR;
    const dg = pixels[index + 1] - keyG;
    const db = pixels[index + 2] - keyB;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    const matte = Math.max(0, Math.min(1, (distance - 28) / 82));
    const alpha = Math.round(pixels[index + 3] * matte);
    if (alpha < 24) transparent += 1;
    if (matte < 1) {
      const spill = (1 - matte) * 0.72;
      const neutral = Math.min(pixels[index], pixels[index + 2]);
      pixels[index] = Math.round(pixels[index] * (1 - spill) + neutral * spill);
      pixels[index + 2] = Math.round(pixels[index + 2] * (1 - spill) + neutral * spill);
    }
    pixels[index + 3] = alpha;
    if (!alpha) pixels[index] = pixels[index + 1] = pixels[index + 2] = 0;
  }
  const transparentRatio = transparent / (canvas.width * canvas.height);
  if (transparentRatio < 0.08) throw new Error("The generated background could not be removed cleanly. Retrying usually fixes this.");
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvasBlob(canvas);
  return { blob, url: URL.createObjectURL(blob), transparentRatio };
}

function cleanFrames(image: HTMLImageElement, count: number): CleanFrame[] {
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) throw new Error("Canvas analysis is unavailable.");
  sourceCtx.drawImage(image, 0, 0);
  const imageData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const pixels = imageData.data;
  const total = source.width * source.height;
  const labels = new Int32Array(total);
  labels.fill(-1);
  const queue = new Int32Array(total);
  const components: { id: number; count: number; minX: number; minY: number; maxX: number; maxY: number }[] = [];

  // Find subjects across the whole strip instead of trusting model-made gutters.
  // The N largest alpha components are the N poses; small text and guide debris are discarded.
  for (let index = 0; index < total; index += 1) {
    if (labels[index] !== -1 || pixels[index * 4 + 3] < 36) continue;
    const id = components.length;
    let head = 0;
    let tail = 0;
    let componentCount = 0;
    let minX = source.width;
    let minY = source.height;
    let maxX = -1;
    let maxY = -1;
    queue[tail++] = index;
    labels[index] = id;
    while (head < tail) {
      const current = queue[head++];
      const y = Math.floor(current / source.width);
      const x = current - y * source.width;
      componentCount += 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let oy = -1; oy <= 1; oy += 1) {
        const ny = y + oy;
        if (ny < 0 || ny >= source.height) continue;
        for (let ox = -1; ox <= 1; ox += 1) {
          const nx = x + ox;
          if ((!ox && !oy) || nx < 0 || nx >= source.width) continue;
          const neighbor = ny * source.width + nx;
          if (labels[neighbor] === -1 && pixels[neighbor * 4 + 3] >= 36) {
            labels[neighbor] = id;
            queue[tail++] = neighbor;
          }
        }
      }
    }
    components.push({ id, count: componentCount, minX, minY, maxX, maxY });
  }

  const ranked = [...components].sort((a, b) => b.count - a.count);
  const largest = ranked[0]?.count || 0;
  const significant = ranked.filter((component) => component.count >= largest * 0.06);
  const selected = significant.slice(0, count).sort((a, b) => (a.minX + a.maxX) - (b.minX + b.maxX));
  const smallestSelected = Math.min(...selected.map((component) => component.count));
  const extra = significant.find((component) => !selected.some((chosen) => chosen.id === component.id));
  const multiple = Boolean(extra && Number.isFinite(smallestSelected) && extra.count > smallestSelected * 0.45);
  const frames: CleanFrame[] = [];
  const edgeX = Math.max(3, Math.round(source.width * 0.006));
  const edgeY = Math.max(3, Math.round(source.height * 0.018));

  for (const component of selected) {
    const pad = 2;
    const left = Math.max(0, component.minX - pad);
    const top = Math.max(0, component.minY - pad);
    const right = Math.min(source.width - 1, component.maxX + pad);
    const bottom = Math.min(source.height - 1, component.maxY + pad);
    const width = right - left + 1;
    const height = bottom - top + 1;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas subject extraction is unavailable.");
    const output = ctx.createImageData(width, height);
    let opaque = 0;
    let edge = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const sourceIndex = y * source.width + x;
        let belongs = labels[sourceIndex] === component.id;
        if (!belongs && pixels[sourceIndex * 4 + 3] > 0) {
          for (let oy = -1; oy <= 1 && !belongs; oy += 1) for (let ox = -1; ox <= 1 && !belongs; ox += 1) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx >= 0 && nx < source.width && ny >= 0 && ny < source.height && labels[ny * source.width + nx] === component.id) belongs = true;
          }
        }
        if (!belongs) continue;
        const targetIndex = (y - top) * width + x - left;
        output.data[targetIndex * 4] = pixels[sourceIndex * 4];
        output.data[targetIndex * 4 + 1] = pixels[sourceIndex * 4 + 1];
        output.data[targetIndex * 4 + 2] = pixels[sourceIndex * 4 + 2];
        output.data[targetIndex * 4 + 3] = pixels[sourceIndex * 4 + 3];
        if (pixels[sourceIndex * 4 + 3] >= 36) {
          opaque += 1;
          if (x < edgeX || x >= source.width - edgeX || y < edgeY || y >= source.height - edgeY) edge += 1;
        }
      }
    }
    ctx.putImageData(output, 0, 0);
    frames.push({ canvas, box: { x: 0, y: 0, width, height, opaque, edge, multiple } });
  }

  while (frames.length < count) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    frames.push({ canvas, box: { x: 0, y: 0, width: 0, height: 0, opaque: 0, edge: 0, multiple: false } });
  }
  return frames;
}

function analyzeFrames(frames: CleanFrame[], row: RowSpec, width: number, height: number): RowQa {
  const boxes = frames.map((frame) => frame.box);
  const reasons: string[] = [];
  const empty = boxes.filter((box) => !box.opaque).length;
  if (empty) reasons.push(`${empty} of ${row.count} slots are empty`);
  const clipped = boxes.filter((box) => box.opaque && box.edge / box.opaque > 0.015).length;
  if (clipped) reasons.push(`${clipped} poses touch a slot edge`);
  const multiple = boxes.filter((box) => box.multiple).length;
  if (multiple) reasons.push(`${multiple} slots may contain multiple subjects`);
  const populated = boxes.filter((box) => box.opaque);
  if (populated.length > 1) {
    const heights = populated.map((box) => box.height);
    const mean = heights.reduce((sum, value) => sum + value, 0) / heights.length;
    const variance = heights.reduce((sum, value) => sum + (value - mean) ** 2, 0) / heights.length;
    const cv = Math.sqrt(variance) / Math.max(1, mean);
    if (cv > 0.22 && row.id !== "jumping") reasons.push("pose scale varies unusually");
  }
  const critical = empty > 0 || clipped > Math.ceil(row.count / 2);
  return {
    pass: reasons.length === 0,
    critical,
    score: Math.max(0, Math.round(100 - empty * 28 - clipped * 8 - Math.max(0, reasons.length - 2) * 6)),
    reasons: [...new Set(reasons)],
    width,
    height,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed.")), "image/png"));
}

async function composePetAtlas(assets: Partial<Record<StateId, RowAsset>>) {
  const canvas = document.createElement("canvas");
  canvas.width = PET_WIDTH;
  canvas.height = PET_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas packing is unavailable.");
  ctx.imageSmoothingEnabled = false;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const spec = rows[rowIndex];
    const sourceId = spec.mirrorOf || spec.id;
    const asset = assets[sourceId];
    if (!asset) throw new Error(`Missing ${sourceId} strip.`);
    const frames = asset.frames;
    const boxes = frames.map((frame) => frame.box);
    if (boxes.some((box) => !box.opaque)) throw new Error(`${spec.label} contains an empty frame.`);
    const medianHeight = median(boxes.map((box) => box.height));
    const medianWidth = median(boxes.map((box) => box.width));
    const scale = Math.min(174 / Math.max(1, medianHeight), 166 / Math.max(1, medianWidth));
    const jumpOffsets = [0, -24, -52, -30, 0];

    for (let frame = 0; frame < spec.count; frame += 1) {
      const box = boxes[frame];
      const dw = box.width * scale;
      const dh = box.height * scale;
      const localX = (CELL_W - dw) / 2;
      const lift = spec.id === "jumping" ? jumpOffsets[frame] || 0 : 0;
      const dy = rowIndex * CELL_H + 194 - dh + lift;
      if (spec.mirrorOf) {
        ctx.save();
        ctx.translate((frame + 1) * CELL_W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(frames[frame].canvas, box.x, box.y, box.width, box.height, localX, dy, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(frames[frame].canvas, box.x, box.y, box.width, box.height, frame * CELL_W + localX, dy, dw, dh);
      }
    }
  }
  return canvasBlob(canvas);
}

async function composeHatch(eggUrl: string, idleFrame: CleanFrame) {
  const egg = await loadImage(eggUrl);
  const eggFrame = cleanFrames(egg, 1)[0];
  const idleBox = idleFrame.box;
  const eggBox = eggFrame.box;
  if (!eggBox.opaque || !idleBox.opaque) throw new Error("Hatch sources are empty.");
  const canvas = document.createElement("canvas");
  canvas.width = PET_WIDTH;
  canvas.height = HATCH_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas hatch packing is unavailable.");
  const eggScale = Math.min(150 / eggBox.width, 172 / eggBox.height);
  const petScale = Math.min(166 / idleBox.width, 174 / idleBox.height);
  for (let frame = 0; frame < 24; frame += 1) {
    const col = frame % COLS;
    const row = Math.floor(frame / COLS);
    const ox = col * CELL_W;
    const oy = row * CELL_H;
    const reveal = Math.max(0, Math.min(1, (frame - 9) / 9));
    const easedReveal = 1 - (1 - reveal) ** 3;
    const wobble = frame < 13 ? Math.sin(frame * 2.15) * Math.max(1, frame - 2) * 0.72 : 0;
    const eggAlpha = frame < 10 ? 1 : Math.max(0, 1 - (frame - 9) / 7);
    const ew = eggBox.width * eggScale;
    const eh = eggBox.height * eggScale;
    ctx.save();
    ctx.globalAlpha = eggAlpha;
    ctx.translate(ox + CELL_W / 2, oy + 194);
    ctx.rotate(wobble * Math.PI / 180);
    const eggPulse = 1 + Math.sin(frame * 1.4) * Math.min(frame / 24, 0.025);
    ctx.scale(eggPulse, 2 - eggPulse);
    ctx.drawImage(eggFrame.canvas, eggBox.x, eggBox.y, eggBox.width, eggBox.height, -ew / 2, -eh, ew, eh);
    ctx.restore();

    if (frame >= 7) {
      const burst = Math.max(0, Math.min(1, (frame - 7) / 12));
      for (let particle = 0; particle < 10; particle += 1) {
        const angle = particle * 2.399 + 0.4;
        const radius = 16 + burst * (38 + (particle % 3) * 8);
        const px = ox + CELL_W / 2 + Math.cos(angle) * radius;
        const py = oy + 121 + Math.sin(angle) * radius * 0.72;
        const size = Math.max(0.7, 3.2 * (1 - burst) + (particle % 2));
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.sin(burst * Math.PI)) * 0.9;
        ctx.translate(px, py);
        ctx.rotate(angle + burst * 2);
        ctx.fillStyle = particle % 2 ? "#a8ff4f" : "#5cf6ff";
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }

    if (reveal > 0) {
      const settle = frame < 19 ? -Math.sin(reveal * Math.PI) * 32 : Math.sin((frame - 18) * 1.8) * Math.max(0, 4 - (frame - 18) * 0.7);
      const popScale = 0.72 + easedReveal * 0.28;
      const squash = frame < 18 ? 1 + Math.sin(reveal * Math.PI) * 0.12 : 1;
      const pw = idleBox.width * petScale * popScale * squash;
      const ph = idleBox.height * petScale * popScale / squash;
      ctx.save();
      ctx.globalAlpha = easedReveal;
      ctx.drawImage(idleFrame.canvas, idleBox.x, idleBox.y, idleBox.width, idleBox.height, ox + (CELL_W - pw) / 2, oy + 194 - ph + settle, pw, ph);
      ctx.restore();
    }
  }
  return canvasBlob(canvas);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function isArtStyle(value: unknown): value is ArtStyle {
  return value === "pixel" || value === "toon" || value === "plush";
}

function isProviderId(value: unknown): value is ProviderId {
  return value === "fal" || value === "openai" || value === "xai" || value === "openrouter" || value === "google" || value === "comfyui" || value === "invoke";
}

function readJsonFile(bytes: Uint8Array, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function findPackageEntry(files: Record<string, Uint8Array>, basename: string, required = true) {
  const matches = Object.entries(files).filter(([name]) => name.split("/").filter(Boolean).at(-1) === basename);
  if (matches.length > 1) throw new Error(`The package contains more than one ${basename}.`);
  if (!matches.length) {
    if (required) throw new Error(`The package is missing ${basename}.`);
    return undefined;
  }
  return matches[0][1];
}

async function imageDimensions(blob: Blob) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function assertManifestContract(manifest: Record<string, unknown>) {
  if (manifest.schema !== "sprite-pet/v1") throw new Error("The package does not use the sprite-pet/v1 manifest contract.");
  const assets = manifest.assets as Record<string, unknown> | undefined;
  const pet = assets?.pet as Record<string, unknown> | undefined;
  const hatch = assets?.hatch as Record<string, unknown> | undefined;
  const petGrid = pet?.grid as Record<string, unknown> | undefined;
  const hatchGrid = hatch?.grid as Record<string, unknown> | undefined;
  const validPet = pet?.width === PET_WIDTH && pet?.height === PET_HEIGHT && petGrid?.columns === COLS && petGrid?.rows === PET_ROWS && petGrid?.cellWidth === CELL_W && petGrid?.cellHeight === CELL_H;
  const validHatch = hatch?.width === PET_WIDTH && hatch?.height === HATCH_HEIGHT && hatchGrid?.columns === COLS && hatchGrid?.rows === HATCH_ROWS && hatchGrid?.cellWidth === CELL_W && hatchGrid?.cellHeight === CELL_H;
  if (!validPet || !validHatch) throw new Error("The package atlas grid does not match Hatch's 192×208 sprite contract.");
}

async function importPetPackage(file: File): Promise<SavedPet> {
  const MAX_ZIP_BYTES = 25 * 1024 * 1024;
  const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Choose a Hatch ZIP package.");
  if (file.size > MAX_ZIP_BYTES) throw new Error("The ZIP is larger than the 25 MB import limit.");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("The selected file could not be opened as a ZIP package.");
  }
  const entries = Object.values(files);
  if (entries.length > 64 || entries.reduce((total, entry) => total + entry.byteLength, 0) > MAX_UNPACKED_BYTES) {
    throw new Error("The unpacked package is too large.");
  }
  const manifestBytes = findPackageEntry(files, "manifest.json");
  const petBytes = findPackageEntry(files, "spritesheet.png");
  const hatchBytes = findPackageEntry(files, "hatch.png");
  const metadataBytes = findPackageEntry(files, "pet.json", false);
  if (!manifestBytes || !petBytes || !hatchBytes) throw new Error("The package is incomplete.");
  const manifest = readJsonFile(manifestBytes, "manifest.json");
  assertManifestContract(manifest);
  const metadata = metadataBytes ? readJsonFile(metadataBytes, "pet.json") : {};
  const petBuffer = petBytes.buffer.slice(petBytes.byteOffset, petBytes.byteOffset + petBytes.byteLength) as ArrayBuffer;
  const hatchBuffer = hatchBytes.buffer.slice(hatchBytes.byteOffset, hatchBytes.byteOffset + hatchBytes.byteLength) as ArrayBuffer;
  const petBlob = new Blob([petBuffer], { type: "image/png" });
  const hatchBlob = new Blob([hatchBuffer], { type: "image/png" });
  let petSize: { width: number; height: number };
  let hatchSize: { width: number; height: number };
  try {
    [petSize, hatchSize] = await Promise.all([imageDimensions(petBlob), imageDimensions(hatchBlob)]);
  } catch {
    throw new Error("One of the package atlases is not a readable image.");
  }
  if (petSize.width !== PET_WIDTH || petSize.height !== PET_HEIGHT || hatchSize.width !== PET_WIDTH || hatchSize.height !== HATCH_HEIGHT) {
    throw new Error("The package PNG dimensions do not match the manifest.");
  }
  const rawDescription = typeof metadata.description === "string" ? metadata.description : typeof metadata.displayName === "string" ? metadata.displayName : typeof manifest.description === "string" ? manifest.description : file.name.replace(/\.zip$/i, "");
  const description = rawDescription.trim().replace(/\s+/g, " ").slice(0, 900) || "Imported sprite pet";
  return {
    id: crypto.randomUUID(), description, createdAt: new Date().toISOString(), petBlob, hatchBlob,
    artStyle: isArtStyle(metadata.artStyle) ? metadata.artStyle : undefined,
    provider: isProviderId(metadata.provider) ? metadata.provider : undefined,
    source: "imported", hatchSource: "imported Hatch package",
  };
}

async function downloadPetPackage(pet: SavedPet) {
  const output = await buildHatchPackage(pet);
  downloadBlob(output.blob, output.filename);
}

async function downloadHermesPetPackage(pet: SavedPet) {
  const output = await buildHermesPackage(pet);
  downloadBlob(output.blob, output.filename);
}

function PetPlayer({ artifact, state, onState }: { artifact: PlayablePet; state: PreviewState; onState?: (state: PreviewState) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let switched = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const image = new Image();
    image.decoding = "async";
    image.src = state === "hatch" ? artifact.hatchUrl : artifact.petUrl;
    image.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || cancelled) return;
      ctx.imageSmoothingEnabled = false;
      const spec = state === "hatch" ? undefined : rows.find((row) => row.id === state);
      const count = spec?.count ?? 24;
      const fps = spec?.fps ?? 12;
      const atlasRow = state === "hatch" ? 0 : rows.findIndex((row) => row.id === state);
      const started = performance.now();
      const render = (time: number) => {
        if (cancelled) return;
        const raw = reduced ? 0 : Math.floor((time - started) * fps / 1000);
        if (state === "hatch" && raw >= count && onState) {
          if (!switched) { switched = true; onState("idle"); }
          return;
        }
        const frame = raw % count;
        const col = frame % COLS;
        const row = state === "hatch" ? Math.floor(frame / COLS) : atlasRow;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, col * CELL_W, row * CELL_H, CELL_W, CELL_H, 0, 0, canvas.width, canvas.height);
        raf = requestAnimationFrame(render);
      };
      raf = requestAnimationFrame(render);
    };
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [artifact, onState, state]);

  return <canvas ref={canvasRef} className="sprite-canvas pet-atlas-canvas" width={CELL_W} height={CELL_H} role="img" aria-label={`Animated ${state} pet preview`} />;
}

const actions: { id: PreviewState; label: string }[] = [
  { id: "hatch", label: "Hatch" },
  ...rows.map((row) => ({ id: row.id, label: row.label })),
];

function ActionGallery({ artifact }: { artifact: PlayablePet }) {
  return (
    <div className="action-gallery" aria-label="All pet animations">
      {actions.map((action) => (
        <div className="action-card checkerboard" key={action.id}>
          <PetPlayer artifact={artifact} state={action.id} />
          <span>{action.label}</span>
        </div>
      ))}
    </div>
  );
}

function PetThumbnail({ pet }: { pet: SavedPet }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(pet.petBlob);
    const image = new Image();
    image.src = url;
    image.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
    };
    return () => URL.revokeObjectURL(url);
  }, [pet.petBlob]);
  return <canvas ref={canvasRef} width={CELL_W} height={CELL_H} role="img" aria-label={`${pet.description} idle preview`} />;
}

function formatTime(milliseconds?: number) {
  if (typeof milliseconds !== "number") return "—";
  const seconds = milliseconds / 1000;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}` : `${seconds.toFixed(1)}s`;
}

export default function SpriteLab() {
  const generationLock = useRef(false);
  const cutoutUrls = useRef<string[]>([]);
  const providerTouched = useRef(false);
  const packingCache = useRef<PackingCache | null>(null);
  const gameSectionRef = useRef<HTMLElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [apiKeys, setApiKeys] = useState<Record<CloudProviderId, string>>({ fal: "", openai: "", xai: "", openrouter: "", google: "" });
  const [providers, setProviders] = useState<ProviderSummary[]>(DEFAULT_PROVIDERS);
  const [provider, setProvider] = useState<ProviderId>("fal");
  const [workflowOverrides, setWorkflowOverrides] = useState<Record<LocalProviderId, WorkflowOverrides>>({
    comfyui: {},
    invoke: {},
  });
  const [localConnections, setLocalConnections] = useState<Record<LocalProviderId, LocalConnection>>({
    comfyui: { direct: false, endpoint: "http://127.0.0.1:8188", token: "" },
    invoke: { direct: false, endpoint: "http://127.0.0.1:9090", token: "" },
  });
  const [description, setDescription] = useState("A round mint moon-moth kitten named Nibi — tiny cream face, two lavender antennae, leaf-shaped wings, stubby paws, star-shaped tail tip, oversized friendly dark eyes");
  const [artStyle, setArtStyle] = useState<ArtStyle>("pixel");
  const [autoRetry, setAutoRetry] = useState(true);
  const [stage, setStage] = useState<Stage>("idle");
  const [detail, setDetail] = useState("Ready to build 81 populated frames");
  const [error, setError] = useState("");
  const [anchorUrl, setAnchorUrl] = useState("");
  const [jobs, setJobs] = useState(initialJobs);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [copied, setCopied] = useState(false);
  const [packingRetryAvailable, setPackingRetryAvailable] = useState(false);
  const [savedPets, setSavedPets] = useState<SavedPet[]>([]);
  const [playablePet, setPlayablePet] = useState<PlayablePet | null>(null);
  const [historyMessage, setHistoryMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const busy = stage === "anchor" || stage === "generating" || stage === "packing";
  const canRetryPacking = stage === "error" && packingRetryAvailable;
  const enhancedBrief = useMemo(() => enhanceCharacterBrief(description), [description]);
  const selectedProvider = providers.find((candidate) => candidate.id === provider) || providers.at(-1) || { id: "fal", label: "fal" };
  const localWorkflows = provider === "comfyui" || provider === "invoke" ? workflowOverrides[provider] : undefined;
  const localConnection = provider === "comfyui" || provider === "invoke" ? localConnections[provider] : undefined;
  const directLocal = Boolean(localConnection && (!selectedProvider.serverConfigured || localConnection.direct));
  const cloudApiKey = isCloudProviderId(provider) ? apiKeys[provider] : "";

  const selectPetForPlay = useCallback((pet: SavedPet, scroll = true) => {
    setPlayablePet({ ...pet, petUrl: URL.createObjectURL(pet.petBlob), hatchUrl: URL.createObjectURL(pet.hatchBlob) });
    if (scroll) window.setTimeout(() => gameSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, []);

  useEffect(() => () => {
    if (artifact) {
      URL.revokeObjectURL(artifact.petUrl);
      URL.revokeObjectURL(artifact.hatchUrl);
    }
  }, [artifact]);

  useEffect(() => () => {
    cutoutUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSavedPets().then((saved) => {
      if (cancelled) return;
      setSavedPets(saved);
      if (saved[0]) selectPetForPlay(saved[0], false);
    }).catch((cause) => {
      if (!cancelled) setHistoryMessage(cause instanceof Error ? cause.message : "Local history could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [selectPetForPlay]);

  useEffect(() => {
    let cancelled = false;
    discoverProviders().then((available) => {
      if (cancelled || !available.length) return;
      setProviders(available);
      if (!providerTouched.current) setProvider(selectPreferredProvider(available));
    }).catch(() => {
      if (!cancelled) setProviders(DEFAULT_PROVIDERS);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (playablePet) {
      URL.revokeObjectURL(playablePet.petUrl);
      URL.revokeObjectURL(playablePet.hatchUrl);
    }
  }, [playablePet]);

  const requestExample = useMemo(() => {
    if (provider === "fal") return {
      provider: "fal",
      submit: { method: "POST", url: "https://queue.fal.run/fal-ai/flux-2/klein/9b/edit", body: { image_urls: ["<anchor-url>"], prompt: pairPosePrompt(rows[0].phases[0], rows[0].phases[1], artStyle), image_size: { width: 1024, height: 512 }, num_inference_steps: 4, output_format: "png", num_images: 1 } },
      poll: "GET the status_url returned by submit",
      result: "GET the response_url returned by submit",
    };
    if (isHostedCloudProviderId(provider)) return {
      provider,
      model: selectedProvider.model,
      hatchProxy: { method: "POST", url: `/api/cloud?provider=${provider}`, credential: "x-provider-key header or server environment", body: { kind: "edit", prompt: pairPosePrompt(rows[0].phases[0], rows[0].phases[1], artStyle), width: 1024, height: 512, reference: "<private-data-url>" } },
    };
    return {
      provider,
      connection: directLocal ? "Direct browser CORS request" : "Hatch server proxy",
      endpoint: directLocal ? "Entered in this tab" : "Configured on the Hatch server",
      workflow: localWorkflows?.editName || (!directLocal && selectedProvider.serverWorkflows ? "server-mounted edit workflow" : "upload required"),
      replacements: ["{{PROMPT}}", "{{NEGATIVE_PROMPT}}", "{{SEED}}", "{{WIDTH}}", "{{HEIGHT}}", "{{REFERENCE_IMAGE}}"],
    };
  }, [artStyle, directLocal, localWorkflows?.editName, provider, selectedProvider.model, selectedProvider.serverWorkflows]);

  function registerCutout(cutout: Cutout): string {
    cutoutUrls.current.push(cutout.url);
    return cutout.url;
  }

  function registerGeneratedSource(source: { url: string; blob?: Blob }) {
    if (source.blob) cutoutUrls.current.push(source.url);
    return source.url;
  }

  function selectProvider(next: ProviderId) {
    if (generationLock.current) return;
    providerTouched.current = true;
    setProvider(next);
    setError("");
  }

  function setProviderApiKey(cloudProvider: CloudProviderId, value: string) {
    setApiKeys((current) => ({ ...current, [cloudProvider]: value }));
  }

  function patchLocalConnection(localProvider: LocalProviderId, update: Partial<LocalConnection>) {
    setLocalConnections((current) => ({
      ...current,
      [localProvider]: { ...current[localProvider], ...update },
    }));
    setError("");
  }

  async function loadWorkflowFile(localProvider: LocalProviderId, kind: "text" | "edit", file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Workflow JSON must be 2 MB or smaller.");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      setWorkflowOverrides((current) => ({
        ...current,
        [localProvider]: {
          ...current[localProvider],
          [kind]: parsed as WorkflowObject,
          [`${kind}Name`]: file.name,
        },
      }));
      setError("");
    } catch {
      setError(`${file.name} is not a JSON workflow object.`);
    }
  }

  function setLocalOutputNode(localProvider: LocalProviderId, outputNode: string) {
    setWorkflowOverrides((current) => ({
      ...current,
      [localProvider]: { ...current[localProvider], outputNode },
    }));
  }

  function clearWorkflowOverrides(localProvider: LocalProviderId) {
    setWorkflowOverrides((current) => ({ ...current, [localProvider]: {} }));
    setError("");
  }

  function generationBackend(): BrowserGenerationBackend {
    if (provider === "fal") return new FalBrowserBackend(apiKeys.fal);
    if (isHostedCloudProviderId(provider)) return new CloudBrowserBackend(provider, apiKeys[provider]);
    const summary = providers.find((candidate) => candidate.id === provider);
    if (!summary) throw new Error(`${provider} is not configured on this Hatch server.`);
    const workflows = workflowOverrides[provider];
    const hasTextOverride = Boolean(workflows.text);
    const hasEditOverride = Boolean(workflows.edit);
    if (hasTextOverride !== hasEditOverride) throw new Error("Upload both the text and reference-edit workflow, or remove the partial override.");
    const connection = localConnections[provider];
    const useDirect = !summary.serverConfigured || connection.direct;
    if (useDirect) {
      if (!hasTextOverride) throw new Error(`Upload both ${summary.label} workflows for direct browser generation.`);
      return new DirectLocalBrowserBackend(provider, { ...workflows, endpoint: connection.endpoint, token: connection.token });
    }
    if (!hasTextOverride && !summary.serverWorkflows) throw new Error(`Upload both ${summary.label} workflows before generating.`);
    return new LocalBrowserBackend(provider, workflows);
  }

  function patchJob(id: StateId | "hatch", update: Partial<JobState>) {
    setJobs((current) => ({ ...current, [id]: { ...current[id], ...update } }));
  }

  async function buildRow(row: RowSpec, backend: BrowserGenerationBackend, canonicalReference: string, seed: number): Promise<RowAsset> {
    const maxAttempts = autoRetry ? 2 : 1;
    const segmentCount = Math.ceil(row.phases.length / 2);
    const frames: CleanFrame[] = [];
    let totalAttempts = 0;

    for (let start = 0; start < row.phases.length; start += 2) {
      const phases = row.phases.slice(start, start + 2);
      const expected = phases.length;
      const segment = Math.floor(start / 2) + 1;
      let accepted: CleanFrame[] | null = null;
      let retryReasons = "";
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        totalAttempts += 1;
        patchJob(row.id, { status: "generating", detail: `${expected === 2 ? "Pose pair" : "Final pose"} ${segment}/${segmentCount}${attempt > 1 ? " · retry" : ""}` });
        const prompt = expected === 2
          ? pairPosePrompt(phases[0], phases[1], artStyle, retryReasons)
          : singlePosePrompt(phases[0], artStyle, retryReasons);
        const edited = await backend.generate({
          kind: "edit",
          prompt,
          reference: canonicalReference,
          width: 1024,
          height: expected === 2 ? 512 : 1024,
          seed: seed + start * 11 + attempt - 1,
          onUpdate: (message) => patchJob(row.id, { status: "generating", detail: `${segment}/${segmentCount} · ${message.slice(0, 52)}` }),
        });
        const rawUrl = registerGeneratedSource(edited);
        patchJob(row.id, { status: "cleaning", detail: `${segment}/${segmentCount} · local alpha · $0` });
        const url = registerCutout(await removeChroma(rawUrl));
        const image = await loadImage(url);
        const candidate = cleanFrames(image, expected);
        if (candidate.every((frame) => frame.box.opaque > 0)) {
          accepted = candidate;
          break;
        }
        retryReasons = `The previous attempt omitted one of the required ${expected} isolated full-body poses. Render exactly ${expected} complete pose${expected === 1 ? "" : "s"} and no others.`;
      }
      if (!accepted) throw new Error(`${row.label} segment ${segment} did not contain ${expected} complete pose${expected === 1 ? "" : "s"}.`);
      frames.push(...accepted);
    }

    const qa = analyzeFrames(frames, row, 1024, 512);
    const asset = { frames, qa, attempts: totalAttempts };
    patchJob(row.id, { status: qa.pass ? "passed" : "warning", detail: qa.pass ? `${row.count} exact frames ready` : qa.reasons.join(" · "), score: qa.score });
    return asset;
  }

  async function buildHatchSources(backend: BrowserGenerationBackend, canonicalReference: string, seed: number): Promise<string> {
    patchJob("hatch", { status: "generating", detail: "Designing the egg" });
    const egg = await backend.generate({
      kind: "edit",
      prompt: eggPrompt(artStyle),
      reference: canonicalReference,
      width: 1024,
      height: 1024,
      seed,
      onUpdate: (message) => patchJob("hatch", { status: "generating", detail: message.slice(0, 70) }),
    });
    const eggRaw = registerGeneratedSource(egg);
    patchJob("hatch", { status: "cleaning", detail: "Removing chroma locally · $0" });
    return registerCutout(await removeChroma(eggRaw));
  }

  async function packArtifacts(cache: PackingCache) {
    const rowAssets = Object.fromEntries(cache.rowEntries) as Partial<Record<StateId, RowAsset>>;
    setStage("packing");
    setDetail("Normalizing pivots and packing exact atlas geometry…");
    const petBlob = await composePetAtlas(rowAssets);
    patchJob("hatch", { status: "cleaning", detail: "Composing 24 frames locally · $0" });
    const idleFrame = rowAssets.idle?.frames[0];
    if (!idleFrame) throw new Error("The completed idle frames are unavailable for the hatch reveal.");
    const hatchBlob = await composeHatch(cache.hatchUrl, idleFrame);
    const hatchSource: Artifact["hatchSource"] = "local 24-frame hatch";
    patchJob("hatch", { status: "passed", detail: "24 deterministic frames ready", score: 96 });
    const scores = cache.rowEntries.map(([, asset]) => asset.qa.score);
    const score = Math.round((scores.reduce((sum, value) => sum + value, 0) + 96) / (scores.length + 1));
    const next: Artifact = {
      id: crypto.randomUUID(),
      description: description.trim(),
      artStyle,
      createdAt: new Date().toISOString(),
      petBlob, hatchBlob, petUrl: URL.createObjectURL(petBlob), hatchUrl: URL.createObjectURL(hatchBlob), score, hatchSource,
      source: "generated", provider: cache.provider,
    };
    packingCache.current = null;
    setPackingRetryAvailable(false);
    setArtifact(next);
    setStage("ready");
    setDetail(`81 populated frames ready · ${PET_WIDTH}×${PET_HEIGHT} pet + ${PET_WIDTH}×${HATCH_HEIGHT} hatch`);
    const saved: SavedPet = {
      id: next.id, description: next.description, artStyle: next.artStyle, createdAt: next.createdAt,
      petBlob: next.petBlob, hatchBlob: next.hatchBlob, score: next.score, hatchSource: next.hatchSource, source: "generated", provider: next.provider,
    };
    selectPetForPlay(saved, false);
    try {
      setSavedPets(await savePetLocally(saved));
      setHistoryMessage("");
    } catch (cause) {
      setHistoryMessage(`${cause instanceof Error ? cause.message : "Local history is unavailable."} This pet is still playable in this tab.`);
    }
  }

  async function retryPacking() {
    const cache = packingCache.current;
    if (!cache || generationLock.current) return;
    generationLock.current = true;
    setError("");
    try {
      await packArtifacts(cache);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Local atlas packing failed.");
      setStage("error");
      setPackingRetryAvailable(true);
      setDetail("Generated model frames are preserved in this tab. Retry local packing at no cost.");
    } finally {
      generationLock.current = false;
    }
  }

  async function generate() {
    if (generationLock.current) return;
    if (!description.trim()) {
      setError("Describe the pet first.");
      setStage("error");
      return;
    }
    let backend: BrowserGenerationBackend;
    try {
      backend = generationBackend();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The selected provider is not ready.");
      setStage("error");
      return;
    }
    generationLock.current = true;
    cutoutUrls.current.forEach((url) => URL.revokeObjectURL(url));
    cutoutUrls.current = [];
    setError("");
    setAnchorUrl("");
    setArtifact(null);
    packingCache.current = null;
    setPackingRetryAvailable(false);
    setJobs(initialJobs());
    const seed = 41721;
    try {
      setStage("anchor");
      setDetail("Creating the canonical identity anchor…");
      const anchor = await backend.generate({
        kind: "text",
        prompt: characterPrompt(description.trim(), artStyle),
        width: 1024,
        height: 1024,
        seed,
        onUpdate: setDetail,
      });
      const canonicalUrl = registerGeneratedSource(anchor);
      setDetail("Removing anchor background locally…");
      setAnchorUrl(registerCutout(await removeChroma(canonicalUrl)));
      setDetail(backend.id === "fal"
        ? "Identity anchor ready for reference edits…"
        : backend.id === "comfyui" || backend.id === "invoke"
          ? `Uploading the identity anchor to ${backend.id === "comfyui" ? "ComfyUI" : "InvokeAI"}…`
          : `Preparing the identity anchor for ${selectedProvider.label} edits…`);
      const canonicalReference = await backend.prepareReference(anchor);
      setStage("generating");
      setDetail("Generating exact two-pose motion pairs and one egg in parallel…");

      const rowPromise = mapLimit(generatedRows, 3, async (row, index) => {
        try {
          return [row.id, await buildRow(row, backend, canonicalReference, seed + 100 + index * 17)] as const;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : `${row.label} failed.`;
          patchJob(row.id, { status: "error", detail: message });
          throw cause;
        }
      });
      const hatchPromise = buildHatchSources(backend, canonicalReference, seed + 900).catch((cause) => {
        const message = cause instanceof Error ? cause.message : "Hatch generation failed.";
        patchJob("hatch", { status: "error", detail: message });
        throw cause;
      });
      const [rowEntries, hatchUrl] = await Promise.all([rowPromise, hatchPromise]);
      const cache: PackingCache = { rowEntries, hatchUrl, provider: backend.id };
      packingCache.current = cache;
      setPackingRetryAvailable(true);
      await packArtifacts(cache);
    } catch (cause) {
      const hasPackingCache = Boolean(packingCache.current);
      setError(cause instanceof Error ? cause.message : "Generation failed.");
      setStage("error");
      setPackingRetryAvailable(hasPackingCache);
      setDetail(hasPackingCache
        ? "Generated model frames are preserved in this tab. Retry local packing at no cost."
        : "Generation stopped");
    } finally {
      generationLock.current = false;
    }
  }

  async function downloadPackage() {
    if (!artifact) return;
    await downloadPetPackage(artifact);
  }

  async function handleImport(file?: File) {
    if (!file || importing) return;
    setImporting(true);
    setHistoryMessage("");
    try {
      const imported = await importPetPackage(file);
      selectPetForPlay(imported);
      try {
        setSavedPets(await savePetLocally(imported));
      } catch (cause) {
        setHistoryMessage(`${cause instanceof Error ? cause.message : "The import could not be saved."} It is still playable in this tab.`);
      }
    } catch (cause) {
      setHistoryMessage(cause instanceof Error ? cause.message : "The package could not be imported.");
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function handleDelete(pet: SavedPet) {
    if (!window.confirm(`Delete “${pet.description.slice(0, 80)}” from this browser?`)) return;
    try {
      await deleteSavedPet(pet.id);
      const remaining = savedPets.filter((entry) => entry.id !== pet.id);
      setSavedPets(remaining);
      if (playablePet?.id === pet.id) {
        if (remaining[0]) selectPetForPlay(remaining[0], false);
        else setPlayablePet(null);
      }
      setHistoryMessage("");
    } catch (cause) {
      setHistoryMessage(cause instanceof Error ? cause.message : "The pet could not be deleted.");
    }
  }

  const handleGameComplete = useCallback(async (petId: string, result: GameResult) => {
    if (!playablePet || playablePet.id !== petId) return;
    const gameRecord = mergeGameRecord(playablePet.gameRecord, result);
    const updated: SavedPet = {
      id: playablePet.id, description: playablePet.description, artStyle: playablePet.artStyle, createdAt: playablePet.createdAt,
      petBlob: playablePet.petBlob, hatchBlob: playablePet.hatchBlob, score: playablePet.score,
      hatchSource: playablePet.hatchSource, source: playablePet.source, bestTimeMs: playablePet.bestTimeMs, gameRecord,
      provider: playablePet.provider,
    };
    setPlayablePet((current) => current?.id === petId ? {
      ...current, gameRecord,
      petUrl: URL.createObjectURL(current.petBlob), hatchUrl: URL.createObjectURL(current.hatchBlob),
    } : current);
    setSavedPets((current) => current.map((entry) => entry.id === petId ? updated : entry));
    try {
      setSavedPets(await savePetLocally(updated));
    } catch (cause) {
      setHistoryMessage(cause instanceof Error ? cause.message : "The Beacon Rescue record could not be saved.");
    }
  }, [playablePet]);

  function openImporter() {
    importInputRef.current?.click();
  }

  async function copyRequest() {
    await navigator.clipboard.writeText(JSON.stringify(requestExample, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <>
    <div className="lab-shell atlas-lab">
      <section className="lab-controls" aria-label="Pet generator controls">
        <fieldset>
          <legend>Generation engine</legend>
          <div className={`segmented providers count-${providers.length}`}>
            {providers.map((candidate) => (
              <button type="button" key={candidate.id} className={provider === candidate.id ? "active" : ""} onClick={() => selectProvider(candidate.id)} disabled={busy} aria-pressed={provider === candidate.id}>
                {candidate.label}
              </button>
            ))}
          </div>
          <p className="field-help">Use a cloud API, connect this browser directly to ComfyUI or InvokeAI, or use a local engine configured on a self-hosted Hatch server.</p>
        </fieldset>
        {isCloudProviderId(provider) ? (
          <div className="field-block">
            <label htmlFor={`${provider}-key`}>{credentialFields[provider].label}</label>
            <div className="key-field"><span aria-hidden="true">◆</span><input id={`${provider}-key`} type="password" value={cloudApiKey} onChange={(event) => setProviderApiKey(provider, event.target.value)} placeholder={credentialFields[provider].placeholder} autoComplete="off" spellCheck="false" /></div>
            <p className="field-help">Held only in page memory. {selectedProvider.serverCredential ? `This server already has ${credentialFields[provider].env} configured; a pasted key overrides it for this tab.` : `Paste a key here or configure ${credentialFields[provider].env} on the server.`}</p>
          </div>
        ) : localWorkflows ? (
          <div className="field-block local-workflows">
            <div className="provider-status"><b>{directLocal ? `Direct browser → ${selectedProvider.label}` : `${selectedProvider.label} via Hatch server`}</b><span>{directLocal ? "Your browser calls the engine endpoint using CORS." : selectedProvider.serverWorkflows ? "Mounted workflow defaults are ready." : "Upload both workflow exports to continue."}</span></div>
            {selectedProvider.serverConfigured && localConnection && (
              <div className="segmented connection-mode">
                <button type="button" className={!localConnection.direct ? "active" : ""} disabled={busy} onClick={() => patchLocalConnection(provider, { direct: false })}>Hatch server</button>
                <button type="button" className={localConnection.direct ? "active" : ""} disabled={busy} onClick={() => patchLocalConnection(provider, { direct: true })}>Direct browser</button>
              </div>
            )}
            {directLocal && localConnection && (
              <div className="direct-engine-fields">
                <label className="output-node" htmlFor={`${provider}-endpoint`}>Engine endpoint</label>
                <div className="key-field"><span aria-hidden="true">↗</span><input id={`${provider}-endpoint`} type="url" value={localConnection.endpoint} onChange={(event) => patchLocalConnection(provider, { endpoint: event.target.value })} placeholder={provider === "comfyui" ? "http://127.0.0.1:8188" : "http://127.0.0.1:9090"} autoComplete="off" spellCheck="false" /></div>
                <label className="output-node" htmlFor={`${provider}-token`}>Bearer token <span>optional</span></label>
                <div className="key-field"><span aria-hidden="true">◆</span><input id={`${provider}-token`} type="password" value={localConnection.token} onChange={(event) => patchLocalConnection(provider, { token: event.target.value })} placeholder="Held only in this tab" autoComplete="off" spellCheck="false" /></div>
              </div>
            )}
            <div className="workflow-grid">
              <label className="workflow-file">
                <span>Text workflow</span>
                <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => loadWorkflowFile(provider, "text", event.target.files?.[0])} />
                <small>{localWorkflows.textName || (!directLocal && selectedProvider.serverWorkflows ? "Server default" : "Required")}</small>
              </label>
              <label className="workflow-file">
                <span>Edit workflow</span>
                <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => loadWorkflowFile(provider, "edit", event.target.files?.[0])} />
                <small>{localWorkflows.editName || (!directLocal && selectedProvider.serverWorkflows ? "Server default" : "Required")}</small>
              </label>
            </div>
            <label className="output-node" htmlFor={`${provider}-output-node`}>Output node <span>optional</span></label>
            <div className="key-field"><span aria-hidden="true">#</span><input id={`${provider}-output-node`} type="text" value={localWorkflows.outputNode || ""} onChange={(event) => setLocalOutputNode(provider, event.target.value)} placeholder={selectedProvider.outputNodeConfigured ? "Using server default" : "Auto-detect first image"} autoComplete="off" spellCheck="false" /></div>
            {(localWorkflows.text || localWorkflows.edit || localWorkflows.outputNode) && <button type="button" className="workflow-reset" disabled={busy} onClick={() => clearWorkflowOverrides(provider)}>{!directLocal && selectedProvider.serverWorkflows ? "Use server workflow defaults" : "Clear browser workflows"}</button>}
            <p className="field-help">{directLocal ? "Endpoint, token and workflow JSON stay in this tab. The engine must allow this site through CORS and your browser may request local-network permission." : "Workflow JSON stays in this tab and is sent only to your Hatch server."} Nothing here is saved in pet history or exports.</p>
          </div>
        ) : null}
        <div className="field-block">
          <label htmlFor="pet-description">Describe the pet</label>
          <textarea id="pet-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={900} />
          <div className="field-meta"><span>Short ideas are expanded into one precise, model-ready creature.</span><b>{description.length}/900</b></div>
          <div className="prompt-helper" aria-live="polite"><span>Prompt strengthened before send</span><p>{enhancedBrief}</p></div>
          <div className="prompt-examples" aria-label="Tested pet ideas">
            <button type="button" onClick={() => setDescription("A round mint moon-moth kitten named Nibi — cream face, lavender antennae, leaf wings, star-shaped tail tip")}>Moon-moth kitten</button>
            <button type="button" onClick={() => setDescription("A tiny lavender star otter — round ears, cream belly, one mint star marking above the right eye")}>Star otter</button>
            <button type="button" onClick={() => setDescription("A cheerful pea-green sprout frog — cream cheeks, two leaf sprouts, tiny navy feet and one lavender satchel strap marking")}>Sprout frog</button>
          </div>
        </div>
        <fieldset>
          <legend>Look</legend>
          <div className="segmented three">
            <button type="button" className={artStyle === "pixel" ? "active" : ""} onClick={() => setArtStyle("pixel")} aria-pressed={artStyle === "pixel"}>Crisp pixel</button>
            <button type="button" className={artStyle === "toon" ? "active" : ""} onClick={() => setArtStyle("toon")} aria-pressed={artStyle === "toon"}>Soft pixel</button>
            <button type="button" className={artStyle === "plush" ? "active" : ""} onClick={() => setArtStyle("plush")} aria-pressed={artStyle === "plush"}>Chunky pixel</button>
          </div>
        </fieldset>
        <details className="advanced">
          <summary>Advanced execution <span>{selectedProvider.model || selectedProvider.label} + local alpha</span></summary>
          <div className="advanced-body">
            <label className="check-row"><input type="checkbox" checked={autoRetry} onChange={(event) => setAutoRetry(event.target.checked)} /><span><b>Retry a missing pose pair once</b><small>{provider === "fal" ? "Adds about $0.02 only when a two-pose segment fails." : `Runs one extra ${selectedProvider.label} job only when a pose pair fails.`}</small></span></label>
            <button type="button" className="copy-request" onClick={copyRequest}>{copied ? "Copied provider contract" : "Copy provider request example"}</button>
          </div>
        </details>
        {canRetryPacking ? (
          <button className="generate-button retry-packing" type="button" onClick={retryPacking}><span>Retry local packing · $0</span><b aria-hidden="true">↻</b></button>
        ) : (
          <button className="generate-button" type="button" disabled={busy} onClick={generate}><span>{busy ? "Hatching your pet…" : "Generate full pet package"}</span><b aria-hidden="true">{busy ? "···" : "→"}</b></button>
        )}
        <p className="cost-note">{provider === "fal" ? "Full no-retry run: 27 fal jobs, about $0.43 at listed FLUX pricing. " : isHostedCloudProviderId(provider) ? `Full no-retry run: 27 ${selectedProvider.label} image API calls billed by that provider; Hatch adds no generation charge. ` : `Full no-retry run: 27 jobs on your ${selectedProvider.label} engine; Hatch adds no generation charge. `}Small two-pose requests are deliberate: they reliably return exact counts. Alpha, mirroring, packing and all 24 hatch frames run in this browser.</p>
      </section>

      <section className="lab-output" aria-label="Generated pet output">
        <div className="output-topline">
          <div><span className={`status-dot ${stage}`} /><strong>{stage === "idle" ? "Ready" : stage === "error" ? "Needs attention" : stage === "ready" ? "Package ready" : stage === "packing" ? "Packing atlases" : stage === "anchor" ? "Locking identity" : "Generating states"}</strong></div>
          <span className="status-detail" aria-live="polite">{detail}</span>
        </div>
        {error && <div className="error-banner" role="alert"><b>Generation stopped.</b><span>{error}</span></div>}

        {!artifact ? (
          <div className="atlas-progress-wrap">
            <div className="atlas-placeholder" aria-label="Eight by nine runtime atlas preview">
              {Array.from({ length: 72 }, (_, index) => <i key={index} className={index % 8 >= [6, 8, 8, 4, 5, 8, 6, 6, 6][Math.floor(index / 8)] ? "empty-cell" : ""} />)}
              {busy && <div className="scan-line" aria-hidden="true" />}
            </div>
            <div className="atlas-caption"><span>Hatch runtime contract</span><strong>8 × 9 · 192 × 208 cells · 57 populated</strong></div>
          </div>
        ) : (
          <div className="result-output atlas-result">
            <ActionGallery artifact={artifact} />
            <div className={`qa-card ${artifact.score >= 88 ? "pass" : "warn"}`}><div className="qa-score"><strong>{artifact.score}</strong><span>/100</span></div><div><b>Deterministic atlas checks complete</b><p>Exact dimensions · normalized pivots · mirrored left run · transparent unused cells · hatch source: {artifact.hatchSource}</p></div></div>
            <div className="download-row result-actions">
              <button type="button" className="play-now-button" onClick={() => selectPetForPlay(artifact)}>Play now <span>GAME</span></button>
              <button type="button" onClick={downloadPackage}>Portable package <span>ZIP</span></button>
              <button type="button" onClick={() => downloadHermesPetPackage(artifact)}>Hermes Agent <span>ZIP</span></button>
              <button type="button" onClick={() => downloadBlob(artifact.petBlob, "spritesheet.png")}>Pet atlas <span>PNG</span></button>
              <button type="button" onClick={() => downloadBlob(artifact.hatchBlob, "hatch.png")}>Hatch atlas <span>PNG</span></button>
            </div>
          </div>
        )}

        <div className="job-grid" aria-label="Animation row progress">
          {[...rows, { id: "hatch" as const, label: "Hatch", count: 24 }].map((row, index) => {
            const job = jobs[row.id];
            return <div className={`job-row ${job.status}`} key={row.id}><span>{String(index + 1).padStart(2, "0")}</span><b>{row.label}</b><small>{job.detail}</small>{typeof job.score === "number" && <em>{job.score}</em>}</div>;
          })}
        </div>
        {/* The generated preview is a short-lived blob URL, so Next Image cannot optimize it. */}
        {anchorUrl && (
          <div className="anchor-chip">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={anchorUrl} alt="Generated canonical pet anchor" />
            <span><b>Identity anchor locked</b><small>Reused in every generated state</small></span>
          </div>
        )}
      </section>
    </div>
    <section className="playground-panel" ref={gameSectionRef} aria-labelledby="playground-heading">
      <div className="panel-heading">
        <div><span>Playable proof</span><h3 id="playground-heading">Beacon Rescue</h3></div>
        {playablePet && <p>Playing as <strong>{playablePet.description}</strong></p>}
      </div>
      {playablePet ? (
        <BeaconGame key={playablePet.id} pet={playablePet} onComplete={handleGameComplete} />
      ) : (
        <div className="empty-playground">
          <strong>Hatch or import a pet to play.</strong>
          <p>Your sprite will run, jump and celebrate using its generated atlas.</p>
          <button type="button" onClick={openImporter}>Import Hatch ZIP</button>
        </div>
      )}
    </section>

    <section className="history-panel" aria-labelledby="history-heading">
      <div className="panel-heading history-heading">
        <div><span>Private · this browser only</span><h3 id="history-heading">Your hatch history</h3></div>
        <button type="button" className="import-button" onClick={openImporter} disabled={importing}>{importing ? "Importing…" : "Import Hatch ZIP"}</button>
        <input ref={importInputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event) => handleImport(event.target.files?.[0])} />
      </div>
      {historyMessage && <div className="history-message" role="status">{historyMessage}</div>}
      {savedPets.length ? (
        <div className="history-grid">
          {savedPets.map((pet) => (
            <article className={`history-card ${playablePet?.id === pet.id ? "selected" : ""}`} key={pet.id}>
              <div className="history-preview checkerboard"><PetThumbnail pet={pet} /></div>
              <div className="history-card-copy">
                <span>{pet.source === "imported" ? "Imported" : "Generated"}{pet.provider ? ` via ${pet.provider === "comfyui" ? "ComfyUI" : pet.provider === "invoke" ? "InvokeAI" : "fal"}` : ""} · {new Date(pet.createdAt).toLocaleDateString()}</span>
                <h4>{pet.description}</h4>
                <p>Beacon Rescue <strong>{pet.gameRecord?.levelVersion === GAME_LEVEL_VERSION ? formatTime(pet.gameRecord.bestTimeMs) : "Not cleared"}</strong> · {pet.gameRecord?.levelVersion === GAME_LEVEL_VERSION ? pet.gameRecord.badges.length : 0}/3 badges</p>
              </div>
              <div className="history-card-actions">
                <button type="button" className="history-play" onClick={() => selectPetForPlay(pet)}>Play</button>
                <button type="button" onClick={() => downloadPetPackage(pet)}>Hatch ZIP</button>
                <button type="button" onClick={() => downloadHermesPetPackage(pet)}>Hermes ZIP</button>
                <button type="button" className="history-delete" onClick={() => handleDelete(pet)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-history"><strong>No saved pets yet.</strong><p>Completed generations and valid imports will appear here automatically.</p></div>
      )}
    </section>
    </>
  );
}
