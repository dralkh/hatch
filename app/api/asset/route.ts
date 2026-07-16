import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const allowedHosts = new Set([
  "fal.media",
  "v3.fal.media",
  "v3b.fal.media",
  "v3b.fal.run",
  "storage.googleapis.com",
]);

function isAllowed(url: URL) {
  return url.protocol === "https:" && allowedHosts.has(url.hostname);
}

async function fetchAllowed(start: URL, range: string | null) {
  let current = start;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: range ? { range } : undefined,
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const next = new URL(location, current);
    if (!isAllowed(next)) throw new Error("Redirected asset host is not allowed.");
    current = next;
  }
  throw new Error("Too many asset redirects.");
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "Missing asset URL." }, { status: 400 });
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid asset URL." }, { status: 400 });
  }
  if (!isAllowed(target)) {
    return NextResponse.json({ error: "Asset host is not allowed." }, { status: 403 });
  }

  try {
    const range = request.headers.get("range");
    if (range && !/^bytes=\d*-\d*$/.test(range)) {
      return NextResponse.json({ error: "Invalid byte range." }, { status: 416 });
    }
    const response = await fetchAllowed(target, range);
    if (!response.ok || !response.body) return NextResponse.json({ error: "Unable to load the generated asset." }, { status: response.status || 502 });
    const type = response.headers.get("content-type") || "application/octet-stream";
    if (!type.startsWith("image/") && !type.startsWith("video/") && type !== "application/octet-stream") {
      return NextResponse.json({ error: "The remote asset is not supported media." }, { status: 415 });
    }
    const headers = new Headers({
      "content-type": type,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    });
    for (const name of ["accept-ranges", "content-range", "content-length"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return NextResponse.json({ error: "Unable to proxy the generated asset." }, { status: 502 });
  }
}
