import { expect, test } from "@playwright/test";
import { boot, processMeter, rootProbe, startFrom, useExample, type ProbeGlobals } from "./helpers.ts";

// The execution environment: each app's container, and the CEI calls the web
// platform already provides inside it.

const example = useExample();

test("an app runs in a worker with an opaque origin and cross-origin isolation", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  expect(await probe.evaluate(() => [self.origin, crossOriginIsolated])).toEqual(["null", true]);
});

test("an app can't use the network except through the kernel", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const base = `http://${example.label("news")}`;
  const attempts = await probe.evaluate(async (base) => {
    const attempt = async (f: () => unknown) => {
      try {
        await f();
        return "allowed";
      } catch {
        return "blocked";
      }
    };
    // A thread the app starts inherits its container's policy.
    const fromThread = new Promise((resolve) => {
      const source = `fetch(${JSON.stringify(`${base}/thread`)}).then(() => postMessage("allowed"), () => postMessage("blocked"));`;
      const thread = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
      thread.onmessage = (m) => resolve(m.data);
    });
    // WebSocket and EventSource report failure with events, so the server's log
    // shows whether they got through.
    new WebSocket(`${base.replace("http", "ws")}/socket`);
    new EventSource(`${base}/events`);
    return {
      fetch: await attempt(() => fetch(`${base}/fetch`)),
      importScripts: await attempt(() => (self as unknown as { importScripts(url: string): void }).importScripts(`${base}/import.js`)),
      worker: await attempt(() => new Worker(`${base}/worker.js`)),
      fetchFromThread: await fromThread,
    };
  }, base);
  expect(attempts).toEqual({ fetch: "blocked", importScripts: "blocked", worker: "blocked", fetchFromThread: "blocked" });

  // The kernel's fetch gets through.
  const status = await probe.evaluate(async (url) => (await (self as unknown as ProbeGlobals).cei.fetch(url)).status, `${base}/echo`);
  expect(status).toBe(200);
  await page.waitForTimeout(500);
  expect(example.requests.filter((r) => !r.includes("/.well-known/"))).toEqual(["news /echo cookie="]);
});

test("apps can't reach each other through BroadcastChannel or storage", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const probe2 = await startFrom(probe, page, example, "probe2");
  await probe2.evaluate(() => {
    (self as any).heard = [];
    new BroadcastChannel("apps").onmessage = (e) => (self as any).heard.push(e.data);
  });
  const { ownChannel, ...storage } = await probe.evaluate(async () => {
    // Another channel in the sender's own worker hears it, so delivery works.
    const own = new Promise((resolve) => {
      new BroadcastChannel("apps").onmessage = (e) => resolve(e.data);
      setTimeout(() => resolve(null), 1000);
    });
    new BroadcastChannel("apps").postMessage("hello");
    const blocked = async (f: () => unknown) => {
      try {
        await f();
        return false;
      } catch {
        return true;
      }
    };
    return {
      indexedDB: await blocked(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("apps");
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
          }),
      ),
      caches: await blocked(() => caches.open("apps")),
      locks: await blocked(() => navigator.locks.request("apps", () => {})),
      ownChannel: await own,
    };
  });
  expect(ownChannel).toBe("hello");
  expect(storage).toEqual({ indexedDB: true, caches: true, locks: true });
  await page.waitForTimeout(300);
  expect(await probe2.evaluate(() => (self as any).heard)).toEqual([]);
});

test("an app can compile WebAssembly but can't eval", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const result = await probe.evaluate(async () => {
    const module = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    let evaluated;
    try {
      evaluated = (0, eval)("1");
    } catch (error) {
      evaluated = (error as Error).name;
    }
    return [module instanceof WebAssembly.Module, evaluated];
  });
  expect(result).toEqual([true, "EvalError"]);
});

// Covers allocate memory, thread create and futex wait and wake.
test("an app's threads share memory and wait on futexes", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const result = await probe.evaluate(async () => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    const words = new Int32Array(memory.buffer);
    const source = `onmessage = (e) => {
      const words = new Int32Array(e.data.buffer);
      const result = Atomics.wait(words, 0, 0, 5000);
      words[1] = 42;
      postMessage(result);
    };`;
    const thread = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    const woke = new Promise((resolve) => (thread.onmessage = (m) => resolve(m.data)));
    thread.postMessage(memory);
    // Wakes the thread once it waits.
    while (Atomics.notify(words, 0, 1) === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    return [await woke, words[1]];
  });
  expect(result).toEqual(["ok", 42]);
});

test("each app runs in its own process, apart from the kernel's", async ({ page, browser }) => {
  const probe = await boot(page, example, "probe");
  const probe2 = await startFrom(probe, page, example, "probe2");
  const busiest = await processMeter(browser);
  const spin = () => {
    const end = Date.now() + 1000;
    while (Date.now() < end);
  };
  const processes = [await busiest(() => page.evaluate(spin)), await busiest(() => probe.evaluate(spin)), await busiest(() => probe2.evaluate(spin))];
  expect(new Set(processes).size).toBe(3);
});

test("exit stops the app and empties its viewports", async ({ page }) => {
  const { probe } = await rootProbe(page, example, "#ff0000");
  await expect(page.locator("#screen > .viewport > .label")).toHaveText(example.label("probe"));
  await probe.evaluate(() => void (self as unknown as ProbeGlobals).cei.exit());
  await expect(page.locator("#containers iframe")).toHaveCount(0);
  await expect(page.locator("#screen > .viewport > .label")).toHaveText("No app");
  await expect(page.locator("canvas")).toHaveCount(0);
});
