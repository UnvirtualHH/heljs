import { For, onCleanup } from "hel/runtime";
import { PetCard } from "../components/PetCard";
import { ErrorNotice, Spinner } from "../components/ui";
import { useApi } from "../lib/api";
import { catalogUrl } from "../lib/urls";
import { router } from "../router";
import type { Catalog, Pet } from "../types";

const SPECIES = [
  ["", "All"],
  ["dog", "Dogs"],
  ["cat", "Cats"],
  ["bird", "Birds"],
  ["fish", "Fish"],
  ["reptile", "Reptiles"],
];

const SEARCH_DELAY = 200;

export function CatalogPage() {
  const q = router.query().q ?? "";
  const species = router.query().species ?? "";
  const sort = router.query().sort ?? "";
  const pets = useApi<Catalog>(() => catalogUrl(router.query()), { keepPrevious: true });

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(searchTimer));

  function onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      router.setQuery({ q: value || null, page: null }, { replace: true });
    }, SEARCH_DELAY);
  }

  function hrefFor(patch: Record<string, string | number | null>) {
    return router.href("/", { ...router.query(), page: null, ...patch });
  }

  return (
    <section>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search pets…" aria-label="Search pets" value={q} onInput={onSearch} />
        <select
          id="sort"
          aria-label="Sort"
          value={sort}
          onChange={(event: Event) => router.setQuery({ sort: (event.target as HTMLSelectElement).value || null, page: null })}
        >
          <option value="">Featured</option>
          <option value="price-asc">Price, low to high</option>
          <option value="price-desc">Price, high to low</option>
          <option value="name">Name</option>
        </select>
      </div>

      <nav class="chips" aria-label="Species">
        {SPECIES.map(([value, label]) => (
          <a class={species === value ? "chip active" : "chip"} href={hrefFor({ species: value || null })}>{label}</a>
        ))}
      </nav>

      {pets.error ? (
        <ErrorNotice error={pets.error} onRetry={pets.refetch} />
      ) : (
        <div class={pets.loading ? "results is-loading" : "results"}>
          <p class="muted" id="result-count">
            {pets.value ? `${pets.value.total} pets` : ""}
            {pets.loading ? " · updating…" : ""}
          </p>
          <div class="grid">
            <For
              each={pets.value?.items ?? []}
              key={(pet: Pet) => pet.id}
              fallback={pets.loading ? <Spinner /> : <p class="notice">No pets match your search.</p>}
            >
              {(pet: Pet) => <PetCard pet={pet} />}
            </For>
          </div>
          {pets.value && pets.value.pages > 1 ? (
            <nav class="pagination" aria-label="Pages">
              {Array.from({ length: pets.value.pages }, (_, index) => index + 1).map((page) => (
                <a class={pets.value?.page === page ? "active" : ""} href={hrefFor({ page })}>{page}</a>
              ))}
            </nav>
          ) : null}
        </div>
      )}
    </section>
  );
}
