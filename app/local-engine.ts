import { readFile, stat } from "node:fs/promises";

export type LocalProviderId = "comfyui" | "invoke";
export type WorkflowKind = "text" | "edit";
export type WorkflowObject = Record<string, unknown>;
export type LocalJobState = "queued" | "running" | "completed" | "failed";

export type Environment = Record<string, string | undefined>;

export type LocalProviderConfig = {
  id: LocalProviderId;
  endpoint: string;
  token?: string;
  textWorkflowPath?: string;
  editWorkflowPath?: string;
  outputNode?: string;
};

export type WorkflowVariables = {
  prompt: string;
  negativePrompt: string;
  seed: number;
  width: number;
  height: number;
  referenceImage?: string;
};

export type LocalJobStatus = {
  status: LocalJobState;
  detail?: string;
};

export type Fetcher = typeof fetch;

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_WORKFLOW_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const JOB_ID = /^[A-Za-z0-9_-]{1,200}$/;
const OUTPUT_NODE = /^[A-Za-z0-9_.:-]{1,160}$/;

export class LocalEngineError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "LocalEngineError";
    this.status = status;
  }
}

function envPrefix(provider: LocalProviderId) {
  return provider === "comfyui" ? "COMFYUI" : "INVOKEAI";
}

function normalizeEndpoint(raw: string) {
  let endpoint: URL;
  try {
    endpoint = new URL(raw.trim());
  } catch {
    throw new LocalEngineError("Local engine endpoint must be a valid URL.", 500);
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.hostname) {
    throw new LocalEngineError("Local engine endpoint must be an http:// or https:// URL.", 500);
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new LocalEngineError("Local engine endpoint must not include credentials, a query, or a fragment.", 500);
  }
  return endpoint.toString().replace(/\/$/, "");
}

export function getLocalProviderConfig(provider: LocalProviderId, env: Environment = process.env): LocalProviderConfig | null {
  const prefix = envPrefix(provider);
  const rawEndpoint = env[`${prefix}_ENDPOINT`]?.trim();
  if (!rawEndpoint) return null;
  return {
    id: provider,
    endpoint: normalizeEndpoint(rawEndpoint),
    token: env[`${prefix}_TOKEN`]?.trim() || undefined,
    textWorkflowPath: env[`${prefix}_TEXT_WORKFLOW`]?.trim() || undefined,
    editWorkflowPath: env[`${prefix}_EDIT_WORKFLOW`]?.trim() || undefined,
    outputNode: normalizeOutputNode(env[`${prefix}_OUTPUT_NODE`]),
  };
}

export function configuredLocalProviders(env: Environment = process.env) {
  return (["comfyui", "invoke"] as const).flatMap((id) => {
    const config = getLocalProviderConfig(id, env);
    if (!config) return [];
    return [{
      id,
      label: id === "comfyui" ? "ComfyUI" : "InvokeAI",
      serverWorkflows: Boolean(config.textWorkflowPath && config.editWorkflowPath),
      outputNodeConfigured: Boolean(config.outputNode),
    }];
  });
}

function endpointUrl(config: LocalProviderConfig, path: string) {
  return `${config.endpoint}/${path.replace(/^\/+/, "")}`;
}

function authHeaders(config: LocalProviderConfig, headers?: HeadersInit) {
  const output = new Headers(headers);
  output.set("user-agent", "Hatchframe-Web/0.2.0");
  if (config.token) output.set("authorization", `Bearer ${config.token}`);
  return output;
}

function normalizeOutputNode(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!OUTPUT_NODE.test(normalized)) throw new LocalEngineError("Output node contains unsupported characters.", 400);
  return normalized;
}

export function validateJobId(value: unknown) {
  if (typeof value !== "string" || !JOB_ID.test(value)) throw new LocalEngineError("A valid local engine job ID is required.", 400);
  return value;
}

export function validateOutputNode(value: unknown, fallback?: string) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") throw new LocalEngineError("Output node must be text.", 400);
  return normalizeOutputNode(value);
}

