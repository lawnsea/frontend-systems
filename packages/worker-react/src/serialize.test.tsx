import { isValidElement, type ReactElement } from "react";
import { expect, test } from "vitest";
import { WORKER_REF, deserializeProps, serializeProps } from "./serialize.js";

function workerComponent(ref: string) {
  const component = (props: any) => null;
  (component as any)[WORKER_REF] = ref;
  return component;
}

const Card = workerComponent("src/Card.tsx#Card");
const Badge = workerComponent("src/Badge.tsx#default");

test("passes JSON values through", () => {
  const props = { title: "t", count: 2, tags: ["a", null], nested: { ok: true } };
  expect(serializeProps(props)).toEqual(props);
});

test("replaces elements of worker components with references", () => {
  const serialized = serializeProps({
    children: [<Card key="a" title="x" />, <Badge key="b" label="new" />],
  });

  expect(serialized).toEqual({
    children: [
      { $$worker: "src/Card.tsx#Card", key: "a", props: { title: "x" } },
      { $$worker: "src/Badge.tsx#default", key: "b", props: { label: "new" } },
    ],
  });
});

test("rejects elements of other components and host elements", () => {
  function Local() {
    return null;
  }
  expect(() => serializeProps({ children: <Local /> })).toThrow(
    "props.children is a <Local> element, which can't be passed to a worker.",
  );
  expect(() => serializeProps({ children: <Card><div /></Card> })).toThrow(
    "props.children.<component>.props.children is a <div> element",
  );
});

test("rejects functions", () => {
  expect(() => serializeProps({ onSelect: () => {} })).toThrow(
    "props.onSelect is a function, which can't be passed to a worker.",
  );
});

test("rebuilds references into elements of the resolved components", () => {
  const resolved = { "src/Card.tsx#Card": Card, "src/Badge.tsx#default": Badge } as Record<string, any>;
  const props = serializeProps({ title: "t", children: <Card key="a" title="x"><Badge label="new" /></Card> });

  const rebuilt = deserializeProps(props, (ref) => resolved[ref]) as { title: string; children: ReactElement<any> };

  expect(rebuilt.title).toBe("t");
  expect(isValidElement(rebuilt.children)).toBe(true);
  expect(rebuilt.children.type).toBe(Card);
  expect(rebuilt.children.key).toBe("a");
  expect(rebuilt.children.props.title).toBe("x");
  expect(rebuilt.children.props.children.type).toBe(Badge);
  expect(rebuilt.children.props.children.props).toEqual({ label: "new" });
});
