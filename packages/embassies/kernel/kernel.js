// The client kernel. It implements the Embassies CEI for apps that run in
// sandboxed, isolated container frames, and holds the only references to their
// ports, viewports and the kernel's keys. See docs/design.md.

const PREFIX = "fd65:6d62::";
const KERNEL_ADDRESS = `${PREFIX}1`;
const BROADCAST = "ff02::1";
const MAX_PACKET = 16 * 1024 * 1024;
const MAX_FETCHES = 32;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?$/;

const encoder = new TextEncoder();
const screen = document.getElementById("screen");
const containers = document.getElementById("containers");

// Apps by principal and by address. A principal is the hex SHA-256 of its
// vendor's Ed25519 public key, in SPKI form.
const apps = new Map();
const byAddress = new Map();
let nextHost = 2;
// Viewports by ID, and the viewport ID each live deed grants.
const viewports = new Map();
const deeds = new Map();
let nextViewport = 1;
let focused = null;

const keys = await kernelKeys();
const signingPublicKey = keys.signing.publicKey;

// Wraps a call's result to transfer, not copy, the listed objects.
class Transferring {
  constructor(value, list) {
    this.value = value;
    this.list = list;
  }
}

// The CEI calls the kernel implements. The rest are web platform features each
// container already has; see docs/design.md.
const CALLS = {
  exit: (app) => exit(app),
  ifconfig: (app) => ({
    address: app.address,
    principal: app.principal,
    prefix: `${PREFIX}/64`,
    broadcast: BROADCAST,
    kernel: KERNEL_ADDRESS,
  }),
  send: (app, { dst, payload }) => {
    string(dst, "dst");
    buffer(payload, "payload");
    if (payload.byteLength > MAX_PACKET) throw new RangeError(`payload is over ${MAX_PACKET} bytes; split it`);
    deliver(app.address, dst, payload);
  },
  appSecret: async (app) => crypto.subtle.sign("HMAC", keys.secret, encoder.encode(`embassies app secret\n${app.principal}`)),
  endorseMe: async (app, { key }) =>
    crypto.subtle.sign("Ed25519", keys.signing.privateKey, endorsed(app.principal, buffer(key, "key"))),
  verifyEndorsement: async (app, { key, principal, endorsement }) =>
    crypto.subtle.verify(
      "Ed25519",
      signingPublicKey,
      buffer(endorsement, "endorsement"),
      endorsed(string(principal, "principal"), buffer(key, "key")),
    ),
  ensureAlive: (app, { boot, signature, publicKey }) => ensureAlive(boot, signature, publicKey),
  verifyLabel: (app, { label }) => verifyLabel(app, label),
  acceptViewport: (app, { deed }) => acceptViewport(app, deed),
  mapCanvas: (app, { viewport }) => mapCanvas(owned(app, viewport)),
  updateCanvas: (app, { viewport, bitmap }) => {
    if (!(bitmap instanceof ImageBitmap)) throw new TypeError("bitmap must be an ImageBitmap");
    try {
      const v = owned(app, viewport);
      if (!v.ctx) throw new Error(`viewport ${viewport} has no canvas; call mapCanvas first`);
      v.ctx.transferFromImageBitmap(bitmap);
    } finally {
      bitmap.close();
    }
  },
  transferViewport: (app, { viewport }) => {
    const v = owned(app, viewport);
    setOwner(v, null);
    return newDeed(v);
  },
  subletViewport: (app, { viewport, rect }) => {
    const parent = owned(app, viewport);
    const v = createViewport(parent.area, app.principal);
    parent.children.add(v.id);
    v.parent = parent.id;
    place(v, rect);
    return { sublet: v.id, deed: newDeed(v) };
  },
  modifyViewport: (app, { sublet, rect }) => place(landlordOf(app, sublet), rect),
  repossessViewport: (app, { sublet }) => {
    const v = landlordOf(app, sublet);
    revoke(v);
    v.generation++;
    v.tenantKey = null;
    return newDeed(v);
  },
  tenantChanged: (app, { sublet }) => {
    const v = landlordOf(app, sublet);
    return { generation: v.generation, key: v.tenantKey?.slice(0) ?? null };
  },
  fetch: (app, request) => kernelFetch(app, request),
};

