# Hatch

<img width="3249" height="1738" alt="image" src="https://github.com/user-attachments/assets/459ba44e-5616-4261-90b2-b96bdea4ee16" />

Hatch turns one creature description into a stable, transparent and
playable pixel-pet package. It locks one character identity, generates small
reference-grounded pose pairs, extracts subjects locally, normalizes pivots,
mirrors the left run, composes a deterministic 24-frame hatch, validates the
result and exports a portable runtime.

The repository includes two complete ways to hatch a pet:

- a polished web app with a secured fal proxy;
- one dependency-free [`hatch.py`](./hatch.py) command that can use fal,
  ComfyUI or InvokeAI directly.

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
keyboard/touch mini-game. The latest 12 pets stay on-device, including imported
Hatch ZIP packages, and each pet remembers its fastest Beacon Rescue clear
plus three mastery badges.

## Run the website

Requirements: Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open the printed local URL. Paste an API-scoped fal key into the page, or set a
server-side `FAL_KEY`. A browser-provided key stays in React memory only; it is
never written to cookies, local storage, IndexedDB or source.

```sh
cp .env.example .env.local
# Edit .env.local, then restart the development server.
```

### Run the website with Docker

Build the production image and open <http://localhost:3000>:

```sh
docker build -t hatch .
docker run --rm -p 3000:3000 hatch
```

Users can still paste their own fal key into the page. To provide one from the
server instead, pass it only when starting the container (never bake it into
the image):

```sh
docker run --rm -p 3000:3000 -e FAL_KEY="your-api-scoped-key" hatch
```

Set `-e PORT=8080` together with `-p 8080:8080` to use another port. The image
runs the standalone production server as an unprivileged user and includes a
health check.

The website's generation route is intentionally fal-only. Browsers cannot
reliably call a user's loopback GPU service from an HTTPS deployment because
of mixed-content, CORS and private-network protections. The standalone Python
path below connects to those engines directly without exposing them publicly.

## Standalone Python workflow

`hatch.py` is the alternative to using the site. It needs Python 3.10+ and has
no third-party dependencies.

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
python3 hatch.py --style plush --seed 8128 --out ./my-pet "round sprout frog"
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

## Security and privacy

- fal credentials are never logged or persisted by the app;
- the Worker proxy only permits the two documented FLUX model IDs;
- returned queue URLs must remain on `queue.fal.run` and match the request ID;
- the asset proxy uses a generated-media host allowlist and response limits;
- browser history stores only finished PNG blobs and pet metadata;
- local engine endpoints and bearer tokens stay inside the CLI process.

See [SECURITY.md](./SECURITY.md) for reporting guidance and
[RESEARCH.md](./RESEARCH.md) for model experiments, cost reasoning, the 405
queue fix and atlas QA details.

## License

MIT — see [LICENSE](./LICENSE).
