import { For } from "heljs/runtime";
import { money } from "../lib/urls";
import { cart, type CartLine } from "../state/cart";

function CartRow(props: { line: CartLine }) {
  return (
    <tr>
      <td><a href={`/pets/${props.line.pet.id}`}>{props.line.pet.emoji} {props.line.pet.name}</a></td>
      <td>{money(props.line.pet.price)}</td>
      <td>
        <input
          type="number"
          min="0"
          aria-label={`Quantity of ${props.line.pet.name}`}
          value={props.line.quantity}
          onInput={(event: Event) => {
            const value = Number((event.target as HTMLInputElement).value);
            if (Number.isInteger(value) && value >= 0) {
              cart.setQuantity(props.line.pet.id, value);
            }
          }}
        />
      </td>
      <td>{money(props.line.pet.price * props.line.quantity)}</td>
      <td><button type="button" class="link" onClick={() => cart.remove(props.line.pet.id)}>Remove</button></td>
    </tr>
  );
}

export function CartPage() {
  return (
    <section>
      <h1>Your cart</h1>
      {cart.count === 0 ? (
        <p class="notice">Your cart is empty. <a href="/">Find a pet</a></p>
      ) : (
        <div>
          <table class="table" id="cart-table">
            <thead>
              <tr><th>Pet</th><th>Price</th><th>Quantity</th><th>Total</th><th></th></tr>
            </thead>
            <tbody>
              <For each={cart.lines} key={(line: CartLine) => line.pet.id}>
                {(line: CartLine) => <CartRow line={line} />}
              </For>
            </tbody>
          </table>
          <dl class="totals">
            <dt>Subtotal</dt><dd id="subtotal">{money(cart.subtotal)}</dd>
            <dt>Shipping</dt><dd id="shipping">{cart.shipping === 0 ? "Free" : money(cart.shipping)}</dd>
            <dt>Total</dt><dd id="total"><strong>{money(cart.total)}</strong></dd>
          </dl>
          <p><a class="button" href="/checkout">Continue to checkout</a></p>
        </div>
      )}
    </section>
  );
}
