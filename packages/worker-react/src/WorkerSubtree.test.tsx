// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SET_PROPS } from "./protocol.js";

const upgradeElement = vi.fn();
vi.mock("@lawnsea/worker-dom", () => ({ upgradeElement: (...args: unknown[]) => upgradeElement(...args) }));
const { WorkerSubtree } = await import("./WorkerSubtree.js");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function fakeWorker() {
  return { callFunction: vi.fn(() => Promise.resolve()), terminate: vi.fn(), onerror: null };
}

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  upgradeElement.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test("upgrades a container whose src is the subtree script", async () => {
  const worker = fakeWorker();
  upgradeElement.mockResolvedValue(worker);
  const config = { executorsAllowed: [2] };
  await act(async () => root.render(<WorkerSubtree src="/sub.js" domURL="/dom.js" config={config} />));

  const [container, domURL, passedConfig] = upgradeElement.mock.calls[0];
  expect(container.getAttribute("src")).toBe("/sub.js");
  expect(container.isConnected).toBe(true);
  expect(domURL).toBe("/dom.js");
  expect(passedConfig).toBe(config);
});

test("sends props when they change by value, not by identity", async () => {
  const worker = fakeWorker();
  upgradeElement.mockResolvedValue(worker);
  await act(async () => root.render(<WorkerSubtree src="/sub.js" domURL="/dom.js" props={{ n: 1 }} />));
  await act(async () => root.render(<WorkerSubtree src="/sub.js" domURL="/dom.js" props={{ n: 1 }} />));
  await act(async () => root.render(<WorkerSubtree src="/sub.js" domURL="/dom.js" props={{ n: 2 }} />));

  expect(worker.callFunction.mock.calls).toEqual([
    [SET_PROPS, { n: 1 }],
    [SET_PROPS, { n: 2 }],
  ]);
});

test("terminates the worker and removes its container on unmount", async () => {
  const worker = fakeWorker();
  upgradeElement.mockResolvedValue(worker);
  await act(async () => root.render(<WorkerSubtree src="/sub.js" domURL="/dom.js" />));
  const container = upgradeElement.mock.calls[0][0] as Element;

  act(() => root.render(<></>));

  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(container.isConnected).toBe(false);
});

test("terminates a worker that starts after unmount", async () => {
  const worker = fakeWorker();
  let resolve!: (w: unknown) => void;
  upgradeElement.mockReturnValue(new Promise((r) => (resolve = r)));
  act(() => root.render(<WorkerSubtree src="/sub.js" domURL="/dom.js" />));
  act(() => root.render(<></>));

  await act(async () => resolve(worker));

  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.callFunction).not.toHaveBeenCalled();
});

test("restarts the worker when src changes", async () => {
  const first = fakeWorker();
  const second = fakeWorker();
  upgradeElement.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  await act(async () => root.render(<WorkerSubtree src="/a.js" domURL="/dom.js" props={{ n: 1 }} />));
  await act(async () => root.render(<WorkerSubtree src="/b.js" domURL="/dom.js" props={{ n: 1 }} />));

  expect(first.terminate).toHaveBeenCalledOnce();
  expect(upgradeElement.mock.calls[0][0].isConnected).toBe(false);
  expect(upgradeElement.mock.calls[1][0].getAttribute("src")).toBe("/b.js");
  expect(second.callFunction).toHaveBeenCalledWith(SET_PROPS, { n: 1 });
});

test("reports a failed prop delivery to onError", async () => {
  const worker = fakeWorker();
  const error = new Error("no setProps");
  worker.callFunction.mockRejectedValue(error);
  upgradeElement.mockResolvedValue(worker);
  const onError = vi.fn();
  await act(async () => root.render(<WorkerSubtree src="/sub.js" domURL="/dom.js" onError={onError} />));

  expect(onError).toHaveBeenCalledWith(error);
});
