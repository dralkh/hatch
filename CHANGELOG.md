# Changelog

Hatch follows [Semantic Versioning](https://semver.org/). The project is in
public preview, so `0.x` releases may still change interfaces.

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

[0.1.0]: https://github.com/dralkh/hatch/releases/tag/v0.1.0
