# Hatchframe research and implementation notes

Updated 15 July 2026.

## Outcome

Hatchframe turns a rough creature description into two portable transparent atlases:

- runtime atlas: 8 columns × 9 rows, 192×208 cells, 1536×1872 total, 57 populated frames;
- hatch atlas: 8 columns × 3 rows, 192×208 cells, 1536×624 total, exactly 24 populated frames.

The normal execution path uses only two fal endpoints:

- `fal-ai/flux-2/klein/9b` for one identity anchor;
- `fal-ai/flux-2/klein/9b/edit` for 24 two-pose motion segments, one single pose and one egg.

Transparency, frame extraction, run-left mirroring, normalization, packing, hatch composition, QA and playback run in the browser.

## Why FLUX.2 [klein] 9B

Current fal list pricing makes the 9B distilled endpoint the best cost fit for this high-volume workflow.

| Candidate | Listed price | Reference editing | Decision |
| --- | ---: | --- | --- |
| FLUX.2 [klein] 9B | $0.006/output MP; edit $0.011/input and output MP | Yes, up to 4 reference images | Default |
| HiDream-O1-Image | $0.01/MP | Yes | Quality fallback candidate |
| Kling Image 3 / O3 | $0.028/image at 1K/2K | Yes | More expensive for nine edits |
| MAI Image 2.5 | about $0.05/output image plus tokens | Yes | More expensive for this job count |

Primary model pages:

