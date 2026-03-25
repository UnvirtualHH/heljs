import type { TodoItem } from "../types";

type OverviewPageProps = {
  completionRatio: () => string;
  pendingHeadline: () => string;
  selectedTodo: () => TodoItem | null;
};

export function OverviewPage(props: OverviewPageProps) {
  return (
    <section class="route-stack">
      <section class="panel stack-gap">
        <div class="dashboard-head">
          <div>
            <span class="section-kicker">Overview</span>
            <h2>Small app, small router</h2>
          </div>
          <div class="dashboard-metric">
            <strong>{props.completionRatio()}</strong>
            <span>{props.pendingHeadline()}</span>
          </div>
        </div>

        <div class="overview-grid">
          <div class="insight-card feature-card">
            <span class="section-kicker">Current focus</span>
            <strong>{props.selectedTodo() ? props.selectedTodo()!.title : "No active task"}</strong>
            <p>
              {props.selectedTodo()
                ? props.selectedTodo()!.note || "This task has no note yet."
                : "Select a task to inspect it in detail."}
            </p>
          </div>
          <div class="insight-card feature-card">
            <span class="section-kicker">Routing MVP</span>
            <strong>Normal anchors first</strong>
            <p>
              The current demo uses plain <code>&lt;a href&gt;</code> tags. The router only
              intercepts internal links it knows about.
            </p>
          </div>
        </div>

        <div class="quick-links">
          <a class="cta-link" href="/todos">
            Open todo workspace
          </a>
          <a class="secondary-link" href="/about">
            Read the core boundaries
          </a>
        </div>
      </section>
    </section>
  );
}
