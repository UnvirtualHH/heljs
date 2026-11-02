import { router } from "../router";
import { cart } from "../state/cart";
import { favorites } from "../state/favorites";
import { session } from "../state/session";
import { CartIcon } from "./ui";

export function Header() {
  function signOut() {
    session.end();
    router.navigate("/");
  }

  return (
    <header class="site-header">
      <a class="brand" href="/">🐾 Hel Pet Shop</a>
      <nav>
        <a href="/" class={router.currentPath() === "/" ? "active" : ""}>Pets</a>
        <a href="/orders" class={router.currentPath().startsWith("/orders") ? "active" : ""}>Orders</a>
        <a href="/admin" class={router.currentPath() === "/admin" ? "active" : ""}>Admin</a>
      </nav>
      <div class="header-side">
        <span class="muted" title="Favorites">♥ {favorites.ids.length}</span>
        {session.user ? (
          <span>
            {session.user.name} <button type="button" class="link" onClick={signOut}>Sign out</button>
          </span>
        ) : (
          <a href="/login">Sign in</a>
        )}
        <a class="cart-link" href="/cart" aria-label="Cart">
          <CartIcon />
          <span id="cart-count">{cart.count}</span>
        </a>
      </div>
    </header>
  );
}
