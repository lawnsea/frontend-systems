import { expect, test, type Browser, type Frame, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { processMeter } from "./helpers.ts";

// How Chromium partitions credentialless iframes: whether one can register a
// service worker, which frames that worker controls, which credentialless
// frames share storage, cookies and BroadcastChannel, and which DIP frames share
// a process. These inform whether containers could be credentialless
// same-origin frames; see docs/design.md.

// Logs each fetch it handles, and claims clients when it activates.
const SERVICE_WORKER = `
  addEventListener("install", () => skipWaiting());
  addEventListener("activate", (e) => e.waitUntil(clients.claim()));
  addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    if (url.pathname === "/log") return;
    fetch("/log?" + encodeURIComponent("sw " + e.request.mode + " " + url.pathname + url.search));
  });`;

// A page that adds frames on request: credentialless or not, with or without DIP.
const TOP = `<!doctype html><body><script>
  self.addFrame = (name, { credentialless = true, dip = false, sandbox = false, path = "/frame", origin = "", parent = document.body } = {}) =>
    new Promise((resolve) => {
      const frame = document.createElement("iframe");
      frame.credentialless = credentialless;
      if (sandbox) frame.sandbox = "allow-scripts";
      frame.name = name;
      frame.src = origin + path + "?name=" + name + (dip ? "&dip" : "");
      frame.onload = () => resolve();
      parent.append(frame);
    });
</script>`;

// A frame that reports what its storage, cookies and BroadcastChannel see.
const FRAME = `<!doctype html><body><script>
  self.heard = [];
  new BroadcastChannel("probe").onmessage = (e) => heard.push(e.data);
  const db = () => new Promise((resolve, reject) => {
    const request = indexedDB.open("probe", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("s");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const idb = async (mode, op) => {
    const store = (await db()).transaction("s", mode).objectStore("s");
    return new Promise((resolve) => { const r = op(store); r.onsuccess = () => resolve(r.result); });
  };
  self.write = async (value) => {
    localStorage.setItem("probe", value);
    document.cookie = "probe=" + value;
    await idb("readwrite", (s) => s.put(value, "probe"));
    new BroadcastChannel("probe").postMessage(value);
  };
  self.read = async () => ({
    localStorage: localStorage.getItem("probe"),
    cookie: document.cookie.match(/probe=([^;]*)/)?.[1] ?? null,
    indexedDB: (await idb("readonly", (s) => s.get("probe"))) ?? null,
  });
  self.addFrame = (name) => new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.credentialless = true;
    frame.name = name;
    frame.src = "/frame?name=" + name;
    frame.onload = () => resolve();
    document.body.append(frame);
  });
</script>`;

// Reports whether it's cross-origin isolated, then spins for 1s per message.
const SPIN_WORKER = `
  postMessage(crossOriginIsolated);
  onmessage = () => { const end = Date.now() + 1000; while (Date.now() < end); postMessage("done"); };`;

// Served with CSP sandbox. Reports what it is, spins for 1s on "spin", writes a
// value to BroadcastChannel and IndexedDB on "write", and reports what it has
// heard and read on "read".
const SANDBOXED_WORKER = `
  const heard = [];
  const info = { origin: self.origin, secure: isSecureContext, subtle: !!crypto.subtle, coi: crossOriginIsolated };
  try { new BroadcastChannel("w").onmessage = (e) => heard.push(e.data); } catch (e) { info.broadcastError = e.name; }
  const store = (mode, op) => new Promise((resolve, reject) => {
    const request = indexedDB.open("w", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("s");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const r = op(request.result.transaction("s", mode).objectStore("s")); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); };
  });
  postMessage(info);
  onmessage = async ({ data }) => {
    if (data === "spin") { const end = Date.now() + 1000; while (Date.now() < end); return postMessage("done"); }
    if (data.write) {
      try { new BroadcastChannel("w").postMessage(data.write); } catch {}
      try { await store("readwrite", (s) => s.put(data.write, "k")); } catch {}
      return postMessage("written");
    }
    let stored;
    try { stored = await store("readonly", (s) => s.get("k")); } catch (e) { stored = "error " + e.name; }
    postMessage({ heard, stored });
  };`;

let server: Server;
let origin: string;
let log: string[];
test.beforeEach(async () => {
  log = [];
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/log") {
      log.push(decodeURIComponent(url.search.slice(1)));
      return res.writeHead(204).end();
    }
    const headers: Record<string, string> = { "Content-Type": "text/html", "Cache-Control": "no-store" };
    if (url.pathname === "/frame" && url.searchParams.has("dip")) headers["Document-Isolation-Policy"] = "isolate-and-credentialless";
    if (url.pathname.endsWith(".js")) headers["Content-Type"] = "text/javascript";
    if (url.pathname === "/sandboxed.js") headers["Content-Security-Policy"] = "sandbox";
    const body = { "/top": TOP, "/frame": FRAME, "/sw.js": SERVICE_WORKER, "/spin.js": SPIN_WORKER, "/sandboxed.js": SANDBOXED_WORKER }[url.pathname];
    res.writeHead(body ? 200 : 404, headers).end(body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});
test.afterEach(() => server.close());

const open = async (page: Page) => {
  await page.goto(`${origin}/top`);
  return page;
};
type FrameOptions = { credentialless?: boolean; dip?: boolean; sandbox?: boolean; path?: string; origin?: string };
const addFrame = async (page: Page, name: string, opts: FrameOptions = {}) => {
  await page.evaluate(([name, opts]) => (self as any).addFrame(name, opts), [name, opts] as const);
  return page.frame({ name })!;
};
// Adds a frame to a frame whose document is /top.
const addNestedFrame = async (parent: Frame, name: string, opts: FrameOptions = {}) => {
  await parent.evaluate(([name, opts]) => (self as any).addFrame(name, opts), [name, opts] as const);
  return parent.childFrames().find((f) => f.name() === name)!;
};
const write = (frame: Frame, value: string) => frame.evaluate((value) => (self as any).write(value), value);
const read = (frame: Frame) => frame.evaluate(() => (self as any).read());
const heard = (frame: Frame) => frame.evaluate(() => (self as any).heard);

// What `frame` sees after `writer` writes, and what `writer` hears back.
// Each call writes a fresh value, so a frame's own earlier write never counts.
let writes = 0;
async function shares(writer: Frame, frame: Frame) {
  const value = `secret${writes++}`;
  await write(writer, value);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const seen = await read(frame);
  return {
    localStorage: seen.localStorage === value,
    cookie: seen.cookie === value,
    indexedDB: seen.indexedDB === value,
    broadcast: (await heard(frame)).includes(value),
  };
}
const NOTHING = { localStorage: false, cookie: false, indexedDB: false, broadcast: false };
const EVERYTHING = { localStorage: true, cookie: true, indexedDB: true, broadcast: true };

// Every credentialless frame under one top-level document shares one ephemeral
// partition, whatever its nesting or Document-Isolation-Policy. A new top-level
// document, from a reload, another tab or a popup, gets a new one.
test.describe("sharing", () => {
  test("two credentialless frames on one page share everything", async ({ page }) => {
    await open(page);
    expect(await shares(await addFrame(page, "a"), await addFrame(page, "b"))).toEqual(EVERYTHING);
  });

  test("Document-Isolation-Policy doesn't change the partition", async ({ page }) => {
    await open(page);
    const dip = await addFrame(page, "dip", { dip: true });
    expect(await shares(dip, await addFrame(page, "plain"))).toEqual(EVERYTHING);
    expect(await shares(dip, await addFrame(page, "dip2", { dip: true }))).toEqual(EVERYTHING);
  });

  test("a credentialless frame shares with its credentialless child", async ({ page }) => {
    await open(page);
    const a = await addFrame(page, "a");
    await a.evaluate(() => (self as any).addFrame("child"));
    expect(await shares(a, page.frame({ name: "child" })!)).toEqual(EVERYTHING);
  });

  test("a credentialless frame shares with one under an ordinary frame", async ({ page }) => {
    await open(page);
    const local = await addFrame(page, "local");
    const sameSite = await addFrame(page, "same-site", { path: "/top", credentialless: false });
    expect(await shares(local, await addNestedFrame(sameSite, "nested"))).toEqual(EVERYTHING);

    // other.localhost is a different site from localhost. The cookie doesn't
    // carry, probably because SameSite=Lax blocks it in a third-party frame.
    const other = origin.replace("localhost", "other.localhost");
    const direct = await addFrame(page, "direct", { origin: other });
    const crossSite = await addFrame(page, "cross-site", { origin: other, path: "/top", credentialless: false });
    expect(await shares(direct, await addNestedFrame(crossSite, "nested-other"))).toEqual({ ...EVERYTHING, cookie: false });
  });

  test("a frame added after another is removed sees what it left", async ({ page }) => {
    await open(page);
    await write(await addFrame(page, "a"), "left");
    await page.evaluate(() => document.querySelector("iframe")!.remove());
    expect(await read(await addFrame(page, "b"))).toEqual({ localStorage: "left", cookie: "left", indexedDB: "left" });
  });

  test("a credentialless frame doesn't share with an ordinary frame", async ({ page }) => {
    await open(page);
    const a = await addFrame(page, "a");
    const b = await addFrame(page, "b", { credentialless: false });
    expect(await shares(a, b)).toEqual(NOTHING);
    expect(await shares(b, a)).toEqual(NOTHING);
  });

  test("credentialless frames in two tabs don't share", async ({ page, context }) => {
    await open(page);
    const a = await addFrame(page, "a");
    expect(await shares(a, await addFrame(await open(await context.newPage()), "b"))).toEqual(NOTHING);
  });

  test("credentialless frames in a page and a popup it opens don't share", async ({ page }) => {
    await open(page);
    const a = await addFrame(page, "a");
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.evaluate(() => void window.open("/top"))]);
    await popup.waitForLoadState();
    expect(await shares(a, await addFrame(popup, "b"))).toEqual(NOTHING);
  });

  test("a credentialless frame doesn't see what one before a reload left", async ({ page }) => {
    await open(page);
    await write(await addFrame(page, "a"), "left");
    await page.reload();
    expect(await read(await addFrame(page, "b"))).toEqual({ localStorage: null, cookie: null, indexedDB: null });
  });
});

