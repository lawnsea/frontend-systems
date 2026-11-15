// @vitest-environment jsdom
import { expect, test } from "vitest";
import { createSanitizer } from "./sanitizer.js";

test("allows everything without a policy", () => {
  const sanitizer = createSanitizer();
  const div = document.createElement("div");

  expect(sanitizer.sanitize(div)).toBe(true);
  expect(sanitizer.setAttribute(div, "title", "hi")).toBe(true);
  expect(div.getAttribute("title")).toBe("hi");
  expect(sanitizer.setAttribute(div, "title", null)).toBe(true);
  expect(div.hasAttribute("title")).toBe(false);
});

test("drops nodes, attributes, and properties the policy rejects", () => {
  const sanitizer = createSanitizer({
    node: (node) => node.nodeName !== "IFRAME",
    attribute: (_, name, value) => !(name === "href" && value?.startsWith("javascript:")),
    property: (_, name) => name !== "innerHTML",
  });
  const a = document.createElement("a");

  expect(sanitizer.sanitize(document.createElement("iframe"))).toBe(false);
  expect(sanitizer.setAttribute(a, "href", "javascript:alert(1)")).toBe(false);
  expect(a.hasAttribute("href")).toBe(false);
  expect(sanitizer.setProperty(a, "innerHTML", "<img>")).toBe(false);
  expect(a.innerHTML).toBe("");
});

test("restores boolean property values that worker-dom stringified", () => {
  const sanitizer = createSanitizer();
  const input = document.createElement("input");
  input.type = "checkbox";

  sanitizer.setProperty(input, "checked", "true");
  expect(input.checked).toBe(true);
  sanitizer.setProperty(input, "checked", "false");
  expect(input.checked).toBe(false);
  sanitizer.setProperty(input, "value", "x");
  expect(input.value).toBe("x");
});

test("gives the worker empty storage and rejects writes", async () => {
  localStorage.setItem("secret", "s");
  const sanitizer = createSanitizer();

  expect(await sanitizer.getStorage(0)).toEqual({});
  expect(sanitizer.setStorage(0, "secret", "x")).toBe(false);
  expect(localStorage.getItem("secret")).toBe("s");
});
