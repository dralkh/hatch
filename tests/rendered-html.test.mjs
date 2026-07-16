import assert from "node:assert/strict";
import test from "node:test";

test("renders the production Hatchframe application", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /Make a tiny friend/i);
  assert.match(html, /81 transparent pixel frames/i);
  assert.match(html, /One idea/i);
  assert.match(html, /FLUX\.2 \[klein\] 9B/i);
  assert.match(html, /ComfyUI/i);
  assert.match(html, /InvokeAI/i);
  assert.match(html, /src="\/art\/nibi-idle\.png"/i);
  assert.match(html, /src="\/art\/nibi-cheer\.png"/i);
  assert.match(html, /src="\/art\/nibi-egg\.png"/i);
  assert.doesNotMatch(html, /\/_vinext\/image\?url=%2Fart%2Fnibi-/i);
});
