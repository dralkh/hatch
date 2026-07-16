import { access, writeFile } from "node:fs/promises";

const configUrl = new URL("../wrangler.jsonc", import.meta.url);

try {
  await access(configUrl);
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;

  const publicBuildConfig = {
    $schema: "./node_modules/wrangler/config-schema.json",
    name: "hatch",
    main: "./worker/index.ts",
    compatibility_date: "2026-07-16",
    compatibility_flags: ["nodejs_compat"],
    observability: { enabled: true },
  };

  await writeFile(configUrl, `${JSON.stringify(publicBuildConfig, null, 2)}\n`, { flag: "wx" });
}
