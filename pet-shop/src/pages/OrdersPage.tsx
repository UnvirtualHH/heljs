import { For } from "heljs/runtime";
import { ErrorNotice, Spinner } from "../components/ui";
import { postJson, useApi } from "../lib/api";
import { money, ORDERS_URL, orderUrl } from "../lib/urls";
import { toasts } from "../state/toasts";
import type { Order, OrderLine } from "../types";

export function OrdersPage() {
  const orders = useApi<Order[]>(() => ORDERS_URL);

  return (
    <section>
      <h1>Your orders</h1>
      {orders.error ? (
        <ErrorNotice error={orders.error} onRetry={orders.refetch} />
      ) : (
        <ul class="orders" id="orders">
          <For
            each={orders.value ?? []}
            key={(order: Order) => order.id}
            fallback={orders.loading ? <Spinner /> : <li class="notice">You have not ordered anything yet.</li>}
          >
            {(order: Order) => (
              <li>
                <a href={`/orders/${order.id}`}>Order {order.id}</a>
                <span class="muted">{order.createdAt}</span>
                <span class={`badge badge-${order.status}`}>{order.status}</span>
                <strong>{money(order.total)}</strong>
              </li>
            )}
          </For>
        </ul>
      )}
    </section>
  );
}

export function OrderPage(props: { id: string }) {
  const order = useApi<Order>(() => orderUrl(props.id));
  let cancelling = false;

  async function cancel() {
    cancelling = true;

    try {
      await postJson(`${orderUrl(props.id)}/cancel`);
      toasts.show("The order was cancelled");
      order.refetch();
    } catch (error) {
      toasts.show(error instanceof Error ? error.message : String(error), "error");
    } finally {
      cancelling = false;
    }
  }

  return (
    <section>
      <p><a href="/orders">← All orders</a></p>
      {order.error ? (
        <ErrorNotice error={order.error} onRetry={order.refetch} />
      ) : order.value ? (
        <article id="order">
          <h1>Order {order.value.id}</h1>
          <p>
            <span class={`badge badge-${order.value.status}`} id="order-status">{order.value.status}</span>
            <span class="muted"> {order.value.createdAt}, for {order.value.customer.name}</span>
          </p>
          <ul>
            <For each={order.value.lines} key={(line: OrderLine) => line.petId}>
              {(line: OrderLine) => <li>{line.quantity} × {line.name}, {money(line.price * line.quantity)}</li>}
            </For>
          </ul>
          <p>Total: <strong>{money(order.value.total)}</strong></p>
          {order.value.status === "paid" ? (
            <button type="button" id="cancel-order" disabled={cancelling} onClick={cancel}>
              {cancelling ? "Cancelling…" : "Cancel order"}
            </button>
          ) : null}
        </article>
      ) : (
        <Spinner />
      )}
    </section>
  );
}
