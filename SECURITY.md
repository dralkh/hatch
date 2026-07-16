# Security

Please report a suspected vulnerability privately through GitHub's security
advisory form instead of opening a public issue.

Hatchframe never persists generation credentials in browser storage. Pasted
fal, OpenAI, xAI, OpenRouter and Google keys stay in React memory for the
current tab and travel only to the same-origin Hatch proxy. For a shared
deployment, store `FAL_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`,
`OPENROUTER_API_KEY` and `GOOGLE_API_KEY` as runtime secrets. Never commit keys,
exported browser data, or local engine tokens.

The Python CLI reads `.env.local` and `.env` into process memory without
overriding exported variables. It sends credentials only to the fixed origin
for the selected cloud provider and never includes keys or identity references
in exported pet packages.

The fal proxy only permits the two documented FLUX endpoints, validates queue
lifecycle URLs, and disables response caching. The generated-asset proxy uses
an explicit host allowlist and size limits. The cloud image proxy uses fixed
provider origins, bounded prompts and references, same-origin browser checks,
validated image formats and no-store responses.

Direct ComfyUI/InvokeAI mode is intentionally different from the proxies: the
browser sends requests to the endpoint entered by the user. That endpoint,
optional bearer token and uploaded workflow JSON remain in React memory and
are never saved in browser history or pet exports. Configure the engine's
CORS allowlist for the exact Hatch origin instead of using `*`, especially
when authorization headers are accepted. Browsers may separately require a
local-network access grant.
