// Public types for the main-thread module (dist/main.mjs).

export type StorageValue = { [key: string]: string };

/**
 * Allows clients to apply restrictions on DOM and storage changes.
 * Storage locations are `0` for localStorage and `1` for sessionStorage.
 */
export interface Sanitizer {
  sanitize(node: Node): boolean;
  setAttribute(node: Node, attr: string, value: string | null): boolean;
  setProperty(node: Node, prop: string, value: string): boolean;
  getStorage(location: number, key?: string | null): Promise<StorageValue>;
  setStorage(location: number, key: string | null, value: string | null): boolean;
}

export interface UpgradeConfiguration {
  mutationPump?: (flush: Function, phase: number) => void;
  longTask?: (promise: Promise<any>) => void;
  sanitizer?: Sanitizer;
  hydrateFilter?: (node: Element) => boolean;
  /** Mutation types the main thread applies. Others are dropped. */
  executorsAllowed?: number[];
  onCreateWorker?: (initialDOM: Element, strings: string[], skeleton: unknown, keys: string[]) => void;
  onSendMessage?: (message: unknown) => void;
  onReceiveMessage?: (message: MessageEvent) => void;
}

export interface ExportedWorker {
  /** Calls a function the worker exported with `exportFunction`. Arguments and the result are JSON-serialized. */
  callFunction(functionIdentifier: string, ...functionArguments: unknown[]): Promise<any>;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null;
  terminate(): void;
}

/**
 * Runs the script at `baseElement`'s `src` in a worker, rendering into `baseElement`.
 * Resolves to `null` if `baseElement` has no `src`.
 */
export function upgradeElement(baseElement: Element, domURL: string, config?: UpgradeConfiguration): Promise<ExportedWorker | null>;
