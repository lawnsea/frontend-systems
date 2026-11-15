import { expect, test } from "@playwright/test";

const GREETING = '[data-worker-subtree="src/Greeting.tsx#Greeting"]';

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("renders a 'use worker' component in a worker with the host's props", async ({ page }) => {
  const subtree = page.locator(GREETING);
  await expect(subtree.locator(".greeting")).toHaveText("Hello, world! Host count: 0");
  await expect(subtree.locator(".realm")).toHaveText("In a worker: yes");
});

test("renders 'use worker' children in the same worker", async ({ page }) => {
  await expect(page.locator(`${GREETING} .children .badge`)).toHaveText(["world is new", "worker-rendered"]);
  await expect(page.locator("[data-worker-subtree]")).toHaveCount(1);
});

test("renders host elements passed as children in the worker", async ({ page }) => {
  const note = page.locator(`${GREETING} .children .note`);
  await expect(note).toHaveText("Passed from the host as 0 elements");
  await expect(note.locator("strong")).toHaveText("0");

  await page.getByRole("button", { name: "Increment host count" }).click();
  await expect(note.locator("strong")).toHaveText("1");
});

test("renders one copy of the subtree under StrictMode", async ({ page }) => {
  await expect(page.locator(`${GREETING} .greeting`)).toHaveCount(1);
  await expect(page.locator(`${GREETING} > div`)).toHaveCount(1);
});

test("re-renders the subtree when the host's props change", async ({ page }) => {
  await page.getByLabel("Name").fill("Ada");
  await page.getByRole("button", { name: "Increment host count" }).click();
  await expect(page.locator(`${GREETING} .greeting`)).toHaveText("Hello, Ada! Host count: 1");
  await expect(page.locator(`${GREETING} .badge`).first()).toHaveText("Ada is new");
});

test("runs the subtree's event handlers in the worker", async ({ page }) => {
  const button = page.locator(`${GREETING} button`);
  await expect(button).toHaveText("Clicked 0 times in the worker");
  await button.click();
  await button.click();
  await expect(button).toHaveText("Clicked 2 times in the worker");
});

test("applies the host's sanitizer to the subtree", async ({ page }) => {
  const subtree = page.locator(GREETING);
  await expect(subtree.locator("a")).toHaveText("Link without an href");
  await expect(subtree.locator("a")).not.toHaveAttribute("href");
  await expect(subtree.locator("iframe")).toHaveCount(0);
});

test("removes the subtree on unmount and restarts it on remount", async ({ page }) => {
  await page.getByRole("button", { name: "Increment host count" }).click();
  await page.getByLabel("Show subtree").uncheck();
  await expect(page.locator(GREETING)).toHaveCount(0);

  await page.getByLabel("Show subtree").check();
  await expect(page.locator(`${GREETING} .greeting`)).toHaveText("Hello, world! Host count: 1");
  await expect(page.locator(`${GREETING} button`)).toHaveText("Clicked 0 times in the worker");
});
