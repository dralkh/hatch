export type EndlessDifficulty = "explorer" | "adventure" | "expert";
export type EndlessEnemyKind = "drifter" | "flock" | "shell" | "spitter" | "guardian";

export type EndlessPlatform = { x: number; y: number; width: number; height: number };
export type EndlessHazard = { x: number; y: number; width: number; height: number; axis: "x" | "y"; amplitude: number; speed: number; phase: number };
export type EndlessSpawn = { kind: EndlessEnemyKind; x: number; y: number };
export type EndlessRoom = {
  index: number;
  templateId: string;
  theme: 0 | 1 | 2;
  haven: boolean;
  boss: boolean;
  platforms: EndlessPlatform[];
  hazards: EndlessHazard[];
  spawns: EndlessSpawn[];
  collectible?: { x: number; y: number };
};

type RoomTemplate = {
  id: string;
  theme: 0 | 1 | 2;
  platforms: EndlessPlatform[];
  hazardSockets: Array<Omit<EndlessHazard, "speed" | "phase">>;
  spawnSockets: Array<{ x: number; y: number }>;
  collectible: { x: number; y: number };
};

const ground = { x: 0, y: 480, width: 960, height: 60 };

export const ENDLESS_ROOM_TEMPLATES: RoomTemplate[] = [
  { id: "grove-steps", theme: 0, platforms: [ground, { x: 150, y: 390, width: 150, height: 18 }, { x: 390, y: 335, width: 150, height: 18 }, { x: 660, y: 390, width: 160, height: 18 }], hazardSockets: [{ x: 300, y: 444, width: 34, height: 36, axis: "x", amplitude: 65 }], spawnSockets: [{ x: 220, y: 355 }, { x: 510, y: 430 }, { x: 735, y: 350 }], collectible: { x: 465, y: 285 } },
  { id: "grove-arches", theme: 0, platforms: [ground, { x: 95, y: 360, width: 180, height: 18 }, { x: 390, y: 405, width: 160, height: 18 }, { x: 690, y: 320, width: 170, height: 18 }], hazardSockets: [{ x: 585, y: 444, width: 34, height: 36, axis: "y", amplitude: 52 }], spawnSockets: [{ x: 170, y: 320 }, { x: 470, y: 365 }, { x: 770, y: 280 }], collectible: { x: 780, y: 268 } },
  { id: "grove-bridge", theme: 0, platforms: [ground, { x: 130, y: 410, width: 190, height: 18 }, { x: 385, y: 300, width: 190, height: 18 }, { x: 650, y: 410, width: 190, height: 18 }], hazardSockets: [{ x: 350, y: 444, width: 32, height: 36, axis: "x", amplitude: 85 }, { x: 585, y: 444, width: 32, height: 36, axis: "x", amplitude: 70 }], spawnSockets: [{ x: 225, y: 370 }, { x: 480, y: 260 }, { x: 745, y: 370 }], collectible: { x: 480, y: 245 } },
  { id: "grove-canopy", theme: 0, platforms: [ground, { x: 110, y: 340, width: 150, height: 18 }, { x: 315, y: 390, width: 130, height: 18 }, { x: 510, y: 285, width: 150, height: 18 }, { x: 725, y: 370, width: 130, height: 18 }], hazardSockets: [{ x: 455, y: 444, width: 34, height: 36, axis: "y", amplitude: 45 }], spawnSockets: [{ x: 185, y: 300 }, { x: 380, y: 350 }, { x: 585, y: 245 }, { x: 790, y: 330 }], collectible: { x: 585, y: 230 } },
  { id: "grove-ravine", theme: 0, platforms: [ground, { x: 170, y: 370, width: 140, height: 18 }, { x: 410, y: 265, width: 140, height: 18 }, { x: 650, y: 370, width: 140, height: 18 }], hazardSockets: [{ x: 330, y: 444, width: 34, height: 36, axis: "x", amplitude: 60 }, { x: 585, y: 350, width: 34, height: 34, axis: "y", amplitude: 70 }], spawnSockets: [{ x: 235, y: 330 }, { x: 480, y: 225 }, { x: 715, y: 330 }], collectible: { x: 480, y: 212 } },
  { id: "ruin-columns", theme: 1, platforms: [ground, { x: 120, y: 405, width: 125, height: 18 }, { x: 330, y: 325, width: 125, height: 18 }, { x: 540, y: 245, width: 125, height: 18 }, { x: 750, y: 365, width: 125, height: 18 }], hazardSockets: [{ x: 470, y: 444, width: 36, height: 36, axis: "x", amplitude: 80 }], spawnSockets: [{ x: 180, y: 365 }, { x: 390, y: 285 }, { x: 600, y: 205 }, { x: 810, y: 325 }], collectible: { x: 600, y: 190 } },
  { id: "ruin-vault", theme: 1, platforms: [ground, { x: 100, y: 330, width: 190, height: 18 }, { x: 385, y: 390, width: 190, height: 18 }, { x: 670, y: 330, width: 190, height: 18 }], hazardSockets: [{ x: 305, y: 444, width: 34, height: 36, axis: "y", amplitude: 55 }, { x: 620, y: 444, width: 34, height: 36, axis: "y", amplitude: 55 }], spawnSockets: [{ x: 190, y: 290 }, { x: 480, y: 350 }, { x: 765, y: 290 }], collectible: { x: 480, y: 335 } },
  { id: "ruin-switchback", theme: 1, platforms: [ground, { x: 120, y: 410, width: 145, height: 18 }, { x: 300, y: 335, width: 145, height: 18 }, { x: 480, y: 260, width: 145, height: 18 }, { x: 660, y: 335, width: 145, height: 18 }], hazardSockets: [{ x: 835, y: 444, width: 34, height: 36, axis: "x", amplitude: 55 }], spawnSockets: [{ x: 190, y: 370 }, { x: 370, y: 295 }, { x: 550, y: 220 }, { x: 730, y: 295 }], collectible: { x: 550, y: 205 } },
  { id: "ruin-balcony", theme: 1, platforms: [ground, { x: 130, y: 300, width: 220, height: 18 }, { x: 430, y: 400, width: 120, height: 18 }, { x: 630, y: 300, width: 220, height: 18 }], hazardSockets: [{ x: 375, y: 444, width: 34, height: 36, axis: "x", amplitude: 65 }, { x: 565, y: 444, width: 34, height: 36, axis: "x", amplitude: 65 }], spawnSockets: [{ x: 240, y: 260 }, { x: 490, y: 360 }, { x: 740, y: 260 }], collectible: { x: 740, y: 245 } },
  { id: "ruin-glyphs", theme: 1, platforms: [ground, { x: 90, y: 380, width: 150, height: 18 }, { x: 310, y: 285, width: 150, height: 18 }, { x: 530, y: 380, width: 150, height: 18 }, { x: 750, y: 285, width: 130, height: 18 }], hazardSockets: [{ x: 250, y: 444, width: 34, height: 36, axis: "y", amplitude: 48 }, { x: 695, y: 350, width: 34, height: 34, axis: "y", amplitude: 60 }], spawnSockets: [{ x: 165, y: 340 }, { x: 385, y: 245 }, { x: 605, y: 340 }, { x: 810, y: 245 }], collectible: { x: 385, y: 230 } },
  { id: "workshop-gears", theme: 2, platforms: [ground, { x: 115, y: 410, width: 150, height: 18 }, { x: 350, y: 305, width: 160, height: 18 }, { x: 610, y: 390, width: 180, height: 18 }], hazardSockets: [{ x: 285, y: 444, width: 38, height: 36, axis: "x", amplitude: 70 }, { x: 810, y: 444, width: 38, height: 36, axis: "x", amplitude: 55 }], spawnSockets: [{ x: 190, y: 370 }, { x: 430, y: 265 }, { x: 700, y: 350 }], collectible: { x: 430, y: 250 } },
  { id: "workshop-lifts", theme: 2, platforms: [ground, { x: 110, y: 320, width: 150, height: 18 }, { x: 330, y: 410, width: 140, height: 18 }, { x: 540, y: 265, width: 150, height: 18 }, { x: 750, y: 380, width: 120, height: 18 }], hazardSockets: [{ x: 485, y: 390, width: 34, height: 34, axis: "y", amplitude: 62 }], spawnSockets: [{ x: 185, y: 280 }, { x: 400, y: 370 }, { x: 615, y: 225 }, { x: 810, y: 340 }], collectible: { x: 615, y: 210 } },
  { id: "workshop-conveyor", theme: 2, platforms: [ground, { x: 120, y: 395, width: 210, height: 18 }, { x: 390, y: 315, width: 180, height: 18 }, { x: 630, y: 395, width: 210, height: 18 }], hazardSockets: [{ x: 345, y: 444, width: 34, height: 36, axis: "x", amplitude: 45 }, { x: 585, y: 444, width: 34, height: 36, axis: "x", amplitude: 45 }], spawnSockets: [{ x: 225, y: 355 }, { x: 480, y: 275 }, { x: 735, y: 355 }], collectible: { x: 480, y: 260 } },
  { id: "workshop-towers", theme: 2, platforms: [ground, { x: 130, y: 350, width: 130, height: 18 }, { x: 330, y: 245, width: 130, height: 18 }, { x: 530, y: 350, width: 130, height: 18 }, { x: 730, y: 245, width: 130, height: 18 }], hazardSockets: [{ x: 275, y: 444, width: 34, height: 36, axis: "y", amplitude: 52 }, { x: 675, y: 330, width: 34, height: 34, axis: "y", amplitude: 65 }], spawnSockets: [{ x: 195, y: 310 }, { x: 395, y: 205 }, { x: 595, y: 310 }, { x: 795, y: 205 }], collectible: { x: 795, y: 190 } },
  { id: "workshop-core", theme: 2, platforms: [ground, { x: 100, y: 390, width: 150, height: 18 }, { x: 300, y: 290, width: 150, height: 18 }, { x: 510, y: 210, width: 150, height: 18 }, { x: 720, y: 350, width: 150, height: 18 }], hazardSockets: [{ x: 460, y: 410, width: 36, height: 36, axis: "x", amplitude: 75 }, { x: 675, y: 444, width: 36, height: 36, axis: "x", amplitude: 55 }], spawnSockets: [{ x: 175, y: 350 }, { x: 375, y: 250 }, { x: 585, y: 170 }, { x: 795, y: 310 }], collectible: { x: 585, y: 155 } },
];

