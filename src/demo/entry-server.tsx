import { App } from "./App";
import { renderToString } from "../framework/server/index";

export function renderApp(): string {
  return renderToString(() => App());
}
