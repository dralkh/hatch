# Hatch

[![Preview release](https://img.shields.io/github/v/release/dralkh/hatch?include_prereleases&label=preview)](https://github.com/dralkh/hatch/releases)
[![License: MIT](https://img.shields.io/github/license/dralkh/hatch)](./LICENSE)
[![Try Hatch](https://img.shields.io/badge/try-hatch.amayx.com-62f6ff)](https://hatch.amayx.com/)

<a href="https://hatch.amayx.com/">
  <img width="3223" height="1717" alt="Hatch web app showing the Nibi pixel pet generator, animation workflow and portable sprite output" src="https://github.com/user-attachments/assets/b40e1d56-8653-4835-8101-30d14638880a" />
</a>

**[Try Hatch live](https://hatch.amayx.com/)** or run the web app and standalone generator locally.

Hatch turns one creature description into a stable, transparent and
playable pixel-pet package. It locks one character identity, generates small
reference-grounded pose pairs, extracts subjects locally, normalizes pivots,
mirrors the left run, composes a deterministic 24-frame hatch, validates the
result and exports a portable runtime.

The repository includes two complete ways to hatch a pet:

- a polished web app with secured fal, OpenAI, xAI, OpenRouter, Google,
  ComfyUI and InvokeAI adapters;
- one [`hatch.py`](./hatch.py) command with the same fal, OpenAI, xAI,
  OpenRouter, Google, ComfyUI and InvokeAI provider choices.

No proprietary hosting project metadata, hosted database or vendor-specific
application runtime is required.

## What a completed pet contains

| Asset | Contract |
| --- | --- |
| `spritesheet.png` | 1536×1872, 8×9 grid, 192×208 cells, 57 populated runtime frames |
| `hatch.png` | 1536×624, 8×3 grid, exactly 24 populated hatch frames |
| `manifest.json` | App-agnostic clips, timing, grids and pivots |
| `pet.json` | Portable identity metadata |
| `qa.json` | CLI extraction and state-quality report |
| `sprite-pet.js` | Dependency-free Canvas animator |
| `index.html` | Working browser playback example |

Runtime states are idle, run right, mirrored run left, wave, jump, failed,
waiting, working and review. The web result view animates every state at once,
stores completed packages in private IndexedDB history and includes a playable
keyboard/touch action game. Beacon Rescue is an authored story course with
three cleansing tools, enemies, visible difficulty presets and four mastery
badges. Endless Patrol streams seeded rooms, combat waves, guardians and
temporary upgrades for as long as the player survives. The latest 12 pets and
their per-mode records stay on-device.

Endless Patrol also includes a live public leaderboard inside Beacon Wilds.
After a run, players can submit a 2–20 character display name; scores are shown
in real time and separated by difficulty. Submissions are an honor system,
validated and rate-limited through InstantDB, while local records continue to
work when the network is unavailable.

### Export for Hermes Agent

Hatch's 1536×1872 runtime atlas already uses Hermes Agent's current petdex/Codex
contract: an 8×9 grid of 192×208 cells with the same state rows and populated
frame counts. No frame conversion or additional generation is required.

On the website, choose **Hermes Agent ZIP** after generating a pet, or use the
same action from a saved pet in local history. The archive contains only
`pet.json` and `spritesheet.png`, matching the Hermes/Petdex atlas contract.
Hermes Agent's current CLI installs pets from its gallery; it does not currently
expose a local ZIP import command.

Hatch can play existing Hermes pets directly. Choose **Import Hatch / Hermes**
and provide a minimal Hermes/Petdex ZIP, a complete Hatch ZIP, or a loose
1536×1872 PNG/WebP atlas. Loose and Hermes imports are normalized to PNG and
receive a local spark-reveal hatch animation; no image provider or Hatch
generation run is required.

The CLI defaults to the full Hatch package. Select the minimal Hermes archive,
or emit both formats from the same generated frames:

```sh
python3 hatch.py --package-format hermes "a tiny cyan dragon-hawk"
python3 hatch.py --package-format both "a tiny cyan dragon-hawk"
```

Hermes uses the runtime atlas and does not consume Hatch's separate 24-frame
egg animation.

## Run the website

Requirements: Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open the printed local URL and choose **fal**, **OpenAI**, **xAI**,
**OpenRouter** or **Google**. Paste that provider's API key into the page, or
configure the matching server-side variable: `FAL_KEY`, `OPENAI_API_KEY`,
`XAI_API_KEY`, `OPENROUTER_API_KEY` or `GOOGLE_API_KEY`. A browser-provided key
stays in React memory only; it is never written to cookies, local storage,
IndexedDB or source.

```sh
cp .env.example .env.local
# Edit .env.local, then restart the development server.
```

Optional model variables are also available: `OPENAI_IMAGE_MODEL`,
`XAI_IMAGE_MODEL`, `OPENROUTER_IMAGE_MODEL` and `GOOGLE_IMAGE_MODEL`. The
defaults are documented in [`.env.example`](./.env.example). Hatch uses each
provider's text-to-image and reference-edit support, then performs chroma
removal, QA, atlas packing and export locally in the browser.

To use a local GPU engine from the web app, configure one endpoint and either
mount both workflow paths on the server or upload both workflow JSON files in
the browser:

```sh
# .env.local — ComfyUI example
COMFYUI_ENDPOINT=http://127.0.0.1:8188
COMFYUI_TEXT_WORKFLOW=/absolute/path/anchor-api.json
COMFYUI_EDIT_WORKFLOW=/absolute/path/edit-api.json
COMFYUI_OUTPUT_NODE=9

# Or use InvokeAI instead
INVOKEAI_ENDPOINT=http://127.0.0.1:9090
INVOKEAI_TEXT_WORKFLOW=/absolute/path/anchor-graph.json
INVOKEAI_EDIT_WORKFLOW=/absolute/path/edit-graph.json
```

ComfyUI and InvokeAI always appear in **Generation engine**. When one is
configured on a self-hosted Hatch server, the server connection is preferred
automatically. Every cloud provider remains available as a manual option.
If mounted workflow paths are omitted, choose the two exported JSON workflows
in the page. Browser overrides stay in the current tab; endpoint URLs and
engine tokens never leave the Hatch server.

### Connect the hosted site directly to a local engine

On <https://hatch.amayx.com/>, choose **ComfyUI** or **InvokeAI**, enter the
engine endpoint, and upload both workflow JSON files. Hatch then calls the
engine directly from that browser tab; the endpoint, optional bearer token,
and workflows are not stored or included in an exported pet.

The engine must allow `https://hatch.amayx.com` through CORS. ComfyUI supports
an origin-specific launch argument:

```sh
python main.py --enable-cors-header https://hatch.amayx.com
```

For InvokeAI, add `https://hatch.amayx.com` to its web server
`allow_origins` configuration. CORS should allow `Content-Type` and, when a
token is used, `Authorization`, plus the engine's `GET` and `POST` routes.
Your browser may also show a local-network access prompt. Localhost HTTP is
supported by browsers that treat loopback as trustworthy; for LAN hostnames
or addresses, HTTPS or an explicit browser local-network grant may be needed.

Treat a self-hosted Hatch instance with a local engine like an engine control
panel: keep it on a trusted network or put access control in front of it.
Authenticated visitors can submit the browser workflow overrides you enable.

### Run the website with Docker

Build the production image and open <http://localhost:3000>:

```sh
docker build -t hatch .
docker run --rm -p 3000:3000 hatch
```

Users can still paste any supported cloud-provider key into the page. To
provide keys from the server instead, pass them only when starting the
container (never bake them into the image):

```sh
docker run --rm -p 3000:3000 -e FAL_KEY="your-api-scoped-key" hatch
```

Use the same `-e NAME=value` pattern for `OPENAI_API_KEY`, `XAI_API_KEY`,
`OPENROUTER_API_KEY` and `GOOGLE_API_KEY`.

Set `-e PORT=8080` together with `-p 8080:8080` to use another port. The image
runs the standalone production server as an unprivileged user and includes a
health check.

Preview releases are also published as public multi-platform images:

```sh
docker run --rm -p 3000:3000 ghcr.io/dralkh/hatch:0.6.0
```

Use the immutable version tag in production. The moving `preview` tag follows
the newest `v0.x` release; Hatch will not publish a `latest` image before 1.0.

For a Dockerized Hatch server to reach an engine running on the host, mount a
read-only workflow directory and add the host gateway:

```sh
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -v "$PWD/config:/config:ro" \
  -e COMFYUI_ENDPOINT=http://host.docker.internal:8188 \
  -e COMFYUI_TEXT_WORKFLOW=/config/anchor-api.json \
  -e COMFYUI_EDIT_WORKFLOW=/config/edit-api.json \
  ghcr.io/dralkh/hatch:0.6.0
```

The public Cloudflare deployment at <https://hatch.amayx.com/> supports the
five cloud choices and direct-browser ComfyUI/InvokeAI. Cloudflare itself
cannot reach services on your private network; direct mode works because the
visitor's browser makes those CORS requests. A self-hosted Hatch server can
instead proxy the local engine, avoiding browser CORS and private-network
limits. The standalone Python path remains useful for headless scripted runs.

## Standalone Python workflow

`hatch.py` is the alternative to using the site. It needs Python 3.10+. Its
fal, OpenAI, OpenRouter, Google, ComfyUI and InvokeAI paths use only the Python
standard library. Because xAI currently returns JPEG images, that path also
needs Pillow to normalize them into Hatch's PNG processing pipeline:

```sh
python3 -m pip install Pillow
```

Download the release-pinned command and checksum from the
[v0.6.0 release](https://github.com/dralkh/hatch/releases/tag/v0.6.0), or use
the current copy in this repository:

```sh
python3 hatch.py --version
python3 hatch.py --self-test
```

The CLI loads `.env.local` and `.env` automatically without replacing values
already exported by the shell. The same key and model variables used by the
web app work here.

### OpenAI, xAI, OpenRouter and Google

```sh
python3 hatch.py --provider openai "a tiny cyan dragon-hawk"
python3 hatch.py --provider xai "a tiny cyan dragon-hawk"
python3 hatch.py --provider openrouter "a tiny cyan dragon-hawk"
python3 hatch.py --provider google "a tiny cyan dragon-hawk"
```

The providers read `OPENAI_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY` and
`GOOGLE_API_KEY`. Their optional model overrides are `OPENAI_IMAGE_MODEL`,
`XAI_IMAGE_MODEL`, `OPENROUTER_IMAGE_MODEL` and `GOOGLE_IMAGE_MODEL`; `--model`
overrides the selected provider for one run. Each path creates the initial
identity with text-to-image, then uses that private PNG reference for all 26
motion/egg edits. Keys and generated references are never written to the pet
package.

### fal

```sh
export FAL_KEY="your-api-scoped-key"
python3 hatch.py "a tiny cyan dragon-hawk with green feather tips"
```

The hosted path uses FLUX.2 [klein] 9B for the anchor and its edit endpoint for
motion and egg images. A normal no-retry run submits 27 jobs. Use `--dry-run`
to inspect the full prompt and job plan without spending credits.

### ComfyUI

1. Build one text-to-image workflow and one reference-edit workflow using a
   checkpoint already installed in ComfyUI.
2. Export each in API format. In current ComfyUI this is available from the
   workflow save/export controls when developer options are enabled.
3. Replace the values that Hatch should control with the placeholders in
   the table below. The edit workflow must feed `{{REFERENCE_IMAGE}}` into a
   `LoadImage` node or equivalent reference input.
4. Start ComfyUI, then run:

```sh
python3 hatch.py \
  --provider comfyui \
  --endpoint http://127.0.0.1:8188 \
  --text-workflow ./anchor-api.json \
  --edit-workflow ./edit-api.json \
  "a sleepy lavender cloud fox with mint ears"
```

Hatch uploads the locked anchor through `/upload/image`, submits each API
workflow to `/prompt`, polls `/history/{prompt_id}` and downloads the selected
output through `/view`. No fal key or cloud service is used.

### InvokeAI

InvokeAI's queue executes a graph, not a saved UI workflow record. Prepare one
executable text-to-image graph and one executable reference-edit graph accepted
by InvokeAI's queue API, then place the same placeholders in their invocation
fields.

```sh
python3 hatch.py \
  --provider invoke \
  --endpoint http://127.0.0.1:9090 \
  --text-workflow ./anchor-graph.json \
  --edit-workflow ./edit-graph.json \
  "a pocket-sized peach star otter with navy paws"
```

Hatch uploads the anchor to `/api/v1/images/upload`, submits each graph to
`/api/v1/queue/default/enqueue_batch`, polls its queue item and downloads the
final `image_name`. Multi-user installations can provide `INVOKEAI_TOKEN` or
`--engine-token`.

### Workflow placeholders

| Placeholder | Value supplied at execution |
| --- | --- |
| `{{PROMPT}}` | Hardened identity, pose-pair or egg prompt |
| `{{NEGATIVE_PROMPT}}` | Compact anti-realism and artifact prompt |
| `{{SEED}}` | Deterministic integer seed |
| `{{WIDTH}}` | 1024 |
| `{{HEIGHT}}` | 1024 for single images, 512 for two-pose strips |
| `{{REFERENCE_IMAGE}}` | Engine-native uploaded identity image name |
| `{{REFERENCE_IMAGE_NAME}}` | Alias of `{{REFERENCE_IMAGE}}` |

An exact placeholder such as `"seed": "{{SEED}}"` becomes a JSON number. A
placeholder embedded inside a larger string remains text. If a workflow has
several image outputs, pass `--output-node NODE_ID`.

Instead of two files, `--workflow bundle.json` accepts:

```json
{
  "text": { "...": "anchor API workflow or executable graph" },
  "edit": { "...": "reference-edit API workflow or executable graph" }
}
```

Useful CLI options:

```sh
python3 hatch.py --help
python3 hatch.py --self-test
python3 hatch.py --provider comfyui --dry-run "mint moth cat"
python3 hatch.py --provider openrouter --dry-run "mint moth cat"
python3 hatch.py --style plush --seed 8128 --out ./my-pet "round sprout frog"
python3 hatch.py --package-format both "round sprout frog"
```

## Validation

```sh
npm run lint
npm test
python3 hatch.py --self-test
```

The test suite type-checks the app, builds the production Worker, validates the
artifact, renders the page through the built Worker, checks proxy boundaries
and guards the late-stage packing regression that previously caused the
`startsWith` crash.

## Releases and versioning

Hatch uses Semantic Versioning for the app and CLI. Git tags are annotated and
named `vMAJOR.MINOR.PATCH`; release tags are immutable, while `main` is the
development branch. During the `v0.x` preview, interfaces may still evolve and
GitHub releases are marked as prereleases.

Each release provides source archives, the single-file `hatch.py` command,
checksums and a matching `ghcr.io/dralkh/hatch` container image. See
[CHANGELOG.md](./CHANGELOG.md) for user-visible changes.

## Security and privacy

- cloud-provider credentials are never logged or persisted by the app;
- browser keys are sent only to the same-origin Hatch proxy, and server keys
  remain runtime-only fallbacks;
- server-proxied engine endpoints and tokens remain server-side; direct-mode
  endpoint, token and workflows remain only in the active browser tab;
- local workflow bodies and PNG responses are bounded and validated;
- the Worker proxy only permits the two documented FLUX model IDs;
- returned queue URLs must remain on `queue.fal.run` and match the request ID;
- the asset proxy uses a generated-media host allowlist and response limits;
- browser history stores only finished PNG blobs and pet metadata;
- browser-provided workflow overrides stay in page memory and are not included
  in history or exported packages.

See [SECURITY.md](./SECURITY.md) for reporting guidance and
[RESEARCH.md](./RESEARCH.md) for model experiments, cost reasoning, the 405
queue fix and atlas QA details.

## License

MIT — see [LICENSE](./LICENSE).