export async function readLimitedBody(stream: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new LocalEngineError(`Request exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB safety limit.`, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function responseBytes(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new LocalEngineError("Local engine response exceeds the safety limit.");
  return readLimitedBody(response.body, maxBytes);
}

async function engineFetch(config: LocalProviderConfig, path: string, init: RequestInit, fetcher: Fetcher) {
  try {
    return await fetcher(endpointUrl(config, path), {
      ...init,
      headers: authHeaders(config, init.headers),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "connection failed";
    throw new LocalEngineError(`Unable to reach ${config.id}: ${detail}`);
  }
}

async function engineJson(config: LocalProviderConfig, path: string, init: RequestInit, fetcher: Fetcher) {
  const response = await engineFetch(config, path, init, fetcher);
  const bytes = await responseBytes(response, response.ok ? MAX_JSON_BYTES : 64 * 1024);
  const text = new TextDecoder().decode(bytes);
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new LocalEngineError(`${config.id} returned invalid JSON.`);
  }
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    const detail = typeof record.detail === "string" ? record.detail : typeof record.error === "string" ? record.error : response.statusText;
    throw new LocalEngineError(`${config.id} request failed (${response.status}): ${detail || "unknown error"}`);
  }
  if (!isRecord(payload)) throw new LocalEngineError(`${config.id} returned an unexpected response shape.`);
  return payload;
}

function isRecord(value: unknown): value is WorkflowObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function containsPlaceholder(value: unknown, placeholder: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsPlaceholder(item, placeholder));
  if (isRecord(value)) return Object.values(value).some((item) => containsPlaceholder(item, placeholder));
  return typeof value === "string" && value.includes(placeholder);
}

export function replaceWorkflowValues(value: unknown, replacements: Record<string, string | number>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceWorkflowValues(item, replacements));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceWorkflowValues(item, replacements)]));
  if (typeof value !== "string") return value;
  if (Object.hasOwn(replacements, value)) return replacements[value];
  return Object.entries(replacements).reduce((rendered, [placeholder, replacement]) => rendered.replaceAll(placeholder, String(replacement)), value);
}

function validateWorkflow(workflow: unknown, kind: WorkflowKind) {
  if (!isRecord(workflow)) throw new LocalEngineError("Workflow must contain a JSON object.", 400);
  if (!containsPlaceholder(workflow, "{{PROMPT}}")) throw new LocalEngineError("Workflow must contain {{PROMPT}}.", 400);
  if (kind === "edit" && !containsPlaceholder(workflow, "{{REFERENCE_IMAGE}}") && !containsPlaceholder(workflow, "{{REFERENCE_IMAGE_NAME}}")) {
    throw new LocalEngineError("Edit workflow must contain {{REFERENCE_IMAGE}} or {{REFERENCE_IMAGE_NAME}}.", 400);
  }
  return workflow;
}

async function workflowFromFile(path: string, kind: WorkflowKind) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_WORKFLOW_BYTES) throw new LocalEngineError("Mounted workflow is missing or exceeds the 2 MB limit.", 500);
    return validateWorkflow(JSON.parse(await readFile(path, "utf8")) as unknown, kind);
  } catch (cause) {
    if (cause instanceof LocalEngineError) throw cause;
    throw new LocalEngineError(`Unable to load the mounted ${kind} workflow.`, 500);
  }
}

export async function prepareWorkflow(
  config: LocalProviderConfig,
  kind: WorkflowKind,
  override: unknown,
  variables: WorkflowVariables,
) {
  const path = kind === "text" ? config.textWorkflowPath : config.editWorkflowPath;
  const template = override == null ? (path ? await workflowFromFile(path, kind) : null) : validateWorkflow(override, kind);
  if (!template) throw new LocalEngineError(`No ${kind} workflow was uploaded or mounted for ${config.id}.`, 400);
  if (!variables.prompt.trim() || variables.prompt.length > 6000) throw new LocalEngineError("Workflow prompt is missing or too long.", 400);
  if (!Number.isSafeInteger(variables.seed) || !Number.isInteger(variables.width) || !Number.isInteger(variables.height)) {
    throw new LocalEngineError("Workflow dimensions and seed must be integers.", 400);
  }
  if (variables.width < 64 || variables.width > 4096 || variables.height < 64 || variables.height > 4096) {
    throw new LocalEngineError("Workflow dimensions must be between 64 and 4096 pixels.", 400);
  }
  if (kind === "edit" && !variables.referenceImage) throw new LocalEngineError("Edit workflow requires an uploaded reference image.", 400);
  return replaceWorkflowValues(template, {
    "{{PROMPT}}": variables.prompt,
    "{{NEGATIVE_PROMPT}}": variables.negativePrompt,
    "{{SEED}}": variables.seed,
    "{{WIDTH}}": variables.width,
    "{{HEIGHT}}": variables.height,
    "{{REFERENCE_IMAGE}}": variables.referenceImage || "",
    "{{REFERENCE_IMAGE_NAME}}": variables.referenceImage || "",
  }) as WorkflowObject;
}

function bytesAsBlob(bytes: Uint8Array, type: string) {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([data], { type });
}

export async function uploadReference(config: LocalProviderConfig, png: Uint8Array, fetcher: Fetcher = fetch) {
  assertPng(png);
  const form = new FormData();
  form.append(config.id === "comfyui" ? "image" : "file", bytesAsBlob(png, "image/png"), "hatchframe-anchor.png");
  const path = config.id === "comfyui" ? "/upload/image" : "/api/v1/images/upload";
  const result = await engineJson(config, path, { method: "POST", body: form }, fetcher);
  if (config.id === "comfyui") {
    if (typeof result.name !== "string" || !result.name) throw new LocalEngineError("ComfyUI upload returned no image name.");
    return typeof result.subfolder === "string" && result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
  }
  if (typeof result.image_name !== "string" || !result.image_name) throw new LocalEngineError("InvokeAI upload returned no image name.");
  return result.image_name;
}

