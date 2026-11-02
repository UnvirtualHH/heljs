import { createContext, useContext, useResource } from "hel/runtime";
import { session } from "../state/session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? `Request failed with ${response.status}`, body?.details);
  }

  return body as T;
}

export const getJson = <T>(url: string, signal: AbortSignal) => request<T>(url, { signal });
export const postJson = <T>(url: string, body: unknown = {}) => request<T>(url, { method: "POST", body: JSON.stringify(body) });
export const patchJson = <T>(url: string, body: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(body) });
export const deleteJson = <T>(url: string) => request<T>(url, { method: "DELETE" });

// What the server already loaded for this page, by API URL.
export const Preloaded = createContext<Record<string, unknown>>({});

export function useApi<T>(url: () => string | null | undefined | false, options: { keepPrevious?: boolean } = {}) {
  const preloaded = useContext(Preloaded);
  const first = url();

  return useResource(url, getJson<T>, {
    ...options,
    initial: first ? (preloaded[first] as T | undefined) : undefined,
  });
}
