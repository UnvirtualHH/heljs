import { For, Show, createContext, store, useContext } from "hel/runtime";

type PlaygroundTodo = {
  id: string;
  title: string;
  done: boolean;
};

type CustomerRow = {
  id: string;
  company: string;
  team: string;
  region: string;
  plan: "Starter" | "Growth" | "Scale";
  status: "Healthy" | "Risk" | "Trial";
  mrr: number;
  seats: number;
};

type SortKey =
  | "company"
  | "region"
  | "mrr"
  | "plan"
  | "team"
  | "seats"
  | "status";
type SortDirection = "asc" | "desc";

type TableUiState = {
  query: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
  selectedId: string;
  modalOpen: boolean;
  draftCompany: string;
  draftTeam: string;
  draftRegion: string;
  draftPlan: CustomerRow["plan"];
  draftStatus: CustomerRow["status"];
  draftMrr: string;
  draftSeats: string;
};

const counterCode = `let count = 0;
let step = 1;

function increment() {
  count += step;
}

return (
  <button onClick={increment}>
    Count: {count}
  </button>
);`;

const todoCode = `const todos = store([
  { id: "a", title: "Claim DOM", done: true },
  { id: "b", title: "Add routing", done: false },
]);

return (
  <For each={todos} key={(t) => t.id}>
    {(todo) => (
      <label>
        <input
          type="checkbox"
          checked={todo.done}
          onChange={(e) => {
            todo.done =
              e.currentTarget.checked;
          }}
        />
        {todo.title}
      </label>
    )}
  </For>
);`;

const contextCode = `const Auth = createContext({
  signedIn: false,
  role: "guest",
});

let signedIn = false;

function toggle() {
  signedIn = !signedIn;
}

return (
  <Auth.Provider value={{ signedIn }}>
    <button onClick={toggle}>
      {signedIn ? "Out" : "In"}
    </button>
    <GuardedPanel />
  </Auth.Provider>
);`;

const tableCode = `function DataTableExample() {
  const rows = store(customerSeed.map((row) => ({ ...row })));
  const ui = store({
    query: "",
    sortKey: "mrr",
    sortDirection: "desc",
    page: 1,
    pageSize: 5,
    selectedId: customerSeed[0]?.id ?? "",
    modalOpen: false,
  });

  const filteredRows = () => rows.filter(/* search */);
  const sortedRows = () => [...filteredRows()].sort(/* sort */);
  const pagedRows = () => sortedRows().slice(/* page window */);

  return (
    <>
      <input value={ui.query} onInput={(event) => (ui.query = event.currentTarget.value)} />
      <table>{/* rows */}</table>
      <Show when={ui.modalOpen}>{/* add modal */}</Show>
    </>
  );
}`;

const customerSeed: CustomerRow[] = [
  {
    id: "atlas",
    company: "Atlas Forge",
    team: "Platform",
    region: "Berlin",
    plan: "Scale",
    status: "Healthy",
    mrr: 2400,
    seats: 28,
  },
  {
    id: "luna",
    company: "Luna Relay",
    team: "Ops",
    region: "Hamburg",
    plan: "Growth",
    status: "Risk",
    mrr: 920,
    seats: 11,
  },
  {
    id: "cinder",
    company: "Cinder Loop",
    team: "Frontend",
    region: "Cologne",
    plan: "Starter",
    status: "Trial",
    mrr: 180,
    seats: 4,
  },
  {
    id: "rune",
    company: "Rune Harbor",
    team: "Core",
    region: "Munich",
    plan: "Scale",
    status: "Healthy",
    mrr: 3150,
    seats: 36,
  },
  {
    id: "mint",
    company: "Mint Current",
    team: "Growth",
    region: "Leipzig",
    plan: "Growth",
    status: "Healthy",
    mrr: 1180,
    seats: 14,
  },
  {
    id: "north",
    company: "North Signal",
    team: "Data",
    region: "Berlin",
    plan: "Scale",
    status: "Risk",
    mrr: 2020,
    seats: 22,
  },
  {
    id: "pearl",
    company: "Pearl Static",
    team: "Design",
    region: "Stuttgart",
    plan: "Starter",
    status: "Trial",
    mrr: 220,
    seats: 5,
  },
  {
    id: "delta",
    company: "Delta Echo",
    team: "Infra",
    region: "Frankfurt",
    plan: "Growth",
    status: "Healthy",
    mrr: 1460,
    seats: 17,
  },
  {
    id: "veil",
    company: "Veil Studio",
    team: "Product",
    region: "Vienna",
    plan: "Growth",
    status: "Risk",
    mrr: 860,
    seats: 9,
  },
  {
    id: "iris",
    company: "Iris Current",
    team: "Research",
    region: "Zurich",
    plan: "Scale",
    status: "Healthy",
    mrr: 2780,
    seats: 31,
  },
  {
    id: "thorn",
    company: "Thorn Path",
    team: "Success",
    region: "Prague",
    plan: "Starter",
    status: "Trial",
    mrr: 150,
    seats: 3,
  },
  {
    id: "fable",
    company: "Fable Grid",
    team: "Platform",
    region: "Copenhagen",
    plan: "Growth",
    status: "Healthy",
    mrr: 1320,
    seats: 16,
  },
];

