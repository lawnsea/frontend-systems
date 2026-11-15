import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { SET_PROPS } from "./protocol.js";

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
