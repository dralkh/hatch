import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const ctx = { waitUntil() {}, passThroughOnException() {} };

test("fal route requires credentials", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/fal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "submit", model: "fal-ai/flux-2/klein/9b", input: { prompt: "test" } }),
  }), env, ctx);
  assert.equal(response.status, 401);
  assert.match(await response.text(), /API-scoped fal key/i);
});

test("fal route rejects models outside the allowlist", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/fal", {
    method: "POST",
    headers: { "content-type": "application/json", "x-fal-key": "fake-key" },
    body: JSON.stringify({ action: "submit", model: "untrusted/model", input: { prompt: "test" } }),
  }), env, ctx);
  assert.equal(response.status, 403);
  assert.match(await response.text(), /not enabled/i);
});

test("fal route rejects forged queue lifecycle URLs before fetching", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/fal", {
    method: "POST",
    headers: { "content-type": "application/json", "x-fal-key": "fake-key" },
    body: JSON.stringify({
      action: "status",
      model: "fal-ai/flux-2/klein/9b/edit",
      requestId: "request_12345678",
      url: "https://example.com/requests/request_12345678/status",
    }),
  }), env, ctx);
  assert.equal(response.status, 502);
  assert.match(await response.text(), /Invalid queue lifecycle URL/i);
});

test("asset route blocks arbitrary remote hosts", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/asset?url=https%3A%2F%2Fexample.com%2Fimage.png"), env, ctx);
  assert.equal(response.status, 403);
  assert.match(await response.text(), /not allowed/i);
});

test("asset route rejects malformed media byte ranges before fetching", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/asset?url=https%3A%2F%2Fv3b.fal.media%2Fvideo.mp4", {
    headers: { range: "bytes=not-a-range" },
  }), env, ctx);
  assert.equal(response.status, 416);
  assert.match(await response.text(), /Invalid byte range/i);
});

test("provider discovery exposes fal and no unconfigured local endpoints", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/providers"), env, ctx);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).providers.map((provider) => provider.id), ["fal"]);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("local route rejects cross-origin requests before provider access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/local?provider=comfyui&action=status", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ jobId: "job_1" }),
  }), env, ctx);
  assert.equal(response.status, 403);
  assert.match(await response.text(), /cross-origin/i);
});

test("local route does not expose an unconfigured engine", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/local?provider=comfyui&action=status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId: "job_1" }),
  }), env, ctx);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /not configured/i);
});
