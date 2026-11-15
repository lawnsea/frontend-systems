import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { SET_PROPS } from "./protocol.js";
import { deserializeProps } from "./serialize.js";

declare const exportFunction: (name: string, fn: (...args: any[]) => unknown) => void;

/**
 * Renders `Component` into the worker-dom document, with the props the host's
 * `<WorkerSubtree>` passes. Call once, from the script `<WorkerSubtree src>` names.
 * Renders nothing until the first props arrive.
 */
export function renderInWorker<P extends object>(Component: ComponentType<P>): void {
  const root = createRoot(document.body);
  exportFunction(SET_PROPS, (props: P) => {
    root.render(createElement(Component, props));
  });
}

/** The worker bundle's `'use worker'` modules, by module id. */
export type WorkerModules = Record<string, Record<string, unknown>>;

/**
 * Renders the `'use worker'` export the host's reference names, with its props.
 * The worker bundle that `worker-react/vite` builds calls this.
 */
export function startWorker(modules: WorkerModules): void {
  const resolve = (ref: string): ComponentType<any> => {
    const hash = ref.lastIndexOf("#");
    const component = modules[ref.slice(0, hash)]?.[ref.slice(hash + 1)];
    if (typeof component !== "function" && (typeof component !== "object" || component === null)) {
      throw new Error(`The worker bundle has no 'use worker' export ${ref}. Restart the dev server or rebuild.`);
    }
    return component as ComponentType<any>;
  };
  const root = createRoot(document.body);
  exportFunction(SET_PROPS, ({ ref, props }: { ref: string; props: unknown }) => {
    root.render(createElement(resolve(ref), deserializeProps(props, resolve) as object));
  });
}
