import { createRouter, ErrorBoundary } from "heljs/runtime";
import { ErrorNotice } from "./components/ui";
import { AdminPage } from "./pages/AdminPage";
import { CartPage } from "./pages/CartPage";
import { CatalogPage } from "./pages/CatalogPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { LoginPage } from "./pages/LoginPage";
import { OrderPage, OrdersPage } from "./pages/OrdersPage";
import { PetPage } from "./pages/PetPage";
import { session } from "./state/session";

export const router = createRouter([
  { path: "/", view: () => <CatalogPage /> },
  {
    path: "/pets/:id",
    // Reading the id here starts every pet fresh, including the boundary.
    view: () => {
      const id = router.params().id ?? "";
      return (
        <ErrorBoundary fallback={(error: unknown, retry: () => void) => <ErrorNotice error={error} onRetry={retry} />}>
          <PetPage id={id} />
        </ErrorBoundary>
      );
    },
  },
  { path: "/cart", view: () => <CartPage /> },
  { path: "/checkout", view: () => <CheckoutPage /> },
  { path: "/orders", view: () => <OrdersPage /> },
  {
    path: "/orders/:id",
    view: () => {
      const id = router.params().id ?? "";
      return <OrderPage id={id} />;
    },
  },
  { path: "/login", view: () => <LoginPage /> },
  {
    path: "/admin",
    view: () =>
      session.isAdmin ? (
        <AdminPage />
      ) : (
        <p class="notice" id="admin-locked">This page is for admins. <a href={router.href("/login", { next: "/admin" })}>Sign in</a></p>
      ),
  },
]);
