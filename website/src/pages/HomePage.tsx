const benchmarkRows = [
  {
    label: "Counter update",
    hel: "30.8k hz",
    compare: "Solid 32.6k / Vue 12.0k / React 6.4k",
  },
  {
    label: "Table update",
    hel: "277.9 hz",
    compare: "naive DOM 260.3 / Vue 151.8 / React 44.8",
  },
  {
    label: "List toggle",
    hel: "402.4 hz",
    compare: "Solid 518.1 / Vue 308.8 / React 134.8",
  },
];

const launchSteps = [
  {
    title: "Install the package",
    body: "Use the starter or wire Hel into a small Vite app in a few files.",
  },
  {
    title: "Write normal components",
    body: "Use let, helper functions, and JSX without dragging signal APIs through user code.",
  },
  {
    title: "Scale deliberately",
    body: "Add routing, context, and stores only where they make the codebase clearer.",
  },
];

const featureCards = [
  {
    label: "Reactive let",
    color: "#8af4d0",
    title: "State feels local again.",
    body: "Hel rewrites component-scoped let bindings into cells and slot updates without asking you to write runtime primitives by hand.",
  },
  {
    label: "Direct DOM",
    color: "#8fb5ff",
    title: "No virtual DOM buffer layer.",
    body: "Text, attributes, keyed lists, and retained branches each have specialized runtime paths instead of one generic renderer.",
  },
  {
    label: "Real SSR",
    color: "#ff9cd4",
    title: "Hydration is part of the design, not a demo trick.",
    body: "The framework already renders to string, marks dynamic regions, and hydrates the same structure on the client.",
  },
];

export function HomePage() {
  return (
    <section class="page-stack home-page">
      <section class="hero-panel panel-surface">
        <div class="hero-copy-stack">
          <span class="section-kicker">Cute on the surface. Ruthless under the hood.</span>
          <h1>Keep your app code plain. Let the compiler do the creepy work.</h1>
          <p class="hero-copy">
            Hel is a compiler-first JSX/TSX framework for people who like direct reactivity but do not want
            to wire `signal()`, `memo()`, and `effect()` all across user code.
          </p>

          <div class="hero-actions">
            <a class="primary-action" href="/docs">
              Get started
            </a>
            <a class="secondary-action" href="/examples">
              Live examples
            </a>
            <a class="secondary-action github-action" href="https://github.com/user/hel" target="_blank" rel="noopener">
              GitHub
            </a>
          </div>
        </div>

        <div class="hero-art panel-inset">
          <div class="hero-orb">
            <img src="/hel-192.png" alt="Hel logo" width="128" height="128" />
          </div>

          <div class="hero-note hero-note-top">
            <span class="note-label">Compiler</span>
            <strong>Transforms `let` into reactive cells and branch slots</strong>
          </div>

          <div class="hero-note hero-note-bottom">
            <span class="note-label">Runtime</span>
            <strong>Patches the real DOM, hydrates SSR output, keeps the core compact</strong>
          </div>
        </div>
      </section>

      <section class="stats-strip">
        <div class="stat-item">
          <strong>80 tests</strong>
          <span>compiler, runtime, SSR, hydration</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <strong>JSX / TSX</strong>
          <span>first-class component authoring</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <strong>~4 KB</strong>
          <span>runtime gzipped</span>
        </div>
      </section>

      <section class="feature-grid">
        {featureCards.map((card) => (
          <article class="feature-card panel-surface">
            <span class="section-kicker" style={`color: ${card.color}`}>{card.label}</span>
            <h3>{card.title}</h3>
            <p class="section-copy">{card.body}</p>
          </article>
        ))}
      </section>

      <section class="content-grid launch-grid">
        <article class="panel-surface stack-gap">
          <div>
            <span class="section-kicker">Quick start</span>
            <h2>Three steps to a real app</h2>
          </div>

          <div class="step-list">
            {launchSteps.map((step, index) => (
              <article class="step-card panel-inset">
                <span class="step-index">0{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p class="section-copy">{step.body}</p>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article class="panel-surface stack-gap">
          <div>
            <span class="section-kicker">Quick sample</span>
            <h2>Normal TypeScript in the component body</h2>
          </div>

          <pre class="code-panel compact"><code>{`// Counter.tsx — plain JSX, no signal API
export function Counter() {
  let count = 0;
  let doubled = count * 2;

  return (
    <button onClick={() => count++}>
      {count} (doubled: {doubled})
    </button>
  );
}`}</code></pre>
        </article>
      </section>

      <section class="benchmark-section panel-surface">
        <div class="section-heading-row">
          <div>
            <span class="section-kicker">Runtime posture</span>
            <h2>Fast enough to be serious, still small enough to inspect</h2>
          </div>
          <p class="section-copy benchmark-caption">
            These are current internal runtime snapshots, not marketing theater.
          </p>
        </div>

        <div class="benchmark-list">
          {benchmarkRows.map((row) => (
            <article class="benchmark-row panel-inset">
              <div>
                <strong>{row.label}</strong>
                <p>{row.compare}</p>
              </div>
              <span class="benchmark-pill">{row.hel}</span>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