function hash32(value: number) {
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function seededUnit(seed: number, salt: number) {
  return hash32((seed >>> 0) ^ Math.imul(salt + 1, 0x9e3779b1)) / 0x100000000;
}

export function templateIndexFor(seed: number, roomIndex: number) {
  const steps = [2, 4, 7, 8, 11, 13, 14];
  const step = steps[hash32(seed) % steps.length];
  const offset = hash32(seed ^ 0x51ed270b) % ENDLESS_ROOM_TEMPLATES.length;
  return (offset + roomIndex * step) % ENDLESS_ROOM_TEMPLATES.length;
}

export function generateEndlessRoom(seed: number, index: number, difficulty: EndlessDifficulty): EndlessRoom {
  const template = ENDLESS_ROOM_TEMPLATES[templateIndexFor(seed, index)];
  const origin = index * 960;
  const haven = index > 0 && index % 5 === 0;
  const boss = index > 0 && (index + 1) % 10 === 0;
  const difficultyScale = difficulty === "explorer" ? 0.75 : difficulty === "expert" ? 1.3 : 1;
  const tier = Math.min(12, Math.floor(index / 3));
  const desired = haven ? 0 : boss ? 1 : Math.max(1, Math.min(8, Math.round((2 + tier * 0.45) * difficultyScale)));
  const kinds: EndlessEnemyKind[] = tier < 2 ? ["drifter", "flock"] : tier < 5 ? ["drifter", "flock", "spitter"] : ["drifter", "flock", "shell", "spitter"];
  const spawns: EndlessSpawn[] = [];
  for (let spawnIndex = 0; spawnIndex < desired; spawnIndex += 1) {
    const socket = template.spawnSockets[spawnIndex % template.spawnSockets.length];
    const kind = boss ? "guardian" : kinds[Math.floor(seededUnit(seed, index * 31 + spawnIndex) * kinds.length) % kinds.length];
    spawns.push({ kind, x: origin + socket.x + Math.floor(spawnIndex / template.spawnSockets.length) * 28, y: socket.y });
  }
  const hazardCount = haven ? 0 : Math.min(template.hazardSockets.length, 1 + Math.floor(tier / 4));
  return {
    index,
    templateId: haven ? `haven-${template.theme}` : template.id,
    theme: template.theme,
    haven,
    boss,
    platforms: template.platforms.map((platform) => ({ ...platform, x: origin + platform.x })),
    hazards: template.hazardSockets.slice(0, hazardCount).map((hazard, hazardIndex) => ({
      ...hazard,
      x: origin + hazard.x,
      speed: (0.00145 + tier * 0.000055) * (difficulty === "explorer" ? 0.9 : difficulty === "expert" ? 1.15 : 1),
      phase: seededUnit(seed, index * 17 + hazardIndex) * Math.PI * 2,
    })),
    spawns,
    collectible: haven ? undefined : { x: origin + template.collectible.x, y: template.collectible.y },
  };
}
