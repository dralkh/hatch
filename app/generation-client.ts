export type CloudProviderId = "fal" | "openai" | "xai" | "openrouter" | "google";
export type HostedCloudProviderId = Exclude<CloudProviderId, "fal">;
export type LocalProviderId = "comfyui" | "invoke";
export type ProviderId = CloudProviderId | LocalProviderId;
export type WorkflowObject = Record<string, unknown>;

export type ProviderSummary = {
  id: ProviderId;
  label: string;
  serverCredential?: boolean;
  serverWorkflows?: boolean;
  outputNodeConfigured?: boolean;
  serverConfigured?: boolean;
  model?: string;
};

export type WorkflowOverrides = {
  text?: WorkflowObject;
  edit?: WorkflowObject;
  textName?: string;
  editName?: string;
  outputNode?: string;
};

export type DirectLocalSettings = WorkflowOverrides & {
  endpoint: string;
  token?: string;
};

export type GeneratedSource = {
  url: string;
  blob?: Blob;
};

export type GenerationRequest = {
  kind: "text" | "edit";
  prompt: string;
  width: number;
  height: number;
  seed: number;
  reference?: string;
  onUpdate: (detail: string) => void;
};

export interface BrowserGenerationBackend {
  readonly id: ProviderId;
  generate(request: GenerationRequest): Promise<GeneratedSource>;
  prepareReference(source: GeneratedSource): Promise<string>;
}

type FalResult = {
  images?: { url?: string }[];
  error?: string;
  detail?: string;
  request_id?: string;
  status_url?: string;
  response_url?: string;
  status?: string;
  queue_position?: number;
  logs?: { message?: string }[];
};

type LocalStatus = {
  status?: "queued" | "running" | "completed" | "failed";
  detail?: string;
  error?: string;
};

const NEGATIVE_PROMPT = "realistic, 3D, blurry, text, watermark, duplicate creature, extra limbs";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_CLOUD_PROVIDERS: ProviderSummary[] = [
  { id: "fal", label: "fal", model: "FLUX.2 [klein] 9B" },
  { id: "openai", label: "OpenAI", model: "gpt-image-2" },
  { id: "xai", label: "xAI", model: "grok-imagine-image-quality" },
  { id: "openrouter", label: "OpenRouter", model: "google/gemini-3.1-flash-image" },
  { id: "google", label: "Google", model: "gemini-3.1-flash-image" },
];

export const DEFAULT_PROVIDERS: ProviderSummary[] = [
  { id: "comfyui", label: "ComfyUI", serverConfigured: false },
  { id: "invoke", label: "InvokeAI", serverConfigured: false },
  ...DEFAULT_CLOUD_PROVIDERS,
];

export function isCloudProviderId(value: ProviderId): value is CloudProviderId {
  return value === "fal" || value === "openai" || value === "xai" || value === "openrouter" || value === "google";
}

export function isHostedCloudProviderId(value: ProviderId): value is HostedCloudProviderId {
  return value === "openai" || value === "xai" || value === "openrouter" || value === "google";
}

async function responseError(response: Response) {
  const data = await response.json().catch(() => ({ error: `Request failed (${response.status}).` })) as { error?: unknown; detail?: unknown };
  return typeof data.detail === "string" ? data.detail : typeof data.error === "string" ? data.error : `Request failed (${response.status}).`;
}

