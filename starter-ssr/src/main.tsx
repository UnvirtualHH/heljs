import "./styles.css";
import { hydrate, mount } from "hel/runtime";
import { App } from "./App";

const root = document.getElementById("app");
if (!(root instanceof Element)) {
  throw new Error("Missing #app root");
}

if (root.firstChild) {
  hydrate(() => <App />, root);
} else {
  mount(() => <App />, root);
}
