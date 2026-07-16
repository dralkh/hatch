import Image from "next/image";
import SpriteLab from "./sprite-lab";

const modelRows = [
  {
    role: "Hosted path",
    models: "fal · FLUX.2 [klein] 9B",
    fit: "The browser-ready route uses one identity anchor and small reference edits, with queue URLs validated by the Worker proxy.",
    price: "≈ $0.43 / pet",
    href: "https://fal.ai/models/fal-ai/flux-2/klein/9b/api",
  },
  {
    role: "Local path",
    models: "ComfyUI native API",
    fit: "hatch.py fills an exported API workflow, uploads the identity anchor, submits /prompt, polls history and retrieves the final image directly.",
    price: "$0 API cost",
    href: "https://docs.comfy.org/development/comfyui-server/api-examples",
  },
  {
    role: "Local path",
    models: "InvokeAI graph queue",
    fit: "hatch.py uploads the anchor, enqueues an executable graph, polls its queue item and downloads the image output from the local instance.",
    price: "$0 API cost",
    href: "https://github.com/invoke-ai/InvokeAI/blob/main/docs/src/content/docs/development/Guides/workflow-api.mdx",
  },
  {
    role: "Transparent output",
    models: "Local chroma matte",
    fit: "A strict #FF00FF field is removed in the browser with soft edges and despill. No paid cleanup model is required.",
    price: "$0",
    href: "#workflow",
  },
  {
    role: "24-frame hatch",
    models: "Deterministic Canvas composer",
    fit: "The generated egg wobbles, bursts and reveals the locked pet over exactly 24 exportable frames—without a video bill.",
    price: "$0",
    href: "#workflow",
  },
  {
    role: "Portable output",
    models: "Canvas player + game",
    fit: "Every completed pet is previewed as live actions, kept in private browser history and playable in a three-zone beacon rescue adventure.",
    price: "$0",
    href: "#lab",
  },
];

const contract = [
  ["Runtime", "57 populated frames"],
  ["Hatch", "24 populated frames"],
  ["Cell", "192 × 208 px"],
  ["Runtime atlas", "1536 × 1872 px"],
  ["Hatch atlas", "1536 × 624 px"],
  ["Engine cost", "fal ≈ $0.43 · local API $0"],
];

