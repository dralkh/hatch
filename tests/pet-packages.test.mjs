import assert from "node:assert/strict";
import test from "node:test";

import { unzipSync } from "fflate";

import { buildHatchPackage, buildHermesPackage, genericManifest, packageSlug } from "../app/pet-packages.ts";

const decoder = new TextDecoder();

function fixturePet() {
  return {
    description: "Mint Moon Fox",
    createdAt: "2026-07-16T00:00:00.000Z",
    artStyle: "pixel",
    provider: "openai",
    petBlob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
    hatchBlob: new Blob([new Uint8Array([5, 6, 7])], { type: "image/png" }),
  };
}

async function unzip(blob) {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

test("builds the existing full Hatch package contract", async () => {
  const output = await buildHatchPackage(fixturePet());
  const files = await unzip(output.blob);

  assert.equal(output.filename, "mint-moon-fox-sprite-pet.zip");
  assert.deepEqual(Object.keys(files).sort(), [
    "README.md",
    "hatch.png",
    "index.html",
    "manifest.json",
    "pet.json",
    "sprite-pet.js",
    "spritesheet.png",
  ]);
  const metadata = JSON.parse(decoder.decode(files["pet.json"]));
  assert.equal(metadata.spritesheetPath, "spritesheet.png");
  assert.equal(metadata.createdBy, "Hatch");
  assert.equal(metadata.provider, "openai");
});

test("builds a minimal Hermes Agent import package", async () => {
  const output = await buildHermesPackage(fixturePet());
  const files = await unzip(output.blob);

  assert.equal(output.filename, "mint-moon-fox-hermes-pet.zip");
  assert.deepEqual(Object.keys(files).sort(), ["pet.json", "spritesheet.png"]);
  assert.deepEqual([...files["spritesheet.png"]], [1, 2, 3, 4]);
  assert.deepEqual(JSON.parse(decoder.decode(files["pet.json"])), {
    id: "mint-moon-fox",
    displayName: "Mint Moon Fox",
    description: "Mint Moon Fox",
    spritesheetPath: "spritesheet.png",
  });
});

test("keeps the shared current Hermes atlas geometry and safe filenames", () => {
  const manifest = genericManifest("pet");
  assert.deepEqual(manifest.assets.pet.grid, {
    columns: 8,
    rows: 9,
    cellWidth: 192,
    cellHeight: 208,
  });
  assert.equal(manifest.assets.pet.width, 1536);
  assert.equal(manifest.assets.pet.height, 1872);
  assert.equal(packageSlug("  Strange / Pet!?  "), "strange-pet");
});
