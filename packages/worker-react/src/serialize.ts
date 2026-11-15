import { Fragment, createElement, isValidElement, type ComponentType, type ReactElement } from "react";

/** Property on a reference component naming the `'use worker'` export it stands for. */
export const WORKER_REF = "$$workerRef";

/**
 * An element as sent to the worker: of a `'use worker'` component (`$$worker`,
 * its reference), a host element (`$$host`, its tag), or a fragment.
 */
export type SerializedElement = { key: string | null; props: unknown } & (
  | { $$worker: string }
  | { $$host: string }
  | { $$fragment: true }
);

function workerRefOf(type: unknown): string | undefined {
  return typeof type === "function" || (typeof type === "object" && type !== null)
    ? ((type as Record<string, unknown>)[WORKER_REF] as string | undefined)
    : undefined;
}

function nameOf(type: unknown): string {
  if (typeof type === "string") return type;
  if (type === Fragment) return "Fragment";
  const t = type as { displayName?: string; name?: string } | null;
  return t?.displayName || t?.name || "Anonymous";
}

function serializeElement(element: ReactElement<Record<string, unknown>>, path: string): SerializedElement {
  const name = nameOf(element.type);
  if (element.props.ref != null) {
    throw new Error(
      `${path} is a <${name}> element with a ref, which can't be passed to a worker yet. See https://github.com/lawnsea/frontend-systems/issues/39.`,
    );
  }
  const key = element.key;
  const props = serializeProps(element.props, `${path}.<${name}>.props`);
  if (typeof element.type === "string") return { $$host: element.type, key, props };
  if (element.type === Fragment) return { $$fragment: true, key, props };
  const ref = workerRefOf(element.type);
  if (ref) return { $$worker: ref, key, props };
  throw new Error(
    `${path} is a <${name}> element, which can't be passed to a worker. Only host elements, fragments, and elements of 'use worker' components can.`,
  );
}

/**
 * Converts props to JSON, replacing elements with descriptions the worker can
 * rebuild. Throws on functions, refs, and elements of components that aren't
 * `'use worker'`, which can't cross to a worker.
 */
export function serializeProps(value: unknown, path = "props"): unknown {
  if (isValidElement(value)) return serializeElement(value as ReactElement<Record<string, unknown>>, path);
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

/** Rebuilds props that `serializeProps` produced, looking up each `'use worker'` reference with `resolve`. */
export function deserializeProps(value: unknown, resolve: (ref: string) => ComponentType<any>): unknown {
  if (Array.isArray(value)) return value.map((item) => deserializeProps(item, resolve));
  if (value !== null && typeof value === "object") {
    const element = value as Partial<{ $$worker: string; $$host: string; $$fragment: true; key: string | null; props: unknown }>;
    const type =
      typeof element.$$worker === "string"
        ? resolve(element.$$worker)
        : typeof element.$$host === "string"
          ? element.$$host
          : element.$$fragment === true
            ? Fragment
            : undefined;
    if (type !== undefined) {
      return createElement(type, { ...(deserializeProps(element.props, resolve) as object), key: element.key ?? undefined });
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = deserializeProps(item, resolve);
    return out;
  }
  return value;
}
