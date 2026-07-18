import assert from "node:assert/strict";
import test from "node:test";

import {
  BEACONS,
  DIFFICULTY_CONFIG,
  HATCH_DURATION_MS,
  PLAYER_H,
  PLAYER_W,
  SANCTUARY,
  WISP,
  createGameWorld,
  getContextAction,
  mergeGameRecord,
  selectEndlessUpgrade,
  stepGame,
} from "../app/game-engine.ts";

const idle = { left: false, right: false, jump: false, interact: false, fire: false, nextWeapon: false, weaponSelect: null };

function finishHatch(world) {
  for (let elapsed = 0; elapsed < HATCH_DURATION_MS; elapsed += 40) stepGame(world, idle, 40);
  assert.equal(world.phase, "playing");
}

function place(world, point) {
  world.x = point.x - PLAYER_W / 2;
  world.y = point.y - PLAYER_H / 2;
  world.vx = 0;
  world.vy = 0;
  world.grounded = true;
  world.standingPlatform = null;
}

function interactFor(world, point, milliseconds) {
  const events = [];
  for (let elapsed = 0; elapsed <= milliseconds; elapsed += 40) {
    place(world, point);
    events.push(...stepGame(world, { ...idle, interact: true }, 40));
  }
  return events;
}

test("hatch intro transitions into play without adding run time", () => {
  const world = createGameWorld();
  finishHatch(world);
  assert.equal(world.elapsedMs, 0);
});

test("story interactions unlock all three guardian tools", () => {
  const world = createGameWorld();
  finishHatch(world);
  world.enemies = [];
  place(world, WISP);
  assert.equal(getContextAction(world)?.kind, "wave");
  stepGame(world, { ...idle, interact: true }, 16);
  assert.equal(world.shield, 1);
  assert.ok(world.unlockedWeapons.has("wisp-bolt"));

  interactFor(world, { x: 1110, y: 425 }, 1640);
  assert.ok(world.unlockedWeapons.has("moon-arc"));
  interactFor(world, BEACONS[0], 1560);
  interactFor(world, BEACONS[1], 1560);
  assert.ok(world.unlockedWeapons.has("beacon-pulse"));
});

test("weapons fire with independent cooldowns and explicit switching", () => {
  const world = createGameWorld({ mode: "endless" });
  finishHatch(world);
  const fired = stepGame(world, { ...idle, fire: true }, 16);
  assert.ok(fired.some((event) => event.type === "fired"));
  assert.equal(world.projectiles[0].weapon, "wisp-bolt");
  assert.ok(world.weaponCooldowns["wisp-bolt"] > 0);
  stepGame(world, { ...idle, weaponSelect: "moon-arc" }, 160);
  assert.equal(world.selectedWeapon, "moon-arc");
});

test("visible difficulty presets control hearts and assistance thresholds", () => {
  assert.deepEqual(Object.keys(DIFFICULTY_CONFIG), ["explorer", "adventure", "expert"]);
  assert.equal(createGameWorld({ difficulty: "explorer" }).maxHearts, 4);
  assert.equal(createGameWorld({ difficulty: "adventure" }).maxHearts, 3);
  assert.equal(createGameWorld({ difficulty: "expert" }).maxHearts, 2);
  assert.equal(DIFFICULTY_CONFIG.explorer.hintFailures, 2);
  assert.equal(DIFFICULTY_CONFIG.expert.hintFailures, 4);
});

test("story victory records the selected difficulty and four mastery routes", () => {
  const world = createGameWorld({ difficulty: "expert" });
  finishHatch(world);
  world.repaired = [true, true, true];
  world.guardianCleaned = true;
  world.failures = 0;
  world.glowbits = new Set(["story:0", "story:1", "story:2", "story:3", "story:4"]);
  world.usedRiskyShortcut = true;
  world.weaponsUsed = new Set(["wisp-bolt", "moon-arc", "beacon-pulse"]);
  interactFor(world, SANCTUARY, 40);
  assert.equal(world.result?.mode, "story");
  assert.equal(world.result?.difficulty, "expert");
  assert.equal(world.result?.badges.length, 4);
});

test("endless upgrades are temporary world state choices", () => {
  const world = createGameWorld({ mode: "endless", seed: 99 });
  world.phase = "upgrade";
  world.pendingUpgrades = ["bolt-tempo", "arc-width", "field-shield"];
  assert.equal(selectEndlessUpgrade(world, "bolt-tempo"), true);
  assert.equal(world.upgradeStacks["bolt-tempo"], 1);
  assert.equal(world.phase, "playing");
});

test("versioned records preserve legacy data and separate modes and difficulty", () => {
  const legacy = { levelVersion: 2, bestTimeMs: 90000, badges: ["steady-heart"], completions: 2 };
  const story = mergeGameRecord(legacy, { mode: "story", difficulty: "adventure", elapsedMs: 100000, failures: 0, glowbits: 5, cleansed: 8, usedRiskyShortcut: false, badges: ["steady-heart"] });
  const endless = mergeGameRecord(story, { mode: "endless", difficulty: "expert", elapsedMs: 60000, score: 4200, rooms: 4, cleansed: 9, seed: 77 });
  assert.equal(endless.legacy?.bestTimeMs, 90000);
  assert.equal(endless.story.adventure?.bestTimeMs, 100000);
  assert.equal(endless.endless.expert?.bestScore, 4200);
  assert.equal(endless.endless.expert?.bestSeed, 77);
});
