import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const workerPath = new URL("../dist/server/index.js", import.meta.url);
const configPath = new URL("../dist/server/wrangler.json", import.meta.url);
const clientPath = new URL("../dist/client", import.meta.url);
const legacyMetadataPath = new URL("../dist/.openai", import.meta.url);

await Promise.all([access(workerPath), access(configPath), access(clientPath)]);
try {
  await access(legacyMetadataPath);
  throw new Error("Legacy dist/.openai metadata must not be packaged.");
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}
const config = JSON.parse(await readFile(configPath, "utf8"));
assert.equal(config.main, "index.js");

const workerUrl = pathToFileURL(workerPath.pathname);
workerUrl.searchParams.set("artifact-validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerUrl.href);
assert.equal(typeof worker.default?.fetch, "function");

console.log("Validated Cloudflare artifact: Worker, client assets, and generated Wrangler config are present.");
