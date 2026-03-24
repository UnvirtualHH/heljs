declare module "react" {
  export function createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
}

declare module "react-dom/client" {
  export type ReactRoot = {
    render(node: unknown): void;
    unmount(): void;
  };

  export function createRoot(container: Element | DocumentFragment): ReactRoot;
}

declare module "react-dom" {
  export function flushSync<T>(fn: () => T): T;
}
