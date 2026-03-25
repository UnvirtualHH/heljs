import { createRouter } from "hel/runtime";
import { AboutPage } from "./pages/AboutPage";
import { DocsPage } from "./pages/DocsPage";
import { ExamplesPage } from "./pages/ExamplesPage";
import { HomePage } from "./pages/HomePage";

export function App() {
  const router = createRouter([
    { path: "/", view: () => <HomePage /> },
    { path: "/docs", view: () => <DocsPage /> },
    { path: "/examples", view: () => <ExamplesPage /> },
    { path: "/about", view: () => <AboutPage /> },
  ]);

  return (
    <div class="site-frame">
      <div class="site-glow site-glow-left"></div>
      <div class="site-glow site-glow-right"></div>

      <header class="topbar-wrap">
        <div class="announcement-bar">
          <span class="announcement-pill">New</span>
          <span>Hel already ships SSR, hydration, routing, context, and package starters.</span>
          <a href="/examples">See the live examples</a>
        </div>

        <div class="topbar">
          <a class="brand-lockup" href="/" aria-label="Hel home">
            <img class="brand-mark" src="/hel-192.png" alt="Hel logo" width="52" height="52" />
            <span class="brand-copy">
              <strong>Hel</strong>
              <span>Compiler-first web framework</span>
            </span>
          </a>

          <nav class="site-nav" aria-label="Primary navigation">
            <a class="site-link" data-active={router.isActive("/")} href="/">
              Home
            </a>
            <a class="site-link" data-active={router.isActive("/docs")} href="/docs">
              Docs
            </a>
            <a class="site-link" data-active={router.isActive("/examples")} href="/examples">
              Examples
            </a>
            <a class="site-link" data-active={router.isActive("/about")} href="/about">
              About
            </a>
          </nav>

          <div class="topbar-actions">
            <a class="utility-link" href="/docs">Get started</a>
            <a class="utility-link utility-link-strong" href="/examples">Open playground</a>
          </div>
        </div>
      </header>

      <main class="site-shell">
        <section class="site-content">{router.view()}</section>
      </main>

      <footer class="site-footer panel-surface">
        <div>
          <strong>Hel</strong>
          <p>Small enough to understand. Sharp enough to ship.</p>
        </div>

        <div class="footer-links">
          <a href="/docs">Docs</a>
          <a href="/examples">Examples</a>
          <a href="/about">About</a>
        </div>
      </footer>
    </div>
  );
}