export async function submitWorkflow(config: LocalProviderConfig, workflow: WorkflowObject, fetcher: Fetcher = fetch) {
  if (config.id === "comfyui") {
    const result = await engineJson(config, "/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID().replaceAll("-", "") }),
    }, fetcher);
    if (typeof result.prompt_id !== "string" || !result.prompt_id) throw new LocalEngineError("ComfyUI returned no prompt ID.");
    return result.prompt_id;
  }
  const result = await engineJson(config, "/api/v1/queue/default/enqueue_batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ batch: { graph: workflow, runs: 1 } }),
  }, fetcher);
  if (!Array.isArray(result.item_ids) || !result.item_ids.length) throw new LocalEngineError("InvokeAI returned no queue item ID.");
  return validateJobId(String(result.item_ids[0]));
}

function comfyRecord(history: WorkflowObject, jobId: string) {
  const record = history[jobId];
  return isRecord(record) ? record : null;
}

export async function getJobStatus(config: LocalProviderConfig, jobId: string, fetcher: Fetcher = fetch): Promise<LocalJobStatus> {
  const id = validateJobId(jobId);
  if (config.id === "comfyui") {
    const history = await engineJson(config, `/history/${encodeURIComponent(id)}`, { method: "GET" }, fetcher);
    const record = comfyRecord(history, id);
    if (!record) return { status: "queued", detail: "Queued in ComfyUI" };
    const status = isRecord(record.status) ? record.status : {};
    if (status.status_str === "error" || status.status_str === "failed") return { status: "failed", detail: "ComfyUI workflow failed." };
    if (isRecord(record.outputs) && Object.keys(record.outputs).length) return { status: "completed" };
    return { status: "running", detail: "ComfyUI is working…" };
  }
  const item = await engineJson(config, `/api/v1/queue/default/i/${encodeURIComponent(id)}`, { method: "GET" }, fetcher);
  const status = typeof item.status === "string" ? item.status.toLowerCase() : "pending";
  if (["failed", "canceled", "cancelled"].includes(status)) return { status: "failed", detail: `InvokeAI job ${status}.` };
  if (status === "completed") return { status: "completed" };
  return { status: status === "pending" || status === "queued" ? "queued" : "running", detail: status === "pending" || status === "queued" ? "Queued in InvokeAI" : "InvokeAI is working…" };
}

function findComfyImage(record: WorkflowObject, outputNode?: string) {
  if (!isRecord(record.outputs)) return null;
  const candidates = outputNode ? [record.outputs[outputNode]] : Object.values(record.outputs);
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !Array.isArray(candidate.images) || !candidate.images.length || !isRecord(candidate.images[0])) continue;
    const image = candidate.images[0];
    if (typeof image.filename === "string" && image.filename) return image;
  }
  return null;
}

function findInvokeImage(value: unknown, outputNode?: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInvokeImage(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (outputNode && Object.hasOwn(value, outputNode)) return findInvokeImage(value[outputNode]);
  if (typeof value.image_name === "string" && value.image_name) return value.image_name;
  for (const item of Object.values(value)) {
    const found = findInvokeImage(item);
    if (found) return found;
  }
  return null;
}

export async function downloadJobImage(config: LocalProviderConfig, jobId: string, outputNode?: string, fetcher: Fetcher = fetch) {
  const id = validateJobId(jobId);
  const selectedNode = validateOutputNode(outputNode, config.outputNode);
  let response: Response;
  if (config.id === "comfyui") {
    const history = await engineJson(config, `/history/${encodeURIComponent(id)}`, { method: "GET" }, fetcher);
    const record = comfyRecord(history, id);
    const image = record ? findComfyImage(record, selectedNode) : null;
    if (!image || typeof image.filename !== "string") throw new LocalEngineError("ComfyUI job has no selectable image output.", 409);
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: typeof image.subfolder === "string" ? image.subfolder : "",
      type: typeof image.type === "string" ? image.type : "output",
    });
    response = await engineFetch(config, `/view?${query}`, { method: "GET" }, fetcher);
  } else {
    const item = await engineJson(config, `/api/v1/queue/default/i/${encodeURIComponent(id)}`, { method: "GET" }, fetcher);
    const session = isRecord(item.session) ? item.session : {};
    const imageName = findInvokeImage(session.results, selectedNode);
    if (!imageName) throw new LocalEngineError("InvokeAI job has no selectable image output.", 409);
    response = await engineFetch(config, `/api/v1/images/i/${encodeURIComponent(imageName)}/full`, { method: "GET" }, fetcher);
  }
  if (!response.ok) throw new LocalEngineError(`${config.id} image download failed (${response.status}).`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType && !["image/png", "application/octet-stream"].includes(contentType)) throw new LocalEngineError(`${config.id} returned unsupported media type ${contentType}.`);
  const bytes = await responseBytes(response, MAX_IMAGE_BYTES);
  assertPng(bytes);
  return bytes;
}

export function assertPng(bytes: Uint8Array) {
  if (bytes.byteLength < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new LocalEngineError("Local engine response is not a PNG.", 415);
  }
}
