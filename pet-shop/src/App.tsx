import { onMount } from "hel/runtime";
import { Header } from "./components/Header";
import { Toasts } from "./components/Toasts";
import { Preloaded } from "./lib/api";
import { router } from "./router";
import { cart } from "./state/cart";
import { restoreFavorites } from "./state/favorites";
import { session } from "./state/session";

export function App(props: { preloaded?: Record<string, unknown> }) {
  // Browser storage is unknown to the server, so it must not take part in hydration.
  onMount(() => {
    cart.restore();
    session.restore();
    restoreFavorites();
  });

  return (
    <Preloaded.Provider value={props.preloaded ?? {}}>
      <Header />
      <main class="page">{router.view()}</main>
      <footer class="site-footer">Built with Hel, in plain TypeScript.</footer>
      <Toasts />
    </Preloaded.Provider>
  );
}
