import { App } from "./App";
import { renderToString } from "./framework/server";

export function renderApp(): string {
  return renderToString(() => App());
}
