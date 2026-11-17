import { expect, test, type Frame, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Whether a page can run code in a same-origin, unsandboxed frame served with
// Document-Isolation-Policy. Each test also runs against a frame without the
// policy, where the attack should work, to show the test can detect it.

let server: Server;
let origin: string;
let log: string[];

test.beforeEach(async () => {
  log = [];
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/log") {
      log.push(url.search.slice(1));
      res.writeHead(204).end();
    } else if (url.pathname === "/frame") {
      const headers: Record<string, string> = { "Content-Type": "text/html" };
      if (url.searchParams.has("dip")) headers["Document-Isolation-Policy"] = "isolate-and-credentialless";
      res.writeHead(200, headers).end("<!doctype html><title>frame</title>");
    } else {
      res.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><body>");
    }
  });
  await new Promise<void>((r) => server.listen(0, "localhost", r));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});
test.afterEach(() => server.close());

// Adds a frame for /frame to the page, calls before with its window while it
// still has its initial about:blank document, and returns it once loaded.
const addFrame = async (page: Page, dip: boolean, before = "") => {
  await page.goto(`${origin}/`);
  const src = `/frame${dip ? "?dip" : ""}`;
  await page.evaluate(
    ([src, before]) =>
      new Promise((resolve) => {
        const frame = document.createElement("iframe");
        frame.src = src;
        frame.onload = resolve;
        document.body.append(frame);
        new Function("w", before)(frame.contentWindow);
      }),
    [src, before],
  );
  const frame = page.frames().find((f) => f.url().startsWith(`${origin}/frame`))! as Frame;
  expect(await frame.evaluate(() => crossOriginIsolated)).toBe(dip);
  return frame;
};

for (const dip of [true, false]) {
  const policy = dip ? "with the policy" : "without the policy (control)";

  test(`the page ${dip ? "can't" : "can"} script a same-origin frame ${policy}`, async ({ page }) => {
    await addFrame(page, dip);
    const access = await page.evaluate(() => {
      try {
        return document.querySelector("iframe")!.contentDocument?.title ?? "no document";
      } catch (e) {
        return (e as Error).name;
      }
    });
    expect(access === "frame").toBe(!dip);
  });

  test(`the page's changes to the initial window ${dip ? "don't carry" : "carry"} over ${policy}`, async ({ page }) => {
    const frame = await addFrame(page, dip, "w.attackerMark = true; w.Array.prototype.attackerMark = true;");
    const marks = await frame.evaluate(() => [
      (self as unknown as { attackerMark?: boolean }).attackerMark ?? false,
      ([] as unknown as { attackerMark?: boolean }).attackerMark ?? false,
    ]);
    expect(marks).toEqual([!dip, !dip]);
  });

  for (const how of ["src", "location"]) {
    test(`the page ${dip ? "can't" : "can"} run a javascript: URL in a same-origin frame ${policy} (${how})`, async ({ page }) => {
      await addFrame(page, dip);
      await page.evaluate((how) => {
        const frame = document.querySelector("iframe")!;
        const js = `javascript:void fetch("/log?javascript-ran-" + crossOriginIsolated)`;
        if (how === "src") frame.src = js;
        else frame.contentWindow!.location.href = js;
      }, how);
      await page.waitForTimeout(1000);
      expect(log).toEqual(dip ? [] : ["javascript-ran-false"]);
    });
  }
}
