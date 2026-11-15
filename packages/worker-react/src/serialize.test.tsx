import { Fragment, isValidElement, type ReactElement } from "react";
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

test("describes host elements and fragments", () => {
  expect(
    serializeProps({
      children: (
        <>
          <div className="note">
            Shipped <strong>today</strong>
          </div>
          <Badge key="b" label="new" />
        </>
      ),
    }),
  ).toEqual({
    children: {
      $$fragment: true,
      key: null,
      props: {
        children: [
          { $$host: "div", key: null, props: { className: "note", children: ["Shipped ", { $$host: "strong", key: null, props: { children: "today" } }] } },
          { $$worker: "src/Badge.tsx#default", key: "b", props: { label: "new" } },
        ],
      },
    },
  });
});

test("rejects elements of components that aren't 'use worker'", () => {
  function Local() {
    return null;
  }
  expect(() => serializeProps({ children: <Local /> })).toThrow(
    "props.children is a <Local> element, which can't be passed to a worker.",
  );
  expect(() => serializeProps({ children: <Card><div><Local /></div></Card> })).toThrow(
    "props.children.<component>.props.children.<div>.props.children is a <Local> element",
  );
});

test("rejects event handlers and refs on host elements", () => {
  expect(() => serializeProps({ children: <button onClick={() => {}} /> })).toThrow(
    "props.children.<button>.props.onClick is a function",
  );
  expect(() => serializeProps({ children: <div ref={{ current: null }} /> })).toThrow(
    "props.children is a <div> element with a ref, which can't be passed to a worker yet.",
  );
  expect(() => serializeProps({ children: <div ref={() => {}} /> })).toThrow("with a ref");
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

test("rebuilds host elements and fragments", () => {
  const props = serializeProps({
    children: (
      <>
        <div key="d" className="note">
          Shipped <strong>today</strong>
        </div>
      </>
    ),
  });

  const { children: fragment } = deserializeProps(props, () => Card) as { children: ReactElement<any> };

  expect(fragment.type).toBe(Fragment);
  const div = fragment.props.children as ReactElement<any>;
  expect(div.type).toBe("div");
  expect(div.key).toBe("d");
  expect(div.props.className).toBe("note");
  expect(div.props.children[0]).toBe("Shipped ");
  expect(div.props.children[1].type).toBe("strong");
  expect(div.props.children[1].props.children).toBe("today");
});
