import type { TodoItem, TodoStore } from "./types";

export const STORAGE_KEY = "hel.todo-demo.v1";

export function createId() {
  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function todayLabel() {
  return new Date().toISOString().slice(0, 10);
}

export function createSeedTodos(): TodoItem[] {
  return [
    {
      id: "claim-dom",
      title: "Claim prerendered DOM without duplicate roots",
      done: true,
      priority: "high",
      note: "Hydration path is stable enough for a real demo app now.",
      createdAt: "2026-03-18",
    },
    {
      id: "shape-store",
      title: "Harden the local store semantics",
      done: false,
      priority: "medium",
      note: "Current store is intentionally coarse-grained but already useful.",
      createdAt: "2026-03-22",
    },
    {
      id: "explore-routing",
      title: "Sketch the first routing story",
      done: false,
      priority: "low",
      note: "Next step after this demo app is a minimal router with nested views.",
      createdAt: "2026-03-24",
    },
  ];
}

export function readInitialState(): TodoStore {
  const base = {
    draft: "",
    filter: "all" as TodoStore["filter"],
    selectedId: "claim-dom",
    todos: createSeedTodos(),
  };

  if (typeof window === "undefined") {
    return base;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return base;
    }

    const parsed = JSON.parse(raw) as Partial<TodoStore>;
    const todos = Array.isArray(parsed.todos) ? parsed.todos : base.todos;
    const selectedId =
      typeof parsed.selectedId === "string" && todos.some((todo) => todo.id === parsed.selectedId)
        ? parsed.selectedId
        : todos[0]?.id ?? "";

    return {
      draft: typeof parsed.draft === "string" ? parsed.draft : "",
      filter:
        parsed.filter === "open" || parsed.filter === "done" || parsed.filter === "all"
          ? parsed.filter
          : "all",
      selectedId,
      todos,
    };
  } catch {
    return base;
  }
}
