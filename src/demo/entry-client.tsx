import { hydrate, mount } from "@hel/runtime";
import { App } from "./App";
import "./styles.css";

const root = document.querySelector("#app");
if (!(root instanceof Element)) {
  throw new Error("Missing #app root element");
}

const hasPreRenderedMarkup = root.firstChild !== null;

if (hasPreRenderedMarkup) {
  hydrate(() => App(), root);
} else {
  mount(() => App(), root);
}
