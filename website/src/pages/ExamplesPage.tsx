import { For, Show, createContext, store, useContext } from "hel/runtime";

type PlaygroundTodo = {
  id: string;
  title: string;
  done: boolean;
};

const AuthContext = createContext({ signedIn: false, role: "guest" });

function CounterExample() {
  let count = 0;
  let step = 1;

  function increment() {
    count += step;
  }

  return (
    <article class="example-card panel-surface">
      <span class="section-kicker">Local state</span>
      <h3>Counter example</h3>
      <p class="section-copy">Plain `let` state and helper functions. No signal API in user code.</p>
      <div class="example-actions">
        <button type="button" onClick={increment}>
          Count: {count}
        </button>
        <button type="button" class="ghost-button" onClick={() => (step = step === 1 ? 5 : 1)}>
          Step: {step}
        </button>
      </div>
    </article>
  );
}

function TodoExample() {
  const todos = store<PlaygroundTodo[]>([
    { id: "claim", title: "Claim prerendered DOM", done: true },
    { id: "router", title: "Keep routing anchor-first", done: false },
    { id: "context", title: "Add minimal context", done: true },
  ]);

  const visibleTodos = () => todos.filter((todo) => !todo.done);

  return (
    <article class="example-card panel-surface">
      <span class="section-kicker">Store + lists</span>
      <h3>Todo example</h3>
      <p class="section-copy">Proxy store mutations with keyed list rendering and direct DOM updates.</p>
      <ul class="example-list">
        <For each={todos} key={(todo: PlaygroundTodo) => todo.id}>
          {(todo: PlaygroundTodo) => (
            <li class="example-list-row panel-inset">
              <label>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={(event: Event) => {
                    todo.done = (event.currentTarget as HTMLInputElement).checked;
                  }}
                />
                <span>{todo.title}</span>
              </label>
            </li>
          )}
        </For>
      </ul>
      <p class="section-copy">{visibleTodos().length} open items remain.</p>
    </article>
  );
}

function GuardedPanel() {
  const auth = useContext(AuthContext);

  return (
    <Show
      when={auth.signedIn}
      fallback={<p class="section-copy">Guest mode. Sign in to reveal the protected panel.</p>}
    >
      <p class="section-copy">
        Signed in as <strong>{auth.role}</strong>. This subtree is driven by context.
      </p>
    </Show>
  );
}

function ContextExample() {
  let signedIn = false;
  let role = "guest";

  function toggleAccess() {
    signedIn = !signedIn;
    role = signedIn ? "admin" : "guest";
  }

  return (
    <article class="example-card panel-surface">
      <span class="section-kicker">Context</span>
      <h3>Guarded subtree</h3>
      <p class="section-copy">Enough shared state for auth-like flows without bloating the core router.</p>
      <AuthContext.Provider value={{ signedIn, role }}>
        <div class="example-actions">
          <button type="button" onClick={toggleAccess}>
            {signedIn ? "Sign out" : "Sign in"}
          </button>
        </div>
        <div class="guard-box panel-inset">
          <GuardedPanel />
        </div>
      </AuthContext.Provider>
    </article>
  );
}

const exampleMeta = [
  {
    title: "Counter",
    body: "Shows plain local state and helper reads.",
  },
  {
    title: "Todo list",
    body: "Shows proxy store mutation and keyed rendering.",
  },
  {
    title: "Guarded panel",
    body: "Shows minimal context for auth-shaped state.",
  },
];

export function ExamplesPage() {
  return (
    <section class="page-stack examples-page">
      <section class="page-hero panel-surface">
        <div>
          <span class="section-kicker">Examples</span>
          <h1>Live examples. Small, honest, and already interactive.</h1>
        </div>
        <p class="hero-copy">
          This site should prove that Hel can render real UI, not just host markdown about itself.
        </p>
      </section>

      <section class="example-meta-grid">
        {exampleMeta.map((item) => (
          <article class="panel-inset example-meta-card">
            <strong>{item.title}</strong>
            <p class="section-copy">{item.body}</p>
          </article>
        ))}
      </section>

      <section class="examples-grid examples-grid-wide">
        <CounterExample />
        <TodoExample />
        <ContextExample />
      </section>
    </section>
  );
}
