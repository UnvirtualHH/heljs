import { For } from "hel/runtime";
import { toasts, type Toast } from "../state/toasts";

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      <For each={toasts.items} key={(toast: Toast) => toast.id}>
        {(toast: Toast) => (
          <div class={`toast toast-${toast.kind}`}>
            {toast.text}
            <button type="button" aria-label="Dismiss" onClick={() => toasts.dismiss(toast.id)}>×</button>
          </div>
        )}
      </For>
    </div>
  );
}
