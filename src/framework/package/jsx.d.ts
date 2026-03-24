declare namespace JSX {
  type Element = Node;

  interface IntrinsicElements {
    [tagName: string]: Record<string, unknown>;
  }
}
