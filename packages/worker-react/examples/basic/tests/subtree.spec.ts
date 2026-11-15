import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("renders the subtree in a worker with the host's props", async ({ page }) => {
  const subtree = page.locator(".subtree");
  await expect(subtree.locator(".greeting")).toHaveText("Hello, world! Host count: 0");
  await expect(subtree.locator(".realm")).toHaveText("In a worker: yes");
});

test("renders one copy of the subtree under StrictMode", async ({ page }) => {
  await expect(page.locator(".subtree .greeting")).toHaveCount(1);
  await expect(page.locator(".subtree > div")).toHaveCount(1);
});

test("re-renders the subtree when the host's props change", async ({ page }) => {
  await page.getByLabel("Name").fill("Ada");
  await page.getByRole("button", { name: "Increment host count" }).click();
  await expect(page.locator(".subtree .greeting")).toHaveText("Hello, Ada! Host count: 1");
});

test("runs the subtree's event handlers in the worker", async ({ page }) => {
  const button = page.locator(".subtree button");
  await expect(button).toHaveText("Clicked 0 times in the worker");
  await button.click();
  await button.click();
  await expect(button).toHaveText("Clicked 2 times in the worker");
});

test("applies the host's sanitizer to the subtree", async ({ page }) => {
  const subtree = page.locator(".subtree");
  await expect(subtree.locator("a")).toHaveText("Link without an href");
  await expect(subtree.locator("a")).not.toHaveAttribute("href");
  await expect(subtree.locator("iframe")).toHaveCount(0);
});

test("removes the subtree on unmount and restarts it on remount", async ({ page }) => {
  await page.getByRole("button", { name: "Increment host count" }).click();
  await page.getByLabel("Show subtree").uncheck();
  await expect(page.locator(".subtree")).toHaveCount(0);

  await page.getByLabel("Show subtree").check();
  await expect(page.locator(".subtree .greeting")).toHaveText("Hello, world! Host count: 1");
  await expect(page.locator(".subtree button")).toHaveText("Clicked 0 times in the worker");
});
