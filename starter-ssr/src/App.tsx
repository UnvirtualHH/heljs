import { For, Show, createRouter, store } from "hel/runtime";

type Story = {
  id: string;
  title: string;
  status: "draft" | "ready";
};

const stories = store<Story[]>([
  { id: "compiler", title: "Ship compiler-first slots", status: "ready" },
  { id: "ssr", title: "Verify SSR starter output", status: "draft" },
]);

const router = createRouter(
  [
    {
      path: "/",
      view: () => <OverviewPage />,
    },
    {
      path: "/stories",
      view: () => <StoriesPage />,
    },
    {
      path: "/stories/:id",
      view: () => <StoryPage id={router.params().id ?? ""} />,
    },
  ],
  {
    initialPath: typeof window === "undefined" ? "/stories/ssr?view=full" : undefined,
  },
);

export function App() {
  return (
    <main class="shell">
      <header class="hero">
        <p class="eyebrow">hel ssr starter</p>
        <h1>SSR Consumer Example</h1>
        <p class="copy">This project consumes `hel`, `hel/server` and `hel/vite` outside the framework workspace.</p>
      </header>

      <nav class="nav">
        <a href="/" data-active={router.isActive("/")}>Overview</a>
        <a href="/stories" data-active={router.isActive("/stories")}>Stories</a>
        <a href={router.href("/stories/ssr", { view: "full" })} data-active={router.isActive("/stories/:id")}>SSR Story</a>
      </nav>

      {router.view()}
    </main>
  );
}

function OverviewPage() {
  const ready = () => stories.filter((story) => story.status === "ready").length;

  return (
    <section class="panel">
      <h2>Overview</h2>
      <p>{stories.length} stories rendered through packaged Hel SSR.</p>
      <p>{ready()} marked ready.</p>
    </section>
  );
}

function StoriesPage() {
  return (
    <section class="panel">
      <div class="toolbar">
        <h2>Stories</h2>
        <button
          type="button"
          onClick={() => {
            stories.push({
              id: `story-${stories.length + 1}`,
              title: `Generated story ${stories.length + 1}`,
              status: "draft",
            });
          }}
        >
          Add story
        </button>
      </div>

      <ul class="list">
        <For each={stories} key={(story: Story) => story.id}>
          {(story: Story) => (
            <li class="row">
              <span>{story.title}</span>
              <a href={`/stories/${story.id}`}>Open</a>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

function StoryPage(props: { id: string }) {
  const story = () => stories.find((entry) => entry.id === props.id) ?? null;
  const mode = () => router.query().view ?? "compact";

  return (
    <section class="panel">
      <Show when={story()} fallback={<p>Missing story.</p>}>
        <article>
          <p class="eyebrow">story detail</p>
          <h2>{story()?.title ?? "Unknown"}</h2>
          <p>Status: {story()?.status ?? "missing"}</p>
          <p>View mode: {mode()}</p>
          <button
            type="button"
            onClick={() => {
              if (!story()) {
                return;
              }
              story()!.status = story()!.status === "ready" ? "draft" : "ready";
            }}
          >
            Toggle status
          </button>
        </article>
      </Show>
    </section>
  );
}
