export type CatalogQuery = {
  q?: string;
  species?: string;
  sort?: string;
  page?: string | number;
};

export function catalogUrl({ q, species, sort, page }: CatalogQuery): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (species) params.set("species", species);
  if (sort) params.set("sort", sort);
  if (page && Number(page) > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/api/pets?${search}` : "/api/pets";
}

export function relatedUrl(pet: { id: number; species: string }): string {
  return `/api/pets?species=${pet.species}&exclude=${pet.id}&limit=3`;
}

export const petUrl = (id: string | number) => `/api/pets/${id}`;
export const reviewsUrl = (id: string | number) => `/api/pets/${id}/reviews`;
export const orderUrl = (id: string | number) => `/api/orders/${id}`;
export const ORDERS_URL = "/api/orders";
export const ADMIN_PETS_URL = "/api/pets?limit=100&sort=name";

export const money = (amount: number) => `${amount.toLocaleString("en-US")} €`;
