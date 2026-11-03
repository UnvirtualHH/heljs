import { For } from "heljs/runtime";
import { ApiError, postJson, useApi } from "../lib/api";
import { reviewsUrl } from "../lib/urls";
import type { Review } from "../types";
import { ErrorNotice, Field, Spinner } from "./ui";

function ReviewForm(props: { petId: number; onAdded: () => void }) {
  let author = "";
  let rating = 5;
  let text = "";
  let saving = false;
  let errors: Record<string, string> = {};

  async function submit(event: Event) {
    event.preventDefault();
    saving = true;
    errors = {};

    try {
      await postJson(reviewsUrl(props.petId), { author, rating, text });
      author = "";
      rating = 5;
      text = "";
      props.onAdded();
    } catch (error) {
      errors = error instanceof ApiError && error.status === 400 ? error.details : { form: String(error) };
    } finally {
      saving = false;
    }
  }

  return (
    <form class="review-form" onSubmit={submit}>
      <h3>Write a review</h3>
      <Field id="review-author" label="Your name" value={author} error={errors.author} onInput={(value) => { author = value; }} />
      <div class="field">
        <label htmlFor="review-rating">Rating</label>
        <select id="review-rating" value={rating} onChange={(event: Event) => { rating = Number((event.target as HTMLSelectElement).value); }}>
          <option value="5">5 stars</option>
          <option value="4">4 stars</option>
          <option value="3">3 stars</option>
          <option value="2">2 stars</option>
          <option value="1">1 star</option>
        </select>
      </div>
      <div class={errors.text ? "field field-invalid" : "field"}>
        <label htmlFor="review-text">Review</label>
        <textarea id="review-text" value={text} onInput={(event: Event) => { text = (event.target as HTMLTextAreaElement).value; }} />
        {errors.text ? <small class="error-text">{errors.text}</small> : null}
      </div>
      {errors.form ? <p class="error-text">{errors.form}</p> : null}
      <button type="submit" disabled={saving}>{saving ? "Sending…" : "Send review"}</button>
    </form>
  );
}

export function ReviewList(props: { petId: number }) {
  const reviews = useApi<Review[]>(() => reviewsUrl(props.petId));
  const average = reviews.value?.length
    ? reviews.value.reduce((sum, review) => sum + review.rating, 0) / reviews.value.length
    : 0;

  return (
    <section>
      <h2 id="reviews-title">Reviews{average > 0 ? ` (${average.toFixed(1)} of 5)` : ""}</h2>
      {reviews.error ? (
        <ErrorNotice error={reviews.error} onRetry={reviews.refetch} />
      ) : (
        <ul class="reviews" id="reviews">
          <For each={reviews.value ?? []} key={(review: Review) => review.id} fallback={reviews.loading ? <Spinner /> : <li class="muted">No reviews yet.</li>}>
            {(review: Review) => (
              <li>
                <strong>{review.author}</strong> <span class="muted">{"★".repeat(review.rating)}, {review.createdAt}</span>
                <p>{review.text}</p>
              </li>
            )}
          </For>
        </ul>
      )}
      <ReviewForm petId={props.petId} onAdded={reviews.refetch} />
    </section>
  );
}