test.describe("service workers", () => {
  test("a credentialless frame's service worker controls later credentialless frames on its page", async ({ page, context }) => {
    await open(page);
    const a = await addFrame(page, "a");
    const registered = await a.evaluate(async () => {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 20));
      return { active: !!registration.active, controlsSelf: !!navigator.serviceWorker.controller };
    });
    expect(registered).toEqual({ active: true, controlsSelf: true });

    const controlled = async (frame: Frame) => frame.evaluate(() => !!navigator.serviceWorker.controller);
    expect(await controlled(await addFrame(page, "b"))).toBe(true);
    expect(await controlled(await addFrame(page, "dip", { dip: true }))).toBe(true);
    // It handles their navigations, so it could serve them any document.
    expect(log).toEqual(expect.arrayContaining(["sw navigate /frame?name=b", "sw navigate /frame?name=dip&dip"]));

    expect(await controlled(await addFrame(page, "ordinary", { credentialless: false }))).toBe(false);
    expect(await controlled(await addFrame(await open(await context.newPage()), "c"))).toBe(false);
    await page.reload();
    expect(await controlled(await addFrame(page, "d"))).toBe(false);
  });

  test("a dedicated worker can't register one", async ({ page }) => {
    await open(page);
    const a = await addFrame(page, "a");
    const exposed = await a.evaluate(
      () =>
        new Promise((resolve) => {
          const worker = new Worker(URL.createObjectURL(new Blob(["postMessage('serviceWorker' in navigator)"], { type: "text/javascript" })));
          worker.onmessage = (m) => resolve(m.data);
        }),
    );
    expect(exposed).toBe(false);
  });
});

