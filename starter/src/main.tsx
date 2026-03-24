import "./styles.css";
import { For, Show, createRouter, mount, store } from "hel/runtime";

type Note = {
  id: string;
  title: string;
  done: boolean;
};

const notes = store<Note[]>([
  { id: "ship", title: "Ship the starter", done: false },
  { id: "route", title: "Check route params", done: true },
]);

const router = createRouter([
  {
    path: "/",
    view: () => <OverviewPage />,
  },
  {
    path: "/notes",
    view: () => <NotesPage />,
  },
  {
    path: "/notes/:id",
    view: () => <NoteDetail id={router.params().id ?? ""} />,
  },
]);

function App() {
  return (
    <main class="shell">
      <header class="hero">
        <p class="eyebrow">hel starter</p>
        <h1>Minimal Consumer App</h1>
        <p class="copy">This app consumes the packaged framework through `hel/runtime` and `hel/vite`.</p>
      </header>

      <nav class="nav">
        <a href="/" data-active={router.isActive("/")}>Overview</a>
        <a href={router.href("/notes", { filter: "all" })} data-active={router.isActive("/notes")}>Notes</a>
      </nav>

      {router.view()}
    </main>
  );
}

function OverviewPage() {
  const openCount = () => notes.filter((note) => !note.done).length;

  return (
    <section class="panel">
      <h2>Overview</h2>
      <p>{notes.length} notes wired through packaged Hel.</p>
      <p>{openCount()} still open.</p>
    </section>
  );
}

function NotesPage() {
  const filter = () => router.query().filter ?? "all";
  const visibleNotes = () =>
    notes.filter((note) => {
      if (filter() === "done") {
        return note.done;
      }

      if (filter() === "open") {
        return !note.done;
      }

      return true;
    });

  return (
    <section class="panel">
      <div class="toolbar">
        <h2>Notes</h2>
        <div class="filters">
          <button type="button" onClick={() => router.setQuery({ filter: "all" }, { replace: true })}>All</button>
          <button type="button" onClick={() => router.setQuery({ filter: "open" }, { replace: true })}>Open</button>
          <button type="button" onClick={() => router.setQuery({ filter: "done" }, { replace: true })}>Done</button>
        </div>
      </div>

      <ul class="list">
        <For each={visibleNotes()} fallback={<li class="empty">Nothing to show.</li>} key={(note: Note) => note.id}>
          {(note: Note) => <NoteRow note={note} />}
        </For>
      </ul>
    </section>
  );
}

function NoteRow(props: { note: Note }) {
  return (
    <li class="row">
      <label>
        <input
          type="checkbox"
          checked={props.note.done}
          onChange={(event: Event) => {
            props.note.done = (event.currentTarget as HTMLInputElement).checked;
          }}
        />
        <span>{props.note.title}</span>
      </label>
      <a href={`/notes/${props.note.id}`}>Open</a>
    </li>
  );
}

function NoteDetail(props: { id: string }) {
  const note = () => notes.find((entry) => entry.id === props.id) ?? null;

  return (
    <section class="panel">
      <Show when={note()} fallback={<p>Missing note.</p>}>
        <article>
          <p class="eyebrow">detail</p>
          <h2>{note()?.title ?? "Unknown"}</h2>
          <p>Status: {note()?.done ? "done" : "open"}</p>
          <a href="/notes">Back to list</a>
        </article>
      </Show>
    </section>
  );
}

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app root");
}

mount(() => <App />, root);