async function falCall(apiKey: string, payload: Record<string, unknown>, fetcher: typeof fetch) {
  const response = await fetcher("/api/fal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-fal-key": apiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<FalResult>;
}

async function runFalQueued(apiKey: string, model: string, input: Record<string, unknown>, onUpdate: (detail: string) => void, fetcher: typeof fetch) {
  const submitted = await falCall(apiKey, { action: "submit", model, input }, fetcher);
  const requestId = submitted.request_id;
  const statusUrl = submitted.status_url;
  const responseUrl = submitted.response_url;
  if (!requestId || !statusUrl || !responseUrl) throw new Error("fal did not return complete queue lifecycle URLs.");
  for (let poll = 0; poll < 360; poll += 1) {
    await sleep(1500);
    const status = await falCall(apiKey, { action: "status", model, requestId, url: statusUrl }, fetcher);
    if (status.status === "IN_QUEUE") {
      const position = typeof status.queue_position === "number" ? ` · ${status.queue_position} ahead` : "";
      onUpdate(`Queued${position}`);
      continue;
    }
    if (status.status === "IN_PROGRESS") {
      onUpdate(status.logs?.at(-1)?.message || "Model is working…");
      continue;
    }
    if (status.status === "COMPLETED") {
      if (status.error) throw new Error(status.error);
      return falCall(apiKey, { action: "result", model, requestId, url: responseUrl }, fetcher);
    }
    if (status.status === "FAILED" || status.status === "CANCELLED") throw new Error(status.error || `fal request ${status.status.toLowerCase()}.`);
  }
  throw new Error("The fal request did not finish within nine minutes.");
}

export class FalBrowserBackend implements BrowserGenerationBackend {
  readonly id = "fal" as const;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(apiKey: string, fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetcher = fetcher.bind(globalThis);
  }

  async generate(request: GenerationRequest) {
    const edit = request.kind === "edit";
    if (edit && !request.reference) throw new Error("fal edit request is missing its identity reference.");
    const model = edit ? "fal-ai/flux-2/klein/9b/edit" : "fal-ai/flux-2/klein/9b";
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      image_size: request.width === request.height
        ? (request.width === 1024 ? (edit ? "square" : "square_hd") : { width: request.width, height: request.height })
        : { width: request.width, height: request.height },
      num_inference_steps: 4,
      output_format: "png",
      num_images: 1,
      seed: request.seed,
      ...(edit ? { image_urls: [request.reference] } : {}),
    };
    const result = await runFalQueued(this.apiKey, model, input, request.onUpdate, this.fetcher);
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("fal returned no generated image.");
    return { url };
  }

  async prepareReference(source: GeneratedSource) {
    return source.url;
  }
}

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("The identity image could not be encoded."));
    reader.onerror = () => reject(reader.error || new Error("The identity image could not be encoded."));
    reader.readAsDataURL(blob);
  });
}

export class CloudBrowserBackend implements BrowserGenerationBackend {
  readonly id: HostedCloudProviderId;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(id: HostedCloudProviderId, apiKey: string, fetcher: typeof fetch = fetch) {
    this.id = id;
    this.apiKey = apiKey;
    this.fetcher = fetcher.bind(globalThis);
  }

