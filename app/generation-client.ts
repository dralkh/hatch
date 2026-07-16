export type ProviderId = "fal" | "comfyui" | "invoke";
export type LocalProviderId = Exclude<ProviderId, "fal">;
export type WorkflowObject = Record<string, unknown>;

export type ProviderSummary = {
  id: ProviderId;
  label: string;
  serverCredential?: boolean;
  serverWorkflows?: boolean;
  outputNodeConfigured?: boolean;
};

export type WorkflowOverrides = {
  text?: WorkflowObject;
  edit?: WorkflowObject;
  textName?: string;
  editName?: string;
  outputNode?: string;
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
    this.fetcher = fetcher;
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
    this.fetcher = fetcher;
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

export function selectPreferredProvider(providers: ProviderSummary[]): ProviderId {
  if (providers.some((provider) => provider.id === "comfyui")) return "comfyui";
  if (providers.some((provider) => provider.id === "invoke")) return "invoke";
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
    return (id === "fal" || id === "comfyui" || id === "invoke") && typeof label === "string";
  });
}
