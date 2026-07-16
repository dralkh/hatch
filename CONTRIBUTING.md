# Contributing

Issues and pull requests are welcome. Before submitting a change:

```sh
npm ci
npm run lint
npm test
python3 hatch.py --self-test
```

Keep the exported atlas contract stable unless the change also updates the
manifest, browser player, CLI, tests, and README. Do not add model keys,
generated pets, local workflows, or engine tokens to the repository.
