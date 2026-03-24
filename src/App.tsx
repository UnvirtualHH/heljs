import { For, Show } from "@hel/runtime";

function AccentBadges() {
  return (
    <div class="badge-row">
      <span class="chip">AST transform</span>
      <span class="chip">direct DOM</span>
      <span class="chip">keyed lists</span>
    </div>
  );
}

type TodoItem = {
  title: string;
  done: boolean;
};

export function App() {
  let count = 0;
  let visible = true;
  let step = 1;
  let newTitle = "";
  let todos: TodoItem[] = [
    { title: "Claim prerendered DOM", done: true },
    { title: "Patch dynamic text slots", done: true },
    { title: "Build keyed list diff", done: false },
  ];

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

  const completedTodos = () => todos.filter((todo) => todo.done).length;
  const remainingTodos = () => todos.length - completedTodos();

  function addTodo(event: Event) {
    event.preventDefault();

    const title = newTitle.trim();
    if (!title) {
      return;
    }

    todos = [...todos, { title, done: false }];
    newTitle = "";
  }

  function toggleTodo(index: number, done: boolean) {
    todos = todos.map((todo, currentIndex) =>
      currentIndex === index ? { ...todo, done } : todo,
    );
  }

  function renameTodo(index: number, title: string) {
    todos = todos.map((todo, currentIndex) =>
      currentIndex === index ? { ...todo, title } : todo,
    );
  }

  function removeTodo(index: number) {
    todos = todos.filter((_, currentIndex) => currentIndex !== index);
  }

  const ratio = () => `${count}:${step}`;
  const summary = () => `${count} clicks wired through plain functions.`;

  function renderStatus() {
    return <p class="status">Helper output: {summary()}</p>;
  }

  return (
    <main class="app">
      <header class="hero">
        <img
          class="hero-logo"
          src="/hel-192.png"
          alt="Hel logo"
          width="112"
          height="112"
        />
        <div class="hero-copy">
          <span class="eyebrow">Compiler-first UI runtime</span>
          <h1>Hel Prototype</h1>
          <p>
            Kein signal/memo/effect im User-Code. Nur <code>let</code>, normale
            TS-Funktionen und JSX.
          </p>
        </div>
      </header>
      <section class="chips">
        <AccentBadges />
      </section>
      <section class="actions">
        <button onClick={increment}>Count: {count}</button>
        <button onClick={() => (step = step === 1 ? 2 : 1)}>
          Step: {step}
        </button>
        <button disabled={count === 0} onClick={() => (count = 0)}>
          Reset
        </button>
        <button onClick={() => (visible = !visible)}>
          {visible ? "Hide" : "Show"} details
        </button>
      </section>
      <Show when={visible} fallback={<div class="panel muted">Details are hidden.</div>}>
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
              <For
                each={recentFrames()}
                key={(entry: ReturnType<typeof recentFrames>[number]) => entry.id}
              >
                {(entry: ReturnType<typeof recentFrames>[number]) => (
                  <li class="frame-row" data-state={entry.state}>
                    <span class="frame-label">{entry.label}</span>
                    <span class="frame-value">{entry.value}</span>
                    <span class="frame-state">{entry.state}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
          <div class="todo-block">
            <div class="todo-header">
              <strong>Todos in plain Hel</strong>
              <span class="todo-meta">
                {completedTodos()}/{todos.length} done, {remainingTodos()} open
              </span>
            </div>
            <form class="todo-form" onSubmit={addTodo}>
              <input
                class="todo-input"
                type="text"
                placeholder="enter todo and click +"
                required
                value={newTitle}
                onInput={(event: Event) => {
                  newTitle = (event.currentTarget as HTMLInputElement).value;
                }}
              />
              <button class="todo-add" type="submit">
                +
              </button>
            </form>
            <div class="todo-list">
              <For each={todos}>
                {(todo: TodoItem, index: number) => (
                  <div class="todo-row" data-done={todo.done}>
                    <input
                      type="checkbox"
                      checked={todo.done}
                      onChange={(event: Event) => {
                        toggleTodo(
                          index,
                          (event.currentTarget as HTMLInputElement).checked,
                        );
                      }}
                    />
                    <input
                      class="todo-title"
                      type="text"
                      value={todo.title}
                      onInput={(event: Event) => {
                        renameTodo(
                          index,
                          (event.currentTarget as HTMLInputElement).value,
                        );
                      }}
                    />
                    <button
                      class="todo-remove"
                      type="button"
                      onClick={() => removeTodo(index)}
                    >
                      x
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
          {renderStatus()}
        </div>
      </Show>
    </main>
  );
}
