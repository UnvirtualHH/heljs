import { For } from "heljs/runtime";
import { ErrorNotice, Field, Spinner } from "../components/ui";
import { ApiError, deleteJson, patchJson, postJson, useApi } from "../lib/api";
import { ADMIN_PETS_URL, petUrl } from "../lib/urls";
import { toasts } from "../state/toasts";
import type { Catalog, Pet, Species } from "../types";

function AdminRow(props: { pet: Pet; onChanged: () => void }) {
  let price = props.pet.price;
  let stock = props.pet.stock;
  let saving = false;
  let confirming = false;

  const dirty = price !== props.pet.price || stock !== props.pet.stock;

  async function save() {
    saving = true;

    try {
      await patchJson(petUrl(props.pet.id), { price, stock });
      toasts.show(`${props.pet.name} was saved`);
      props.onChanged();
    } catch (error) {
      toasts.show(error instanceof Error ? error.message : String(error), "error");
    } finally {
      saving = false;
    }
  }

  async function remove() {
    await deleteJson(petUrl(props.pet.id));
    toasts.show(`${props.pet.name} was removed`);
    props.onChanged();
  }

  return (
    <tr data-pet={props.pet.id}>
      <td>{props.pet.emoji} {props.pet.name}</td>
      <td>
        <input class="price-input" type="number" min="0" aria-label={`Price of ${props.pet.name}`} value={price} onInput={(event: Event) => { price = Number((event.target as HTMLInputElement).value); }} />
      </td>
      <td>
        <input class="stock-input" type="number" min="0" aria-label={`Stock of ${props.pet.name}`} value={stock} onInput={(event: Event) => { stock = Number((event.target as HTMLInputElement).value); }} />
      </td>
      <td>
        <button type="button" class="save" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        {confirming ? (
          <span>
            <button type="button" class="confirm-delete" onClick={remove}>Really delete</button>
            <button type="button" class="link" onClick={() => { confirming = false; }}>Keep</button>
          </span>
        ) : (
          <button type="button" class="link delete" onClick={() => { confirming = true; }}>Delete</button>
        )}
      </td>
    </tr>
  );
}

function NewPetForm(props: { onCreated: () => void }) {
  let name = "";
  let species: Species = "dog";
  let price = 100;
  let stock = 1;
  let saving = false;
  let errors: Record<string, string> = {};

  async function submit(event: Event) {
    event.preventDefault();
    saving = true;
    errors = {};

    try {
      await postJson<Pet>("/api/pets", { name, species, price, stock });
      toasts.show(`${name} was added`);
      name = "";
      props.onCreated();
    } catch (error) {
      errors = error instanceof ApiError && error.status === 400 ? error.details : { form: String(error) };
    } finally {
      saving = false;
    }
  }

  return (
    <form id="new-pet" class="inline-form" onSubmit={submit}>
      <Field id="new-name" label="Name" value={name} error={errors.name} onInput={(value) => { name = value; }} />
      <div class="field">
        <label htmlFor="new-species">Species</label>
        <select id="new-species" value={species} onChange={(event: Event) => { species = (event.target as HTMLSelectElement).value as Species; }}>
          <option value="dog">Dog</option>
          <option value="cat">Cat</option>
          <option value="bird">Bird</option>
          <option value="fish">Fish</option>
          <option value="reptile">Reptile</option>
        </select>
      </div>
      <Field id="new-price" label="Price" type="number" value={price} error={errors.price} onInput={(value) => { price = Number(value); }} />
      <Field id="new-stock" label="Stock" type="number" value={stock} error={errors.stock} onInput={(value) => { stock = Number(value); }} />
      <button type="submit" disabled={saving}>{saving ? "Adding…" : "Add pet"}</button>
      {errors.form ? <p class="error-text">{errors.form}</p> : null}
    </form>
  );
}

export function AdminPage() {
  const pets = useApi<Catalog>(() => ADMIN_PETS_URL, { keepPrevious: true });

  return (
    <section>
      <h1>Manage pets</h1>
      <NewPetForm onCreated={pets.refetch} />
      {pets.error ? (
        <ErrorNotice error={pets.error} onRetry={pets.refetch} />
      ) : (
        <table class="table" id="admin-table">
          <thead>
            <tr><th>Pet</th><th>Price</th><th>Stock</th><th></th></tr>
          </thead>
          <tbody>
            <For
              each={pets.value?.items ?? []}
              key={(pet: Pet) => pet.id}
              fallback={<tr><td colspan="4"><Spinner /></td></tr>}
            >
              {(pet: Pet) => <AdminRow pet={pet} onChanged={pets.refetch} />}
            </For>
          </tbody>
        </table>
      )}
    </section>
  );
}
