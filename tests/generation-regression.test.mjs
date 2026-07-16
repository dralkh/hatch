import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/sprite-lab.tsx", import.meta.url), "utf8");
const gameSource = await readFile(new URL("../app/pet-game.tsx", import.meta.url), "utf8");
const engineSource = await readFile(new URL("../app/game-engine.ts", import.meta.url), "utf8");

test("passes the cleaned hatch blob URL directly into local composition", () => {
  assert.doesNotMatch(source, /composeHatch\(hatch\.url/);
  assert.match(source, /buildHatchSources\([^)]*\): Promise<string>/);
  assert.match(source, /composeHatch\(cache\.hatchUrl, idleFrame\)/);
});

test("validates image sources before checking their URL scheme", () => {
  assert.match(source, /const source = requireImageSource\(url\)/);
  assert.match(source, /source\.startsWith\("blob:"\)/);
});

test("preserves completed model frames for a free local packing retry", () => {
  assert.match(source, /Generated model frames are preserved in this tab/);
  assert.match(source, /Retry local packing · \$0/);
});

test("persists finished pets locally without persisting credentials", () => {
  assert.match(source, /indexedDB\.open\(HISTORY_DB/);
  assert.match(source, /savePetLocally\(saved\)/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*apiKey/);
  const savedPetType = source.match(/type SavedPet = \{([\s\S]*?)\n\};/)?.[1] || "";
  assert.doesNotMatch(savedPetType, /endpoint|token/i);
});

test("offers configured local providers without exposing their endpoints", () => {
  assert.match(source, /discoverProviders\(\)/);
  assert.match(source, /selectPreferredProvider\(available\)/);
  assert.match(source, /new LocalBrowserBackend\(provider, workflows\)/);
  assert.match(source, /Workflow JSON stays in this tab/);
});

test("renders every action as an animated preview and exposes the playable game", () => {
  assert.match(source, /function ActionGallery/);
  assert.match(source, /actions\.map\(\(action\)/);
  assert.match(gameSource, /function PetGame/);
  assert.match(gameSource, /Beacon Rescue/);
  for (const state of ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "working", "review"]) {
    assert.match(gameSource, new RegExp(`\\b${state}\\b`));
  }
});

test("imports bounded Hatchframe packages and keeps them in local history", () => {
  assert.match(source, /unzipSync/);
  assert.match(source, /async function importPetPackage/);
  assert.match(source, /sprite-pet\/v1/);
  assert.match(source, /MAX_ZIP_BYTES/);
  assert.match(source, /setSavedPets\(await savePetLocally\(imported\)\)/);
});

test("records versioned Beacon Rescue results and merges mastery badges", () => {
  assert.match(engineSource, /GAME_LEVEL_VERSION = 2/);
  assert.match(engineSource, /type GameRecord/);
  assert.match(source, /mergeGameRecord\(playablePet\.gameRecord, result\)/);
  assert.match(engineSource, /Math\.min\(prior\.bestTimeMs, result\.elapsedMs\)/);
  assert.match(gameSource, /onCompleteRef\.current\(pet\.id, world\.result\)/);
});
