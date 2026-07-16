import { NextResponse } from "next/server";
import { configuredLocalProviders } from "../../local-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const falServerCredential = Boolean(process.env.FAL_KEY?.trim());
  return NextResponse.json({
    providers: [
      ...configuredLocalProviders(),
      { id: "fal", label: "fal", serverCredential: falServerCredential },
    ],
  }, { headers: { "cache-control": "no-store" } });
}
