import { renderToString } from "hel/server";
import { App } from "./App";

export function renderApp() {
  return renderToString(() => <App />);
}
