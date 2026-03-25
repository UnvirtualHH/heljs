const docSections = [
  {
    label: "Core reactivity",
    title: "Use local let state, not a user-facing signal ceremony.",
    body: "Hel rewrites component-scoped let bindings into cells. Helper functions can read that state without turning your whole component into manual reactive wiring.",
    code: `function Counter() {\n  let count = 0;\n  const parity = () => (count % 2 === 0 ? "even" : "odd");\n\n  return <button onClick={() => count++}>Count: {count} ({parity()})</button>;\n}`,
  },
  {
    label: "Rendering model",
    title: "Patch the real DOM through specialized slots.",
    body: "Hel emits dedicated runtime paths for text, attributes, conditionals, retained branches, and keyed lists. That is why the core can stay small and still perform like a serious system.",
    code: `<For each={todos} key={(todo) => todo.id}>\n  {(todo) => <TodoRow todo={todo} />}\n</For>`,
  },
  {
    label: "Routing",
    title: "Anchor-first navigation with params and query state.",
    body: "The built-in router intentionally stays small: normal anchors, route params, query helpers, and history navigation. No giant data router in core.",
    code: `const router = createRouter([\n  { path: "/", view: () => <HomePage /> },\n  { path: "/docs/:slug", view: () => <DocPage slug={router.params().slug} /> },\n]);`,
  },
  {
    label: "Context",
    title: "Enough global wiring for auth, theme, and shell state.",
    body: "Context exists for subtree composition, not to turn Hel into a service locator. That keeps it useful without letting it swell into framework soup.",
    code: `const AuthContext = createContext({ role: "guest" });\n\n<AuthContext.Provider value={{ role: "admin" }}>\n  <GuardedArea />\n</AuthContext.Provider>`,
  },
];

const nextReads = [
  "Getting Started",
  "API Reference",
  "SSR and Hydration",
  "Limits and Non-Goals",
];

export function DocsPage() {
  return (
    <section class="page-stack docs-page">
      <section class="page-hero panel-surface">
        <div>
          <span class="section-kicker">Documentation</span>
          <h1>Small API surface. Clear boundaries. No fake simplicity.</h1>
        </div>
        <p class="hero-copy">
          Hel should feel easy because the model is coherent, not because the framework hides its
          costs behind a giant black box.
        </p>
      </section>

      <section class="docs-grid docs-grid-wide">
        {docSections.map((section) => (
          <article class="panel-surface stack-gap docs-card">
            <div>
              <span class="section-kicker">{section.label}</span>
              <h3>{section.title}</h3>
            </div>
            <p class="section-copy">{section.body}</p>
            <pre class="code-panel compact"><code>{section.code}</code></pre>
          </article>
        ))}
      </section>

      <section class="content-grid docs-summary-grid">
        <article class="panel-surface stack-gap">
          <div>
            <span class="section-kicker">Already in core</span>
            <h2>What Hel already handles</h2>
          </div>
          <ul class="plain-list accent-list">
            <li>reactive component-scoped let state</li>
            <li>direct DOM runtime without a virtual DOM</li>
            <li>SSR string rendering and hydration</li>
            <li>small router with params, query state, and history navigation</li>
            <li>proxy store, context, keyed lists, Show, and For</li>
          </ul>
        </article>

        <article class="panel-surface stack-gap">
          <div>
            <span class="section-kicker">Read next</span>
            <h2>The rest of the docs set</h2>
          </div>
          <div class="doc-link-grid">
            {nextReads.map((title) => (
              <article class="doc-link-card panel-inset">
                <strong>{title}</strong>
                <p class="section-copy">Find the deeper design notes in the markdown docs shipped with the repo.</p>
              </article>
            ))}
          </div>
        </article>
      </section>
    </section>
  );
}
