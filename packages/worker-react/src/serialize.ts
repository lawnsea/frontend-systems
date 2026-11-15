import { createElement, isValidElement, type ComponentType, type ReactElement } from "react";

/** Property on a reference component naming the `'use worker'` export it stands for. */
export const WORKER_REF = "$$workerRef";

/** An element of a `'use worker'` component, as sent to the worker. */
export interface SerializedElement {
  $$worker: string;
  key: string | null;
  props: unknown;
}

function workerRefOf(type: unknown): string | undefined {
  return typeof type === "function" || (typeof type === "object" && type !== null)
    ? ((type as Record<string, unknown>)[WORKER_REF] as string | undefined)
    : undefined;
}

function nameOf(type: unknown): string {
  if (typeof type === "string") return type;
  const t = type as { displayName?: string; name?: string } | null;
  return t?.displayName || t?.name || "Anonymous";
}

/**
 * Converts props to JSON, replacing elements of `'use worker'` components with
 * references. Throws on functions and on elements of other components, which
 * can't run in a worker.
 */
export function serializeProps(value: unknown, path = "props"): unknown {
  if (isValidElement(value)) {
    const element = value as ReactElement<Record<string, unknown>>;
    const ref = workerRefOf(element.type);
    if (!ref) {
      throw new Error(
        `${path} is a <${nameOf(element.type)}> element, which can't be passed to a worker. Only elements of 'use worker' components can.`,
      );
    }
    return { $$worker: ref, key: element.key, props: serializeProps(element.props, `${path}.<${nameOf(element.type)}>.props`) };
  }
  if (typeof value === "function") {
    throw new Error(`${path} is a function, which can't be passed to a worker. Worker props must be JSON-serializable.`);
  }
  if (Array.isArray(value)) return value.map((item, i) => serializeProps(item, `${path}[${i}]`));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = serializeProps(item, `${path}.${key}`);
    return out;
  }
  return value;
}

/** Rebuilds props that `serializeProps` produced, looking up each reference with `resolve`. */
export function deserializeProps(value: unknown, resolve: (ref: string) => ComponentType<any>): unknown {
  if (Array.isArray(value)) return value.map((item) => deserializeProps(item, resolve));
  if (value !== null && typeof value === "object") {
    if (typeof (value as SerializedElement).$$worker === "string") {
      const { $$worker, key, props } = value as SerializedElement;
      return createElement(resolve($$worker), { ...(deserializeProps(props, resolve) as object), key: key ?? undefined });
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = deserializeProps(item, resolve);
    return out;
  }
  return value;
}
