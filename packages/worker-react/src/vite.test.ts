import { expect, test } from "vitest";
import { exportNames, hasUseWorkerDirective, workerReact } from "./vite.js";

test("finds a 'use worker' directive among a module's leading directives", () => {
  expect(hasUseWorkerDirective(`"use worker";\nexport const A = 1;`, "a.ts")).toBe(true);
  expect(hasUseWorkerDirective(`// comment\n'use strict';\n'use worker';\nexport const A = 1;`, "a.ts")).toBe(true);
});

test("ignores 'use worker' that isn't a leading directive", () => {
  expect(hasUseWorkerDirective(`import x from "x";\n"use worker";`, "a.ts")).toBe(false);
  expect(hasUseWorkerDirective(`const s = "use worker";`, "a.ts")).toBe(false);
  expect(hasUseWorkerDirective(`function f() { "use worker"; }`, "a.ts")).toBe(false);
});

test("lists a module's value exports", () => {
  const code = `"use worker";
    import { X } from "./x";
    export function A({ t }: { t: string }) { return <X>{t}</X>; }
    export const B = () => null, C = 1;
    export class D {}
    export default function () { return null; }
    const E = () => null;
    export { E as F, type X };
    export type T = string;
    export interface I {}`;

  expect(exportNames(code, "a.tsx")).toEqual(["A", "B", "C", "D", "default", "F"]);
});

test("rejects export * in a worker module", () => {
  expect(() => exportNames(`"use worker"; export * from "./x";`, "a.ts")).toThrow("can't use `export *`");
});

function transform(code: string, id: string) {
  const plugin = workerReact() as any;
  plugin.configResolved({ root: "/app", base: "/" });
  return plugin.transform(code, id);
}

test("replaces a worker module's exports with references", () => {
  const code = `"use worker";\nimport { secret } from "./secret";\nexport function Card() { return secret; }\nexport default Card;`;

  expect(transform(code, "/app/src/Card.tsx?v=1")).toBe(
    [
      `import { createWorkerReference } from "worker-react";`,
      `const scripts = {"src":"/worker-react/subtree.js","domURL":"/worker-react/worker-dom.js"};`,
      `export const Card = createWorkerReference("src/Card.tsx", "Card", scripts);`,
      `export default createWorkerReference("src/Card.tsx", "default", scripts);`,
    ].join("\n"),
  );
});

test("leaves other modules alone", () => {
  expect(transform(`export const A = "use worker";`, "/app/src/a.ts")).toBeUndefined();
  expect(transform(`"use worker"; export const A = 1;`, "/app/node_modules/x/a.js")).toBeUndefined();
  expect(transform(`"use worker";`, "/app/src/a.css")).toBeUndefined();
});