  async generate(request: GenerationRequest) {
    request.onUpdate(`Sending to ${this.id === "xai" ? "xAI" : this.id === "openrouter" ? "OpenRouter" : this.id === "openai" ? "OpenAI" : "Google"}…`);
    const response = await this.fetcher(`/api/cloud?provider=${this.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { "x-provider-key": this.apiKey } : {}),
      },
      body: JSON.stringify({
        kind: request.kind,
        prompt: request.prompt,
        width: request.width,
        height: request.height,
        seed: request.seed,
        reference: request.reference,
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error(`${this.id} returned unsupported media type ${blob.type || "unknown"}.`);
    return { blob, url: URL.createObjectURL(blob) };
  }

  async prepareReference(source: GeneratedSource) {
    if (!source.blob) throw new Error(`${this.id} identity reference is missing its image data.`);
    return blobToDataUrl(source.blob);
  }
}

async function localCall(provider: LocalProviderId, action: string, body: BodyInit, contentType: string, fetcher: typeof fetch) {
  const response = await fetcher(`/api/local?provider=${provider}&action=${action}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
  return response;
}

export class LocalBrowserBackend implements BrowserGenerationBackend {
  readonly id: LocalProviderId;
  private readonly workflows: WorkflowOverrides;
  private readonly fetcher: typeof fetch;
  private readonly pollDelayMs: number;

  constructor(
    id: LocalProviderId,
    workflows: WorkflowOverrides,
    fetcher: typeof fetch = fetch,
    pollDelayMs = 1500,
  ) {
    this.id = id;
    this.workflows = workflows;
    this.fetcher = fetcher.bind(globalThis);
    this.pollDelayMs = pollDelayMs;
  }

  async generate(request: GenerationRequest) {
    const workflow = request.kind === "text" ? this.workflows.text : this.workflows.edit;
    const submitted = await localCall(this.id, "submit", JSON.stringify({
      kind: request.kind,
      workflow,
      variables: {
        prompt: request.prompt,
        negativePrompt: NEGATIVE_PROMPT,
        seed: request.seed,
        width: request.width,
        height: request.height,
        referenceImage: request.reference,
      },
    }), "application/json", this.fetcher);
    if (!submitted.ok) throw new Error(await responseError(submitted));
    const submission = await submitted.json() as { jobId?: unknown };
    if (typeof submission.jobId !== "string" || !submission.jobId) throw new Error(`${this.id} returned no job ID.`);

    for (let poll = 0; poll < 360; poll += 1) {
      await sleep(this.pollDelayMs);
      const statusResponse = await localCall(this.id, "status", JSON.stringify({
        jobId: submission.jobId,
        outputNode: this.workflows.outputNode,
      }), "application/json", this.fetcher);
      if (!statusResponse.ok) throw new Error(await responseError(statusResponse));
      const status = await statusResponse.json() as LocalStatus;
      if (status.status === "failed") throw new Error(status.detail || `${this.id} workflow failed.`);
      if (status.status === "completed") break;
      if (status.status !== "queued" && status.status !== "running") throw new Error(`${this.id} returned an unknown job state.`);
      request.onUpdate(status.detail || (status.status === "queued" ? "Queued" : "Local engine is working…"));
      if (poll === 359) throw new Error(`${this.id} request did not finish within nine minutes.`);
    }

    const result = await localCall(this.id, "result", JSON.stringify({
      jobId: submission.jobId,
      outputNode: this.workflows.outputNode,
    }), "application/json", this.fetcher);
    if (!result.ok) throw new Error(await responseError(result));
    const blob = await result.blob();
    if (blob.type && blob.type !== "image/png") throw new Error(`${this.id} returned unsupported media type ${blob.type}.`);
    return { blob, url: URL.createObjectURL(blob) };
  }

  async prepareReference(source: GeneratedSource) {
    if (!source.blob) throw new Error(`${this.id} identity reference is missing its PNG data.`);
    const response = await localCall(this.id, "upload", source.blob, "image/png", this.fetcher);
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.json() as { reference?: unknown };
    if (typeof result.reference !== "string" || !result.reference) throw new Error(`${this.id} upload returned no reference handle.`);
    return result.reference;
  }
}

function isRecord(value: unknown): value is WorkflowObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function replaceWorkflowValues(value: unknown, replacements: Record<string, string | number>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceWorkflowValues(item, replacements));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceWorkflowValues(item, replacements)]));
  if (typeof value !== "string") return value;
  if (Object.hasOwn(replacements, value)) return replacements[value];
  return Object.entries(replacements).reduce((rendered, [placeholder, replacement]) => rendered.replaceAll(placeholder, String(replacement)), value);
}

export function normalizeDirectEndpoint(raw: string) {
  let endpoint: URL;
  try {
    endpoint = new URL(raw.trim());
  } catch {
    throw new Error("Enter a valid ComfyUI or InvokeAI endpoint URL.");
  }
  if (!["http:", "https:"].includes(endpoint.protocol) || !endpoint.hostname) throw new Error("The direct engine endpoint must use http:// or https://.");
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("The direct engine endpoint cannot contain credentials, a query, or a fragment.");
  return endpoint.toString().replace(/\/$/, "");
}

function directWorkflow(kind: GenerationRequest["kind"], workflow: WorkflowObject | undefined, request: GenerationRequest) {
  if (!workflow) throw new Error(`Upload the ${kind === "text" ? "text" : "reference-edit"} workflow JSON.`);
  const serialized = JSON.stringify(workflow);
  if (!serialized.includes("{{PROMPT}}")) throw new Error("Workflow must contain {{PROMPT}}.");
  if (kind === "edit" && !serialized.includes("{{REFERENCE_IMAGE}}") && !serialized.includes("{{REFERENCE_IMAGE_NAME}}")) {
    throw new Error("Edit workflow must contain {{REFERENCE_IMAGE}} or {{REFERENCE_IMAGE_NAME}}.");
  }
  if (kind === "edit" && !request.reference) throw new Error("Edit workflow is missing its uploaded identity reference.");
  return replaceWorkflowValues(workflow, {
    "{{PROMPT}}": request.prompt,
    "{{NEGATIVE_PROMPT}}": NEGATIVE_PROMPT,
    "{{SEED}}": request.seed,
    "{{WIDTH}}": request.width,
    "{{HEIGHT}}": request.height,
    "{{REFERENCE_IMAGE}}": request.reference || "",
    "{{REFERENCE_IMAGE_NAME}}": request.reference || "",
  }) as WorkflowObject;
}

