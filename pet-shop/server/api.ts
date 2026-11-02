import type { Customer, Order, OrderLine, Pet, Review, Species } from "../src/types";

const PAGE_SIZE = 8;
const ADMIN_TOKEN = "admin-token";

function createPets(): Pet[] {
  const seed: Array<[string, Species, string, number, number, number, string, string]> = [
    ["Bello", "dog", "Labrador", 3, 450, 2, "🐕", "Friendly and endlessly hungry."],
    ["Rex", "dog", "German Shepherd", 5, 520, 1, "🐕‍🦺", "Takes guarding the sofa very seriously."],
    ["Luna", "dog", "Border Collie", 2, 610, 3, "🐶", "Herds children, cats, and vacuum cleaners."],
    ["Fips", "dog", "Dachshund", 7, 300, 1, "🐕", "Small dog, large opinions."],
    ["Minka", "cat", "Maine Coon", 4, 380, 2, "🐈", "Will sit on whatever you are reading."],
    ["Mimi", "cat", "Siamese", 1, 420, 4, "🐱", "Talks back, and usually wins."],
    ["Shadow", "cat", "Bombay", 6, 290, 1, "🐈‍⬛", "You will only see the eyes."],
    ["Tiger", "cat", "Bengal", 3, 700, 1, "🐅", "Not a real tiger. Mostly."],
    ["Coco", "bird", "Cockatiel", 2, 120, 5, "🦜", "Knows one song, and sings it often."],
    ["Pip", "bird", "Canary", 1, 60, 8, "🐤", "A morning person, whether you are or not."],
    ["Kiwi", "bird", "Lovebird", 2, 90, 6, "🐦", "Comes as a set of one, sadly."],
    ["Bubbles", "fish", "Goldfish", 1, 15, 20, "🐠", "Has forgotten this description already."],
    ["Nemo", "fish", "Clownfish", 1, 45, 10, "🐟", "Frequently misplaced."],
    ["Inky", "fish", "Betta", 2, 25, 12, "🐡", "Prefers to live alone. Respect that."],
    ["Spike", "reptile", "Bearded Dragon", 4, 240, 2, "🦎", "Waves at strangers."],
    ["Shelly", "reptile", "Tortoise", 30, 500, 1, "🐢", "Will outlive this codebase."],
    ["Noodle", "reptile", "Corn Snake", 3, 180, 2, "🐍", "An escape artist with no arms."],
    ["Max", "dog", "Beagle", 4, 390, 0, "🐕", "Currently out of stock, and very sorry about it."],
    ["Nala", "cat", "Ragdoll", 2, 650, 2, "🐈", "Goes limp when held, on purpose."],
    ["Zazu", "bird", "Hornbill", 6, 880, 1, "🦤", "Keeps you informed, whether you asked or not."],
  ];

  return seed.map(([name, species, breed, age, price, stock, emoji, description], index) => ({
    id: index + 1,
    name,
    species,
    breed,
    age,
    price,
    stock,
    emoji,
    description,
  }));
}

function createState() {
  return {
    pets: createPets(),
    reviews: [
      { id: 1, petId: 1, author: "Anna", rating: 5, text: "Ate my homework. Worth it.", createdAt: "2026-10-02" },
      { id: 2, petId: 1, author: "Ben", rating: 4, text: "Very loud, very lovely.", createdAt: "2026-10-11" },
      { id: 3, petId: 5, author: "Clara", rating: 5, text: "Sits on the keyboard during deploys.", createdAt: "2026-09-21" },
    ] as Review[],
    orders: [] as Order[],
    nextPetId: 21,
    nextReviewId: 4,
    nextOrderId: 1001,
  };
}

let state = createState();

// Tests start from the same data every time.
export function resetApi(): void {
  state = createState();
}

export type ApiResult = {
  status: number;
  body: unknown;
};

const ok = (body: unknown, status = 200): ApiResult => ({ status, body });
const fail = (status: number, error: string, details?: Record<string, string>): ApiResult => ({
  status,
  body: { error, details },
});

function listPets(query: URLSearchParams): ApiResult {
  const q = (query.get("q") ?? "").trim().toLowerCase();
  const species = query.get("species");
  const exclude = Number(query.get("exclude") ?? 0);
  const sort = query.get("sort") ?? "featured";
  const limit = Number(query.get("limit") ?? PAGE_SIZE);
  let items = state.pets.filter((pet) => {
    if (pet.id === exclude) return false;
    if (species && pet.species !== species) return false;
    return !q || `${pet.name} ${pet.breed} ${pet.species}`.toLowerCase().includes(q);
  });

  if (sort === "price-asc") items = [...items].sort((a, b) => a.price - b.price);
  if (sort === "price-desc") items = [...items].sort((a, b) => b.price - a.price);
  if (sort === "name") items = [...items].sort((a, b) => a.name.localeCompare(b.name));

  const pages = Math.max(1, Math.ceil(items.length / limit));
  const page = Math.min(Math.max(1, Number(query.get("page") ?? 1)), pages);

  return ok({
    items: items.slice((page - 1) * limit, page * limit),
    total: items.length,
    page,
    pages,
  });
}

function findPet(id: string): Pet | undefined {
  return state.pets.find((pet) => pet.id === Number(id));
}

