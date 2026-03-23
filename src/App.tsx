function AccentBadges() {
  return (
    <div class="badge-row">
      <span class="chip">AST transform</span>
      <span class="chip">direct DOM</span>
    </div>
  );
}

export function App() {
  let count = 0;
  let visible = true;
  let step = 1;

  function increment() {
    count += step;
  }

  function isEven() {
    return count % 2 === 0;
  }

  function parityLabel() {
    return isEven() ? "Even" : "Odd";
  }

  function nextCount() {
    return count + step;
  }

  function stepMode() {
    return step === 1 ? "Precise" : "Burst";
  }

  function recentFrames() {
    return Array.from({ length: Math.min(4, count + 1) }, (_, index) => {
      const frame = count + index * step;
      return {
        id: `${frame}-${index}`,
        label: `Frame ${index + 1}`,
        value: frame,
        state: frame % 2 === 0 ? "stable" : "volatile",
      };
    });
  }

  const ratio = () => `${count}:${step}`;
  const summary = () => `${count} clicks wired through plain functions.`;

  function renderStatus() {
    return <p class="status">Helper output: {summary()}</p>;
  }

  return (
    <main class="app">
      <header class="hero">
        <img class="hero-logo" src="/hel-192.png" alt="Hel logo" width="112" height="112" />
        <div class="hero-copy">
          <span class="eyebrow">Compiler-first UI runtime</span>
          <h1>Hel Prototype</h1>
          <p>Kein signal/memo/effect im User-Code. Nur <code>let</code>, normale TS-Funktionen und JSX.</p>
        </div>
      </header>
      <section class="chips"><AccentBadges /></section>
      <section class="actions">
        <button onClick={increment}>Count: {count}</button>
        <button onClick={() => (step = step === 1 ? 2 : 1)}>Step: {step}</button>
        <button disabled={count === 0} onClick={() => (count = 0)}>Reset</button>
        <button onClick={() => (visible = !visible)}>{visible ? "Hide" : "Show"} details</button>
      </section>
      {visible ? (
        <div class="panel">
          <strong>Reactive details</strong>
          <p>Current count is {count}.</p>
          <table class="stats-table">
            <tbody>
              <tr>
                <th>Parity</th>
                <td>{parityLabel()}</td>
              </tr>
              <tr>
                <th>Next tick</th>
                <td>{nextCount()}</td>
              </tr>
              <tr>
                <th>Step mode</th>
                <td>{stepMode()}</td>
              </tr>
              <tr>
                <th>Ratio</th>
                <td>{ratio()}</td>
              </tr>
            </tbody>
          </table>
          <div class="list-block">
            <strong>Recent frames</strong>
            <ul class="frame-list">
              {recentFrames().map((entry) => (
                <li class="frame-row" data-state={entry.state}>
                  <span class="frame-label">{entry.label}</span>
                  <span class="frame-value">{entry.value}</span>
                  <span class="frame-state">{entry.state}</span>
                </li>
              ))}
            </ul>
          </div>
          {renderStatus()}
        </div>
      ) : (
        <div class="panel muted">Details are hidden.</div>
      )}
    </main>
  );
}
