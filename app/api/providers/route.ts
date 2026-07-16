import { NextResponse } from "next/server";
import { configuredLocalProviders } from "../../local-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuredLocals = configuredLocalProviders();
  const localProviders = ([
    { id: "comfyui" as const, label: "ComfyUI" },
    { id: "invoke" as const, label: "InvokeAI" },
  ]).map((provider) => configuredLocals.find((configured) => configured.id === provider.id) || { ...provider, serverConfigured: false });
  const cloudProviders = [
    { id: "fal", label: "fal", key: "FAL_KEY", model: "FLUX.2 [klein] 9B" },
    { id: "openai", label: "OpenAI", key: "OPENAI_API_KEY", model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2" },
    { id: "xai", label: "xAI", key: "XAI_API_KEY", model: process.env.XAI_IMAGE_MODEL?.trim() || "grok-imagine-image-quality" },
    { id: "openrouter", label: "OpenRouter", key: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_IMAGE_MODEL?.trim() || "google/gemini-3.1-flash-image" },
    { id: "google", label: "Google", key: "GOOGLE_API_KEY", model: process.env.GOOGLE_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image" },
  ].map(({ key, ...provider }) => ({ ...provider, serverCredential: Boolean(process.env[key]?.trim()) }));
  return NextResponse.json({
    providers: [
      ...localProviders,
      ...cloudProviders,
    ],
  }, { headers: { "cache-control": "no-store" } });
}
