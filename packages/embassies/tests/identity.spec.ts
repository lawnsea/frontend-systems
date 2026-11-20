import { expect, test, type Worker } from "@playwright/test";
import { appWorker, boot, startFrom, useExample, type ProbeGlobals } from "./helpers.ts";

// ensureAlive, getAppSecret, endorseMe, verifyEndorsement and verifyLabel.

const example = useExample();

// Fetches the vendor's key, boot block and signature from inside the app, and
// calls ensureAlive with them, flipping a bit of the boot block if `tamper`.
const ensureAlive = (probe: Worker, label: string, tamper = false) =>
  probe.evaluate(
    async ({ label, tamper }) => {
      const { cei, probe } = self as unknown as ProbeGlobals;
      const get = async (file: string) => (await cei.fetch(`http://${label}/.well-known/embassies/${file}`)).body;
      const [key, bootBlock, signature] = await Promise.all(["key", "boot.js", "boot.sig"].map(get));
      if (tamper) new Uint8Array(bootBlock)[0] ^= 1;
      const digest = probe.hex(await cei.subtle.digest("SHA-256", key));
      try {
        return { principal: await cei.ensureAlive(bootBlock, signature, key), digest };
      } catch (error) {
        return { error: (error as Error).message, digest };
      }
    },
    { label, tamper },
  );

test("ensureAlive refuses a boot block that doesn't match its signature", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  expect((await ensureAlive(probe, example.label("probe2"), true)).error).toMatch(/signature doesn't match/);
  await expect(page.locator("#containers iframe")).toHaveCount(1);
});

test("ensureAlive starts one container per key and returns its principal", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const first = await ensureAlive(probe, example.label("probe2"));
  const second = await ensureAlive(probe, example.label("probe2"));
  expect(first.principal).toBe(first.digest);
  expect(second.principal).toBe(first.principal);
  await expect(page.locator("#containers iframe")).toHaveCount(2);
  const probe2 = await appWorker(page, "probe2");
  expect(await probe2.evaluate(async () => (await (self as unknown as ProbeGlobals).cei.ifconfig()).principal)).toBe(first.principal);
});

test("an app's secret is stable across kernel loads and differs between apps", async ({ page }) => {
  const secret = (worker: Worker) =>
    worker.evaluate(async () => {
      const { cei, probe } = self as unknown as ProbeGlobals;
      return probe.hex(await cei.appSecret());
    });
  const probe = await boot(page, example, "probe");
  const first = await secret(probe);
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(await secret(await startFrom(probe, page, example, "probe2"))).not.toBe(first);
  expect(await secret(await boot(page, example, "probe"))).toBe(first);
});

test("the kernel endorses an app's key only for that app", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const probe2 = await startFrom(probe, page, example, "probe2");
  const endorsement = await probe.evaluate(async () => {
    const { cei, probe } = self as unknown as ProbeGlobals;
    const key = crypto.getRandomValues(new Uint8Array(65)).buffer;
    return { key: probe.hex(key), principal: (await cei.ifconfig()).principal, signature: probe.hex(await cei.endorseMe(key.slice(0))) };
  });
  // Another app on the same kernel checks it.
  const checks = await probe2.evaluate(async ({ key, principal, signature }) => {
    const { cei } = self as unknown as ProbeGlobals;
    const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16)).buffer;
    const otherKey = bytes(key);
    new Uint8Array(otherKey)[0] ^= 1;
    return [
      await cei.verifyEndorsement(bytes(key), principal, bytes(signature)),
      await cei.verifyEndorsement(bytes(key), (await cei.ifconfig()).principal, bytes(signature)),
      await cei.verifyEndorsement(otherKey, principal, bytes(signature)),
    ];
  }, endorsement);
  expect(checks).toEqual([true, false, false]);
});

test("verifyLabel accepts the app's own label and refuses another vendor's", async ({ page }) => {
  const probe = await boot(page, example, "probe");
  const results = await probe.evaluate(async (labels) => {
    const { cei } = self as unknown as ProbeGlobals;
    return Promise.all(labels.map((label) => cei.verifyLabel(label).catch((error: Error) => error.message)));
  }, [example.label("probe"), example.label("news"), "not a label"]);
  expect(results[0]).toBe(true);
  expect(results[1]).toMatch(/publishes a different key/);
  expect(results[2]).toMatch(/must be a host name/);
});