function directImageName(value: unknown, outputNode?: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = directImageName(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (outputNode && Object.hasOwn(value, outputNode)) return directImageName(value[outputNode]);
  if (typeof value.image_name === "string" && value.image_name) return value.image_name;
  for (const item of Object.values(value)) {
    const found = directImageName(item);
    if (found) return found;
  }
  return null;
}

export class DirectLocalBrowserBackend implements BrowserGenerationBackend {
  readonly id: LocalProviderId;
  private readonly settings: DirectLocalSettings;
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly pollDelayMs: number;

  constructor(id: LocalProviderId, settings: DirectLocalSettings, fetcher: typeof fetch = fetch, pollDelayMs = 1500) {
    this.id = id;
    this.settings = settings;
    this.endpoint = normalizeDirectEndpoint(settings.endpoint);
    this.fetcher = fetcher.bind(globalThis);
    this.pollDelayMs = pollDelayMs;
  }

  private async call(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.settings.token) headers.set("authorization", `Bearer ${this.settings.token}`);
    try {
      return await this.fetcher(`${this.endpoint}/${path.replace(/^\/+/, "")}`, {
        ...init,
        headers,
        mode: "cors",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
        targetAddressSpace: "local",
      } as RequestInit);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "network request failed";
      throw new Error(`The browser could not reach ${this.id === "comfyui" ? "ComfyUI" : "InvokeAI"}. Check the endpoint, CORS origin, and local-network permission. ${detail}`);
    }
  }

  private async json(path: string, init: RequestInit = {}) {
    const response = await this.call(path, init);
    if (!response.ok) throw new Error(`${this.id} request failed (${response.status}): ${await response.text().then((text) => text.slice(0, 500)).catch(() => response.statusText)}`);
    const value = await response.json() as unknown;
    if (!isRecord(value)) throw new Error(`${this.id} returned an invalid JSON response.`);
    return value;
  }

  private async png(path: string) {
    const response = await this.call(path, { method: "GET" });
    if (!response.ok) throw new Error(`${this.id} image download failed (${response.status}).`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 25 * 1024 * 1024) throw new Error(`${this.id} image exceeds the 25 MB limit.`);
    const blob = await response.blob();
    if (blob.size > 25 * 1024 * 1024) throw new Error(`${this.id} image exceeds the 25 MB limit.`);
    const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (signature.length !== 8 || pngSignature.some((byte, index) => signature[index] !== byte)) throw new Error(`${this.id} returned an asset that is not a PNG.`);
    return new Blob([await blob.arrayBuffer()], { type: "image/png" });
  }

  async generate(request: GenerationRequest) {
    const workflow = directWorkflow(request.kind, request.kind === "text" ? this.settings.text : this.settings.edit, request);
    let jobId: string;
    if (this.id === "comfyui") {
      const submitted = await this.json("/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID().replaceAll("-", "") }),
      });
      if (typeof submitted.prompt_id !== "string" || !submitted.prompt_id) throw new Error("ComfyUI returned no prompt ID.");
      jobId = submitted.prompt_id;
    } else {
      const submitted = await this.json("/api/v1/queue/default/enqueue_batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch: { graph: workflow, runs: 1 } }),
      });
      if (!Array.isArray(submitted.item_ids) || !submitted.item_ids.length) throw new Error("InvokeAI returned no queue item ID.");
      jobId = String(submitted.item_ids[0]);
    }

    for (let poll = 0; poll < 360; poll += 1) {
      await sleep(this.pollDelayMs);
      if (this.id === "comfyui") {
        const history = await this.json(`/history/${encodeURIComponent(jobId)}`, { method: "GET" });
        const rawRecord: unknown = history[jobId];
        const record: WorkflowObject | null = isRecord(rawRecord) ? rawRecord : null;
        if (!record) {
          request.onUpdate("Queued in ComfyUI");
          continue;
        }
        const status = isRecord(record.status) ? record.status : {};
        if (status.status_str === "error" || status.status_str === "failed") throw new Error("ComfyUI workflow failed.");
        const outputs = record.outputs;
        if (!isRecord(outputs) || !Object.keys(outputs).length) {
          request.onUpdate("ComfyUI is working…");
          continue;
        }
        const candidates = this.settings.outputNode ? [outputs[this.settings.outputNode]] : Object.values(outputs);
        const image = candidates.map((candidate) => isRecord(candidate) && Array.isArray(candidate.images) && isRecord(candidate.images[0]) ? candidate.images[0] : null).find((candidate): candidate is WorkflowObject => Boolean(candidate));
        if (!image || typeof image.filename !== "string") throw new Error("ComfyUI job has no selectable image output.");
        const query = new URLSearchParams({ filename: image.filename, subfolder: typeof image.subfolder === "string" ? image.subfolder : "", type: typeof image.type === "string" ? image.type : "output" });
        const blob = await this.png(`/view?${query}`);
        return { blob, url: URL.createObjectURL(blob) };
      }
      const item = await this.json(`/api/v1/queue/default/i/${encodeURIComponent(jobId)}`, { method: "GET" });
      const status = typeof item.status === "string" ? item.status.toLowerCase() : "pending";
      if (["failed", "canceled", "cancelled"].includes(status)) throw new Error(`InvokeAI job ${status}.`);
      if (status !== "completed") {
        request.onUpdate(status === "pending" || status === "queued" ? "Queued in InvokeAI" : "InvokeAI is working…");
        continue;
      }
      const session = isRecord(item.session) ? item.session : {};
      const imageName = directImageName(session.results, this.settings.outputNode);
      if (!imageName) throw new Error("InvokeAI job has no selectable image output.");
      const blob = await this.png(`/api/v1/images/i/${encodeURIComponent(imageName)}/full`);
      return { blob, url: URL.createObjectURL(blob) };
    }
    throw new Error(`${this.id} request did not finish within nine minutes.`);
  }

  async prepareReference(source: GeneratedSource) {
    if (!source.blob) throw new Error(`${this.id} identity reference is missing its PNG data.`);
    const form = new FormData();
    form.append(this.id === "comfyui" ? "image" : "file", source.blob, "hatchframe-anchor.png");
    const result = await this.json(this.id === "comfyui" ? "/upload/image" : "/api/v1/images/upload", { method: "POST", body: form });
    if (this.id === "comfyui") {
      if (typeof result.name !== "string" || !result.name) throw new Error("ComfyUI upload returned no image name.");
      return typeof result.subfolder === "string" && result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
    }
    if (typeof result.image_name !== "string" || !result.image_name) throw new Error("InvokeAI upload returned no image name.");
    return result.image_name;
  }
}

export function selectPreferredProvider(providers: ProviderSummary[]): ProviderId {
  if (providers.some((provider) => provider.id === "comfyui" && provider.serverConfigured)) return "comfyui";
  if (providers.some((provider) => provider.id === "invoke" && provider.serverConfigured)) return "invoke";
  for (const id of ["openai", "google", "xai", "openrouter", "fal"] as const) {
    if (providers.some((provider) => provider.id === id && provider.serverCredential)) return id;
  }
  return "fal";
}

export async function discoverProviders(fetcher: typeof fetch = fetch): Promise<ProviderSummary[]> {
  const response = await fetcher("/api/providers", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(await responseError(response));
  const data = await response.json() as { providers?: unknown };
  if (!Array.isArray(data.providers)) throw new Error("Provider discovery returned an invalid response.");
  return data.providers.filter((provider): provider is ProviderSummary => {
    if (!provider || typeof provider !== "object") return false;
    const id = (provider as { id?: unknown }).id;
    const label = (provider as { label?: unknown }).label;
    return (id === "fal" || id === "openai" || id === "xai" || id === "openrouter" || id === "google" || id === "comfyui" || id === "invoke") && typeof label === "string";
  });
}