// --- Apps ---

async function ensureAlive(boot, signature, publicKey) {
  buffer(boot, "boot");
  buffer(signature, "signature");
  buffer(publicKey, "publicKey");
  const key = await crypto.subtle.importKey("spki", publicKey, "Ed25519", false, ["verify"]);
  if (!(await crypto.subtle.verify("Ed25519", key, signature, boot))) {
    throw new Error("The boot block's signature doesn't match its public key");
  }
  const principal = hex(await crypto.subtle.digest("SHA-256", publicKey));
  if (!apps.has(principal)) start(principal, boot);
  return principal;
}

// Starts a container frame and hands it the boot block and the app's kernel port.
function start(principal, boot) {
  const frame = document.createElement("iframe");
  frame.sandbox = "allow-scripts";
  frame.src = "/container";
  const channel = new MessageChannel();
  const app = { principal, address: PREFIX + (nextHost++).toString(16), frame, port: channel.port1, label: null, fetches: 0 };
  apps.set(principal, app);
  byAddress.set(app.address, app);
  channel.port1.onmessage = (e) => handle(app, e.data);
  const onReady = (e) => {
    if (e.source !== frame.contentWindow || e.data !== "ready") return;
    removeEventListener("message", onReady);
    frame.contentWindow.postMessage({ boot }, "*", [channel.port2]);
  };
  addEventListener("message", onReady);
  containers.append(frame);
}

function exit(app) {
  for (const v of viewports.values()) if (v.owner === app.principal) setOwner(v, null);
  for (const v of [...viewports.values()]) if (v.landlord === app.principal) destroy(v);
  apps.delete(app.principal);
  byAddress.delete(app.address);
  app.port.close();
  app.frame.remove();
}

async function handle(app, message) {
  if (!apps.has(app.principal) || typeof message !== "object" || message === null) return;
  const { id, call, args } = message;
  try {
    if (typeof call !== "string" || !Object.hasOwn(CALLS, call)) throw new TypeError(`Unknown call ${String(call)}`);
    const result = await CALLS[call](app, typeof args === "object" && args !== null ? args : {});
    if (!apps.has(app.principal)) return;
    if (result instanceof Transferring) app.port.postMessage({ id, ok: true, result: result.value }, result.list);
    else app.port.postMessage({ id, ok: true, result });
  } catch (error) {
    if (apps.has(app.principal)) app.port.postMessage({ id, ok: false, error: String(error?.message ?? error) });
  }
}

const notify = (principal, event) => apps.get(principal)?.port.postMessage(event);

// --- Identity ---

const endorsed = (principal, key) => {
  const prefix = encoder.encode(`embassies endorsement\n${principal}\n`);
  const message = new Uint8Array(prefix.length + key.byteLength);
  message.set(prefix);
  message.set(new Uint8Array(key), prefix.length);
  return message;
};

