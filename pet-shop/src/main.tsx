import "./styles.css";
import { hydrate, mount } from "hel/runtime";
import { App } from "./App";

declare global {
  interface Window {
    __DATA__?: Record<string, unknown>;
  }
}

const root = document.getElementById("app");
if (!(root instanceof Element)) {
  throw new Error("Missing #app root");
}

const hasServerHtml = Array.from(root.childNodes).some((node) => node.nodeType === Node.ELEMENT_NODE);

if (hasServerHtml) {
  hydrate(() => <App preloaded={window.__DATA__} />, root);
} else {
  root.replaceChildren();
  mount(() => <App />, root);
}
