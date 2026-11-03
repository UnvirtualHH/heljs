import { For } from "heljs/runtime";
import { PetCard } from "../components/PetCard";
import { ReviewList } from "../components/ReviewList";
import { Spinner } from "../components/ui";
import { useApi } from "../lib/api";
import { money, petUrl, relatedUrl } from "../lib/urls";
import { cart } from "../state/cart";
import { toasts } from "../state/toasts";
import type { Catalog, Pet } from "../types";

function PetDetails(props: { pet: Pet }) {
  let quantity = 1;

  const inCart = cart.lines.find((line) => line.pet.id === props.pet.id)?.quantity ?? 0;
  const available = props.pet.stock - inCart;

  function add() {
    cart.add(props.pet, quantity);
    toasts.show(`${quantity} × ${props.pet.name} added to your cart`);
    quantity = 1;
  }

  return (
    <article class="pet">
      <div class="pet-emoji">{props.pet.emoji}</div>
      <div>
        <h1>{props.pet.name}</h1>
        <p class="muted">{props.pet.breed}, {props.pet.age} years old</p>
        <p>{props.pet.description}</p>
        <p class="price">{money(props.pet.price)}</p>
        <p class="muted" id="stock">
          {props.pet.stock === 0 ? "Out of stock" : `${props.pet.stock} in stock`}
          {inCart > 0 ? `, ${inCart} in your cart` : ""}
        </p>
        <div class="buy">
          <button type="button" aria-label="Less" disabled={quantity <= 1} onClick={() => { quantity -= 1; }}>−</button>
          <output id="quantity">{quantity}</output>
          <button type="button" aria-label="More" disabled={quantity >= available} onClick={() => { quantity += 1; }}>+</button>
          <button type="button" class="add" disabled={available <= 0} onClick={add}>Add to cart</button>
        </div>
      </div>
    </article>
  );
}

function RelatedPets(props: { url: string }) {
  const related = useApi<Catalog>(() => props.url);

  return (
    <section>
      <h2>You might also like</h2>
      <div class="grid" id="related">
        <For each={related.value?.items ?? []} key={(pet: Pet) => pet.id} fallback={related.loading ? <Spinner /> : <p class="muted">Nothing similar right now.</p>}>
          {(pet: Pet) => <PetCard pet={pet} />}
        </For>
      </div>
    </section>
  );
}

// Failures reach the route's ErrorBoundary by reading pet.value.
export function PetPage(props: { id: string }) {
  const pet = useApi<Pet>(() => petUrl(props.id));

  return (
    <div>
      <p><a href="/">← All pets</a></p>
      {pet.value ? (
        <div>
          <PetDetails pet={pet.value} />
          <ReviewList petId={pet.value.id} />
          <RelatedPets url={relatedUrl(pet.value)} />
        </div>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
