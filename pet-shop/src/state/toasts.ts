export type Toast = {
  id: number;
  text: string;
  kind: "info" | "error";
};

const VISIBLE_FOR = 3000;

export function useToasts() {
  let items: Toast[] = [];
  let nextId = 1;

  function dismiss(id: number) {
    items = items.filter((toast) => toast.id !== id);
  }

  function show(text: string, kind: Toast["kind"] = "info") {
    const id = nextId;
    nextId += 1;
    items = [...items, { id, text, kind }];
    setTimeout(() => dismiss(id), VISIBLE_FOR);
  }

  return { items, show, dismiss };
}

export const toasts = useToasts();
