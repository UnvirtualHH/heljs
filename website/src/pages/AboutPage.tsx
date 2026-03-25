const coreBoundaries = [
  "Reactive local state should stay readable in plain component code.",
  "Direct DOM updates should remain inspectable and specific.",
  "SSR and hydration should be native, not bolted on through a second framework.",
  "Core should stay small enough that ecosystem layers can grow above it later.",
];

const nonGoals = [
  "A giant data framework in core",
  "Nested route loading systems for every app shape",
  "Cache-heavy orchestration layers",
  "Magic that cannot be traced back to the compiled output",
];

export function AboutPage() {
  return (
    <section class="page-stack about-page">
      <section class="page-hero panel-surface about-hero">
        <div>
          <span class="section-kicker">About Hel</span>
          <h1>A framework with fangs, not fluff.</h1>
        </div>
        <p class="hero-copy">
          Hel started from a simple frustration: Solid's runtime model is excellent, but the user
          code still ends up carrying too much explicit reactive wiring. Hel pushes more of that
          burden into the compiler while keeping the runtime legible.
        </p>
      </section>

      <section class="content-grid about-grid">
        <article class="panel-surface stack-gap">
          <div>
            <span class="section-kicker">Core principles</span>
            <h2>What belongs in Hel</h2>
          </div>
          <div class="principle-list">
            {coreBoundaries.map((item) => (
              <article class="principle-card panel-inset">
                <strong>{item}</strong>
              </article>
            ))}
          </div>
        </article>

        <article class="panel-surface stack-gap">
          <div>
            <span class="section-kicker">Non-goals</span>
            <h2>What should live above Hel</h2>
          </div>
          <ul class="plain-list accent-list">
            {nonGoals.map((item) => (
              <li>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section class="panel-surface manifesto-panel">
        <div class="manifesto-copy">
          <span class="section-kicker">Positioning</span>
          <h2>Small core first. Heavier ecosystem later.</h2>
          <p class="section-copy">
            Hel does not need to become an all-in-one platform to be useful. It needs a tight core,
            a coherent compiler story, and enough runtime structure that other layers can trust it.
          </p>
        </div>
        <div class="manifesto-mark panel-inset">
          <img src="/hel-192.png" alt="Hel logo" width="96" height="96" />
          <strong>Playful identity, serious internals.</strong>
        </div>
      </section>
    </section>
  );
}