test.describe("processes", () => {
  // Starts a worker from a URL in each frame, as an app container would, and
  // returns the renderer process each worker runs in, and the page's.
  // A sandboxed frame's origin is opaque, so its worker comes from a blob URL.
  async function processes(page: Page, browser: Browser, frames: Frame[], { blob = false } = {}) {
    for (const frame of frames) {
      const isolated = await frame.evaluate(
        ([blob, source]) =>
          new Promise((resolve) => {
            const url = blob ? URL.createObjectURL(new Blob([source], { type: "text/javascript" })) : "/spin.js";
            const worker = new Worker(url);
            (self as any).worker = worker;
            worker.onmessage = (m) => resolve(m.data);
          }),
        [blob, SPIN_WORKER] as const,
      );
      expect(isolated).toBe(true);
    }
    const busiest = await processMeter(browser);
    const pageProcess = await busiest(() =>
      page.evaluate(() => {
        const end = Date.now() + 1000;
        while (Date.now() < end);
      }),
    );
    const workers = [];
    for (const frame of frames) {
      workers.push(
        await busiest(() =>
          frame.evaluate(
            () =>
              new Promise((resolve) => {
                const { worker } = self as any;
                worker.onmessage = resolve;
                worker.postMessage(null);
              }),
          ),
        ),
      );
    }
    return { pageProcess, workers };
  }

  // Chromium appears to give DIP documents a process per origin.
  for (const credentialless of [true, false]) {
    test(`same-origin ${credentialless ? "credentialless" : "ordinary"} frames with DIP share one process, apart from the page's`, async ({ page, browser }) => {
      await open(page);
      const frames = [];
      for (const name of ["a", "b", "c"]) frames.push(await addFrame(page, name, { dip: true, credentialless }));
      const { pageProcess, workers } = await processes(page, browser, frames);
      expect(new Set(workers).size).toBe(1);
      expect(workers[0]).not.toBe(pageProcess);
    });
  }

  test("sandboxed frames with DIP each get their own process", async ({ page, browser }) => {
    await open(page);
    const frames = [];
    for (const name of ["a", "b", "c"]) frames.push(await addFrame(page, name, { dip: true, credentialless: false, sandbox: true }));
    const { pageProcess, workers } = await processes(page, browser, frames, { blob: true });
    expect(new Set([pageProcess, ...workers]).size).toBe(4);
  });
});