- [FLUX.2 [klein] 9B text-to-image](https://fal.ai/models/fal-ai/flux-2/klein/9b/api)
- [FLUX.2 [klein] 9B image edit](https://fal.ai/models/fal-ai/flux-2/klein/9b/edit/api)
- [HiDream-O1-Image](https://fal.ai/models/fal-ai/hidream-o1-image/api)
- [Kling O3 Image](https://fal.ai/models/fal-ai/kling-image/o3/text-to-image)
- [MAI Image 2.5](https://fal.ai/models/microsoft/mai-image-2.5)

The selected FLUX endpoints are fast four-step distilled models. The edit schema accepts `prompt`, `image_urls`, `image_size`, `seed`, `num_inference_steps`, `num_images`, `output_format` and safety settings. The implementation uses PNG, four steps, one output, a square anchor and egg, and 2048×512 motion strips.

## Estimated normal cost

At listed pricing:

- anchor: roughly 1 MP × $0.006 = $0.006;
- 24 two-pose edits: each approximately 1 MP input + 0.5 MP output × $0.011 = about $0.396;
- one single-pose edit: approximately 1 MP input + 0.25 MP output × $0.011 = about $0.014;
- egg edit: approximately 1 MP input + 0.25 MP output × $0.011 = about $0.014;
- local alpha, extraction, mirroring, packing and hatch: $0.

Normal total: approximately **$0.43 before retries**.

One failed two-pose segment may be retried once, adding roughly $0.02. Listed fal prices can change and fal billing is authoritative.

## Prompt hardening

The earlier failure examples were short and ambiguous: `Dragon`, `hawk`, and `Dragon, hawk — cyan, green`. A model can interpret the combined form as two characters, distribute colors unpredictably or duplicate wings and limbs.

Hatchframe expands short input before submission:

1. Detect creature terms and ordered color terms.
2. When dragon plus hawk/eagle are present, request exactly one cohesive baby hybrid.
3. State concrete anatomy: compact dragon body, hawk beak and eyes, two feathered wings, two hind legs, one tail and one horn crest.
4. Convert colors into a primary and accent palette.
5. Explicitly prohibit a second creature, duplicate heads, wings, legs and tails.
6. Lock full-body framing, side or slight three-quarter camera, generous padding and one uniform key background.

Every motion request then repeats five locks:

- exactly two poses, one in each half, or one pose for the final odd frame;
- exact reference identity in every pose;
- equal invisible slots with clear gaps;
- full-body containment and stable bottom-center pivot;
- no text, captions, panels, grids, scenery, props or duplicate anatomy.

## Local transparency

Every generation requests a single flat `#FF00FF` background and forbids magenta in the subject. The browser then:

1. samples the image border to measure the actual generated key color;
2. rejects a border that is not recognizably magenta;
3. converts RGB distance from the sampled key into a soft alpha matte;
4. despills red/blue at semi-transparent edges;
5. zeroes RGB for fully transparent pixels;
6. rejects results with less than 8% transparent area.

This avoids a paid background-removal model while keeping the output PNG-native and transparent.

## Stable extraction and packing

Large strip requests were tested and rejected as the production strategy: requests for four to eight poses returned only two to five significant subjects. Exact two-pose requests returned both required subjects in the tested idle and run cases. Hatchframe therefore generates 24 pose pairs plus one single pose. Connected-component analysis runs across each transparent result, ranks components by opaque area, chooses the required subjects and sorts them by horizontal center. Small label-like debris is discarded.

### Real supplied-key test

The exact user failure input `Dragon, hawk — cyan, green` was expanded into the single-hybrid brief and run through the live fal queue endpoints.

- anchor: one cohesive cyan-and-green dragon-hawk, 1024×1024, usable magenta border and one dominant subject;
- egg: one 1024×1024 identity-grounded egg with usable magenta border;
- oversized row experiment: every requested 4–8 pose row omitted at least one pose, confirming that a cheaper model should not be trusted with the full row count at once;
- two-pose architecture: **25/25 motion jobs returned the required component count**, including the one single-pose job for the odd five-frame jump row;
- total accepted generated source poses: 49; local run-left mirroring brings the runtime total to 57;
- all tested image outputs passed the local magenta-border gate and produced substantial transparent area after the same matte thresholds used by the app.

The queue tests used the returned lifecycle URLs with POST submission and GET status/result retrieval. The supplied key was held only in process memory and was not written to the project or test artifacts.

Each state is normalized to one deterministic cell geometry:

- cell: 192×208;
- bottom pivot: x=96, y=194;
- maximum ordinary pose area: 166×174;
- jumping applies fixed vertical offsets after normalization;
- run-left is produced by mirroring the accepted run-right row locally;
- unused runtime cells remain transparent with zeroed RGB.

Runtime state order and frame counts:

| Row | State | Frames |
| ---: | --- | ---: |
| 0 | idle | 6 |
| 1 | running-right | 8 |
| 2 | running-left | 8, mirrored locally |
| 3 | waving | 4 |
| 4 | jumping | 5 |
| 5 | failed | 8 |
| 6 | waiting | 6 |
| 7 | working | 6 |
| 8 | review | 6 |

## 24-frame hatch without video generation

The egg edit is keyed locally, then composed with the accepted idle pet into exactly 24 Canvas frames:

- frames 0–6: restrained breathing and wobble;
- frames 7–12: increasing shake and energy particles;
- frames 10–16: egg fades while the pet rises with squash-and-stretch;
- frames 17–23: pet settles to the same runtime pivot while particles decay.

This gives deterministic timing, alpha and geometry and removes the largest single cost from the previous pipeline.

## Queue lifecycle and the 405 fix

fal queue submission uses `POST`. The returned lifecycle URLs are then authoritative:

- returned `status_url`: `GET`;
- returned `response_url`: `GET`;
- returned `cancel_url`: `PUT`.

The server route does not reconstruct lifecycle paths from a model ID. It accepts only HTTPS `queue.fal.run` URLs whose request ID and action suffix match the submitted request, then forwards the correct method. This fixes the original 405 caused by posting to or rebuilding lifecycle endpoints.

Primary documentation:

- [fal queue inference](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [fal proxy setup](https://fal.ai/docs/documentation/model-apis/inference/proxy-setup)

## Export package

The ZIP is host-agnostic:

- `spritesheet.png`
- `hatch.png`
- `pet.json`
- `manifest.json`
- `sprite-pet.js`
- `index.html`
- `README.md`

The manifest defines atlas geometry, pivots, clip timing, loop behavior and one-shot transitions. The dependency-free runtime plays hatch once, switches to idle and exposes named states for app integration.
