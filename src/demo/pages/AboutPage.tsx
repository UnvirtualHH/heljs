export function AboutPage() {
  return (
    <section class="route-stack">
      <section class="panel stack-gap">
        <div>
          <span class="section-kicker">About Hel</span>
          <h2>Keep the core small</h2>
        </div>

        <div class="about-list">
          <article class="insight-card feature-card">
            <strong>Core responsibilities</strong>
            <p>
              Fine-grained local reactivity, direct DOM updates, SSR, hydration, simple control flow,
              and now a small anchor-first router.
            </p>
          </article>
          <article class="insight-card feature-card">
            <strong>Not in the first core</strong>
            <p>
              Deep data orchestration, complex nested routing, loaders, guards, and cache layers can sit on
              top once the base is stable.
            </p>
          </article>
          <article class="insight-card feature-card">
            <strong>Current router contract</strong>
            <p>
              Static path matching, history integration, normal anchors, route params and optional
              convenience helpers. No nested layouts yet.
            </p>
          </article>
        </div>
      </section>
    </section>
  );
}
