import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_PLATFORMS,
  BEACONS,
  GLOWBITS,
  HAZARDS,
  HATCH_DURATION_MS,
  MOONWELLS,
  PLAYER_H,
  PLAYER_W,
  RUNE,
  SANCTUARY,
  SHORTCUT_PLATFORMS,
  WISP,
  createGameWorld,
  getContextAction,
  hazardRect,
  mergeGameRecord,
  platformRect,
  stepGame,
} from "../app/game-engine.ts";

const idle = { left: false, right: false, jump: false, interact: false };

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

test("hatch intro transitions into controllable play without adding run time", () => {
  const world = createGameWorld();
  for (let elapsed = 0; elapsed < HATCH_DURATION_MS - 40; elapsed += 40) stepGame(world, idle, 40);
  assert.equal(world.phase, "hatching");
  stepGame(world, idle, 40);
  assert.equal(world.phase, "playing");
  assert.equal(world.elapsedMs, 0);
});

test("context actions recruit, recharge, review, repair, and awaken", () => {
  const world = createGameWorld();
  finishHatch(world);

  place(world, WISP);
  assert.equal(getContextAction(world)?.kind, "wave");
  stepGame(world, { ...idle, interact: true }, 16);
  assert.equal(world.wispRecruited, true);
  assert.equal(world.shield, 1);
  assert.equal(world.gesture, "wave");
  for (let elapsed = 0; elapsed < 640; elapsed += 40) stepGame(world, idle, 40);

  world.shield = 0;
  interactFor(world, MOONWELLS[0], 1300);
  assert.equal(world.moonwellCharged, true);
  assert.equal(world.shield, 1);

  interactFor(world, RUNE, 960);
  assert.equal(world.reviewed, true);

  BEACONS.forEach((beacon, index) => {
    interactFor(world, beacon, 1560);
    assert.equal(world.repaired[index], true);
  });

  world.glowbits = new Set(GLOWBITS.map((_, index) => index));
  world.usedRiskyShortcut = true;
  interactFor(world, SANCTUARY, 40);
  assert.equal(world.phase, "won");
  assert.deepEqual(world.result?.badges.sort(), ["glowkeeper", "sky-runner", "steady-heart"]);
});

test("the Wisp shield absorbs one hazard before fail-soft recovery", () => {
  const world = createGameWorld();
  finishHatch(world);
  world.wispRecruited = true;
  world.shield = 1;
  const hazard = hazardRect(HAZARDS[0], world.elapsedMs);
  world.x = hazard.x;
  world.y = hazard.y;
  const shieldEvents = stepGame(world, idle, 16);
  assert.equal(world.shield, 0);
  assert.ok(shieldEvents.some((event) => event.type === "shield-broken"));

  world.invulnerableMs = 0;
  world.x = hazard.x;
  world.y = hazard.y;
  const failEvents = stepGame(world, idle, 16);
  assert.equal(world.phase, "failed");
  assert.equal(world.failures, 1);
  assert.ok(world.elapsedMs >= 5000);
  assert.ok(failEvents.some((event) => event.type === "failed"));
});

test("three failures reveal a route hint without changing the level", () => {
  const world = createGameWorld();
  finishHatch(world);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    world.phase = "playing";
    world.invulnerableMs = 0;
    world.shield = 0;
    const hazard = hazardRect(HAZARDS[0], world.elapsedMs);
    world.x = hazard.x;
    world.y = hazard.y;
    stepGame(world, idle, 16);
  }
  assert.equal(world.hintSegment, 1);
  assert.equal(world.segmentFailures[1], 3);
});

test("review exposes authored shortcut platforms and landing marks their use", () => {
  const world = createGameWorld();
  finishHatch(world);
  world.reviewed = true;
  const shortcut = SHORTCUT_PLATFORMS[0];
  world.x = shortcut.x + 20;
  world.y = shortcut.y - PLAYER_H - 2;
  world.vy = 100;
  world.grounded = false;
  stepGame(world, idle, 40);
  assert.equal(world.usedRiskyShortcut, true);
});

test("moving platforms carry a standing player instead of dropping them", () => {
  const world = createGameWorld();
  finishHatch(world);
  const platformIndex = BASE_PLATFORMS.findIndex((platform) => platform.moving === "y");
  const platform = BASE_PLATFORMS[platformIndex];
  const startRect = platformRect(platform, world.elapsedMs);
  world.x = startRect.x + 12;
  world.y = startRect.y - PLAYER_H;
  world.vx = 0;
  world.vy = 0;
  world.grounded = true;
  world.standingPlatform = platformIndex;

  stepGame(world, idle, 40);

  const movedRect = platformRect(platform, world.elapsedMs);
  assert.equal(world.grounded, true);
  assert.equal(world.standingPlatform, platformIndex);
  assert.ok(Math.abs(world.y + PLAYER_H - movedRect.y) < 0.001);
});

test("jumping detaches the player from a moving platform", () => {
  const world = createGameWorld();
  finishHatch(world);
  const platformIndex = BASE_PLATFORMS.findIndex((platform) => platform.moving === "y");
  const platform = BASE_PLATFORMS[platformIndex];
  const rect = platformRect(platform, world.elapsedMs);
  world.x = rect.x + 12;
  world.y = rect.y - PLAYER_H;
  world.grounded = true;
  world.standingPlatform = platformIndex;

  stepGame(world, { ...idle, jump: true }, 16);

  assert.equal(world.grounded, false);
  assert.equal(world.standingPlatform, null);
  assert.ok(world.vy < 0);
});

test("versioned records keep the fastest time and merge earned badges", () => {
  const first = mergeGameRecord(undefined, { elapsedMs: 100000, failures: 0, glowbits: 3, usedRiskyShortcut: false, badges: ["steady-heart"] });
  const second = mergeGameRecord(first, { elapsedMs: 120000, failures: 1, glowbits: 5, usedRiskyShortcut: true, badges: ["glowkeeper", "sky-runner"] });
  assert.equal(second.bestTimeMs, 100000);
  assert.equal(second.completions, 2);
  assert.deepEqual(second.badges.sort(), ["glowkeeper", "sky-runner", "steady-heart"]);
});
