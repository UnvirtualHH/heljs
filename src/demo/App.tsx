import { createRouter, store } from "@hel/runtime";
import { readInitialState, STORAGE_KEY, createId, todayLabel } from "./data";
import { AccentBadges } from "./components/AccentBadges";
import { AboutPage } from "./pages/AboutPage";
import { OverviewPage } from "./pages/OverviewPage";
import { TodosPage } from "./pages/TodosPage";
import type { TodoFilter, TodoItem, TodoPriority, TodoStore } from "./types";

export function App() {
  const state = store<TodoStore>(readInitialState());

  function normalizeFilterQuery(filter?: string): TodoFilter {
    return filter === "open" || filter === "done" ? filter : "all";
  }

  function persist() {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        draft: state.draft,
        filter: state.filter,
        selectedId: state.selectedId,
        todos: state.todos,
      }),
    );
  }

  function completedTodos() {
    return state.todos.filter((todo) => todo.done).length;
  }

  function openTodos() {
    return state.todos.length - completedTodos();
  }

  function filteredTodos() {
    if (state.filter === "open") {
      return state.todos.filter((todo) => !todo.done);
    }

    if (state.filter === "done") {
      return state.todos.filter((todo) => todo.done);
    }

    return state.todos;
  }

  function selectedTodo() {
    return state.todos.find((todo) => todo.id === state.selectedId) ?? null;
  }

  function hasSelection() {
    return state.selectedId !== "";
  }

  function completionRatio() {
    if (state.todos.length === 0) {
      return "0% done";
    }

    return `${Math.round((completedTodos() / state.todos.length) * 100)}% done`;
  }

  function pendingHeadline() {
    return openTodos() === 1 ? "1 item needs work" : `${openTodos()} items need work`;
  }

  function selectedStatus() {
    return selectedTodo() && selectedTodo()!.done ? "Ready" : "In progress";
  }

  function syncSelectionFromRoute(routeTodoId?: string) {
    state.filter = normalizeFilterQuery(router.query().filter);

    if (!routeTodoId) {
      if (!state.selectedId && state.todos[0]) {
        state.selectedId = state.todos[0].id;
      }
      return;
    }

    const exists = state.todos.some((todo) => todo.id === routeTodoId);
    state.selectedId = exists ? routeTodoId : "";
  }

  function addTodo(event: Event) {
    event.preventDefault();

    const title = state.draft.trim();
    if (!title) {
      return;
    }

    const item: TodoItem = {
      id: createId(),
      title,
      done: false,
      priority: "medium",
      note: "",
      createdAt: todayLabel(),
    };

    state.todos.unshift(item);
    state.selectedId = item.id;
    state.filter = "all";
    state.draft = "";
    persist();
    router.navigate(router.href(`/todos/${encodeURIComponent(item.id)}`));
  }

  function setFilter(filter: TodoFilter) {
    state.filter = filter;
    persist();
    router.setQuery({ filter: filter === "all" ? null : filter }, { replace: true });
  }

  function selectTodo(id: string) {
    state.selectedId = id;
    persist();
    router.navigate(router.href(`/todos/${encodeURIComponent(id)}`, {
      filter: state.filter === "all" ? null : state.filter,
    }));
  }

  function toggleTodo(id: string, done: boolean) {
    const todo = state.todos.find((entry) => entry.id === id);
    if (!todo) {
      return;
    }

    todo.done = done;
    persist();
  }

  function renameTodo(id: string, title: string) {
    const todo = state.todos.find((entry) => entry.id === id);
    if (!todo) {
      return;
    }

    todo.title = title;
    persist();
  }

  function changePriority(id: string, priority: TodoPriority) {
    const todo = state.todos.find((entry) => entry.id === id);
    if (!todo) {
      return;
    }

    todo.priority = priority;
    persist();
  }

  function changeNote(id: string, note: string) {
    const todo = state.todos.find((entry) => entry.id === id);
    if (!todo) {
      return;
    }

    todo.note = note;
    persist();
  }

  function removeTodo(id: string) {
    const index = state.todos.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return;
    }

    state.todos.splice(index, 1);

    if (state.selectedId === id) {
      const nextId = state.todos[0]?.id ?? "";
      state.selectedId = nextId;
      router.navigate(
        nextId
          ? router.href(`/todos/${encodeURIComponent(nextId)}`, {
              filter: state.filter === "all" ? null : state.filter,
            })
          : router.href("/todos", {
              filter: state.filter === "all" ? null : state.filter,
            }),
        { replace: true },
      );
    }

    persist();
  }

  const router = createRouter([
    {
      path: "/",
      view: () => (
        <OverviewPage
          completionRatio={completionRatio}
          pendingHeadline={pendingHeadline}
          selectedTodo={selectedTodo}
        />
      ),
    },
    {
      path: "/todos",
      view: () => {
        syncSelectionFromRoute();
        return (
          <TodosPage
            state={state}
            completionRatio={completionRatio}
            pendingHeadline={pendingHeadline}
            completedTodos={completedTodos}
            openTodos={openTodos}
            filteredTodos={filteredTodos}
            selectedTodo={selectedTodo}
            hasSelection={hasSelection}
            selectedStatus={selectedStatus}
            addTodo={addTodo}
            setFilter={setFilter}
            selectTodo={selectTodo}
            toggleTodo={toggleTodo}
            renameTodo={renameTodo}
            changePriority={changePriority}
            changeNote={changeNote}
            removeTodo={removeTodo}
          />
        );
      },
    },
    {
      path: "/todos/:id",
      view: () => {
        syncSelectionFromRoute(router.params().id);
        return (
          <TodosPage
            state={state}
            completionRatio={completionRatio}
            pendingHeadline={pendingHeadline}
            completedTodos={completedTodos}
            openTodos={openTodos}
            filteredTodos={filteredTodos}
            selectedTodo={selectedTodo}
            hasSelection={hasSelection}
            selectedStatus={selectedStatus}
            addTodo={addTodo}
            setFilter={setFilter}
            selectTodo={selectTodo}
            toggleTodo={toggleTodo}
            renameTodo={renameTodo}
            changePriority={changePriority}
            changeNote={changeNote}
            removeTodo={removeTodo}
          />
        );
      },
    },
    { path: "/about", view: () => <AboutPage /> },
  ]);

  return (
    <main class="app todo-app-shell">
      <header class="hero hero-dense">
        <img
          class="hero-logo"
          src="/hel-192.png"
          alt="Hel logo"
          width="112"
          height="112"
        />
        <div class="hero-copy">
          <span class="eyebrow">Compiler-first UI runtime</span>
          <h1>Hel Todo Demo</h1>
          <p>
            Kleine echte App mit <code>store()</code>, <code>For</code>, <code>Show</code>,
            einem einfachen Router und lokaler Persistenz.
          </p>
        </div>
      </header>

      <section class="chips">
        <AccentBadges />
      </section>

      <nav class="route-nav" aria-label="Primary navigation">
        <a class="route-link" data-active={router.isActive("/")} href="/">
          Overview
        </a>
        <a class="route-link" data-active={router.isActive("/todos")} href="/todos">
          Todos
        </a>
        <a class="route-link" data-active={router.isActive("/about")} href="/about">
          About
        </a>
      </nav>

      {router.view()}
    </main>
  );
}
