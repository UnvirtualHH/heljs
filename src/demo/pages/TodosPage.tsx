import { For, Show } from "hel/runtime";
import type { TodoFilter, TodoItem, TodoPriority } from "../types";

type TodosPageProps = {
  state: {
    draft: string;
    filter: TodoFilter;
    selectedId: string;
    todos: TodoItem[];
  };
  completionRatio: () => string;
  pendingHeadline: () => string;
  completedTodos: () => number;
  openTodos: () => number;
  filteredTodos: () => TodoItem[];
  selectedTodo: () => TodoItem | null;
  hasSelection: () => boolean;
  selectedStatus: () => string;
  addTodo: (event: Event) => void;
  setFilter: (filter: TodoFilter) => void;
  selectTodo: (id: string) => void;
  toggleTodo: (id: string, done: boolean) => void;
  renameTodo: (id: string, title: string) => void;
  changePriority: (id: string, priority: TodoPriority) => void;
  changeNote: (id: string, note: string) => void;
  removeTodo: (id: string) => void;
};

function TodoCard(props: {
  todo: TodoItem;
  selectedId: string;
  selectTodo: (id: string) => void;
  toggleTodo: (id: string, done: boolean) => void;
  renameTodo: (id: string, title: string) => void;
}) {
  const todo = props.todo;

  return (
    <article
      class="todo-card"
      data-selected={todo.id === props.selectedId}
      data-done={todo.done}
      data-priority={todo.priority}
    >
      <div class="todo-card-top">
        <label class="todo-toggle">
          <input
            type="checkbox"
            checked={todo.done}
            onChange={(event: Event) => {
              props.toggleTodo(todo.id, (event.currentTarget as HTMLInputElement).checked);
            }}
          />
          <span>{todo.done ? "Done" : "Open"}</span>
        </label>
        <button class="ghost-button" type="button" onClick={() => props.selectTodo(todo.id)}>
          {todo.id === props.selectedId ? "Selected" : "Details"}
        </button>
      </div>
      <input
        class="todo-title"
        type="text"
        value={todo.title}
        onFocus={() => props.selectTodo(todo.id)}
        onInput={(event: Event) => {
          props.renameTodo(todo.id, (event.currentTarget as HTMLInputElement).value);
        }}
      />
      <div class="todo-card-bottom">
        <span class="priority-pill">{todo.priority}</span>
        <span class="todo-date">{todo.createdAt}</span>
      </div>
    </article>
  );
}

export function TodosPage(props: TodosPageProps) {
  const renderTodo = (todo: TodoItem) => (
    <TodoCard
      todo={todo}
      selectedId={props.state.selectedId}
      selectTodo={props.selectTodo}
      toggleTodo={props.toggleTodo}
      renameTodo={props.renameTodo}
    />
  );

  return (
    <section class="dashboard-grid">
      <section class="panel stack-gap">
        <div class="dashboard-head">
          <div>
            <span class="section-kicker">Workspace</span>
            <h2>Focused backlog</h2>
          </div>
          <div class="dashboard-metric">
            <strong>{props.completionRatio()}</strong>
            <span>{props.pendingHeadline()}</span>
          </div>
        </div>

        <form class="todo-form" onSubmit={props.addTodo}>
          <input
            class="todo-input"
            type="text"
            placeholder="Add a task for Hel"
            required
            value={props.state.draft}
            onInput={(event: Event) => {
              props.state.draft = (event.currentTarget as HTMLInputElement).value;
            }}
          />
          <button class="todo-add" type="submit">
            Add task
          </button>
        </form>

        <div class="toolbar-row">
          <div class="filter-row">
            <button
              class="filter-button"
              data-active={props.state.filter === "all"}
              type="button"
              onClick={() => props.setFilter("all")}
            >
              All ({props.state.todos.length})
            </button>
            <button
              class="filter-button"
              data-active={props.state.filter === "open"}
              type="button"
              onClick={() => props.setFilter("open")}
            >
              Open ({props.openTodos()})
            </button>
            <button
              class="filter-button"
              data-active={props.state.filter === "done"}
              type="button"
              onClick={() => props.setFilter("done")}
            >
              Done ({props.completedTodos()})
            </button>
          </div>
          <span class="toolbar-note">State survives reloads via localStorage.</span>
        </div>

        <div class="todo-grid">
          <For
            each={props.filteredTodos()}
            key={(todo: TodoItem) => todo.id}
            fallback={
              <div class="empty-state">
                <strong>No tasks in this filter.</strong>
                <p>Switch the filter or add a new task.</p>
              </div>
            }
          >
            {renderTodo}
          </For>
        </div>
      </section>

      <aside class="panel detail-panel">
        <Show
          when={props.hasSelection()}
          fallback={
            <div class="empty-state compact">
              <strong>No task selected.</strong>
              <p>Create one or choose a task from the list.</p>
            </div>
          }
        >
          <div class="stack-gap">
            <div class="detail-head">
              <div>
                <span class="section-kicker">Inspector</span>
                <h2>{props.selectedTodo() ? props.selectedTodo()!.title : "No task"}</h2>
              </div>
              <button
                class="danger-button"
                type="button"
                disabled={!props.selectedTodo()}
                onClick={() => {
                  if (props.selectedTodo()) {
                    props.removeTodo(props.selectedTodo()!.id);
                  }
                }}
              >
                Delete
              </button>
            </div>

            <div class="detail-meta">
              <span
                class="priority-pill"
                data-priority={props.selectedTodo() ? props.selectedTodo()!.priority : "low"}
              >
                {props.selectedTodo() ? props.selectedTodo()!.priority : "low"}
              </span>
              <span class="todo-date">
                Created {props.selectedTodo() ? props.selectedTodo()!.createdAt : "-"}
              </span>
            </div>

            <label class="field-group">
              <span>Priority</span>
              <select
                value={props.selectedTodo() ? props.selectedTodo()!.priority : "medium"}
                onChange={(event: Event) => {
                  if (props.selectedTodo()) {
                    props.changePriority(
                      props.selectedTodo()!.id,
                      (event.currentTarget as HTMLSelectElement).value as TodoPriority,
                    );
                  }
                }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>

            <label class="field-group">
              <span>Notes</span>
              <textarea
                rows={7}
                value={props.selectedTodo() ? props.selectedTodo()!.note : ""}
                onInput={(event: Event) => {
                  if (props.selectedTodo()) {
                    props.changeNote(
                      props.selectedTodo()!.id,
                      (event.currentTarget as HTMLTextAreaElement).value,
                    );
                  }
                }}
              />
            </label>

            <div class="insight-grid">
              <div class="insight-card">
                <span class="section-kicker">Status</span>
                <strong>{props.selectedStatus()}</strong>
              </div>
              <div class="insight-card">
                <span class="section-kicker">Open work</span>
                <strong>{props.openTodos()}</strong>
              </div>
            </div>
          </div>
        </Show>
      </aside>
    </section>
  );
}
