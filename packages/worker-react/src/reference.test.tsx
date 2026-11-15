// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SET_PROPS } from "./protocol.js";

const upgradeElement = vi.fn();
vi.mock("@lawnsea/worker-dom", () => ({ upgradeElement: (...args: unknown[]) => upgradeElement(...args) }));
const { WorkerReactConfig, createWorkerReference } = await import("./reference.js");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const scripts = { src: "/worker-react/subtree.js", domURL: "/worker-react/worker-dom.js" };
const Card = createWorkerReference("src/Card.tsx", "Card", scripts);
const Badge = createWorkerReference("src/Badge.tsx", "default", scripts);

let host: HTMLElement;
let root: Root;
let worker: { callFunction: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; onerror: null };
beforeEach(() => {
  worker = { callFunction: vi.fn(() => Promise.resolve()), terminate: vi.fn(), onerror: null };
  upgradeElement.mockReset();
  upgradeElement.mockResolvedValue(worker);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test("starts the worker bundle and sends the export's reference and props", async () => {
  await act(async () => root.render(<Card title="t"><Badge label="new" /></Card>));

  const [container, domURL] = upgradeElement.mock.calls[0];
  expect(container.getAttribute("src")).toBe(scripts.src);
  expect(container.parentElement.getAttribute("data-worker-subtree")).toBe("src/Card.tsx#Card");
  expect(domURL).toBe(scripts.domURL);
  expect(worker.callFunction).toHaveBeenCalledWith(SET_PROPS, {
    ref: "src/Card.tsx#Card",
    props: {
      title: "t",
      children: { $$worker: "src/Badge.tsx#default", key: null, props: { label: "new" } },
    },
  });
});

test("starts one worker for a reference and its worker children", async () => {
  await act(async () => root.render(<Card><Badge label="a" /><Badge label="b" /></Card>));

  expect(upgradeElement).toHaveBeenCalledOnce();
});

test("passes the config from WorkerReactConfig", async () => {
  const config = { executorsAllowed: [2, 13] };
  const onError = vi.fn();
  await act(async () =>
    root.render(
      <WorkerReactConfig value={{ config, onError }}>
        <Card />
      </WorkerReactConfig>,
    ),
  );

  expect(upgradeElement.mock.calls[0][2]).toBe(config);
});

test("throws when a child isn't a worker component", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  function Local() {
    return null;
  }

  expect(() => act(() => root.render(<Card><Local /></Card>))).toThrow(
    "<Card> props.children is a <Local> element, which can't be passed to a worker.",
  );
  errors.mockRestore();
});
