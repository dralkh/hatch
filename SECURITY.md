# Security

Please report a suspected vulnerability privately through GitHub's security
advisory form instead of opening a public issue.

Hatchframe never persists generation credentials in browser storage. For a
shared deployment, store `FAL_KEY` as a Cloudflare Worker secret. Never commit
keys, exported browser data, or local engine tokens.

The fal proxy only permits the two documented FLUX endpoints, validates queue
lifecycle URLs, and disables response caching. The generated-asset proxy uses
an explicit host allowlist and size limits.
