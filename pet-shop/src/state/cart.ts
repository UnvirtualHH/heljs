import type { Pet } from "../types";

export type CartLine = {
  pet: Pet;
  quantity: number;
};

const STORAGE_KEY = "hel-pet-shop.cart";
const FREE_SHIPPING_FROM = 200;
const SHIPPING = 15;

export function useCart() {
  let lines: CartLine[] = [];

  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = lines.reduce((sum, line) => sum + line.pet.price * line.quantity, 0);
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING;
  const total = subtotal + shipping;

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }

  function add(pet: Pet, quantity = 1) {
    const existing = lines.find((line) => line.pet.id === pet.id);
    lines = existing
      ? lines.map((line) => (line === existing ? { ...line, quantity: line.quantity + quantity } : line))
      : [...lines, { pet, quantity }];
    save();
  }

  function setQuantity(petId: number, quantity: number) {
    lines = quantity <= 0
      ? lines.filter((line) => line.pet.id !== petId)
      : lines.map((line) => (line.pet.id === petId ? { ...line, quantity } : line));
    save();
  }

  function remove(petId: number) {
    setQuantity(petId, 0);
  }

  function clear() {
    lines = [];
    save();
  }

  function restore() {
    lines = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  }

  return { lines, count, subtotal, shipping, total, add, setQuantity, remove, clear, restore };
}

export const cart = useCart();
