import type { Session, User } from "../types";

const STORAGE_KEY = "hel-pet-shop.session";

export function useSession() {
  // A plain annotation would be narrowed to null for the code below.
  let user = null as User | null;
  let token = "";

  const isAdmin = user?.role === "admin";

  function start(next: Session) {
    user = next.user;
    token = next.token;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function end() {
    user = null;
    token = "";
    sessionStorage.removeItem(STORAGE_KEY);
  }

  function restore() {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      start(JSON.parse(saved));
    }
  }

  return { user, token, isAdmin, start, end, restore };
}

export const session = useSession();
