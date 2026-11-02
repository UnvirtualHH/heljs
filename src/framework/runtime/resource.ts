import { cell, effect, get, onScopeCleanup, set, untrack } from "./core";
import { isHydrating } from "./hydration";
import type { Resource, ResourceOptions } from "../shared";

// Only source() is tracked. A fetcher runs across awaits, where reads could not
// be tracked anyway, so whatever identifies the data has to be in the source.
export function useResource<S, T>(
  source: () => S,
  fetcher: (source: NonNullable<S>, signal: AbortSignal) => T | Promise<T>,
  options: ResourceOptions<T> = {},
): Resource<T> {
  const value = cell<T | undefined>(options.initial);
  const failure = cell<{ error: unknown } | null>(null);
  const loading = cell(false);
  const version = cell(0);

  let controller: AbortController | null = null;
  let currentSource: S | undefined;
  let currentVersion = 0;
  let first = true;

  effect(() => {
    const nextSource = source();
    const nextVersion = get(version);
    const sourceChanged = !Object.is(nextSource, currentSource);

    if (!first && !sourceChanged && nextVersion === currentVersion) {
      return;
    }

    // Preloaded data is only known to be fresh for the page it came with. A later
    // instance, such as coming back to a route, starts from it but still fetches.
    const skipFetch = first && "initial" in options && isHydrating();
    const keepValue = first || !sourceChanged || options.keepPrevious;
    first = false;
    currentSource = nextSource;
    currentVersion = nextVersion;
    controller?.abort();
    controller = null;

    if (skipFetch) {
      return;
    }

    set(failure, null);

    if (!nextSource) {
      set(value, undefined);
      set(loading, false);
      return;
    }

    if (!keepValue) {
      set(value, undefined);
    }

    set(loading, true);

    const request = new AbortController();
    controller = request;
    let pending: T | Promise<T>;

    try {
      pending = untrack(() => fetcher(nextSource as NonNullable<S>, request.signal));
    } catch (error) {
      pending = Promise.reject(error);
    }

    Promise.resolve(pending).then(
      (result) => {
        if (!request.signal.aborted) {
          set(value, result);
          set(loading, false);
        }
      },
      (error: unknown) => {
        if (!request.signal.aborted) {
          set(failure, { error });
          set(loading, false);
        }
      },
    );
  });

  onScopeCleanup(() => controller?.abort());

  return {
    get value() {
      // A failure that nobody checked for must not look like empty data.
      const failed = get(failure);
      if (failed) {
        throw failed.error;
      }

      return get(value);
    },
    get error() {
      return get(failure)?.error;
    },
    get loading() {
      return get(loading);
    },
    refetch() {
      set(version, version.value + 1);
    },
  };
}
