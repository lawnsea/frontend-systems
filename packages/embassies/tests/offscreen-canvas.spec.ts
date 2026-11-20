import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Why the kernel blits ImageBitmaps rather than handing apps an OffscreenCanvas
// from transferControlToOffscreen: in Chromium 156, drawing to such a canvas from
// a worker in another process crashes the page's renderer. Expected to fail until
// Chromium fixes it; when this starts passing, see docs/design.md.

const PAGE = `<!doctype html><body style="margin:0"><script>
  const frame = document.createElement("iframe");
  frame.sandbox = "allow-scripts";
  frame.src = "/frame";
  document.body.append(frame);
  const canvas = document.createElement("canvas");
  document.body.prepend(canvas);
  addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow) return;
    const offscreen = canvas.transferControlToOffscreen();
    frame.contentWindow.postMessage(offscreen, "*", [offscreen]);
  });
</script>`;

// Draws red to the canvas it's sent, from a worker in its own process.
const FRAME = `<!doctype html><script>
  const source = "onmessage = (e) => { const c = e.data.getContext('2d'); c.fillStyle = 'red'; c.fillRect(0, 0, 300, 150); postMessage('drew'); }";
  const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
  worker.onmessage = () => parent.postMessage("drew", "*");
  addEventListener("message", (e) => worker.postMessage(e.data, [e.data]));
  parent.postMessage("ready", "*");
</script>`;

let server: Server;
let origin: string;
test.beforeEach(async () => {
  server = createServer((req, res) => {
    const frame = req.url === "/frame";
    res
      .writeHead(200, {
        "Content-Type": "text/html",
        ...(frame ? { "Document-Isolation-Policy": "isolate-and-credentialless" } : {}),
      })
      .end(frame ? FRAME : PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});
test.afterEach(() => server.close());

test("a worker in another process can draw to a transferred OffscreenCanvas", async ({ page }) => {
  test.fail(true, "Chromium 156 crashes the page's renderer");
  let crashed = false;
  page.on("crash", () => (crashed = true));
  await page.goto(`${origin}/`);
  await page.waitForTimeout(1000);
  expect(crashed).toBe(false);
});