const AuthContext = createContext({ signedIn: false, role: "guest" });

function compareRows(a: CustomerRow, b: CustomerRow, key: SortKey) {
  if (key === "mrr" || key === "seats") {
    return a[key] - b[key];
  }

  return String(a[key]).localeCompare(String(b[key]));
}

function statusTone(status: CustomerRow["status"]) {
  if (status === "Healthy") {
    return "tone-healthy";
  }
  if (status === "Risk") {
    return "tone-risk";
  }
  return "tone-trial";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function CounterExample() {
  let count = 0;
  let step = 1;
  let showCode = false;

  function increment() {
    count += step;
  }

  return (
    <article class="flip-example-card panel-surface">
      <div class="flip-card-header">
        <div>
          <span class="section-kicker">Local state</span>
          <h3>Counter example</h3>
          <p class="section-copy">
            Plain let state and helper functions. No signal API in user code.
          </p>
        </div>

        <button
          type="button"
          class="code-toggle"
          title={showCode ? "Show preview" : "Show code"}
          onClick={() => {
            showCode = !showCode;
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
      </div>

      <div
        class={`flip-card-stage ${showCode ? "flip-card-stage-flipped" : ""}`}
      >
        <Show
          when={showCode}
          fallback={
            <div class="flip-face flip-face-preview">
              <div class="example-actions">
                <button type="button" onClick={increment}>
                  Count: {count}
                </button>
                <button
                  type="button"
                  class="ghost-button"
                  onClick={() => (step = step === 1 ? 5 : 1)}
                >
                  Step: {step}
                </button>
              </div>
            </div>
          }
        >
          <div class="flip-face flip-face-code">
            <pre class="code-panel compact">
              <code>{counterCode}</code>
            </pre>
          </div>
        </Show>
      </div>
    </article>
  );
}

function TodoExample() {
  const todos = store<PlaygroundTodo[]>([
    { id: "claim", title: "Claim prerendered DOM", done: true },
    { id: "router", title: "Keep routing anchor-first", done: false },
    { id: "context", title: "Add minimal context", done: true },
  ]);
  let showCode = false;

  const visibleTodos = () => todos.filter((todo) => !todo.done);

  return (
    <article class="flip-example-card panel-surface">
      <div class="flip-card-header">
        <div>
          <span class="section-kicker">Store + lists</span>
          <h3>Todo example</h3>
          <p class="section-copy">
            Proxy store mutations with keyed list rendering and direct DOM
            updates.
          </p>
        </div>

        <button
          type="button"
          class="code-toggle"
          title={showCode ? "Show preview" : "Show code"}
          onClick={() => {
            showCode = !showCode;
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
      </div>

      <div
        class={`flip-card-stage ${showCode ? "flip-card-stage-flipped" : ""}`}
      >
        <Show
          when={showCode}
          fallback={
            <div class="flip-face flip-face-preview">
              <ul class="example-list">
                <For each={todos} key={(todo: PlaygroundTodo) => todo.id}>
                  {(todo: PlaygroundTodo) => (
                    <li class="example-list-row panel-inset">
                      <label>
                        <input
                          type="checkbox"
                          checked={todo.done}
                          onChange={(event: Event) => {
                            todo.done = (
                              event.currentTarget as HTMLInputElement
                            ).checked;
                          }}
                        />
                        <span>{todo.title}</span>
                      </label>
                    </li>
                  )}
                </For>
              </ul>
              <p class="section-copy">
                {visibleTodos().length} open items remain.
              </p>
            </div>
          }
        >
          <div class="flip-face flip-face-code">
            <pre class="code-panel compact">
              <code>{todoCode}</code>
            </pre>
          </div>
        </Show>
      </div>
    </article>
  );
}

function GuardedPanel() {
  const auth = useContext(AuthContext);

  return (
    <Show
      when={auth.signedIn}
      fallback={
        <p class="section-copy">
          Guest mode. Sign in to reveal the protected panel.
        </p>
      }
    >
      <p class="section-copy">
        Signed in as <strong>{auth.role}</strong>. This subtree is driven by
        context.
      </p>
    </Show>
  );
}

function ContextExample() {
  let signedIn = false;
  let role = "guest";
  let showCode = false;

  function toggleAccess() {
    signedIn = !signedIn;
    role = signedIn ? "admin" : "guest";
  }

  return (
    <article class="flip-example-card panel-surface">
      <div class="flip-card-header">
        <div>
          <span class="section-kicker">Context</span>
          <h3>Guarded subtree</h3>
          <p class="section-copy">
            Enough shared state for auth-like flows without bloating the core
            router.
          </p>
        </div>

        <button
          type="button"
          class="code-toggle"
          title={showCode ? "Show preview" : "Show code"}
          onClick={() => {
            showCode = !showCode;
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
      </div>

      <div
        class={`flip-card-stage ${showCode ? "flip-card-stage-flipped" : ""}`}
      >
        <Show
          when={showCode}
          fallback={
            <div class="flip-face flip-face-preview">
              <AuthContext.Provider value={{ signedIn, role }}>
                <div class="example-actions">
                  <button type="button" onClick={toggleAccess}>
                    {signedIn ? "Sign out" : "Sign in"}
                  </button>
                </div>
                <div class="guard-box panel-inset">
                  <GuardedPanel />
                </div>
              </AuthContext.Provider>
            </div>
          }
        >
          <div class="flip-face flip-face-code">
            <pre class="code-panel compact">
              <code>{contextCode}</code>
            </pre>
          </div>
        </Show>
      </div>
    </article>
  );
}

function DataTableExample() {
  const rows = store<CustomerRow[]>(customerSeed.map((row) => ({ ...row })));
  const ui = store<TableUiState>({
    query: "",
    sortKey: "mrr",
    sortDirection: "desc",
    page: 1,
    pageSize: 5,
    selectedId: customerSeed[0]?.id ?? "",
    modalOpen: false,
    draftCompany: "",
    draftTeam: "",
    draftRegion: "Berlin",
    draftPlan: "Growth",
    draftStatus: "Trial",
    draftMrr: "600",
    draftSeats: "6",
  });
  let showCode = false;

  const totalRows = () => rows.length;

  const filteredRows = () => {
    const normalized = ui.query.trim().toLowerCase();

    if (!normalized) {
      return rows;
    }

    return rows.filter((row) => {
      return (
        row.company.toLowerCase().includes(normalized) ||
        row.team.toLowerCase().includes(normalized) ||
        row.region.toLowerCase().includes(normalized) ||
        row.status.toLowerCase().includes(normalized) ||
        row.plan.toLowerCase().includes(normalized)
      );
    });
  };

  const sortedRows = () => {
    const nextRows = [...filteredRows()];

    nextRows.sort((a, b) => {
      const value = compareRows(a, b, ui.sortKey);
      return ui.sortDirection === "asc" ? value : -value;
    });

    return nextRows;
  };

  const pageCount = () =>
    Math.max(1, Math.ceil(sortedRows().length / ui.pageSize));
  const currentPage = () => Math.min(ui.page, pageCount());

  const pagedRows = () => {
    const start = (currentPage() - 1) * ui.pageSize;
    return sortedRows().slice(start, start + ui.pageSize);
  };

  const selectedRow = () =>
    rows.find((row) => row.id === ui.selectedId) ?? null;

  const startRow = () => {
    if (sortedRows().length === 0) {
      return 0;
    }
    return (currentPage() - 1) * ui.pageSize + 1;
  };

  const endRow = () =>
    Math.min(currentPage() * ui.pageSize, sortedRows().length);

  function syncSelectionToPage() {
    const visible = pagedRows();

    if (visible.length === 0) {
      ui.selectedId = "";
      return;
    }

    if (!visible.some((row) => row.id === ui.selectedId)) {
      ui.selectedId = visible[0].id;
    }
  }

  function setSort(nextKey: SortKey) {
    if (ui.sortKey === nextKey) {
      ui.sortDirection = ui.sortDirection === "asc" ? "desc" : "asc";
    } else {
      ui.sortKey = nextKey;
      ui.sortDirection =
        nextKey === "company" ||
        nextKey === "team" ||
        nextKey === "plan" ||
        nextKey === "region" ||
        nextKey === "status"
          ? "asc"
          : "desc";
    }
    ui.page = 1;
    syncSelectionToPage();
  }

  function updateQuery(value: string) {
    ui.query = value;
    ui.page = 1;
    syncSelectionToPage();
  }

  function updatePageSize(value: string) {
    ui.pageSize = Number(value);
    ui.page = 1;
    syncSelectionToPage();
  }

  function goToPreviousPage() {
    ui.page = Math.max(1, ui.page - 1);
    syncSelectionToPage();
  }

  function goToNextPage() {
    ui.page = Math.min(pageCount(), ui.page + 1);
    syncSelectionToPage();
  }

  function openModal() {
    ui.modalOpen = true;
  }

  function closeModal() {
    ui.modalOpen = false;
  }

  function addCustomer(event: Event) {
    event.preventDefault();

    const company = ui.draftCompany.trim();
    const team = ui.draftTeam.trim();
    const region = ui.draftRegion.trim();
    const mrr = Number(ui.draftMrr);
    const seats = Number(ui.draftSeats);

    if (
      !company ||
      !team ||
      !region ||
      Number.isNaN(mrr) ||
      Number.isNaN(seats)
    ) {
      return;
    }

    const id = `${company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${rows.length + 1}`;

    rows.push({
      id,
      company,
      team,
      region,
      plan: ui.draftPlan,
      status: ui.draftStatus,
      mrr,
      seats,
    });

    ui.query = "";
    ui.selectedId = id;
    const insertedIndex = sortedRows().findIndex((row) => row.id === id);
    ui.page =
      insertedIndex >= 0 ? Math.floor(insertedIndex / ui.pageSize) + 1 : 1;
    ui.modalOpen = false;
    ui.draftCompany = "";
    ui.draftTeam = "";
    ui.draftRegion = "Berlin";
    ui.draftPlan = "Growth";
    ui.draftStatus = "Trial";
    ui.draftMrr = "600";
    ui.draftSeats = "6";
  }

  return (
    <article class="flip-example-card flip-example-card-wide panel-surface">
      <div class="flip-card-header">
        <div>
          <span class="section-kicker">Real table example</span>
          <h3>Search, sort, pagination, selection, and add-via-modal</h3>
          <p class="section-copy">
            A more realistic admin-style example with row state, modal insert,
            and page-aware selection.
          </p>
        </div>

        <button
          type="button"
          class="code-toggle"
          title={showCode ? "Show preview" : "Show code"}
          onClick={() => {
            showCode = !showCode;
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
      </div>

      <div
        class={`flip-card-stage ${showCode ? "flip-card-stage-flipped" : ""}`}
      >
        <Show
          when={showCode}
          fallback={
            <div class="flip-face flip-face-preview">
              <div class="table-header-row">
                <div class="table-header-copy">
                  <p class="section-copy">
                    This is the kind of UI that actually matters for dashboards
                    and backoffice screens.
                  </p>
                </div>

                <div class="table-header-actions">
                  <div class="table-header-meta panel-inset">
                    <strong>{sortedRows().length}</strong>
                    <span>matching rows</span>
                  </div>
                  <button
                    type="button"
                    class="primary-inline-action"
                    onClick={openModal}
                  >
                    Add customer
                  </button>
                </div>
              </div>

              <div class="table-toolbar">
                <label class="toolbar-field">
                  <span>Search</span>
                  <input
                    type="search"
                    value={ui.query}
                    placeholder="Search company, team, region..."
                    onInput={(event: Event) =>
                      updateQuery(
                        (event.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                </label>

                <label class="toolbar-field toolbar-field-small">
                  <span>Rows per page</span>
                  <select
                    value={String(ui.pageSize)}
                    onChange={(event: Event) =>
                      updatePageSize(
                        (event.currentTarget as HTMLSelectElement).value,
                      )
                    }
                  >
                    <option value="5">5</option>
                    <option value="8">8</option>
                    <option value="10">10</option>
                  </select>
                </label>
              </div>

              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          class="sort-button"
                          onClick={() => setSort("company")}
                        >
                          Company
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          class="sort-button"
                          onClick={() => setSort("team")}
                        >
                          Team
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          class="sort-button"
                          onClick={() => setSort("region")}
                        >
                          Region
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          class="sort-button"
                          onClick={() => setSort("plan")}
                        >
                          Plan
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          class="sort-button"
                          onClick={() => setSort("status")}
                        >
                          Status
                        </button>
                      </th>
                      <th class="numeric-column">
                        <button
                          type="button"
                          class="sort-button"
                          onClick={() => setSort("mrr")}
                        >
                          MRR
                        </button>
                      </th>
                      <th class="numeric-column">
                        <button
                          type="button"
                          class="sort-button"
                          onClick={() => setSort("seats")}
                        >
                          Seats
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <Show
                      when={pagedRows().length > 0}
                      fallback={
                        <tr>
                          <td colSpan={7} class="empty-cell">
                            No customers match this filter.
                          </td>
                        </tr>
                      }
                    >
                      <For
                        each={pagedRows()}
                        key={(row: CustomerRow) => row.id}
                      >
                        {(row: CustomerRow) => (
                          <tr
                            class={
                              ui.selectedId === row.id ? "selected-row" : ""
                            }
                            onClick={() => {
                              ui.selectedId = row.id;
                            }}
                          >
                            <td>
                              <div class="company-cell">
                                <strong>{row.company}</strong>
                                <span>{row.id}</span>
                              </div>
                            </td>
                            <td>{row.team}</td>
                            <td>{row.region}</td>
                            <td>{row.plan}</td>
                            <td>
                              <span
                                class={`status-pill ${statusTone(row.status)}`}
                              >
                                {row.status}
                              </span>
                            </td>
                            <td class="numeric-column">
                              {formatCurrency(row.mrr)}
                            </td>
                            <td class="numeric-column">{row.seats}</td>
                          </tr>
                        )}
                      </For>
                    </Show>
                  </tbody>
                </table>
              </div>

              <div class="table-footer-row">
                <p class="section-copy">
                  Showing {startRow()}-{endRow()} of {sortedRows().length}{" "}
                  filtered rows from {totalRows()} total customers.
                </p>

                <div class="pagination-controls">
                  <button
                    type="button"
                    class="ghost-button"
                    disabled={currentPage() <= 1}
                    onClick={goToPreviousPage}
                  >
                    Previous
                  </button>
                  <span class="pagination-pill panel-inset">
                    Page {currentPage()} / {pageCount()}
                  </span>
                  <button
                    type="button"
                    class="ghost-button"
                    disabled={currentPage() >= pageCount()}
                    onClick={goToNextPage}
                  >
                    Next
                  </button>
                </div>
              </div>

              <Show when={selectedRow()}>
                <div class="table-selection panel-inset">
                  <div>
                    <span class="section-kicker">Selected customer</span>
                    <h3>{selectedRow()?.company}</h3>
                    <p class="section-copy">
                      {selectedRow()?.team} team in {selectedRow()?.region} on
                      the {selectedRow()?.plan} plan.
                    </p>
                  </div>

                  <div class="selection-meta-grid">
                    <article class="selection-meta-item">
                      <span>MRR</span>
                      <strong>
                        {selectedRow()
                          ? formatCurrency(selectedRow()!.mrr)
                          : "-"}
                      </strong>
                    </article>
                    <article class="selection-meta-item">
                      <span>Seats</span>
                      <strong>{selectedRow()?.seats}</strong>
                    </article>
                    <article class="selection-meta-item">
                      <span>Status</span>
                      <strong>{selectedRow()?.status}</strong>
                    </article>
                  </div>
                </div>
              </Show>

              <Show when={ui.modalOpen}>
                <div class="modal-backdrop" onClick={closeModal}>
                  <div
                    class="modal-shell panel-surface"
                    onClick={(event: Event) => event.stopPropagation()}
                  >
                    <div class="modal-header-row">
                      <div>
                        <span class="section-kicker">Add customer</span>
                        <h3>Insert a new row into the table</h3>
                        <p class="section-copy modal-copy">
                          Required: company, team, region, MRR, and seats.
                        </p>
                      </div>
                      <button
                        type="button"
                        class="ghost-button modal-close"
                        onClick={closeModal}
                      >
                        Close
                      </button>
                    </div>

                    <form class="modal-form" onSubmit={addCustomer}>
                      <label class="toolbar-field">
                        <span>Company *</span>
                        <input
                          required
                          value={ui.draftCompany}
                          onInput={(event: Event) =>
                            (ui.draftCompany = (
                              event.currentTarget as HTMLInputElement
                            ).value)
                          }
                        />
                      </label>

                      <label class="toolbar-field">
                        <span>Team *</span>
                        <input
                          required
                          value={ui.draftTeam}
                          onInput={(event: Event) =>
                            (ui.draftTeam = (
                              event.currentTarget as HTMLInputElement
                            ).value)
                          }
                        />
                      </label>

                      <label class="toolbar-field toolbar-field-small">
                        <span>Region *</span>
                        <input
                          required
                          value={ui.draftRegion}
                          onInput={(event: Event) =>
                            (ui.draftRegion = (
                              event.currentTarget as HTMLInputElement
                            ).value)
                          }
                        />
                      </label>

                      <label class="toolbar-field toolbar-field-small">
                        <span>Plan</span>
                        <select
                          value={ui.draftPlan}
                          onChange={(event: Event) =>
                            (ui.draftPlan = (
                              event.currentTarget as HTMLSelectElement
                            ).value as CustomerRow["plan"])
                          }
                        >
                          <option value="Starter">Starter</option>
                          <option value="Growth">Growth</option>
                          <option value="Scale">Scale</option>
                        </select>
                      </label>

                      <label class="toolbar-field toolbar-field-small">
                        <span>Status</span>
                        <select
                          value={ui.draftStatus}
                          onChange={(event: Event) =>
                            (ui.draftStatus = (
                              event.currentTarget as HTMLSelectElement
                            ).value as CustomerRow["status"])
                          }
                        >
                          <option value="Healthy">Healthy</option>
                          <option value="Risk">Risk</option>
                          <option value="Trial">Trial</option>
                        </select>
                      </label>

                      <label class="toolbar-field toolbar-field-small">
                        <span>MRR *</span>
                        <input
                          required
                          type="number"
                          min="0"
                          value={ui.draftMrr}
                          onInput={(event: Event) =>
                            (ui.draftMrr = (
                              event.currentTarget as HTMLInputElement
                            ).value)
                          }
                        />
                      </label>

                      <label class="toolbar-field toolbar-field-small">
                        <span>Seats *</span>
                        <input
                          required
                          type="number"
                          min="1"
                          value={ui.draftSeats}
                          onInput={(event: Event) =>
                            (ui.draftSeats = (
                              event.currentTarget as HTMLInputElement
                            ).value)
                          }
                        />
                      </label>

                      <div class="modal-actions">
                        <button
                          type="button"
                          class="ghost-button"
                          onClick={closeModal}
                        >
                          Cancel
                        </button>
                        <button type="submit" class="primary-inline-action">
                          Create row
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </Show>
            </div>
          }
        >
          <div class="flip-face flip-face-code">
            <pre class="code-panel compact">
              <code>{tableCode}</code>
            </pre>
          </div>
        </Show>
      </div>
    </article>
  );
}

const exampleMeta = [
  {
    title: "Counter",
    body: "Shows plain local state and helper reads.",
  },
  {
    title: "Todo list",
    body: "Shows proxy store mutation and keyed rendering.",
  },
  {
    title: "Guarded panel",
    body: "Shows minimal context for auth-shaped state.",
  },
  {
    title: "Data table",
    body: "Shows search, sort, pagination, add, and row selection.",
  },
];

export function ExamplesPage() {
  return (
    <section class="page-stack examples-page">
      <section class="page-hero panel-surface">
        <div>
          <span class="section-kicker">Examples</span>
          <h1>Live examples. Small, honest, and already interactive.</h1>
        </div>
        <p class="hero-copy">
          This site should prove that Hel can render real UI, not just host
          markdown about itself.
        </p>
      </section>

      <section class="example-meta-grid">
        {exampleMeta.map((item) => (
          <article class="panel-inset example-meta-card">
            <strong>{item.title}</strong>
            <p class="section-copy">{item.body}</p>
          </article>
        ))}
      </section>

      <section class="examples-grid examples-grid-wide">
        <CounterExample />
        <TodoExample />
        <ContextExample />
      </section>

      <DataTableExample />
    </section>
  );
}
