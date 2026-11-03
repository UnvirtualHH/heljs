import { Field } from "../components/ui";
import { postJson } from "../lib/api";
import { money, ORDERS_URL } from "../lib/urls";
import { router } from "../router";
import { cart } from "../state/cart";
import { toasts } from "../state/toasts";
import type { Order } from "../types";

function validate(values: { name: string; email: string; address: string; card: string }) {
  const errors: Record<string, string> = {};
  if (!values.name.trim()) errors.name = "Please enter your name";
  if (!/^[^@\s]+@[^@\s]+$/.test(values.email)) errors.email = "Please enter a valid email address";
  if (values.address.trim().length < 5) errors.address = "Please enter your full address";
  if (!/^\d{16}$/.test(values.card.replaceAll(" ", ""))) errors.card = "A card number has 16 digits";
  return errors;
}

export function CheckoutPage() {
  let name = "";
  let email = "";
  let address = "";
  let card = "";
  let submitted = false;
  let saving = false;
  let failure = "";

  const errors = validate({ name, email, address, card });
  const valid = Object.keys(errors).length === 0;
  const shown = submitted ? errors : {};

  async function submit(event: Event) {
    event.preventDefault();
    submitted = true;

    if (!valid) {
      return;
    }

    saving = true;
    failure = "";

    try {
      const order = await postJson<Order>(ORDERS_URL, {
        items: cart.lines.map((line) => ({ petId: line.pet.id, quantity: line.quantity })),
        customer: { name, email, address },
        card: card.replaceAll(" ", ""),
      });
      cart.clear();
      toasts.show(`Thank you! Order ${order.id} is on its way.`);
      router.navigate(`/orders/${order.id}`);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      saving = false;
    }
  }

  return (
    <section class="checkout">
      <h1>Checkout</h1>
      {cart.count === 0 ? (
        <p class="notice">There is nothing to check out. <a href="/">Find a pet</a></p>
      ) : (
        <form id="checkout-form" onSubmit={submit} novalidate>
          <Field id="name" label="Name" value={name} error={shown.name} onInput={(value) => { name = value; }} />
          <Field id="email" label="Email" type="email" value={email} error={shown.email} onInput={(value) => { email = value; }} />
          <Field id="address" label="Address" value={address} error={shown.address} onInput={(value) => { address = value; }} />
          <Field
            id="card"
            label="Card number"
            value={card}
            error={shown.card}
            hint="A number ending in 0000 is declined."
            onInput={(value) => { card = value; }}
          />
          {failure ? <p class="notice notice-error" role="alert" id="checkout-failure">{failure}</p> : null}
          <p class="muted">Total: <strong id="checkout-total">{money(cart.total)}</strong></p>
          <button type="submit" disabled={saving}>{saving ? "Paying…" : "Pay now"}</button>
        </form>
      )}
    </section>
  );
}
