import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "heljs/runtime";
import { handleApi, resetApi } from "../server/api";
import { App } from "../src/App";
import { router } from "../src/router";
import { cart } from "../src/state/cart";
import { favorites } from "../src/state/favorites";
import { session } from "../src/state/session";

const wait = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await wait();
  }
};

let root: HTMLElement;
let unmount: () => void;
let delays: Record<string, number> = {};
let requests: string[] = [];

const q = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector);
const qa = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
const click = (element: Element | null | undefined) => {
  if (!element) throw new Error("Nothing to click");
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
};
const type = (selector: string, value: string, event = "input") => {
  const element = q<HTMLInputElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  element.value = value;
  element.dispatchEvent(new Event(event, { bubbles: true }));
};
const submit = (selector: string) => q(selector)!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const go = async (path: string) => {
  router.navigate(path);
  await settle();
};
const names = () => qa(".card h3").map((element) => element.textContent);

beforeEach(async () => {
  resetApi();
  localStorage.clear();
  sessionStorage.clear();
  cart.clear();
  session.end();
  favorites.ids = [];
  delays = {};
  requests = [];
  document.body.innerHTML = "";

  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    requests.push(`${init.method ?? "GET"} ${url}`);
    const delay = Object.entries(delays).find(([part]) => url.includes(part))?.[1];
    if (delay) await wait(delay);
    init.signal?.throwIfAborted();
    const authorization = (init.headers as Record<string, string> | undefined)?.Authorization;
    const result = await handleApi(init.method ?? "GET", url, (init.body as string) ?? "", authorization);
    return {
      ok: result.status < 400,
      status: result.status,
      json: async () => JSON.parse(JSON.stringify(result.body)),
    };
  });

  router.navigate("/");
  root = document.createElement("div");
  document.body.appendChild(root);
  unmount = mount(() => <App />, root);
  await settle();
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe("catalog", () => {
  it("lists the first page", () => {
    expect(qa(".card")).toHaveLength(8);
    expect(q("#result-count")?.textContent).toContain("20 pets");
    expect(qa(".pagination a")).toHaveLength(3);
  });

  it("searches through the URL and keeps the input focused", async () => {
    const input = q<HTMLInputElement>("#search")!;
    input.focus();
    type("#search", "mi");
    await wait(250);
    await settle();

    expect(window.location.search).toBe("?q=mi");
    expect(names()).toEqual(["Minka", "Mimi"]);
    expect(q("#search")).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it("combines filters, sorting, and pages", async () => {
    await go("/?species=cat&sort=price-desc");
    expect(names().slice(0, 2)).toEqual(["Tiger", "Nala"]);
    expect(q(".chip.active")?.textContent).toBe("Cats");
    expect(q<HTMLSelectElement>("#sort")?.value).toBe("price-desc");

    await go("/?page=2");
    expect(q(".pagination a.active")?.textContent).toBe("2");
    expect(names()).toHaveLength(8);
  });

  it("shows the old results while loading, and ignores a slow answer to an old search", async () => {
    delays = { "q=slow": 400 };
    router.setQuery({ q: "slow" });
    await settle();
    expect(q("#result-count")?.textContent).toContain("updating");
    expect(names()).toHaveLength(8);

    router.setQuery({ q: "bello" });
    await wait(600);
    await settle();
    expect(names()).toEqual(["Bello"]);
  });

  it("tells when nothing matches", async () => {
    await go("/?q=unicorn");
    expect(q(".grid")?.textContent).toContain("No pets match");
  });

  it("marks favorites everywhere", async () => {
    click(q(".favorite"));
    await settle();
    expect(q(".favorite")?.getAttribute("aria-pressed")).toBe("true");
    expect(q(".header-side")?.textContent).toContain("♥ 1");
  });

  it("disables a pet that is sold out", async () => {
    await go("/?q=max");
    expect(q<HTMLButtonElement>(".card .add")?.disabled).toBe(true);
    expect(q(".card .add")?.textContent).toBe("Sold out");
  });
});

describe("pet page", () => {
  it("loads the pet, then what depends on it", async () => {
    await go("/pets/1");

    expect(q(".pet h1")?.textContent).toBe("Bello");
    expect(qa("#reviews li")).toHaveLength(2);
    expect(q("#reviews-title")?.textContent).toBe("Reviews (4.5 of 5)");
    expect(qa("#related .card h3").map((element) => element.textContent)).toEqual(["Rex", "Luna", "Fips"]);
  });

  it("starts fresh on another pet", async () => {
    await go("/pets/3");
    click(q("[aria-label=More]"));
    await settle();
    expect(q("#quantity")?.textContent).toBe("2");

    await go("/pets/1");
    expect(q(".pet h1")?.textContent).toBe("Bello");
    expect(q("#quantity")?.textContent).toBe("1");
  });

  it("limits the quantity to what is still available", async () => {
    await go("/pets/1");
    click(q(".buy .add"));
    await settle();
    click(q(".buy .add"));
    await settle();

    expect(q("#stock")?.textContent).toBe("2 in stock, 2 in your cart");
    expect(q<HTMLButtonElement>(".buy .add")?.disabled).toBe(true);
    expect(q("#cart-count")?.textContent).toBe("2");
  });

  it("shows a missing pet, and recovers on the next one", async () => {
    await go("/pets/999");
    expect(q("[role=alert]")?.textContent).toContain("Pet 999 was not found");

    await go("/pets/2");
    expect(q("[role=alert]")).toBeNull();
    expect(q(".pet h1")?.textContent).toBe("Rex");
  });

  it("validates and adds a review", async () => {
    await go("/pets/2");
    submit(".review-form");
    await settle();
    expect(qa(".review-form .error-text").map((element) => element.textContent)).toContain("Please write something");

    type("#review-author", "Flo");
    type("#review-rating", "3", "change");
    type("#review-text", "Good boy");
    await settle();
    submit(".review-form");
    await settle();

    expect(q("#reviews")?.textContent).toContain("Good boy");
    expect(q("#reviews-title")?.textContent).toBe("Reviews (3.0 of 5)");
    expect(q<HTMLInputElement>("#review-author")?.value).toBe("");
    expect(q<HTMLSelectElement>("#review-rating")?.value).toBe("5");
  });
});

describe("cart", () => {
  const addPet = async (query: string) => {
    await go(`/?q=${query}`);
    click(q(".card .add"));
    await settle();
  };

  it("adds, charges shipping below the limit, and survives a reload", async () => {
    await addPet("bubbles");
    await go("/cart");

    expect(q("#subtotal")?.textContent).toBe("15 €");
    expect(q("#shipping")?.textContent).toBe("15 €");
    expect(q("#total")?.textContent).toBe("30 €");

    const saved = localStorage.getItem("hel-pet-shop.cart");
    cart.restore();
    expect(JSON.parse(saved!)[0].pet.name).toBe("Bubbles");
    expect(cart.count).toBe(1);
  });

  it("changes a quantity without losing focus, and drops free of shipping", async () => {
    await addPet("bubbles");
    await go("/cart");

    const input = q<HTMLInputElement>("#cart-table input")!;
    input.focus();
    type("#cart-table input", "20");
    await settle();

    expect(q("#cart-table input")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(q("#subtotal")?.textContent).toBe("300 €");
    expect(q("#shipping")?.textContent).toBe("Free");
  });

  it("removes a line and shows the empty cart", async () => {
    await addPet("bubbles");
    await go("/cart");
    click(qa("#cart-table button").at(-1));
    await settle();

    expect(q("#cart-table")).toBeNull();
    expect(root.textContent).toContain("Your cart is empty");
  });
});

describe("checkout", () => {
  const fill = async (card = "4111 1111 1111 1111") => {
    type("#name", "Flo");
    type("#email", "flo@example.com");
    type("#address", "Main Street 1");
    type("#card", card);
    await settle();
  };

  beforeEach(async () => {
    await go("/?q=bello");
    click(q(".card .add"));
    await settle();
    await go("/checkout");
  });

  it("shows errors only after the first attempt, and clears them while typing", async () => {
    expect(qa(".error-text")).toHaveLength(0);

    submit("#checkout-form");
    await settle();
    expect(qa(".error-text")).toHaveLength(4);
    expect(requests.filter((request) => request.startsWith("POST"))).toEqual([]);

    const name = q<HTMLInputElement>("#name")!;
    name.focus();
    type("#name", "Flo");
    await settle();
    expect(q("#name")).toBe(name);
    expect(document.activeElement).toBe(name);
    expect(qa(".error-text")).toHaveLength(3);
  });

  it("stays on the form with what was typed when the card is declined", async () => {
    await fill("4111 1111 1111 0000");
    submit("#checkout-form");
    await settle();

    expect(q("#checkout-failure")?.textContent).toBe("The card was declined");
    expect(q<HTMLInputElement>("#email")?.value).toBe("flo@example.com");
    expect(q("#cart-count")?.textContent).toBe("1");
  });

  it("disables the button while paying, then shows the order and empties the cart", async () => {
    await fill();
    delays = { "/api/orders": 300 };
    submit("#checkout-form");
    await settle();
    expect(q("#checkout-form button")?.textContent).toBe("Paying…");
    expect(q<HTMLButtonElement>("#checkout-form button")?.disabled).toBe(true);

    await wait(500);
    delays = {};
    await settle();

    expect(window.location.pathname).toBe("/orders/1001");
    expect(q("#order h1")?.textContent).toBe("Order 1001");
    expect(q("#cart-count")?.textContent).toBe("0");

    const pet = await handleApi("GET", "/api/pets/1");
    expect((pet.body as { stock: number }).stock).toBe(1);
  });

  it("reports when the stock ran out in the meantime", async () => {
    await handleApi("PATCH", "/api/pets/1", JSON.stringify({ stock: 0 }), "Bearer admin-token");
    await fill();
    submit("#checkout-form");
    await settle();

    expect(q("#checkout-failure")?.textContent).toBe("Only 0 of Bello left");
  });
});

describe("orders", () => {
  it("lists an order, and cancelling restocks it", async () => {
    await handleApi("POST", "/api/orders", JSON.stringify({
      items: [{ petId: 1, quantity: 1 }],
      customer: { name: "Flo", email: "a@b", address: "Street 1" },
      card: "4111111111111111",
    }));

    await go("/orders");
    expect(q("#orders")?.textContent).toContain("Order 1001");

    await go("/orders/1001");
    expect(q("#order-status")?.textContent).toBe("paid");

    click(q("#cancel-order"));
    await settle();
    expect(q("#order-status")?.textContent).toBe("cancelled");
    expect(q("#cancel-order")).toBeNull();

    const pet = await handleApi("GET", "/api/pets/1");
    expect((pet.body as { stock: number }).stock).toBe(2);
  });

  it("explains an order that does not exist", async () => {
    await go("/orders/9999");
    expect(q("[role=alert]")?.textContent).toContain("Order 9999 was not found");
  });
});

describe("admin", () => {
  const signIn = async () => {
    await go("/login?next=/admin");
    type("#login-name", "admin");
    type("#login-password", "admin");
    await settle();
    submit("#login-form");
    await settle();
  };

  const row = (id: number) => q(`tr[data-pet="${id}"]`)!;
  const changeStock = (id: number, value: string) => {
    const input = row(id).querySelector<HTMLInputElement>(".stock-input")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("is locked until signed in", async () => {
    await go("/admin");
    expect(q("#admin-locked")).not.toBeNull();

    await signIn();
    expect(window.location.pathname).toBe("/admin");
    expect(q("#admin-table")).not.toBeNull();
    expect(q(".header-side")?.textContent).toContain("Admin");
  });

  it("reports a wrong password", async () => {
    await go("/login");
    type("#login-name", "admin");
    type("#login-password", "nope");
    await settle();
    submit("#login-form");
    await settle();
    expect(q("#login-failure")?.textContent).toBe("Wrong name or password");
  });

  // Saving one row refetches the list, which brings new objects for every row.
  it("keeps what was typed in another row when one row is saved", async () => {
    await signIn();
    const other = row(2);
    const otherInput = other.querySelector<HTMLInputElement>(".stock-input")!;
    changeStock(2, "9");
    otherInput.focus();
    changeStock(1, "7");
    await settle();

    click(row(1).querySelector(".save"));
    await settle();

    expect(row(2)).toBe(other);
    expect(document.activeElement).toBe(otherInput);
    expect(otherInput.value).toBe("9");
    expect(row(2).querySelector<HTMLButtonElement>(".save")?.disabled).toBe(false);
    expect(row(1).querySelector<HTMLButtonElement>(".save")?.disabled).toBe(true);
  });

  it("asks before deleting", async () => {
    await signIn();
    click(row(3).querySelector(".delete"));
    await settle();
    click(row(3).querySelector(".link"));
    await settle();
    expect(row(3).querySelector(".confirm-delete")).toBeNull();

    click(row(3).querySelector(".delete"));
    await settle();
    click(row(3).querySelector(".confirm-delete"));
    await settle();
    expect(row(3)).toBeNull();
  });

  it("validates and adds a pet", async () => {
    await signIn();
    submit("#new-pet");
    await settle();
    expect(q("#new-pet .error-text")?.textContent).toBe("A name is required");

    type("#new-name", "Hedwig");
    await settle();
    submit("#new-pet");
    await settle();
    expect(q("#admin-table")?.textContent).toContain("Hedwig");
    expect(q<HTMLInputElement>("#new-name")?.value).toBe("");
  });
});
