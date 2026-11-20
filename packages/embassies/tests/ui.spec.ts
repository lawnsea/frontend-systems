import { expect, test, type Page, type Worker } from "@playwright/test";
import { AREA, appWorker, boot, pixel, rootProbe, useExample, type ProbeGlobals } from "./helpers.ts";
import type { Example } from "../server.ts";

// The viewport calls: accept, map and update canvas, receive UI events,
// transfer, sublet, modify and repossess, and tenant changed.

const example = useExample({ vendors: { unlabeled: "tests/apps/unlabeled.js" } });

const RED = "#ff0000";
const BLUE = "#0000ff";
const GREEN = "#00ff00";
const WHITE = "#ffffff";
// Where the sublet goes in the probe's canvas, and where its area is on screen,
// below its 1px border and 20px label.
const RECT = { x: 100, y: 100, width: 200, height: 150 };
const SUBLET_AREA = { x: AREA.x + RECT.x + 1, y: AREA.y + RECT.y + 21 };

const rootLabel = (page: Page) => page.locator("#screen > .viewport > .label");
const subletLabel = (page: Page) => page.locator(".area .viewport > .label");

// Has the probe sublet RECT to probe2, which accepts and paints it.
async function sublet(page: Page, example: Example, probe: Worker, viewport: number, color: string) {
  const { sublet, deed } = await probe.evaluate(({ viewport, rect }) => (self as unknown as ProbeGlobals).cei.subletViewport(viewport, rect), {
    viewport,
    rect: RECT,
  });
  await probe.evaluate(({ label, deed }) => (self as unknown as ProbeGlobals).link.send(label, { kind: "embed", deed }), {
    label: example.label("probe2"),
    deed,
  });
  const probe2 = await appWorker(page, "probe2");
  const accepted = await probe2.evaluate(async (color) => {
    const { probe } = self as unknown as ProbeGlobals;
    const { viewport, width, height, key } = await probe.accept(await probe.nextDeed(), color);
    return { viewport, width, height, key: probe.hex(key) };
  }, color);
  return { sublet: sublet as number, probe2, ...accepted };
}

const calls = (worker: Worker, fn: string, ...args: unknown[]) =>
  worker.evaluate(
    ({ fn, args }) => (self as unknown as ProbeGlobals).cei[fn](...args).then(
      (result: unknown) => ({ result }),
      (error: Error) => ({ error: error.message }),
    ),
    { fn, args },
  );

const uiEvents = (worker: Worker, type: string) =>
  worker.evaluate((type) => (self as unknown as ProbeGlobals).probe.ui.filter((e: { type: string }) => e.type === type), type);

test("accepting a viewport needs a verified label", async ({ page }) => {
  const app = await boot(page, example, "unlabeled");
  const deed = await app.evaluate(() => (self as unknown as ProbeGlobals).probe.nextDeed());
  expect(await calls(app, "acceptViewport", deed)).toEqual({ error: "Call verifyLabel before accepting a viewport" });
  // A refused deed stays live.
  expect(await calls(app, "verifyLabel", example.label("unlabeled"))).toEqual({ result: true });
  expect(await calls(app, "acceptViewport", deed)).toMatchObject({ result: { viewport: 1 } });
  await expect(rootLabel(page)).toHaveText(example.label("unlabeled"));
});

test("the kernel labels a viewport with its owner and shows the owner's pixels", async ({ page }) => {
  await page.goto(`${example.origin}/`);
  await expect(rootLabel(page)).toHaveText("No app");
  await rootProbe(page, example, RED);
  await expect(rootLabel(page)).toHaveText(example.label("probe"));
  await expect.poll(() => pixel(page, AREA.x + 10, AREA.y + 10)).toBe(RED);
});

test("transferring a viewport revokes it from its old owner", async ({ page }) => {
  const { probe, viewport } = await rootProbe(page, example, RED);
  const deed = (await calls(probe, "transferViewport", viewport)).result;
  await expect(rootLabel(page)).toHaveText("No app");
  await expect.poll(() => pixel(page, AREA.x + 10, AREA.y + 10)).toBe(WHITE);

  await probe.evaluate(({ label, deed }) => (self as unknown as ProbeGlobals).link.send(label, { kind: "navigate", deed }), {
    label: example.label("probe2"),
    deed,
  });
  const probe2 = await appWorker(page, "probe2");
  await probe2.evaluate(async (color) => {
    const { probe } = self as unknown as ProbeGlobals;
    await probe.accept(await probe.nextDeed(), color);
  }, BLUE);
  await expect(rootLabel(page)).toHaveText(example.label("probe2"));
  await expect.poll(() => pixel(page, AREA.x + 10, AREA.y + 10)).toBe(BLUE);

  // The old owner can't map a canvas or draw, and the deed is spent.
  const refused = `This app doesn't hold viewport ${viewport}`;
  expect(await calls(probe, "mapCanvas", viewport)).toEqual({ error: refused });
  const drawn = await probe.evaluate((viewport) => {
    const canvas = new OffscreenCanvas(100, 100);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 100, 100);
    return (self as unknown as ProbeGlobals).cei.updateCanvas(viewport, canvas.transferToImageBitmap()).catch((e: Error) => e.message);
  }, viewport);
  expect(drawn).toBe(refused);
  expect(await calls(probe, "acceptViewport", deed)).toEqual({ error: "The deed isn't live; it may have been redeemed or revoked" });
  await page.waitForTimeout(100);
  expect(await pixel(page, AREA.x + 10, AREA.y + 10)).toBe(BLUE);
});

