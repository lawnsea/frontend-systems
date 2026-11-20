// The example server. It serves the kernel at http://localhost:<port>/ and plays
// each vendor at http://<vendor>.localhost:<port>/, where it publishes the
// vendor's key and a boot block it signs at startup. `node server.ts` serves the
// demo at http://localhost:5177/?boot=news.localhost:5177.
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// The DPI libraries every boot block starts with, in order.
const LIBRARIES = ["apps/lib/cei.js", "apps/lib/link.js", "apps/lib/ui.js"];

// Each vendor's app source, by vendor.
export const VENDORS: Record<string, string> = {
  news: "apps/news.js",
  weather: "apps/weather.js",
  recipes: "apps/recipes.js",
  probe: "apps/probe.js",
  probe2: "apps/probe.js",
};

const KERNEL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src http: https:",
  "frame-src 'self'",
  "img-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
].join("; ");

// Blocks every network request, so the kernel port is the app's only way out.
const containerCsp = (nonce: string) =>
  [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'`,
    "worker-src blob:",
  ].join("; ");

export interface Example {
  origin: string;
  // The host name a vendor's key is published at, like news.localhost:5177.
  label(vendor: string): string;
  // Each request to a vendor, as "<vendor> <path> cookie=<Cookie header>", and
  // each WebSocket handshake, as "upgrade <host> <path>".
  requests: string[];
  close(): Promise<void>;
}

export interface Options {
  // More vendors, or replacement sources, by vendor. Sources are paths relative
  // to this file.
  vendors?: Record<string, string>;
}

export async function startExample(port = 0, opts: Options = {}): Promise<Example> {
  const vendors = { ...VENDORS, ...opts.vendors };
  const requests: string[] = [];
  const published = new Map<string, { key: Buffer; boot: Buffer; signature: Buffer }>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (host === "localhost") return serveKernel(url, res);
    const vendor = host.endsWith(".localhost") ? host.slice(0, -".localhost".length) : "";
    if (published.has(vendor)) return serveVendor(vendor, url, req, res);
    res.writeHead(404).end();
  });
  // Logs WebSocket handshakes, so tests can show none got through, and refuses them.
  server.on("upgrade", (req, socket) => {
    requests.push(`upgrade ${req.headers.host} ${req.url}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(port, "localhost", resolve));
  const actualPort = (server.address() as AddressInfo).port;
  const label = (vendor: string) => `${vendor}.localhost:${actualPort}`;

  const labels = Object.fromEntries(Object.keys(vendors).map((vendor) => [vendor, label(vendor)]));
  for (const [vendor, source] of Object.entries(vendors)) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const boot = Buffer.from(
      [`self.VENDOR = ${JSON.stringify(vendor)};`, `self.LABELS = ${JSON.stringify(labels)};`, ...[...LIBRARIES, source].map(read)].join("\n"),
    );
    published.set(vendor, {
      key: publicKey.export({ type: "spki", format: "der" }),
      boot,
      signature: sign(null, boot, privateKey),
    });
  }

  function serveVendor(vendor: string, url: URL, req: IncomingMessage, res: ServerResponse) {
    requests.push(`${vendor} ${url.pathname} cookie=${req.headers.cookie ?? ""}`);
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (req.method === "OPTIONS") {
      return res.writeHead(204, { ...cors, "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" }).end();
    }
    const { key, boot, signature } = published.get(vendor)!;
    const files: Record<string, [string, Buffer]> = {
      "/.well-known/embassies/key": ["application/octet-stream", key],
      "/.well-known/embassies/boot.js": ["text/javascript", boot],
      "/.well-known/embassies/boot.sig": ["application/octet-stream", signature],
    };
    const file = files[url.pathname];
    if (file) return res.writeHead(200, { ...cors, "Content-Type": file[0], "Cache-Control": "no-store" }).end(file[1]);
    if (url.pathname === "/echo") {
      return res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify(req.headers));
    }
    res.writeHead(404, cors).end();
  }

  function serveKernel(url: URL, res: ServerResponse) {
    const common = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (url.pathname === "/") {
      return res
        .writeHead(200, {
          ...common,
          "Content-Type": "text/html",
          "Content-Security-Policy": KERNEL_CSP,
          "Cross-Origin-Opener-Policy": "same-origin",
        })
        .end(read("kernel/kernel.html"));
    }
    if (url.pathname === "/kernel.js") return res.writeHead(200, { ...common, "Content-Type": "text/javascript" }).end(read("kernel/kernel.js"));
    if (url.pathname === "/kernel.css") return res.writeHead(200, { ...common, "Content-Type": "text/css" }).end(read("kernel/kernel.css"));
    if (url.pathname === "/container") {
      const nonce = randomBytes(16).toString("base64");
      return res
        .writeHead(200, {
          ...common,
          "Content-Type": "text/html",
          "Content-Security-Policy": containerCsp(nonce),
          "Document-Isolation-Policy": "isolate-and-credentialless",
        })
        .end(read("kernel/container.html").replace("{{nonce}}", nonce));
    }
    res.writeHead(404, common).end();
  }

  return {
    origin: `http://localhost:${actualPort}`,
    label,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

if (import.meta.main) {
  const example = await startExample(5177);
  console.log(`Serving the demo at ${example.origin}/?boot=${example.label("news")}`);
}
