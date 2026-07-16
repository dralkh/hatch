import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalEngineError,
  assertPng,
  configuredLocalProviders,
  downloadJobImage,
  getJobStatus,
  getLocalProviderConfig,
  prepareWorkflow,
  replaceWorkflowValues,
  submitWorkflow,
  uploadReference,
} from "../app/local-engine.ts";
import { LocalBrowserBackend, discoverProviders, selectPreferredProvider } from "../app/generation-client.ts";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const comfyConfig = { id: "comfyui", endpoint: "http://127.0.0.1:8188" };
const invokeConfig = { id: "invoke", endpoint: "http://127.0.0.1:9090" };
const textWorkflow = { "1": { inputs: { prompt: "{{PROMPT}}", seed: "{{SEED}}", size: "{{WIDTH}}x{{HEIGHT}}" } } };
const editWorkflow = { "1": { inputs: { prompt: "{{PROMPT}}", reference: "{{REFERENCE_IMAGE}}" } } };
const variables = { prompt: "a mint pet", negativePrompt: "blur", seed: 42, width: 1024, height: 512 };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("provider config exposes only configured capability flags", () => {
  const env = {
    COMFYUI_ENDPOINT: "http://127.0.0.1:8188/",
    COMFYUI_TOKEN: "secret",
    COMFYUI_TEXT_WORKFLOW: "/config/text.json",
    COMFYUI_EDIT_WORKFLOW: "/config/edit.json",
  };
  const config = getLocalProviderConfig("comfyui", env);
  assert.equal(config.endpoint, "http://127.0.0.1:8188");
  assert.equal(config.token, "secret");
  assert.deepEqual(configuredLocalProviders(env), [{ id: "comfyui", label: "ComfyUI", serverWorkflows: true, outputNodeConfigured: false }]);
  assert.throws(() => getLocalProviderConfig("invoke", { INVOKEAI_ENDPOINT: "file:///tmp/image" }), LocalEngineError);
});

test("workflow replacement preserves exact numeric placeholder types", async () => {
  assert.deepEqual(replaceWorkflowValues({ seed: "{{SEED}}", label: "seed={{SEED}}" }, { "{{SEED}}": 17 }), { seed: 17, label: "seed=17" });
  const prepared = await prepareWorkflow(comfyConfig, "edit", editWorkflow, { ...variables, referenceImage: "inputs/anchor.png" });
  assert.equal(prepared["1"].inputs.prompt, "a mint pet");
  assert.equal(prepared["1"].inputs.reference, "inputs/anchor.png");
  await assert.rejects(() => prepareWorkflow(comfyConfig, "edit", editWorkflow, variables), /requires an uploaded reference/i);
});

test("ComfyUI adapter uploads, queues, polls, and downloads a bounded PNG", async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/upload/image")) return json({ name: "anchor.png", subfolder: "hatch" });
    if (String(url).endsWith("/prompt")) return json({ prompt_id: "prompt_1" });
    if (String(url).endsWith("/history/prompt_1")) return json({ prompt_1: { status: { status_str: "success" }, outputs: { "9": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } } } });
    if (String(url).includes("/view?")) return new Response(png, { headers: { "content-type": "image/png" } });
    return json({ error: "unexpected" }, 404);
  };
  assert.equal(await uploadReference(comfyConfig, png, fetcher), "hatch/anchor.png");
  assert.equal(await submitWorkflow(comfyConfig, textWorkflow, fetcher), "prompt_1");
  assert.deepEqual(await getJobStatus(comfyConfig, "prompt_1", fetcher), { status: "completed" });
  assert.deepEqual(await downloadJobImage(comfyConfig, "prompt_1", "9", fetcher), png);
  assert.match(calls.at(-1).url, /filename=out\.png/);
});

test("InvokeAI adapter uploads, queues, polls, and downloads a PNG", async () => {
  const fetcher = async (url) => {
    const target = String(url);
    if (target.endsWith("/api/v1/images/upload")) return json({ image_name: "anchor.png" }, 201);
    if (target.endsWith("/api/v1/queue/default/enqueue_batch")) return json({ item_ids: [12] }, 201);
    if (target.endsWith("/api/v1/queue/default/i/12")) return json({ status: "completed", session: { results: { save: { image: { image_name: "result.png" } } } } });
    if (target.endsWith("/api/v1/images/i/result.png/full")) return new Response(png, { headers: { "content-type": "application/octet-stream" } });
    return json({ error: "unexpected" }, 404);
  };
  assert.equal(await uploadReference(invokeConfig, png, fetcher), "anchor.png");
  assert.equal(await submitWorkflow(invokeConfig, textWorkflow, fetcher), "12");
  assert.deepEqual(await getJobStatus(invokeConfig, "12", fetcher), { status: "completed" });
  assert.deepEqual(await downloadJobImage(invokeConfig, "12", undefined, fetcher), png);
});

test("browser local backend normalizes the route lifecycle", async () => {
  const actions = [];
  const fetcher = async (url) => {
    const action = new URL(String(url), "http://localhost").searchParams.get("action");
    actions.push(action);
    if (action === "submit") return json({ jobId: "job_1" }, 202);
    if (action === "status") return json({ status: "completed" });
    if (action === "result") return new Response(png, { headers: { "content-type": "image/png" } });
    if (action === "upload") return json({ reference: "anchor.png" });
    return json({}, 404);
  };
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = () => "blob:test";
  try {
    const backend = new LocalBrowserBackend("comfyui", { text: textWorkflow, edit: editWorkflow }, fetcher, 0);
    const generated = await backend.generate({ kind: "text", prompt: "pet", width: 1024, height: 1024, seed: 1, onUpdate() {} });
    assert.equal(generated.url, "blob:test");
    assert.equal(await backend.prepareReference(generated), "anchor.png");
    assert.deepEqual(actions, ["submit", "status", "result", "upload"]);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
  }
});

test("provider discovery prefers local engines and rejects non-PNG output", async () => {
  const providers = await discoverProviders(async () => json({ providers: [{ id: "invoke", label: "InvokeAI" }, { id: "fal", label: "fal" }] }));
  assert.equal(selectPreferredProvider(providers), "invoke");
  assert.throws(() => assertPng(new TextEncoder().encode("not an image")), /not a PNG/i);
});