test.describe("workers served with CSP sandbox", () => {
  // Starts /sandboxed.js in each frame and returns what each reports.
  const start = (frame: Frame) =>
    frame.evaluate(
      () =>
        new Promise((resolve) => {
          const worker = new Worker("/sandboxed.js");
          (self as any).worker = worker;
          worker.onmessage = (m) => resolve(m.data);
          worker.onerror = (e) => resolve({ error: e.message ?? "error" });
        }),
    );
  const ask = (frame: Frame, message: unknown) =>
    frame.evaluate(
      (message) =>
        new Promise((resolve) => {
          const { worker } = self as any;
          worker.onmessage = (m: MessageEvent) => resolve(m.data);
          worker.postMessage(message);
        }),
      message,
    );

  // The worker gets an opaque origin, so it's no secure context and can't use
  // IndexedDB. It still runs in its frame's process, and still shares
  // BroadcastChannel with the other frames' workers.
  for (const credentialless of [true, false]) {
    test(`in same-origin ${credentialless ? "credentialless" : "ordinary"} frames with DIP, one runs in its frame's shared process`, async ({ page, browser }) => {
      await open(page);
      const frames: Frame[] = [];
      for (const name of ["a", "b", "c"]) frames.push(await addFrame(page, name, { dip: true, credentialless }));
      for (const frame of frames) expect(await start(frame)).toEqual({ origin: "null", secure: false, subtle: false, coi: true });

      await ask(frames[0], { write: "from-a" });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await ask(frames[1], "read")).toEqual({ heard: ["from-a"], stored: "error SecurityError" });

      const busiest = await processMeter(browser);
      const pageProcess = await busiest(() =>
        page.evaluate(() => {
          const end = Date.now() + 1000;
          while (Date.now() < end);
        }),
      );
      const workers = [];
      for (const frame of frames) workers.push(await busiest(() => ask(frame, "spin")));
      const frameProcess = await busiest(() =>
        frames[0].evaluate(() => {
          const end = Date.now() + 1000;
          while (Date.now() < end);
        }),
      );
      expect(new Set(workers)).toEqual(new Set([frameProcess]));
      expect(frameProcess).not.toBe(pageProcess);
    });
  }
});
