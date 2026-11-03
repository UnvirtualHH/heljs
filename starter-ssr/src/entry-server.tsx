import { renderToString } from "heljs/server";
import { App } from "./App";

export function renderApp() {
  return renderToString(() => <App />);
}
