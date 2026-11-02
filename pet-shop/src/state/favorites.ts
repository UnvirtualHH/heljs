import { store } from "hel/runtime";

const STORAGE_KEY = "hel-pet-shop.favorites";

export const favorites = store({ ids: [] as number[] });

export function isFavorite(id: number): boolean {
  return favorites.ids.includes(id);
}

export function toggleFavorite(id: number): void {
  const index = favorites.ids.indexOf(id);

  if (index >= 0) {
    favorites.ids.splice(index, 1);
  } else {
    favorites.ids.push(id);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites.ids));
}

export function restoreFavorites(): void {
  favorites.ids = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
}
