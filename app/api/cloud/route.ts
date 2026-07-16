import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CloudProvider = "openai" | "xai" | "openrouter" | "google";
type ImageRequest = {
  kind?: "text" | "edit";
  prompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  reference?: string;
};

type ImagePayload = {
  data?: Array<{ b64_json?: unknown; media_type?: unknown; url?: unknown }>;
  steps?: Array<{ type?: unknown; content?: Array<{ type?: unknown; data?: unknown; mime_type?: unknown }> }>;
  error?: unknown;
  detail?: unknown;
};

const MAX_REFERENCE_LENGTH = 16 * 1024 * 1024;
const MAX_REQUEST_LENGTH = 18 * 1024 * 1024;
const MAX_UPSTREAM_JSON_LENGTH = 32 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const providerSettings: Record<CloudProvider, { keyEnv: string; modelEnv: string; defaultModel: string }> = {
  openai: { keyEnv: "OPENAI_API_KEY", modelEnv: "OPENAI_IMAGE_MODEL", defaultModel: "gpt-image-2" },
  xai: { keyEnv: "XAI_API_KEY", modelEnv: "XAI_IMAGE_MODEL", defaultModel: "grok-imagine-image-quality" },
  openrouter: { keyEnv: "OPENROUTER_API_KEY", modelEnv: "OPENROUTER_IMAGE_MODEL", defaultModel: "google/gemini-3.1-flash-image" },
  google: { keyEnv: "GOOGLE_API_KEY", modelEnv: "GOOGLE_IMAGE_MODEL", defaultModel: "gemini-3.1-flash-image" },
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

function requestError(message: string) {
  const error = new Error(message);
  (error as Error & { status?: number }).status = 400;
  return error;
}

function parseProvider(raw: string | null): CloudProvider | null {
  return raw === "openai" || raw === "xai" || raw === "openrouter" || raw === "google" ? raw : null;
}

function envValue(name: string) {
  return typeof process !== "undefined" ? process.env[name]?.trim() : undefined;
}

function credential(request: Request, provider: CloudProvider) {
  return request.headers.get("x-provider-key")?.trim() || envValue(providerSettings[provider].keyEnv) || null;
}

function model(provider: CloudProvider) {
  const settings = providerSettings[provider];
  return envValue(settings.modelEnv) || settings.defaultModel;
}

function aspectRatio(width: number, height: number) {
  return width === height ? "1:1" : "16:9";
}

function openAiSize(width: number, height: number) {
  return width === height ? "1024x1024" : "1536x1024";
}

function decodeBase64(value: string) {
  const normalized = value.replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error("The provider returned invalid image data.");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hasImageSignature(bytes: Uint8Array, mime: string) {
  if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

function parseReference(reference: string | undefined) {
  if (!reference || reference.length > MAX_REFERENCE_LENGTH) throw requestError("The identity reference is missing or too large.");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(reference);
  if (!match) throw requestError("The identity reference must be a PNG, JPEG, or WebP data URL.");
  const mime = match[1].toLowerCase();
  if (!IMAGE_TYPES.has(mime)) throw requestError("The identity reference format is not supported.");
  try {
    const bytes = decodeBase64(match[2]);
    if (!hasImageSignature(bytes, mime)) throw new Error();
    return { mime, base64: match[2].replace(/\s/g, ""), bytes };
  } catch {
    throw requestError("The identity reference contains invalid image data.");
  }
}

function providerMessage(payload: ImagePayload, fallback: string) {
  if (payload.error && typeof payload.error === "object") {
    const message = (payload.error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.slice(0, 600);
  }
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error.slice(0, 600);
  if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.slice(0, 600);
  return fallback;
}

async function readLimitedText(stream: ReadableStream<Uint8Array> | null, maxBytes: number, message: string) {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(message);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function readProviderJson(response: Response, provider: CloudProvider) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_UPSTREAM_JSON_LENGTH) throw new Error(`${provider} returned an image response that is too large.`);
  const text = await readLimitedText(response.body, MAX_UPSTREAM_JSON_LENGTH, `${provider} returned an image response that is too large.`);
  let payload: ImagePayload;
  try {
    payload = text ? JSON.parse(text) as ImagePayload : {};
  } catch {
    throw new Error(`${provider} returned an invalid response.`);
  }
  if (!response.ok) {
    const error = new Error(providerMessage(payload, `${provider} rejected the image request.`));
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return payload;
}

function dataImage(payload: ImagePayload, providerLabel: string, defaultMime = "image/png") {
  const first = payload.data?.[0];
  if (typeof first?.b64_json !== "string" || !first.b64_json) throw new Error(`${providerLabel} returned no inline image.`);
  const mime = typeof first.media_type === "string" && IMAGE_TYPES.has(first.media_type) ? first.media_type : defaultMime;
  const bytes = decodeBase64(first.b64_json);
  if (!hasImageSignature(bytes, mime)) throw new Error(`${providerLabel} returned invalid ${mime} data.`);
  return { bytes, mime };
}

function googleImage(payload: ImagePayload) {
  for (const step of [...(payload.steps || [])].reverse()) {
    if (step.type !== "model_output") continue;
    for (const content of [...(step.content || [])].reverse()) {
      if (content.type !== "image" || typeof content.data !== "string") continue;
      const mime = typeof content.mime_type === "string" && IMAGE_TYPES.has(content.mime_type) ? content.mime_type : "image/png";
      const bytes = decodeBase64(content.data);
      if (!hasImageSignature(bytes, mime)) throw new Error(`Google returned invalid ${mime} data.`);
      return { bytes, mime };
    }
  }
  throw new Error("Google returned no generated image.");
}

async function callOpenAI(key: string, body: Required<Pick<ImageRequest, "kind" | "prompt" | "width" | "height">> & ImageRequest) {
  const endpoint = body.kind === "edit" ? "edits" : "generations";
  let requestBody: BodyInit;
  let headers: HeadersInit;
  if (body.kind === "edit") {
    const reference = parseReference(body.reference);
    const form = new FormData();
    form.set("model", model("openai"));
    form.set("prompt", body.prompt);
    form.set("size", openAiSize(body.width, body.height));
    form.set("quality", "low");
    form.set("output_format", "png");
    form.append("image[]", new Blob([reference.bytes], { type: reference.mime }), "identity.png");
    requestBody = form;
    headers = { authorization: `Bearer ${key}` };
  } else {
    requestBody = JSON.stringify({
      model: model("openai"), prompt: body.prompt, size: openAiSize(body.width, body.height),
      quality: "low", output_format: "png", n: 1,
    });
    headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  }
  const response = await fetch(`https://api.openai.com/v1/images/${endpoint}`, { method: "POST", headers, body: requestBody });
  return dataImage(await readProviderJson(response, "openai"), "OpenAI");
}

async function callXAI(key: string, body: Required<Pick<ImageRequest, "kind" | "prompt" | "width" | "height">> & ImageRequest) {
  const reference = body.kind === "edit" ? parseReference(body.reference) : null;
  const response = await fetch(`https://api.x.ai/v1/images/${body.kind === "edit" ? "edits" : "generations"}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: model("xai"), prompt: body.prompt, n: 1, response_format: "b64_json", resolution: "1k",
      aspect_ratio: aspectRatio(body.width, body.height),
      ...(reference ? { image: { type: "image_url", url: `data:${reference.mime};base64,${reference.base64}` } } : {}),
    }),
  });
  return dataImage(await readProviderJson(response, "xai"), "xAI", "image/jpeg");
}

async function callOpenRouter(key: string, body: Required<Pick<ImageRequest, "kind" | "prompt" | "width" | "height">> & ImageRequest) {
  const reference = body.kind === "edit" ? parseReference(body.reference) : null;
  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Hatch" },
    body: JSON.stringify({
      model: model("openrouter"), prompt: body.prompt, n: 1, resolution: "1K",
      aspect_ratio: aspectRatio(body.width, body.height), output_format: "png", seed: body.seed,
      ...(reference ? { input_references: [{ type: "image_url", image_url: { url: `data:${reference.mime};base64,${reference.base64}` } }] } : {}),
    }),
  });
  return dataImage(await readProviderJson(response, "openrouter"), "OpenRouter");
}

async function callGoogle(key: string, body: Required<Pick<ImageRequest, "kind" | "prompt" | "width" | "height">> & ImageRequest) {
  const reference = body.kind === "edit" ? parseReference(body.reference) : null;
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      model: model("google"),
      store: false,
      input: [
        ...(reference ? [{ type: "image", mime_type: reference.mime, data: reference.base64 }] : []),
        { type: "text", text: body.prompt },
      ],
      response_format: { type: "image", mime_type: "image/png", aspect_ratio: aspectRatio(body.width, body.height), image_size: "1K" },
    }),
  });
  return googleImage(await readProviderJson(response, "google"));
}

export async function POST(request: Request) {
  const provider = parseProvider(new URL(request.url).searchParams.get("provider"));
  if (!provider) return jsonError("Unknown cloud image provider.", 404);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return jsonError("Cross-origin provider requests are not allowed.", 403);
  const key = credential(request, provider);
  if (!key) return jsonError(`Add a ${providerSettings[provider].keyEnv} value on the server or paste this provider's API key in the page.`, 401);

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REQUEST_LENGTH) return jsonError("Image request is too large.", 413);
  let body: ImageRequest;
  try {
    body = JSON.parse(await readLimitedText(request.body, MAX_REQUEST_LENGTH, "Image request is too large.")) as ImageRequest;
  } catch (cause) {
    if (cause instanceof Error && cause.message === "Image request is too large.") return jsonError(cause.message, 413);
    return jsonError("Expected a JSON request body.", 400);
  }
  if (body.kind !== "text" && body.kind !== "edit") return jsonError("Image request kind must be text or edit.", 400);
  if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 12_000) return jsonError("Image prompt must be between 1 and 12,000 characters.", 400);
  if (!Number.isInteger(body.width) || !Number.isInteger(body.height) || body.width! < 256 || body.width! > 2048 || body.height! < 256 || body.height! > 2048) {
    return jsonError("Image dimensions must be whole numbers between 256 and 2048.", 400);
  }
  if (body.kind === "edit" && typeof body.reference !== "string") return jsonError("An edit request requires an identity reference.", 400);

  const completeBody = body as Required<Pick<ImageRequest, "kind" | "prompt" | "width" | "height">> & ImageRequest;
  try {
    const image = provider === "openai" ? await callOpenAI(key, completeBody)
      : provider === "xai" ? await callXAI(key, completeBody)
        : provider === "openrouter" ? await callOpenRouter(key, completeBody)
          : await callGoogle(key, completeBody);
    return new Response(image.bytes, {
      status: 200,
      headers: {
        "content-type": image.mime,
        "content-length": String(image.bytes.byteLength),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : `Unable to reach ${provider}.`;
    const upstreamStatus = cause && typeof cause === "object" && "status" in cause ? Number((cause as { status?: unknown }).status) : 0;
    return jsonError(message, upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 502);
  }
}
