import { helMagicPlugin } from "./plugin";

export type MeasureRow = {
  name: string;
  codeLength: number;
  dynText: number;
  dynAttr: number;
  dynBlock: number;
  text: number;
  attr: number;
  node: number;
  tpl: number;
  arrowFns: number;
};

function transform(code: string): string {
  const plugin = helMagicPlugin();
  const transformHook = plugin.transform;
  const handler =
    typeof transformHook === "function"
      ? transformHook
      : transformHook && typeof transformHook === "object" && "handler" in transformHook
        ? transformHook.handler
        : null;

  const result = handler
    ? (handler as (this: unknown, code: string, id: string) => unknown).call({}, code, "Measure.tsx")
    : null;

  if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string") {
    throw new Error("Expected transformed output");
  }

  return result.code;
}

function count(haystack: string, needle: string): number {
  return (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
}

export function measureTransforms(): MeasureRow[] {
  const samples: Record<string, string> = {
    counter: `
      export function Counter() {
        let count = 0;
        return <section><h1>Count</h1><p>{count}</p><button onClick={() => count++}>+</button></section>;
      }
    `,
    form: `
      export function Form() {
        let title = "hel";
        let done = false;
        return <form><input value={title} /><input type="checkbox" checked={done} /></form>;
      }
    `,
    staticTree: `
      export function StaticTree() {
        return <main><div className="hero"><strong>Hel</strong><span>Static</span></div></main>;
      }
    `,
    listBlock: `
      export function ListBlock() {
        let visible = true;
        let count = 2;
        const rows = () => Array.from({ length: count }, (_, index) => <li>{index}</li>);
        return <section>{visible ? <ul>{rows().map((entry) => entry)}</ul> : <p>off</p>}</section>;
      }
    `,
  };

  return Object.entries(samples).map(([name, source]) => {
    const output = transform(source);
    return {
      name,
      codeLength: output.length,
      dynText: count(output, "__dynText("),
      dynAttr: count(output, "__dynAttr("),
      dynBlock: count(output, "__dynBlock("),
      text: count(output, "__text("),
      attr: count(output, "__attr("),
      node: count(output, "__node("),
      tpl: count(output, "__tpl("),
      arrowFns: count(output, "=>"),
    };
  });
}
