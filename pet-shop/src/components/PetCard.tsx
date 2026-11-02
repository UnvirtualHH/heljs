import { money } from "../lib/urls";
import { cart } from "../state/cart";
import { isFavorite, toggleFavorite } from "../state/favorites";
import { toasts } from "../state/toasts";
import type { Pet } from "../types";

export function PetCard(props: { pet: Pet }) {
  const soldOut = props.pet.stock === 0;

  function addToCart() {
    cart.add(props.pet);
    toasts.show(`${props.pet.name} is in your cart`);
  }

  return (
    <article class="card">
      <button
        type="button"
        class="favorite"
        aria-pressed={isFavorite(props.pet.id) ? "true" : "false"}
        aria-label={`Favorite ${props.pet.name}`}
        onClick={() => toggleFavorite(props.pet.id)}
      >
        {isFavorite(props.pet.id) ? "♥" : "♡"}
      </button>
      <a class="card-link" href={`/pets/${props.pet.id}`}>
        <span class="card-emoji">{props.pet.emoji}</span>
        <h3>{props.pet.name}</h3>
        <p class="muted">{props.pet.breed}, {props.pet.age} years</p>
      </a>
      <div class="card-footer">
        <strong>{money(props.pet.price)}</strong>
        <button type="button" class="add" disabled={soldOut} onClick={addToCart}>
          {soldOut ? "Sold out" : "Add to cart"}
        </button>
      </div>
    </article>
  );
}
