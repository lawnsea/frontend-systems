import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Whether a page can run code in a same-origin, unsandboxed frame served with
// Document-Isolation-Policy, from the network or by a service worker. Each test
// also runs against a frame without the policy, where the attack should work, to
// show the test can detect it.

// Serves /frame by fetching it, and sends the frame's document a message once it
// is a client.
const WORKER = `
  addEventListener("install", () => skipWaiting());
  addEventListener("activate", (e) => e.waitUntil(clients.claim()));
  addEventListener("fetch", (e) => {
    if (new URL(e.request.url).pathname !== "/frame") return;
    e.respondWith(fetch(e.request));
    e.waitUntil((async () => {
      fetch("/log?worker-served-frame");
      for (let i = 0; i < 50; i++) {
        const client = await clients.get(e.resultingClientId);
        if (client) return client.postMessage("hello");
        await new Promise((r) => setTimeout(r, 100));
      }
    })());
  });`;

// Reports each message from its service worker.
const FRAME = `<!doctype html><title>frame</title><script>
  navigator.serviceWorker.onmessage = (m) => fetch("/log?frame-got-" + m.data);
</script>`;

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
    } else if (url.pathname === "/sw.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" }).end(WORKER);
    } else if (url.pathname === "/frame") {
      const headers: Record<string, string> = { "Content-Type": "text/html" };
      if (url.searchParams.has("dip")) headers["Document-Isolation-Policy"] = "isolate-and-credentialless";
      res.writeHead(200, headers).end(FRAME);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><body>");
    }
  });
  await new Promise<void>((r) => server.listen(0, "localhost", r));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});
test.afterEach(() => server.close());

// Adds a frame for /frame to the page, served by a service worker if `worker`,
// calls before with its window while it still has its initial about:blank
// document, and returns it once loaded.
const addFrame = async (page: Page, { dip, worker }: { dip: boolean; worker: boolean }, before = "") => {
  await page.goto(`${origin}/`);
  if (worker) {
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
      }
    });
  }
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
  const frame = page.frames().find((f) => f.url().startsWith(`${origin}/frame`))!;
  expect(await frame.evaluate(() => crossOriginIsolated)).toBe(dip);
  expect(log.includes("worker-served-frame")).toBe(worker);
  return frame;
};

for (const dip of [true, false]) {
  const policy = dip ? "with the policy" : "without the policy (control)";

  test(`a service worker controls a same-origin frame ${policy} and can message it`, async ({ page }) => {
    const frame = await addFrame(page, { dip, worker: true });
    expect(await frame.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${origin}/sw.js`);
    await expect.poll(() => log).toContain("frame-got-hello");
  });

  for (const worker of [false, true]) {
    const served = worker ? "served by a service worker" : "served from the network";

    test(`the page ${dip ? "can't" : "can"} script a same-origin frame ${policy}, ${served}`, async ({ page }) => {
      await addFrame(page, { dip, worker });
      const access = await page.evaluate(() => {
        try {
          return document.querySelector("iframe")!.contentDocument?.title ?? "no document";
        } catch (e) {
          return (e as Error).name;
        }
      });
      expect(access === "frame").toBe(!dip);
    });

    test(`the page's changes to the initial window ${dip ? "don't carry" : "carry"} over ${policy}, ${served}`, async ({ page }) => {
      const frame = await addFrame(page, { dip, worker }, "w.attackerMark = true; w.Array.prototype.attackerMark = true;");
      const marks = await frame.evaluate(() => [
        (self as unknown as { attackerMark?: boolean }).attackerMark ?? false,
        ([] as unknown as { attackerMark?: boolean }).attackerMark ?? false,
      ]);
      expect(marks).toEqual([!dip, !dip]);
    });

    for (const how of ["src", "location"]) {
      test(`the page ${dip ? "can't" : "can"} run a javascript: URL in a same-origin frame ${policy}, ${served} (${how})`, async ({ page }) => {
        await addFrame(page, { dip, worker });
        await page.evaluate((how) => {
          const frame = document.querySelector("iframe")!;
          const js = `javascript:void fetch("/log?javascript-ran-" + crossOriginIsolated)`;
          if (how === "src") frame.src = js;
          else frame.contentWindow!.location.href = js;
        }, how);
        await page.waitForTimeout(1000);
        expect(log.filter((e) => e.startsWith("javascript-ran-"))).toEqual(dip ? [] : ["javascript-ran-false"]);
      });
    }
  }
}