export default function Home() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Hatch home">
          <span className="brand-orbit" aria-hidden="true"><i /></span>
          <span>Hatch</span>
        </a>
        <nav aria-label="Page sections">
          <a href="#lab">Generator</a>
          <a href="#workflow">Method</a>
          <a href="#models">Cost</a>
          <a href="#sources">Docs</a>
        </nav>
        <a className="source-pill" href="https://github.com/dralkh/hatch" target="_blank" rel="noreferrer">
          <span className="source-pill-label">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
              <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.95 10.95 0 0 1 5.75 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
            </svg>
            <span>View source</span>
          </span>
          <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span>Pixel-first</span> animation kit generator</p>
          <h1>Make a tiny friend.<br /><em>Keep every frame.</em></h1>
          <p className="hero-lede">
            Meet Nibi, our round little moon-moth kitten. Start with this original mascot or describe a completely different cute creature. Hatch locks its identity, builds 81 transparent pixel frames, remembers past hatches locally and proves each pet inside the Beacon Rescue adventure.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#lab">Hatch a pet <span aria-hidden="true">→</span></a>
            <a className="button quiet" href="#models">Choose hosted or local</a>
          </div>
          <div className="hero-proof" aria-label="Pipeline summary">
            <div><strong>3</strong><span>engine paths</span></div>
            <div><strong>81</strong><span>live frames</span></div>
            <div><strong>0</strong><span>video jobs</span></div>
          </div>
        </div>

        <div className="hero-pixel-stage" aria-label="Nibi, an original pixel moon-moth kitten mascot, with a hatching egg and a cheerful pose">
          <div className="stage-topline"><span>NIBI / IDLE</span><span>FRAME 01 / 06</span></div>
          <div className="pixel-grid" aria-hidden="true" />
          <Image className="hero-nibi" src="/art/nibi-idle.png" alt="Nibi, a mint pixel-art moon-moth kitten with lavender antennae" width={1024} height={1024} priority unoptimized />
          <div className="pose-card">
            <span>WAVE / 03</span>
            <Image src="/art/nibi-cheer.png" alt="Nibi in a cheerful raised-paws pixel pose" width={1024} height={1024} priority unoptimized />
          </div>
          <div className="pixel-egg-card">
            <Image src="/art/nibi-egg.png" alt="Nibi's cream and mint pixel hatching egg" width={1024} height={1024} priority unoptimized />
            <span>24-frame hatch</span>
          </div>
          <div className="hero-frame-count"><b>81</b><span>ready-to-play<br />pixel frames</span></div>
        </div>
      </section>

      <section className="marquee" aria-label="Product capabilities">
        <div>ONE IDENTITY <i /> NINE STATES <i /> TWENTY-FOUR FRAME HATCH <i /> TRANSPARENT PNG <i /> PORTABLE RUNTIME</div>
      </section>

      <section className="lab-section" id="lab">
        <div className="section-kicker">The working forge</div>
        <div className="section-heading split-heading">
          <div>
            <p className="section-number">01</p>
            <h2>One idea.<br />A complete living pet.</h2>
          </div>
          <p>
            The hosted page keeps a fal key in memory only. The standalone Python workflow can instead talk directly to ComfyUI or InvokeAI on your own machine. Every path uses the same prompt hardening and deterministic atlas contract.
          </p>
        </div>
        <SpriteLab />
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-kicker dark">Built to survive messy prompts</div>
        <div className="section-heading dark split-heading">
          <div>
            <p className="section-number">02</p>
            <h2>Creative where it matters.<br />Exact where it counts.</h2>
          </div>
          <p>Your chosen model invents the creature and poses. Hatch owns identity wording, alpha removal, subject extraction, state order, mirroring, pivots, cells, quality gates, local history and playback.</p>
        </div>

        <div className="creature-showcase">
          <article className="showcase-card cyan">
            <div><span>Identity lock / 01</span><h3>One mascot,<br />many moods.</h3><p>Nibi keeps the same mint body, cream face, lavender antennae, leaf wings and star-tail in every state.</p></div>
            <Image src="/art/nibi-idle.png" alt="Nibi's consistent idle pixel-art identity" width={1024} height={1024} unoptimized />
          </article>
          <article className="showcase-card green">
            <div><span>Motion lock / 02</span><h3>Alive without<br />losing the design.</h3><p>Each tiny pose changes the gesture, not the character. Crisp clusters and a limited palette stay readable at app scale.</p></div>
            <Image src="/art/nibi-cheer.png" alt="Nibi's cheerful pixel-art pose" width={1024} height={1024} unoptimized />
          </article>
        </div>

        <div className="workflow-grid">
          <article className="workflow-card feature"><span className="card-index">01</span><h3>Clarify the creature</h3><p>Comma-separated animals become one hybrid. Color lists become primary and accent palettes. The prompt forbids separate creatures and repeated anatomy.</p></article>
          <article className="workflow-card"><span className="card-index">02</span><h3>Lock identity once</h3><p>A square anchor defines anatomy, markings and camera. Every motion row and egg reuses the exact source image through fal, ComfyUI or InvokeAI.</p></article>
          <article className="workflow-card"><span className="card-index">03</span><h3>Remove alpha locally</h3><p>A uniform magenta field is converted to soft transparency in the browser. Border sampling, despill and coverage checks reject unusable backgrounds.</p></article>
          <article className="workflow-card"><span className="card-index">04</span><h3>Pack, remember, play</h3><p>Exact cells and a coded hatch produce deterministic exports. IndexedDB keeps past pets on-device, while the action wall and three-zone adventure verify that every atlas moves.</p></article>
        </div>

        <div className="contract-panel">
          <div>
            <p className="eyebrow orange">The Hatch contract</p>
            <h3>Prompts can bend.<br />Geometry cannot.</h3>
            <p className="contract-copy">Nine reusable activity states and one onboarding hatch sequence ship as two transparent, app-agnostic atlases with a tiny dependency-free Canvas player.</p>
          </div>
          <dl>{contract.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
        </div>
      </section>

      <section className="models-section" id="models">
        <div className="section-kicker">The engine stack</div>
        <div className="section-heading split-heading">
          <div><p className="section-number">03</p><h2>Bring a key.<br />Or bring a GPU.</h2></div>
          <p>FLUX.2 [klein] 9B on fal remains the zero-setup web default. ComfyUI and InvokeAI users can run their own checkpoint through exported workflow templates and keep prompts, source images and model execution on their machine.</p>
        </div>
        <div className="savings-banner"><strong>3 paths</strong><span>one exact sprite contract</span><p>fal hosted</p><i aria-hidden="true">·</i><p>ComfyUI / InvokeAI local</p></div>
        <div className="model-table" role="table" aria-label="Hatch model workflow">
          <div className="model-row model-head" role="row"><span role="columnheader">Stage</span><span role="columnheader">Engine</span><span role="columnheader">Why it is here</span><span role="columnheader">Listed cost</span><span aria-hidden="true" /></div>
          {modelRows.map((row) => (
            <a className="model-row" role="row" href={row.href} target={row.href.startsWith("http") ? "_blank" : undefined} rel={row.href.startsWith("http") ? "noreferrer" : undefined} key={row.role}>
              <strong role="cell">{row.role}</strong><span role="cell">{row.models}</span><span role="cell">{row.fit}</span><b role="cell">{row.price}</b><span className="row-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      <section className="sources-section" id="sources">
        <div><p className="eyebrow pale">Official references · 16 July 2026</p><h2>Inspect the exact<br />APIs behind it.</h2></div>
        <div className="source-links">
          <a href="https://github.com/dralkh/hatch" target="_blank" rel="noreferrer"><span>Hatch source code</span><b>GitHub repository ↗</b></a>
          <a href="https://fal.ai/models/fal-ai/flux-2/klein/9b/api" target="_blank" rel="noreferrer"><span>FLUX.2 [klein] 9B</span><b>Text to image · $0.006/MP ↗</b></a>
          <a href="https://fal.ai/models/fal-ai/flux-2/klein/9b/edit/api" target="_blank" rel="noreferrer"><span>FLUX.2 [klein] 9B Edit</span><b>Reference editing · fast four-step ↗</b></a>
          <a href="https://fal.ai/docs/documentation/model-apis/inference/queue" target="_blank" rel="noreferrer"><span>fal asynchronous inference</span><b>Lifecycle URLs + HTTP methods ↗</b></a>
          <a href="https://fal.ai/docs/documentation/model-apis/inference/proxy-setup" target="_blank" rel="noreferrer"><span>fal proxy setup</span><b>Server-side credential boundary ↗</b></a>
          <a href="https://docs.comfy.org/development/comfyui-server/api-examples" target="_blank" rel="noreferrer"><span>ComfyUI Server API</span><b>Workflow export · prompt · history ↗</b></a>
          <a href="https://github.com/invoke-ai/InvokeAI/blob/main/docs/src/content/docs/development/Guides/workflow-api.mdx" target="_blank" rel="noreferrer"><span>InvokeAI Workflow Execution API</span><b>Graph queue · image output ↗</b></a>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-orbit" aria-hidden="true"><i /></span><span>Hatch</span></div>
        <p>From a rough creature idea to 81 transparent, playable frames.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
