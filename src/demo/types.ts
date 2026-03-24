export type TodoFilter = "all" | "open" | "done";
export type TodoPriority = "low" | "medium" | "high";

export type TodoItem = {
  id: string;
  title: string;
  done: boolean;
  priority: TodoPriority;
  note: string;
  createdAt: string;
};

export type TodoStore = {
  draft: string;
  filter: TodoFilter;
  selectedId: string;
  todos: TodoItem[];
};
