# Changelog

Hatch follows [Semantic Versioning](https://semver.org/). The project is in
public preview, so `0.x` releases may still change interfaces.

## [0.6.0] - 2026-07-18

### Added

- Endless Patrol mode with deterministic streamed rooms, combat waves,
  guardians, temporary upgrades and per-difficulty local records.
- Three cleansing weapons, visible Explorer, Adventure and Expert presets,
  enemy combat and a fourth mastery badge in the authored Beacon Rescue mode.
- A real-time public Endless Patrol leaderboard with constrained submissions,
  origin checks and network rate limits.
- Direct import of Hatch and Hermes/Petdex ZIP packages plus loose 1536×1872
  PNG or WebP runtime atlases, including locally generated hatch animations.

### Changed

- Game records now track Story and Endless results separately by difficulty,
  while retaining legacy Beacon Rescue records during migration.

## [0.5.0] - 2026-07-16

### Added

- Hermes Agent-compatible sprite exports from both the website and standalone
  CLI, using the current 8×9, 192×208-cell runtime atlas contract.
- `--package-format hatch|hermes|both` for selecting full Hatch packages,
  minimal Hermes imports or both archives from one generation.

### Changed

- Routine Dependabot update pull requests and general-purpose CI runs are
  disabled; tagged and manually dispatched container publishing remains.
- Container releases publish directly after checkout without the removed CI
  validation dependency.

## [0.4.0] - 2026-07-16

### Added

- Provider parity in `hatch.py` for OpenAI, xAI, OpenRouter and Google,
  including automatic `.env` loading, model overrides and reference edits.
- Bounded base64 response validation and PNG normalization for direct cloud
  CLI output; xAI's JPEG output is converted with Pillow when selected.
- Retry handling for cloud rate limits and transient provider failures during
  the CLI's bounded-concurrency generation phase.

## [0.3.0] - 2026-07-16

### Added

- Selectable OpenAI, xAI, OpenRouter and Google image-generation providers in
  the web app, alongside fal and configured local engines.
- Memory-only browser key entry plus optional runtime server secrets and model
  overrides for every cloud provider.
- A bounded, same-origin cloud proxy that normalizes provider generation and
  reference-edit responses into Hatch's local processing pipeline.
- Direct-browser ComfyUI and InvokeAI choices on the hosted site for engines
  that explicitly allow the Hatch origin through CORS.
- Memory-only local endpoint, bearer token, workflow and output-node controls,
  while retaining the self-hosted Hatch server-proxy mode.

## [0.2.0] - 2026-07-16

### Added

- Self-hosted web generation through ComfyUI or InvokeAI, selected directly
  in the Hatch interface.
- Server-mounted workflow defaults plus paired browser workflow overrides for
  text and reference-edit jobs.
- Bounded, same-origin local-engine proxy routes with normalized upload,
  submit, status and PNG-result handling.
- Provider metadata in portable pet packages and local history.

### Changed

- Self-hosted Hatch prefers a configured local engine, while the public
  `hatch.amayx.com` deployment remains fal-only.
- Web, Docker and environment documentation now cover local GPU engines.

### Security

- Local endpoint URLs and bearer tokens stay server-side and are never sent
  to the browser or included in exported packages.
- Workflow and image requests use strict size limits, same-origin checks,
  validated job identifiers and PNG signature validation.

## [0.1.0] - 2026-07-16

### Added

- Live Hatch web app with secured fal queue and generated-asset proxies.
- Dependency-free Python CLI for fal, ComfyUI and InvokeAI workflows.
- Deterministic 57-frame runtime atlas and 24-frame hatch export contract.
- Portable Canvas player, local pet history and Beacon Rescue validation game.
- Docker deployment, CI validation and multi-platform GHCR preview images.

### Security

- Credentials remain in process or page memory and are never persisted.
- Queue lifecycle and generated-asset URLs are constrained before fetching.
- Local engine tokens remain inside the CLI process.

[0.6.0]: https://github.com/dralkh/hatch/releases/tag/v0.6.0
[0.5.0]: https://github.com/dralkh/hatch/releases/tag/v0.5.0
[0.4.0]: https://github.com/dralkh/hatch/releases/tag/v0.4.0
[0.3.0]: https://github.com/dralkh/hatch/releases/tag/v0.3.0
[0.2.0]: https://github.com/dralkh/hatch/releases/tag/v0.2.0
[0.1.0]: https://github.com/dralkh/hatch/releases/tag/v0.1.0
