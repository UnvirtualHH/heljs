import { ApiError } from "../lib/api";

export function Spinner() {
  return <p class="spinner" role="status">Loading…</p>;
}

export function ErrorNotice(props: { error: unknown; onRetry?: () => void }) {
  const message = props.error instanceof Error ? props.error.message : String(props.error);
  const notFound = props.error instanceof ApiError && props.error.status === 404;

  return (
    <div class="notice notice-error" role="alert">
      <h2>{notFound ? "Not found" : "Something went wrong"}</h2>
      <p>{message}</p>
      {props.onRetry && !notFound ? <button type="button" onClick={props.onRetry}>Try again</button> : null}
      <p><a href="/">Back to the shop</a></p>
    </div>
  );
}

export function CartIcon() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l3 13h11l2-9H6" />
    </svg>
  );
}

export function Field(props: {
  id: string;
  label: string;
  value: string | number;
  error?: string;
  type?: string;
  hint?: string;
  onInput: (value: string) => void;
}) {
  return (
    <div class={props.error ? "field field-invalid" : "field"}>
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type={props.type ?? "text"}
        value={props.value}
        aria-invalid={props.error ? "true" : "false"}
        onInput={(event: Event) => props.onInput((event.target as HTMLInputElement).value)}
      />
      {props.hint ? <small>{props.hint}</small> : null}
      {props.error ? <small class="error-text">{props.error}</small> : null}
    </div>
  );
}
