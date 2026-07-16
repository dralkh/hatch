import { NextResponse } from "next/server";
import {
  LocalEngineError,
  MAX_IMAGE_BYTES,
  downloadJobImage,
  getJobStatus,
  getLocalProviderConfig,
  prepareWorkflow,
  readLimitedBody,
  submitWorkflow,
  uploadReference,
  validateJobId,
  validateOutputNode,
  type LocalProviderId,
  type WorkflowKind,
  type WorkflowVariables,
} from "../../local-engine";

export const dynamic = "force-dynamic";

const MAX_JSON_BYTES = 2 * 1024 * 1024 + 64 * 1024;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerId(value: string | null): LocalProviderId {
  if (value !== "comfyui" && value !== "invoke") throw new LocalEngineError("Unknown local provider.", 400);
  return value;
}

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new LocalEngineError("Cross-origin local engine requests are not allowed.", 403);
}

async function jsonBody(request: Request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new LocalEngineError("Workflow request exceeds the 2 MB safety limit.", 413);
  const bytes = await readLimitedBody(request.body, MAX_JSON_BYTES);
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!isRecord(value)) throw new Error();
    return value;
  } catch {
    throw new LocalEngineError("Expected a JSON object request body.", 400);
  }
}

function workflowKind(value: unknown): WorkflowKind {
  if (value !== "text" && value !== "edit") throw new LocalEngineError("Workflow kind must be text or edit.", 400);
  return value;
}

function workflowVariables(value: unknown): WorkflowVariables {
  if (!isRecord(value)) throw new LocalEngineError("Workflow variables are required.", 400);
  if (typeof value.prompt !== "string" || typeof value.negativePrompt !== "string") throw new LocalEngineError("Workflow prompts must be text.", 400);
  if (typeof value.seed !== "number" || typeof value.width !== "number" || typeof value.height !== "number") throw new LocalEngineError("Workflow dimensions and seed must be numbers.", 400);
  if (value.referenceImage != null && typeof value.referenceImage !== "string") throw new LocalEngineError("Reference image handle must be text.", 400);
  return {
    prompt: value.prompt,
    negativePrompt: value.negativePrompt,
    seed: value.seed,
    width: value.width,
    height: value.height,
    referenceImage: typeof value.referenceImage === "string" ? value.referenceImage : undefined,
  };
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const url = new URL(request.url);
    const provider = providerId(url.searchParams.get("provider"));
    const action = url.searchParams.get("action");
    const config = getLocalProviderConfig(provider);
    if (!config) return jsonError(`${provider} is not configured on this server.`, 404);

    if (action === "upload") {
      const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "image/png" && contentType !== "application/octet-stream") throw new LocalEngineError("Reference upload must be a PNG.", 415);
      const declared = Number(request.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new LocalEngineError("Reference image exceeds the 25 MB limit.", 413);
      const image = await readLimitedBody(request.body, MAX_IMAGE_BYTES);
      const reference = await uploadReference(config, image);
      return NextResponse.json({ reference }, { headers: { "cache-control": "no-store" } });
    }

    const body = await jsonBody(request);
    if (action === "submit") {
      const kind = workflowKind(body.kind);
      const workflow = await prepareWorkflow(config, kind, body.workflow, workflowVariables(body.variables));
      const jobId = await submitWorkflow(config, workflow);
      return NextResponse.json({ jobId }, { status: 202, headers: { "cache-control": "no-store" } });
    }
    const jobId = validateJobId(body.jobId);
    const outputNode = validateOutputNode(body.outputNode, config.outputNode);
    if (action === "status") {
      return NextResponse.json(await getJobStatus(config, jobId), { headers: { "cache-control": "no-store" } });
    }
    if (action === "result") {
      const image = await downloadJobImage(config, jobId, outputNode);
      const data = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer;
      return new Response(data, {
        headers: {
          "content-type": "image/png",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    throw new LocalEngineError("Unknown local engine action.", 400);
  } catch (cause) {
    if (cause instanceof LocalEngineError) return jsonError(cause.message, cause.status);
    console.error(JSON.stringify({ message: "local engine proxy failed", path: new URL(request.url).pathname }));
    return jsonError("Local engine proxy failed.", 502);
  }
}
