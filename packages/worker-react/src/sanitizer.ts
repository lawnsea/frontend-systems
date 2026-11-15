import type { Sanitizer } from "@lawnsea/worker-dom";

/** Each check returns whether to allow the change. Omitted checks allow everything. */
export interface SanitizerPolicy {
  node?(node: Node): boolean;
  attribute?(element: Element, name: string, value: string | null): boolean;
  property?(node: Node, name: string, value: unknown): boolean;
}

/**
 * Builds a worker-dom sanitizer that applies the changes `policy` allows and
 * drops the rest. The worker gets empty storage and can't write the page's.
 */
export function createSanitizer(policy: SanitizerPolicy = {}): Sanitizer {
  return {
    sanitize: (node) => policy.node?.(node) ?? true,
    setAttribute(node, name, value) {
      const element = node as Element;
      if (!(policy.attribute?.(element, name, value) ?? true)) return false;
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
      return true;
    },
    setProperty(node, name, raw) {
      const target = node as unknown as Record<string, unknown>;
      // worker-dom stringifies property values before a sanitizer sees them.
      const value = typeof target[name] === "boolean" ? raw === "true" : raw;
      if (!(policy.property?.(node, name, value) ?? true)) return false;
      target[name] = value;
      return true;
    },
    getStorage: () => Promise.resolve({}),
    setStorage: () => false,
  };
}