test("a sublet has its own label and sits above its landlord's canvas", async ({ page }) => {
  const { probe, viewport } = await rootProbe(page, example, RED);
  const { width, height } = await sublet(page, example, probe, viewport, GREEN);
  expect({ width, height }).toEqual({ width: RECT.width - 2, height: RECT.height - 22 });
  await expect(subletLabel(page)).toHaveText(example.label("probe2"));
  await expect.poll(() => pixel(page, SUBLET_AREA.x + 10, SUBLET_AREA.y + 10)).toBe(GREEN);
  // The landlord repaints all of its canvas, which stays below the sublet.
  await probe.evaluate((viewport) => (self as unknown as ProbeGlobals).probe.paint(viewport, "#0000ff"), viewport);
  await expect.poll(() => pixel(page, AREA.x + 10, AREA.y + 10)).toBe(BLUE);
  expect(await pixel(page, SUBLET_AREA.x + 10, SUBLET_AREA.y + 10)).toBe(GREEN);
});

test("pointer events go to the app under the pointer, and key events to the focused one", async ({ page }) => {
  const { probe, viewport } = await rootProbe(page, example, RED);
  const { probe2, viewport: inner } = await sublet(page, example, probe, viewport, GREEN);

  await page.mouse.click(SUBLET_AREA.x + 10, SUBLET_AREA.y + 20);
  await page.keyboard.press("a");
  await expect.poll(() => uiEvents(probe2, "keydown")).toMatchObject([{ viewport: inner, key: "a" }]);
  expect(await uiEvents(probe2, "pointerdown")).toMatchObject([{ viewport: inner, x: 10, y: 20 }]);
  expect([...(await uiEvents(probe, "pointerdown")), ...(await uiEvents(probe, "keydown"))]).toEqual([]);
  await expect(page.locator(".focused > .label")).toHaveText(example.label("probe2"));

  await page.mouse.click(AREA.x + 30, AREA.y + 40);
  await page.keyboard.press("b");
  await expect.poll(() => uiEvents(probe, "keydown")).toMatchObject([{ viewport, key: "b" }]);
  expect(await uiEvents(probe, "pointerdown")).toMatchObject([{ viewport, x: 30, y: 40 }]);
  expect(await uiEvents(probe2, "keydown")).toHaveLength(1);
});

test("modifyViewport moves and resizes a sublet, and tells its tenant", async ({ page }) => {
  const { probe, viewport } = await rootProbe(page, example, RED);
  const { sublet: id, probe2, viewport: inner } = await sublet(page, example, probe, viewport, GREEN);
  expect(await calls(probe, "modifyViewport", id, { x: 400, y: 50, width: 100, height: 80 })).toEqual({});
  await expect
    .poll(() => probe2.evaluate(() => (self as unknown as ProbeGlobals).probe.events.filter((e: { event: string }) => e.event === "viewport")))
    .toEqual([{ event: "viewport", viewport: inner, width: 98, height: 58 }]);
  await expect(page.locator(".area .viewport")).toHaveCSS("left", "400px");
  // Only the landlord can.
  expect(await calls(probe2, "modifyViewport", id, RECT)).toEqual({ error: `This app didn't sublet viewport ${id}` });
});

test("repossessing a sublet revokes it from its tenant and changes the tenant key", async ({ page }) => {
  const { probe, viewport } = await rootProbe(page, example, RED);
  const { sublet: id, probe2, viewport: inner, key } = await sublet(page, example, probe, viewport, GREEN);
  const tenant = () =>
    probe.evaluate(async (id) => {
      const { cei, probe } = self as unknown as ProbeGlobals;
      const { generation, key } = await cei.tenantChanged(id);
      return { generation, key: probe.hex(key) };
    }, id);
  expect(await tenant()).toEqual({ generation: 1, key });
  expect(key).toMatch(/^[0-9a-f]{64}$/);

  const deed = (await calls(probe, "repossessViewport", id)).result;
  expect(deed).toEqual(expect.any(String));
  expect(await tenant()).toEqual({ generation: 2, key: null });
  await expect(subletLabel(page)).toHaveText("No app");
  await expect
    .poll(() => probe2.evaluate(() => (self as unknown as ProbeGlobals).probe.events.filter((e: { event: string }) => e.event === "revoked")))
    .toEqual([{ event: "revoked", viewport: inner }]);
  expect(await calls(probe2, "mapCanvas", inner)).toEqual({ error: `This app doesn't hold viewport ${inner}` });
});

test("a landlord that gives up its viewport loses its sublets", async ({ page }) => {
  const { probe, viewport } = await rootProbe(page, example, RED);
  const { probe2, viewport: inner } = await sublet(page, example, probe, viewport, GREEN);
  await calls(probe, "transferViewport", viewport);
  await expect(page.locator(".area .viewport")).toHaveCount(0);
  await expect
    .poll(() => probe2.evaluate(() => (self as unknown as ProbeGlobals).probe.events.filter((e: { event: string }) => e.event === "revoked")))
    .toEqual([{ event: "revoked", viewport: inner }]);
});

test("resizing the window tells the screen's owner its new size", async ({ page }) => {
  const { probe, viewport } = await rootProbe(page, example, RED);
  await page.setViewportSize({ width: 800, height: 600 });
  await expect
    .poll(() => probe.evaluate(() => (self as unknown as ProbeGlobals).probe.events.filter((e: { event: string }) => e.event === "viewport").at(-1)))
    .toEqual({ event: "viewport", viewport, width: 798, height: 578 });
});
