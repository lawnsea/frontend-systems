# worker-react

`worker-react` renders part of a React tree in a [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API), using [`@lawnsea/worker-dom`](../worker-dom) as the worker's DOM. The subtree can't read or change the page's DOM, and its rendering doesn't block the main thread.

- [Example](examples/basic): a host page renders `'use worker'` components.

## Usage

Mark a module with `'use worker'`, as with React's [`'use client'`](https://react.dev/reference/rsc/use-client):

```tsx
// Greeting.tsx
"use worker";

export function Greeting({ name, children }: { name: string; children?: ReactNode }) {
  return <section>Hello, {name}! {children}</section>;
}
```

Render its exports from host code like any component:

```tsx
import { Greeting } from "./Greeting";
import Badge from "./Badge"; // also "use worker"

<Greeting name={name}>
  <Badge label="new" />
  <p className="note">Shipped <strong>today</strong></p>
</Greeting>;
```

Each `'use worker'` element the host renders runs in its own worker. Its children, and everything its module imports, render in that same worker.

Add the plugin to the Vite config:

```ts
import { workerReact } from "worker-react/vite";

export default defineConfig({ plugins: [workerReact(), react()] });
```

The plugin:

- replaces each export of a `'use worker'` module, in the host's bundle, with a component that renders it in a worker
- bundles every `'use worker'` module under `src`, and what they import, into one worker script at `worker-react/subtree.js`
- serves worker-dom's worker script, unmodified, at `worker-react/worker-dom.js`

`include` sets which modules it checks, as globs relative to the Vite root.

### The boundary

What the host passes to a `'use worker'` component crosses to the worker, so:

- **Props must be JSON-serializable.** `Date`s become strings, and `undefined` values are dropped. A function prop throws. Callback props are [#33](https://github.com/lawnsea/frontend-systems/issues/33).
- **Elements must be host elements like `<div>`, fragments, or elements of `'use worker'` components.** That includes `children`, which render in the worker. An element of any other component throws, since the worker doesn't have its code.
- **Elements can't have event handlers or refs.** A handler is a function, which throws. Refs are [#39](https://github.com/lawnsea/frontend-systems/issues/39).
- **Context doesn't cross.** That's [#34](https://github.com/lawnsea/frontend-systems/issues/34).

Each worker loads React and worker-dom, so render a few large `'use worker'` subtrees, not many small ones.

### Without the plugin

`<WorkerSubtree src domURL props />` runs the script at `src`, which calls `renderInWorker(Component)`. `src` must be a single classic script, not a module, and `domURL` must serve `@lawnsea/worker-dom/worker.js` unmodified.

## Limitations

- **Events are asynchronous.** The worker handles an event after the browser has dispatched it, so `preventDefault()` in a subtree handler has no effect on the browser's default action.
- **Every event inside the subtree crosses to the worker.** React listens for all event types at its root, so `mousemove` and `scroll` inside the subtree each post a message.
- **Workers don't hot-reload.** After editing a `'use worker'` module in dev, reload the page.

## Isolation

`WorkerReactConfig` passes worker-dom's [configuration](../worker-dom/types/main.d.ts) to the workers below it. `createSanitizer` builds a sanitizer from a policy, applying the changes it allows and dropping the rest:

```tsx
import { WorkerReactConfig, createSanitizer } from "worker-react";

const workers = {
  config: {
    sanitizer: createSanitizer({
      node: (node) => node.nodeName !== "IFRAME",
      attribute: (_, name, value) => !(name === "href" && /^\s*javascript:/i.test(value ?? "")),
    }),
  },
};

<WorkerReactConfig value={workers}>
  <App />
</WorkerReactConfig>;
```

With a sanitizer, the worker starts with empty `localStorage` and `sessionStorage` and can't write the page's. Without one, it gets a copy of both and can write them. `config.executorsAllowed` limits which kinds of mutation the main thread applies; `Mutation` lists them. Props need `Mutation.FUNCTION_CALL`.

The subtree receives only events inside its container, and `resize`.

The worker runs at the page's [origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin), so the subtree can still:

- `fetch` the origin's resources with the user's cookies
- read and write IndexedDB and the Cache API
- talk to the origin's other contexts with `BroadcastChannel`
- load scripts with `importScripts`

## Development

- `pnpm build` compiles `src` to `dist`.
- `pnpm typecheck` typechecks `src`, including tests.
- `pnpm test` runs the unit tests with [Vitest](https://vitest.dev/).
- In `examples/basic`, `pnpm test` builds worker-dom and worker-react, then runs the browser tests with [Playwright](https://playwright.dev/) against the dev server and the production build.