// Checks that the label's well-known key is the app's, using the Web PKI in place
// of the paper's DNSSEC chain.
async function verifyLabel(app, value) {
  const response = await fetch(wellKnown(label(value), "key"), { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`Couldn't fetch ${response.url}: ${response.status}`);
  if (hex(await crypto.subtle.digest("SHA-256", await response.arrayBuffer())) !== app.principal) {
    throw new Error(`${value} publishes a different key; serve this app's key at ${response.url}`);
  }
  app.label = value;
  for (const v of viewports.values()) if (v.owner === app.principal) showLabel(v);
  return true;
}

function label(value) {
  if (typeof value !== "string" || !LABEL.test(value)) throw new TypeError("label must be a host name, like news.example");
  return value;
}

// Uses http for *.localhost so the example runs without certificates.
const wellKnown = (value, file) =>
  `${/\.localhost(:\d+)?$/.test(value) ? "http" : "https"}://${value}/.well-known/embassies/${file}`;

async function kernelKeys() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("embassies-kernel", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = (mode, op) =>
    new Promise((resolve, reject) => {
      const request = op(db.transaction("keys", mode).objectStore("keys"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  let stored = await run("readonly", (store) => store.get("keys"));
  if (!stored) {
    stored = {
      secret: await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
      signing: await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]),
    };
    await run("readwrite", (store) => store.put(stored, "keys"));
  }
  return stored;
}

// --- Network ---

// Routes a packet, with the source address the kernel assigned the sender.
function deliver(src, dst, payload) {
  if (dst === BROADCAST) {
    for (const app of apps.values()) {
      if (app.address !== src) app.port.postMessage({ event: "packet", src, dst, payload: payload.slice(0) });
    }
    return;
  }
  byAddress.get(dst)?.port.postMessage({ event: "packet", src, dst, payload }, [payload]);
}

// Fetches without credentials, referrer or cache, so no app's request carries
// ambient authority or observes another app's.
async function kernelFetch(app, { url, method = "GET", headers = [], body = null }) {
  const target = new URL(string(url, "url"));
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new TypeError("fetch supports only http and https URLs");
  if (target.origin === location.origin) throw new Error("Apps can't fetch the kernel's origin");
  string(method, "method");
  if (!Array.isArray(headers) || !headers.every((h) => Array.isArray(h) && h.length === 2 && h.every((s) => typeof s === "string"))) {
    throw new TypeError("headers must be an array of [name, value] strings");
  }
  if (body !== null && typeof body !== "string" && !(body instanceof ArrayBuffer)) {
    throw new TypeError("body must be null, a string or an ArrayBuffer");
  }
  if (app.fetches >= MAX_FETCHES) throw new Error(`${MAX_FETCHES} fetches are in flight; wait for one to finish`);
  app.fetches++;
  try {
    const response = await fetch(target, {
      method,
      headers,
      body,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "cors",
      cache: "no-store",
    });
    const responseBody = await response.arrayBuffer();
    return new Transferring(
      { url: response.url, status: response.status, statusText: response.statusText, headers: [...response.headers], body: responseBody },
      [responseBody],
    );
  } finally {
    app.fetches--;
  }
}

// --- Viewports ---

const areas = new WeakMap();
const resizes = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const v = areas.get(entry.target);
    if (v?.owner) notify(v.owner, { event: "viewport", viewport: v.id, ...size(v) });
  }
});

function createViewport(container, landlord) {
  const element = document.createElement("div");
  element.className = "viewport";
  const bar = document.createElement("div");
  bar.className = "label";
  const area = document.createElement("div");
  area.className = "area";
  element.append(bar, area);
  container.append(element);
  const v = { id: nextViewport++, owner: null, landlord, parent: null, element, bar, area, ctx: null, children: new Set(), generation: 0, tenantKey: null };
  viewports.set(v.id, v);
  areas.set(area, v);
  resizes.observe(area);
  showLabel(v);
  return v;
}

function acceptViewport(app, deed) {
  const id = deeds.get(string(deed, "deed"));
  if (id === undefined) throw new Error("The deed isn't live; it may have been redeemed or revoked");
  if (!app.label) throw new Error("Call verifyLabel before accepting a viewport");
  deeds.delete(deed);
  const v = viewports.get(id);
  setOwner(v, app.principal);
  let key = null;
  if (v.landlord) {
    v.generation++;
    v.tenantKey = crypto.getRandomValues(new Uint8Array(32)).buffer;
    key = v.tenantKey.slice(0);
    notify(v.landlord, { event: "tenant", sublet: v.id, generation: v.generation });
  }
  return { viewport: v.id, ...size(v), key };
}

// Replaces the viewport's canvas element, so the only canvas on screen is one
// the kernel draws for the current owner.
function mapCanvas(v) {
  v.canvas?.remove();
  const { width, height } = size(v);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  v.canvas = canvas;
  v.ctx = canvas.getContext("bitmaprenderer");
  v.area.prepend(canvas);
  return { width, height };
}

// Hands the viewport to a new owner, or none, and destroys its sublets.
function setOwner(v, principal) {
  v.canvas?.remove();
  v.canvas = null;
  v.ctx = null;
  for (const child of v.children) destroy(viewports.get(child));
  v.children.clear();
  for (const [deed, id] of deeds) if (id === v.id) deeds.delete(deed);
  v.owner = principal;
  showLabel(v);
}

function revoke(v) {
  const owner = v.owner;
  setOwner(v, null);
  if (owner) notify(owner, { event: "revoked", viewport: v.id });
}

