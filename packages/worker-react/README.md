# worker-react

`worker-react` renders part of a React tree in a [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API), using [`@lawnsea/worker-dom`](../worker-dom) as the worker's DOM. The subtree can't read or change the page's DOM, and its rendering doesn't block the main thread.

- [Example](examples/basic): a host page passes props to a subtree in a worker.

## Usage

The host renders `<WorkerSubtree>`:

```tsx
import { WorkerSubtree } from "worker-react";

<WorkerSubtree src="/subtree.js" domURL="/worker-dom.js" props={{ name, count }} />;
```

The script at `src` renders a component with `renderInWorker`:

```tsx
import { renderInWorker } from "worker-react/worker";

renderInWorker(Greeting);
```

`<WorkerSubtree>` starts the worker on mount, restarts it when `src` or `domURL` changes, and terminates it on unmount. The component renders when the first props arrive and re-renders when they change.

### Serving the scripts

worker-dom fetches both scripts as text and runs them in one classic worker script, so:

- **`src`** must be a single bundled classic script, not a module. The example bundles it as an IIFE with Vite (see [`vite.config.ts`](examples/basic/vite.config.ts)).
- **`domURL`** must serve `@lawnsea/worker-dom/worker.js` byte for byte. Vite's dev server rewrites scripts it serves, which breaks the worker, so the example serves the file itself.

## Limitations

- **Props must be JSON-serializable.** They're sent with `JSON.stringify`, so `Date`s become strings, and functions, `Map`s, and `undefined` values are dropped. Callback props are [#33](https://github.com/lawnsea/frontend-systems/issues/33), and context is [#34](https://github.com/lawnsea/frontend-systems/issues/34).
- **Events are asynchronous.** The worker handles an event after the browser has dispatched it, so `preventDefault()` in a subtree handler has no effect on the browser's default action.
- **Every event inside the subtree crosses to the worker.** React listens for all event types at its root, so `mousemove` and `scroll` inside the subtree each post a message.

## Isolation

`config` takes worker-dom's [configuration](../worker-dom/types/main.d.ts). `createSanitizer` builds a sanitizer from a policy, applying the changes it allows and dropping the rest:

```tsx
import { createSanitizer } from "worker-react";

const config = {
  sanitizer: createSanitizer({
    node: (node) => node.nodeName !== "IFRAME",
    attribute: (_, name, value) => !(name === "href" && /^\s*javascript:/i.test(value ?? "")),
  }),
};
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
- In `examples/basic`, `pnpm test` builds worker-dom and worker-react, then runs the browser tests with [Playwright](https://playwright.dev/).
