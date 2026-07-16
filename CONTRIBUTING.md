# Contributing

Issues and pull requests are welcome. Use the issue forms for reproducible bugs
and proposed outcomes. Security reports belong in a private GitHub advisory,
never a public issue.

Create a focused branch from `main`, keep commits scoped, and run:

```sh
npm ci
npm run lint
npm test
python3 hatch.py --self-test
```

Keep the exported atlas contract stable unless the change also updates the
manifest, browser player, CLI, tests, and README. Do not add model keys,
generated pets, local workflows, or engine tokens to the repository.

Pull requests should explain user impact and compatibility. CI repeats the
checks above on Node.js 22.13 and Python 3.10, builds the container, and starts
it for an HTTP smoke test. Maintainers squash merged branches and delete them
after merge.

Releases use annotated Semantic Versioning tags named `vMAJOR.MINOR.PATCH`.
During the `v0.x` preview, releases and the matching `preview` container tag
may include interface changes; published version tags remain immutable.
