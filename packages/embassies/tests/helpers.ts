import { expect, test, type Browser, type Page, type Worker } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { startExample, type Example, type Options } from "../server.ts";

// The root viewport's area starts below its 1px border and 20px label.
export const AREA = { x: 1, y: 21 };

// Starts a server for each test, and closes it after.
export function useExample(opts: Options = {}) {
  const example = {} as Example;
  test.beforeEach(async () => Object.assign(example, await startExample(0, opts)));
  test.afterEach(() => example.close());
  return example;
}

// Loads the kernel and boots the vendor's app with the whole screen.
export async function boot(page: Page, example: Example, vendor: string) {
  await page.goto(`${example.origin}/?boot=${example.label(vendor)}`);
  return appWorker(page, vendor);
}

// Finds the worker the vendor's app runs in.
export async function appWorker(page: Page, vendor: string): Promise<Worker> {
  let found: Worker | undefined;
  await expect
    .poll(async () => {
      for (const worker of page.workers()) {
        if ((await worker.evaluate(() => (self as unknown as { VENDOR: string }).VENDOR).catch(() => "")) === vendor) {
          found = worker;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  return found!;
}

// A probe app's globals, as tests reach them from its worker with
// `self as unknown as ProbeGlobals`.
export interface ProbeGlobals {
  cei: any;
  link: any;
  probe: any;
}

// Boots the probe with the screen, and has it paint the screen one color.
export async function rootProbe(page: Page, example: Example, color: string) {
  const probe = await boot(page, example, "probe");
  const viewport: number = await probe.evaluate(async (color) => {
    const { probe } = self as unknown as ProbeGlobals;
    return (await probe.accept(await probe.nextDeed(), color)).viewport;
  }, color);
  return { probe, viewport };
}

// Starts the vendor's app from the probe and returns its worker.
export async function startFrom(probe: Worker, page: Page, example: Example, vendor: string) {
  await probe.evaluate((label) => (self as unknown as ProbeGlobals).link.open(label), example.label(vendor));
  return appWorker(page, vendor);
}

// Measures which renderer process does work. The returned function runs busy
// and returns the ID of the renderer process whose CPU time grew most. CDP
// doesn't map frames or workers to processes, so this is how tests find them.
export async function processMeter(browser: Browser) {
  const cdp = await browser.newBrowserCDPSession();
  const cpuTimes = async () => {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    return new Map(processInfo.filter((p) => p.type === "renderer").map((p) => [p.id, p.cpuTime]));
  };
  return async (busy: () => Promise<unknown>) => {
    const before = await cpuTimes();
    await busy();
    const deltas = [...(await cpuTimes())].map(([id, time]) => [id, time - (before.get(id) ?? 0)] as const);
    const [id, delta] = deltas.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(delta).toBeGreaterThan(0.5);
    return id;
  };
}

// Returns the RGB color on screen at a point, in CSS pixels.
export async function pixel(page: Page, x: number, y: number): Promise<string> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const idat: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("latin1", offset + 4, offset + 8) === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  // One pixel: a filter byte, then RGB(A). Every filter leaves the first pixel as is.
  const [, r, g, b] = inflateSync(Buffer.concat(idat));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
