import { Field } from "../components/ui";
import { postJson } from "../lib/api";
import { router } from "../router";
import { session } from "../state/session";
import type { Session } from "../types";

export function LoginPage() {
  let name = "";
  let password = "";
  let failure = "";
  let saving = false;

  async function submit(event: Event) {
    event.preventDefault();
    saving = true;
    failure = "";

    try {
      session.start(await postJson<Session>("/api/login", { name, password }));
      router.navigate(router.query().next ?? "/");
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      saving = false;
    }
  }

  return (
    <section class="narrow">
      <h1>Sign in</h1>
      <form id="login-form" onSubmit={submit}>
        <Field id="login-name" label="Name" value={name} hint="Try admin / admin." onInput={(value) => { name = value; }} />
        <Field id="login-password" label="Password" type="password" value={password} onInput={(value) => { password = value; }} />
        {failure ? <p class="notice notice-error" role="alert" id="login-failure">{failure}</p> : null}
        <button type="submit" disabled={saving}>{saving ? "Signing in…" : "Sign in"}</button>
      </form>
    </section>
  );
}
