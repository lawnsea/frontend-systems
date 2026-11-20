import { expect, test, type Worker } from "@playwright/test";
import { boot, startFrom, useExample, type ProbeGlobals } from "./helpers.ts";

// getIfconfig, the net buffer calls, and the kernel's fetch.

const example = useExample({ vendors: { probe3: "apps/probe.js" } });

const ifconfig = (worker: Worker) => worker.evaluate(() => (self as unknown as ProbeGlobals).cei.ifconfig());
const send = (worker: Worker, dst: string, text: string) =>
  worker.evaluate(({ dst, text }) => (self as unknown as ProbeGlobals).cei.send(dst, new TextEncoder().encode(text).buffer), { dst, text });
const received = (worker: Worker, text: string) =>
  worker.evaluate((text) => (self as unknown as ProbeGlobals).probe.packets.filter((p: { text: string }) => p.text === text), text);

test("each app gets its own address in the kernel's prefix", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const probe2 = await startFrom(probe, page, example, "probe2");
  const [a, b] = [await ifconfig(probe), await ifconfig(probe2)];
  expect(a.prefix).toBe("fd65:6d62::/64");
  for (const { address } of [a, b]) expect(address).toMatch(/^fd65:6d62::[0-9a-f]+$/);
  expect(a.address).not.toBe(b.address);
});

test("the kernel delivers a unicast packet, with the sender's address, to its destination only", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const probe2 = await startFrom(probe, page, example, "probe2");
  const probe3 = await startFrom(probe, page, example, "probe3");
  const [a, b] = [await ifconfig(probe), await ifconfig(probe2)];
  await send(probe, b.address, "hello");
  await expect.poll(() => received(probe2, "hello")).toEqual([{ src: a.address, dst: b.address, text: "hello" }]);
  await page.waitForTimeout(200);
  expect([...(await received(probe, "hello")), ...(await received(probe3, "hello"))]).toEqual([]);
});

test("a broadcast reaches every app but the sender", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const probe2 = await startFrom(probe, page, example, "probe2");
  const a = await ifconfig(probe);
  await send(probe2, a.broadcast, "to all");
  const b = await ifconfig(probe2);
  await expect.poll(() => received(probe, "to all")).toEqual([{ src: b.address, dst: a.broadcast, text: "to all" }]);
  expect(await received(probe2, "to all")).toEqual([]);
});

test("the kernel drops a packet to an address no app has", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const probe2 = await startFrom(probe, page, example, "probe2");
  await send(probe, "fd65:6d62::ff", "lost");
  await page.waitForTimeout(200);
  expect([...(await received(probe, "lost")), ...(await received(probe2, "lost"))]).toEqual([]);
});

test("the kernel's fetch sends no cookies", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const label = example.label("probe2");
  await page.context().addCookies([{ name: "session", value: "secret", domain: "probe2.localhost", path: "/", sameSite: "None", secure: true }]);
  // The browser attaches the cookie to a credentialed request from the kernel's page.
  await page.evaluate((url) => fetch(url, { credentials: "include", mode: "no-cors" }), `http://${label}/echo`);
  expect(example.requests.at(-1)).toBe("probe2 /echo cookie=session=secret");

  const response = await probe.evaluate(async (url) => {
    const { status, body } = await (self as unknown as ProbeGlobals).cei.fetch(url);
    return { status, headers: JSON.parse(new TextDecoder().decode(body)) };
  }, `http://${label}/echo`);
  expect(response.status).toBe(200);
  expect(response.headers.cookie).toBeUndefined();
  expect(response.headers.referer).toBeUndefined();
  expect(example.requests.at(-1)).toBe("probe2 /echo cookie=");
});

test("the kernel's fetch refuses other schemes and the kernel's own origin", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const errors = await probe.evaluate(async (urls) => {
    const { cei } = self as unknown as ProbeGlobals;
    return Promise.all(urls.map((url) => cei.fetch(url).then(() => "fetched", (error: Error) => error.message)));
  }, ["data:text/plain,hi", `${example.origin}/kernel.js`]);
  expect(errors[0]).toMatch(/only http and https/);
  expect(errors[1]).toMatch(/can't fetch the kernel's origin/);
});
