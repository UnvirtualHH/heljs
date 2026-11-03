import "./styles.css";
import { mount } from "heljs/runtime";
import { App } from "./App";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app root");
}

mount(() => <App />, root);
