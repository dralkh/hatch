# Changelog

Hatch follows [Semantic Versioning](https://semver.org/). The project is in
public preview, so `0.x` releases may still change interfaces.

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

[0.2.0]: https://github.com/dralkh/hatch/releases/tag/v0.2.0
[0.1.0]: https://github.com/dralkh/hatch/releases/tag/v0.1.0
