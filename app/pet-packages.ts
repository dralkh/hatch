import { strToU8, zipSync } from "fflate";

const CELL_W = 192;
const CELL_H = 208;
const COLS = 8;
const PET_ROWS = 9;
const HATCH_ROWS = 3;
const PET_WIDTH = CELL_W * COLS;
const PET_HEIGHT = CELL_H * PET_ROWS;
const HATCH_HEIGHT = CELL_H * HATCH_ROWS;

export interface PackagePet {
  description: string;
  createdAt: string;
  petBlob: Blob;
  hatchBlob: Blob;
  artStyle?: string;
  provider?: string;
}

export interface PackageOutput {
  blob: Blob;
  filename: string;
}

export function packageSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "sprite-pet";
}

export function genericManifest(description: string) {
  return {
    schema: "sprite-pet/v1",
    description,
    assets: {
      pet: { src: "spritesheet.png", width: PET_WIDTH, height: PET_HEIGHT, grid: { columns: COLS, rows: PET_ROWS, cellWidth: CELL_W, cellHeight: CELL_H } },
      hatch: { src: "hatch.png", width: PET_WIDTH, height: HATCH_HEIGHT, grid: { columns: COLS, rows: HATCH_ROWS, cellWidth: CELL_W, cellHeight: CELL_H } },
    },
    pivot: { x: 96, y: 194 },
    clips: {
      hatch: { asset: "hatch", start: 0, count: 24, frameMs: 83, loop: false, next: "idle" },
      idle: { asset: "pet", row: 0, count: 6, frameMs: 167, loop: true },
      runRight: { asset: "pet", row: 1, count: 8, frameMs: 91, loop: true },
      runLeft: { asset: "pet", row: 2, count: 8, frameMs: 91, loop: true },
      wave: { asset: "pet", row: 3, count: 4, frameMs: 143, loop: false, next: "idle" },
      jump: { asset: "pet", row: 4, count: 5, frameMs: 111, loop: false, next: "idle" },
      failed: { asset: "pet", row: 5, count: 8, frameMs: 143, loop: false, next: "idle" },
      waiting: { asset: "pet", row: 6, count: 6, frameMs: 200, loop: true },
      work: { asset: "pet", row: 7, count: 6, frameMs: 111, loop: true },
      review: { asset: "pet", row: 8, count: 6, frameMs: 167, loop: true },
    },
  };
}

function portableRuntime() {
  return `export class SpritePet {
  constructor(canvas, manifest, base = ".") {
    this.canvas = canvas; this.ctx = canvas.getContext("2d"); this.manifest = manifest; this.base = base;
    this.images = {}; this.state = "idle"; this.started = performance.now(); this.raf = 0;
  }
  async load() {
    for (const [id, asset] of Object.entries(this.manifest.assets)) {
      const image = new Image(); image.src = new URL(asset.src, new URL(this.base, location.href)).href;
      await image.decode(); this.images[id] = image;
    }
    this.play("hatch");
  }
  play(name) { this.state = name; this.started = performance.now(); cancelAnimationFrame(this.raf); this.tick(this.started); }
  tick = (now) => {
    const clip = this.manifest.clips[this.state]; const asset = this.manifest.assets[clip.asset]; const elapsed = now - this.started;
    let frame = Math.floor(elapsed / clip.frameMs);
    if (!clip.loop && frame >= clip.count) { this.play(clip.next || "idle"); return; }
    frame %= clip.count; const absolute = clip.start == null ? clip.row * asset.grid.columns + frame : clip.start + frame;
    const col = absolute % asset.grid.columns, row = Math.floor(absolute / asset.grid.columns);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.images[clip.asset], col * asset.grid.cellWidth, row * asset.grid.cellHeight, asset.grid.cellWidth, asset.grid.cellHeight, 0, 0, this.canvas.width, this.canvas.height);
    this.raf = requestAnimationFrame(this.tick);
  }
  destroy() { cancelAnimationFrame(this.raf); }
}`;
}

function exampleHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sprite Pet</title><style>body{min-height:100vh;display:grid;place-items:center;background:#eef7fa}canvas{width:192px;height:208px;image-rendering:pixelated}</style></head><body><canvas id="pet" width="192" height="208"></canvas><script type="module">import {SpritePet} from './sprite-pet.js'; const manifest=await fetch('./manifest.json').then(r=>r.json()); const pet=new SpritePet(document.querySelector('#pet'),manifest); await pet.load(); window.pet=pet;</script></body></html>`;
}

function zipBlob(files: Record<string, Uint8Array>) {
  const zipped = zipSync(files, { level: 6 });
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: "application/zip" });
}

function petMetadata(pet: PackagePet) {
  const slug = packageSlug(pet.description);
  return {
    id: slug,
    displayName: pet.description.slice(0, 80),
    description: pet.description,
    spritesheetPath: "spritesheet.png",
  };
}

export async function buildHatchPackage(pet: PackagePet): Promise<PackageOutput> {
  const slug = packageSlug(pet.description);
  const manifest = genericManifest(pet.description);
  const petJson = {
    ...petMetadata(pet),
    ...(pet.artStyle ? { artStyle: pet.artStyle } : {}),
    ...(pet.provider ? { provider: pet.provider } : {}),
    createdAt: pet.createdAt,
    createdBy: "Hatch",
  };
  const readme = `# ${pet.description}\n\nGenerated by Hatch.\n\n- spritesheet.png: app-ready 8×9 runtime atlas, 192×208 cells\n- hatch.png: 24-frame 8×3 one-shot hatch atlas\n- pet.json: portable pet identity metadata\n- manifest.json: app-agnostic animation contract\n- sprite-pet.js + index.html: dependency-free browser player\n\nServe this folder over HTTP and open index.html. Call window.pet.play('review'), window.pet.play('work'), or window.pet.play('hatch').\n`;
  return {
    blob: zipBlob({
      "spritesheet.png": new Uint8Array(await pet.petBlob.arrayBuffer()),
      "hatch.png": new Uint8Array(await pet.hatchBlob.arrayBuffer()),
      "pet.json": strToU8(JSON.stringify(petJson, null, 2)),
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
      "sprite-pet.js": strToU8(portableRuntime()),
      "index.html": strToU8(exampleHtml()),
      "README.md": strToU8(readme),
    }),
    filename: `${slug}-sprite-pet.zip`,
  };
}

export async function buildHermesPackage(pet: PackagePet): Promise<PackageOutput> {
  const slug = packageSlug(pet.description);
  return {
    blob: zipBlob({
      "pet.json": strToU8(JSON.stringify(petMetadata(pet), null, 2)),
      "spritesheet.png": new Uint8Array(await pet.petBlob.arrayBuffer()),
    }),
    filename: `${slug}-hermes-pet.zip`,
  };
}
