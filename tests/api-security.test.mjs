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

test("provider discovery exposes direct local and cloud options without endpoint details", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/providers"), env, ctx);
  assert.equal(response.status, 200);
  const providers = (await response.json()).providers;
  assert.deepEqual(providers.map((provider) => provider.id), ["comfyui", "invoke", "fal", "openai", "xai", "openrouter", "google"]);
  assert.equal(providers[0].serverConfigured, false);
  assert.equal(providers[1].serverConfigured, false);
  assert.ok(providers.every((provider) => !("endpoint" in provider) && !("token" in provider)));
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("cloud route requires the selected provider credential", async () => {
  const worker = await loadWorker();
  for (const provider of ["openai", "xai", "openrouter", "google"]) {
    const response = await worker.fetch(new Request(`http://localhost/api/cloud?provider=${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "text", prompt: "test", width: 1024, height: 1024, seed: 1 }),
    }), env, ctx);
    assert.equal(response.status, 401, provider);
    assert.match(await response.text(), /API_KEY/i, provider);
  }
});

test("cloud route rejects cross-origin browser requests before provider access", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/cloud?provider=openai", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example", "x-provider-key": "fake-key" },
    body: JSON.stringify({ kind: "text", prompt: "test", width: 1024, height: 1024, seed: 1 }),
  }), env, ctx);
  assert.equal(response.status, 403);
  assert.match(await response.text(), /cross-origin/i);
});

test("cloud route rejects oversized request bodies before parsing", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/cloud?provider=openai", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(19 * 1024 * 1024), "x-provider-key": "fake-key" },
    body: "{}",
  }), env, ctx);
  assert.equal(response.status, 413);
  assert.match(await response.text(), /too large/i);
});

test("cloud route validates edit references before calling a provider", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/cloud?provider=xai", {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-key": "fake-key" },
    body: JSON.stringify({ kind: "edit", prompt: "test", width: 1024, height: 512, seed: 1, reference: "https://example.com/image.png" }),
  }), env, ctx);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /data URL/i);
});

test("cloud route maps each provider contract and normalizes image bytes", async () => {
  const worker = await loadWorker();
  const nativeFetch = globalThis.fetch;
  const cases = [
    { provider: "openai", endpoint: "https://api.openai.com/v1/images/generations", model: "gpt-image-2", payload: { data: [{ b64_json: "iVBORw0KGgo=" }] }, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], type: "image/png" },
    { provider: "xai", endpoint: "https://api.x.ai/v1/images/generations", model: "grok-imagine-image-quality", payload: { data: [{ b64_json: "/9j/" }] }, bytes: [0xff, 0xd8, 0xff], type: "image/jpeg" },
    { provider: "openrouter", endpoint: "https://openrouter.ai/api/v1/images", model: "google/gemini-3.1-flash-image", payload: { data: [{ b64_json: "iVBORw0KGgo=" }] }, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], type: "image/png" },
    { provider: "google", endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions", model: "gemini-3.1-flash-image", payload: { steps: [{ type: "model_output", content: [{ type: "image", data: "iVBORw0KGgo=", mime_type: "image/png" }] }] }, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], type: "image/png" },
  ];
  try {
    for (const entry of cases) {
      let captured;
      globalThis.fetch = async (input, init) => {
        captured = { url: String(input), init };
        return new Response(JSON.stringify(entry.payload), { headers: { "content-type": "application/json" } });
      };
      const response = await worker.fetch(new Request(`http://localhost/api/cloud?provider=${entry.provider}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-provider-key": "fake-key" },
        body: JSON.stringify({ kind: "text", prompt: "test", width: 1024, height: 1024, seed: 7 }),
      }), env, ctx);
      assert.equal(response.status, 200, entry.provider);
      assert.equal(response.headers.get("content-type"), entry.type, entry.provider);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(entry.bytes), entry.provider);
      assert.equal(captured.url, entry.endpoint, entry.provider);
      const providerBody = JSON.parse(captured.init.body);
      assert.equal(providerBody.model, entry.model, entry.provider);
    }
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("OpenAI gpt-image-2 edit omits unsupported input_fidelity", async () => {
  const worker = await loadWorker();
  const nativeFetch = globalThis.fetch;
  let captured;
  try {
    globalThis.fetch = async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }), {
        headers: { "content-type": "application/json" },
      });
    };
    const response = await worker.fetch(new Request("http://localhost/api/cloud?provider=openai", {
      method: "POST",
      headers: { "content-type": "application/json", "x-provider-key": "fake-key" },
      body: JSON.stringify({
        kind: "edit",
        prompt: "test",
        width: 1024,
        height: 1024,
        seed: 7,
        reference: "data:image/png;base64,iVBORw0KGgo=",
      }),
    }), env, ctx);
    assert.equal(response.status, 200);
    assert.equal(captured.url, "https://api.openai.com/v1/images/edits");
    assert.ok(captured.init.body instanceof FormData);
    assert.equal(captured.init.body.get("model"), "gpt-image-2");
    assert.equal(captured.init.body.get("input_fidelity"), null);
    assert.ok(captured.init.body.get("image[]") instanceof Blob);
  } finally {
    globalThis.fetch = nativeFetch;
  }
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
