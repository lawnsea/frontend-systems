import { expect, test } from "@playwright/test";
import { AREA, boot, pixel, useExample } from "./helpers.ts";

const example = useExample();

test("news embeds weather, links to recipes, and recipes links back", async ({ page }) => {
  await boot(page, example, "news");
  const rootLabel = page.locator("#screen > .viewport > .label");
  const embedded = page.locator(".area .viewport");
  await expect(rootLabel).toHaveText(example.label("news"));
  await expect(embedded.locator(".label")).toHaveText(example.label("weather"));
  await expect.poll(() => pixel(page, AREA.x + 10, AREA.y + 300)).toBe("#fffbe6");

  // The "Read today's recipes" link.
  await page.mouse.click(AREA.x + 60, AREA.y + 128);
  await expect(rootLabel).toHaveText(example.label("recipes"));
  await expect(embedded).toHaveCount(0);
  await expect.poll(() => pixel(page, AREA.x + 10, AREA.y + 300)).toBe("#eefbea");

  // The "Back" link.
  await page.mouse.click(AREA.x + 40, AREA.y + 32);
  await expect(rootLabel).toHaveText(example.label("news"));
  await expect(embedded.locator(".label")).toHaveText(example.label("weather"));
  await expect.poll(() => pixel(page, AREA.x + 10, AREA.y + 300)).toBe("#fffbe6");
});
