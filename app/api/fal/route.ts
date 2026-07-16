import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const allowedModels = new Set([
  "fal-ai/flux-2/klein/9b",
  "fal-ai/flux-2/klein/9b/edit",
]);

type RequestBody = {
  action?: "submit" | "status" | "result" | "run" | "cancel";
  model?: string;
  requestId?: string;
  url?: string;
  input?: Record<string, unknown>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

function credentials(request: Request) {
  const provided = request.headers.get("x-fal-key")?.trim();
  const serverKey = typeof process !== "undefined" ? process.env.FAL_KEY?.trim() : undefined;
  const key = provided || serverKey;
  if (!key) return null;
  return key.replace(/^Key\s+/i, "");
}

async function forward(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || `fal returned ${response.status}.` };
  }
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "cache-control": "no-store" },
  });
}

function queueLifecycleUrl(raw: string | undefined, requestId: string, action: "status" | "result" | "cancel") {
  if (!raw) throw new Error("Missing queue lifecycle URL.");
  const target = new URL(raw);
  if (target.protocol !== "https:" || target.hostname !== "queue.fal.run" || target.username || target.password || target.port) {
    throw new Error("Invalid queue lifecycle URL.");
  }
  const escapedId = requestId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffix = action === "status" ? "/status" : action === "cancel" ? "/cancel" : "";
  if (!new RegExp(`/requests/${escapedId}${suffix}$`).test(target.pathname)) {
    throw new Error("Queue URL does not match the request.");
  }
  target.hash = "";
  if (action === "status") target.searchParams.set("logs", "1");
  else target.search = "";
  return target.toString();
}

export async function POST(request: Request) {
  const key = credentials(request);
  if (!key) return jsonError("Add an API-scoped fal key, or configure FAL_KEY on the server.", 401);

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return jsonError("Expected a JSON request body.", 400);
  }

  const { action, model, requestId, url, input } = body;
  if (!model || !allowedModels.has(model)) return jsonError("That model is not enabled by this proxy.", 403);
  if (!action || !["submit", "status", "result", "run", "cancel"].includes(action)) return jsonError("Unknown fal action.", 400);
  if ((action === "submit" || action === "run") && (!input || typeof input !== "object" || Array.isArray(input))) return jsonError("Model input must be an object.", 400);
  if ((action === "status" || action === "result" || action === "cancel") && (!requestId || !/^[A-Za-z0-9_-]{8,160}$/.test(requestId))) return jsonError("A valid request id is required.", 400);

  const authHeaders = { Authorization: `Key ${key}`, "content-type": "application/json" };
  const base = `https://queue.fal.run/${model}`;

  try {
    if (action === "submit") return forward(base, { method: "POST", headers: authHeaders, body: JSON.stringify(input) });
    if (action === "run") return forward(`https://fal.run/${model}`, { method: "POST", headers: authHeaders, body: JSON.stringify(input) });
    if (action === "status") return forward(queueLifecycleUrl(url, requestId!, "status"), { method: "GET", headers: { Authorization: `Key ${key}` } });
    if (action === "result") return forward(queueLifecycleUrl(url, requestId!, "result"), { method: "GET", headers: { Authorization: `Key ${key}` } });
    return forward(queueLifecycleUrl(url, requestId!, "cancel"), { method: "PUT", headers: { Authorization: `Key ${key}` } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to reach fal.";
    return jsonError(message, 502);
  }
}
