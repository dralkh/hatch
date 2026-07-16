/// <reference types="@cloudflare/workers-types" />

/** Cloudflare Worker entry point for Hatchframe's vinext application. */
import handler from "vinext/server/app-router-entry";

const worker = {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
