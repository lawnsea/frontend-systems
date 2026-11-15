/**
 * worker-dom's mutation types, for `config.executorsAllowed`. The main thread
 * drops mutations whose type is not allowed. Mirrors `TransferrableMutationType`
 * in worker-dom, which is a `const enum` and so has no runtime value.
 */
export const Mutation = {
  ATTRIBUTES: 0,
  CHARACTER_DATA: 1,
  CHILD_LIST: 2,
  PROPERTIES: 3,
  EVENT_SUBSCRIPTION: 4,
  GET_BOUNDING_CLIENT_RECT: 5,
  LONG_TASK_START: 6,
  LONG_TASK_END: 7,
  OFFSCREEN_CANVAS_INSTANCE: 8,
  OBJECT_MUTATION: 9,
  OBJECT_CREATION: 10,
  IMAGE_BITMAP_INSTANCE: 11,
  /** Lets the worker write the page's localStorage and sessionStorage. */
  STORAGE: 12,
  /** Required: props are delivered with a function call. */
  FUNCTION_CALL: 13,
  SCROLL_INTO_VIEW: 14,
} as const;
