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
          <span class="announcement-pill">v0.1</span>
          <span>First public preview — compiler, SSR, hydration, and routing are shipping.</span>
          <a href="/docs">Read the release notes &rarr;</a>
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
            <a class="utility-link utility-link-strong" href="/examples">Playground</a>
            <a class="utility-link github-icon-link" href="https://github.com/user/hel" target="_blank" rel="noopener" aria-label="GitHub">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            </a>
          </div>
        </div>
      </header>

      <main class="site-shell">
        <section class="site-content">{router.view()}</section>
      </main>

      <footer class="site-footer panel-surface">
        <div class="footer-brand">
          <img class="footer-logo" src="/hel-192.png" alt="Hel" width="128" height="128" />
          <div class="footer-brand-copy">
            <strong>Hel</strong>
            <p>Small enough to understand.<br />Sharp enough to ship.</p>
          </div>
        </div>

        <div class="footer-col">
          <strong class="footer-col-title">Resources</strong>
          <a href="/docs">Documentation</a>
          <a href="/examples">Examples</a>
          <a href="/about">About</a>
        </div>

        <div class="footer-col">
          <strong class="footer-col-title">Community</strong>
          <a href="https://github.com/user/hel" target="_blank" rel="noopener">GitHub</a>
          <a href="https://github.com/user/hel/discussions" target="_blank" rel="noopener">Discussions</a>
        </div>
      </footer>
    </div>
  );
}