function validatePet(input: Partial<Pet>): Record<string, string> {
  const details: Record<string, string> = {};
  if (!input.name?.trim()) details.name = "A name is required";
  if (!Number.isFinite(input.price) || (input.price as number) < 0) details.price = "The price must be 0 or more";
  if (!Number.isInteger(input.stock) || (input.stock as number) < 0) details.stock = "The stock must be a whole number";
  return details;
}

function createOrder(input: {
  items?: Array<{ petId: number; quantity: number }>;
  customer?: Customer;
  card?: string;
}): ApiResult {
  if (!input.items?.length) return fail(400, "The cart is empty");
  if (!input.customer?.name || !input.customer.email || !input.customer.address) return fail(400, "Customer details are incomplete");
  if ((input.card ?? "").endsWith("0000")) return fail(402, "The card was declined");

  const lines: OrderLine[] = [];
  for (const { petId, quantity } of input.items) {
    const pet = state.pets.find((entry) => entry.id === petId);
    if (!pet) return fail(409, "A pet in your cart is no longer available");
    if (pet.stock < quantity) return fail(409, `Only ${pet.stock} of ${pet.name} left`);
    lines.push({ petId, name: pet.name, price: pet.price, quantity });
  }

  for (const line of lines) {
    state.pets.find((pet) => pet.id === line.petId)!.stock -= line.quantity;
  }

  const order: Order = {
    id: String(state.nextOrderId++),
    lines,
    total: lines.reduce((sum, line) => sum + line.price * line.quantity, 0),
    customer: input.customer,
    status: "paid",
    createdAt: new Date().toISOString().slice(0, 10),
  };
  state.orders.unshift(order);
  return ok(order, 201);
}

function cancelOrder(id: string): ApiResult {
  const order = state.orders.find((entry) => entry.id === id);
  if (!order) return fail(404, "Order not found");
  if (order.status === "cancelled") return fail(409, "This order is already cancelled");

  order.status = "cancelled";
  for (const line of order.lines) {
    const pet = state.pets.find((entry) => entry.id === line.petId);
    if (pet) pet.stock += line.quantity;
  }
  return ok(order);
}

export async function handleApi(method = "GET", url: string, rawBody = "", authorization?: string): Promise<ApiResult> {
  const { pathname, searchParams } = new URL(url, "http://shop.local");
  const parts = pathname.replace(/^\/api\//, "").split("/");
  const body = rawBody ? JSON.parse(rawBody) : {};
  const isAdmin = authorization === `Bearer ${ADMIN_TOKEN}`;
  const [resource, id, action] = parts;

  if (resource === "login" && method === "POST") {
    if (body.name === "admin" && body.password === "admin") {
      return ok({ token: ADMIN_TOKEN, user: { name: "Admin", role: "admin" } });
    }
    return fail(401, "Wrong name or password");
  }

  if (resource === "pets") {
    if (!id) {
      if (method === "GET") return listPets(searchParams);
      if (method === "POST") {
        if (!isAdmin) return fail(401, "Please sign in as an admin");
        const details = validatePet(body);
        if (Object.keys(details).length > 0) return fail(400, "Please check the form", details);
        const pet: Pet = { emoji: "🐾", breed: "Unknown", age: 1, description: "", species: "dog", ...body, id: state.nextPetId++ };
        state.pets.push(pet);
        return ok(pet, 201);
      }
    }

    const pet = findPet(id!);
    if (!pet) return fail(404, `Pet ${id} was not found`);

    if (action === "reviews") {
      if (method === "GET") return ok(state.reviews.filter((review) => review.petId === pet.id));
      if (method === "POST") {
        const details: Record<string, string> = {};
        if (!body.author?.trim()) details.author = "Your name is required";
        if (!(body.rating >= 1 && body.rating <= 5)) details.rating = "Pick a rating from 1 to 5";
        if (!body.text?.trim()) details.text = "Please write something";
        if (Object.keys(details).length > 0) return fail(400, "Please check the form", details);
        const review: Review = {
          id: state.nextReviewId++,
          petId: pet.id,
          author: body.author,
          rating: body.rating,
          text: body.text,
          createdAt: new Date().toISOString().slice(0, 10),
        };
        state.reviews.push(review);
        return ok(review, 201);
      }
    }

    if (method === "GET") return ok(pet);

    if (!isAdmin) return fail(401, "Please sign in as an admin");

    if (method === "PATCH") {
      const next = { ...pet, ...body };
      const details = validatePet(next);
      if (Object.keys(details).length > 0) return fail(400, "Please check the form", details);
      Object.assign(pet, body);
      return ok(pet);
    }

    if (method === "DELETE") {
      state.pets = state.pets.filter((entry) => entry.id !== pet.id);
      return ok({ deleted: pet.id });
    }
  }

  if (resource === "orders") {
    if (!id && method === "POST") return createOrder(body);
    if (!id && method === "GET") return ok(state.orders);
    if (id && action === "cancel" && method === "POST") return cancelOrder(id);
    if (id && method === "GET") {
      const order = state.orders.find((entry) => entry.id === id);
      return order ? ok(order) : fail(404, `Order ${id} was not found`);
    }
  }

  return fail(404, "Not found");
}