function destroy(v) {
  revoke(v);
  if (focused === v) focused = null;
  viewports.get(v.parent)?.children.delete(v.id);
  viewports.delete(v.id);
  resizes.unobserve(v.area);
  v.element.remove();
}

function newDeed(v) {
  for (const [deed, id] of deeds) if (id === v.id) deeds.delete(deed);
  const deed = base64url(crypto.getRandomValues(new Uint8Array(16)));
  deeds.set(deed, v.id);
  return deed;
}

// Positions a sublet within its landlord's canvas, in canvas pixels.
function place(v, rect) {
  const { x, y, width, height } = typeof rect === "object" && rect !== null ? rect : {};
  if (![x, y, width, height].every((n) => Number.isFinite(n) && n >= 0)) {
    throw new TypeError("rect must have non-negative x, y, width and height");
  }
  const scale = devicePixelRatio;
  Object.assign(v.element.style, {
    left: `${x / scale}px`,
    top: `${y / scale}px`,
    width: `${width / scale}px`,
    height: `${height / scale}px`,
  });
}

function size(v) {
  const { width, height } = v.area.getBoundingClientRect();
  return { width: Math.max(1, Math.round(width * devicePixelRatio)), height: Math.max(1, Math.round(height * devicePixelRatio)) };
}

function showLabel(v) {
  const app = v.owner && apps.get(v.owner);
  v.bar.textContent = app ? app.label : "No app";
  v.element.classList.toggle("empty", !app);
}

function owned(app, id) {
  const v = viewports.get(id);
  if (!v || v.owner !== app.principal) throw new Error(`This app doesn't hold viewport ${String(id)}`);
  return v;
}

function landlordOf(app, id) {
  const v = viewports.get(id);
  if (!v || v.landlord !== app.principal) throw new Error(`This app didn't sublet viewport ${String(id)}`);
  return v;
}

// --- Input ---

// Delivers pointer events to the app under the pointer, and key events to the
// app that holds the focused viewport.
const viewportAt = (target) => (target instanceof Element ? areas.get(target.closest(".area")) : undefined);

for (const type of ["pointerdown", "pointerup", "pointermove", "wheel"]) {
  addEventListener(type, (e) => {
    const v = viewportAt(e.target);
    if (!v) return;
    if (type === "pointerdown") focus(v);
    if (!v.owner || !v.ctx) return;
    const r = v.area.getBoundingClientRect();
    notify(v.owner, {
      event: "ui",
      viewport: v.id,
      type,
      x: Math.round((e.clientX - r.left) * devicePixelRatio),
      y: Math.round((e.clientY - r.top) * devicePixelRatio),
      button: e.button,
      buttons: e.buttons,
      deltaX: e.deltaX ?? 0,
      deltaY: e.deltaY ?? 0,
    });
  });
}

for (const type of ["keydown", "keyup"]) {
  addEventListener(type, (e) => {
    if (!focused?.owner) return;
    notify(focused.owner, { event: "ui", viewport: focused.id, type, key: e.key, code: e.code, repeat: e.repeat });
  });
}

function focus(v) {
  focused?.element.classList.remove("focused");
  focused = v;
  v.element.classList.add("focused");
}

// --- Validation ---

function string(value, name) {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  return value;
}

function buffer(value, name) {
  if (!(value instanceof ArrayBuffer)) throw new TypeError(`${name} must be an ArrayBuffer`);
  return value;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- Startup ---

const root = createViewport(screen, null);

// Boots the app the URL names, if any, and sends it a deed for the whole screen.
const bootLabel = new URLSearchParams(location.search).get("boot");
if (bootLabel !== null) {
  const [publicKey, boot, signature] = await Promise.all(
    ["key", "boot.js", "boot.sig"].map(async (file) => {
      const response = await fetch(wellKnown(label(bootLabel), file), { credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error(`Couldn't fetch ${response.url}: ${response.status}`);
      return response.arrayBuffer();
    }),
  );
  const app = apps.get(await ensureAlive(boot, signature, publicKey));
  const payload = encoder.encode(JSON.stringify({ type: "root-viewport", deed: newDeed(root) })).buffer;
  deliver(KERNEL_ADDRESS, app.address, payload);
}
