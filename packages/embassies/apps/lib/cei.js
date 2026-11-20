// The CEI client. It turns CEI calls into messages on the kernel port the
// container hands this worker. It's part of each app's DPI, not the kernel, so
// the kernel trusts nothing it sends.
self.cei = (() => {
  let port;
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  // Events that arrive before anything listens for their type.
  const queued = new Map();

  let subtlePort;
  const subtleCalls = new Map();

  const ready = new Promise((resolve) => {
    self.addEventListener("message", (e) => {
      if (port || !e.ports[0]) return;
      [port, subtlePort] = e.ports;
      subtlePort.onmessage = ({ data }) => {
        const call = subtleCalls.get(data.id);
        subtleCalls.delete(data.id);
        if (data.ok) call.resolve(data.result);
        else call.reject(new Error(data.error));
      };
      port.onmessage = ({ data }) => {
        if (data.event) return emit(data);
        const call = pending.get(data.id);
        if (!call) return;
        pending.delete(data.id);
        if (data.ok) call.resolve(data.result);
        else call.reject(new Error(data.error));
      };
      resolve();
    });
  });

  function emit(event) {
    const fns = listeners.get(event.event);
    if (fns?.size) for (const fn of fns) fn(event);
    else queued.set(event.event, [...(queued.get(event.event) ?? []), event]);
  }

  async function call(name, args = {}, transfer = []) {
    await ready;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port.postMessage({ id, call: name, args }, transfer);
    });
  }

  // SubtleCrypto, relayed by the container document; see kernel/container.html.
  // It isn't a CEI call: the kernel never sees it.
  const subtle = new Proxy(
    {},
    {
      get: (_, method) => async (...args) => {
        await ready;
        const id = nextId++;
        return new Promise((resolve, reject) => {
          subtleCalls.set(id, { resolve, reject });
          subtlePort.postMessage({ id, method, args });
        });
      },
    },
  );

  return {
    ready,
    subtle,
    // Listens for "packet", "ui", "viewport", "revoked" or "tenant" events.
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      const events = queued.get(type) ?? [];
      queued.delete(type);
      for (const event of events) fn(event);
    },
    off: (type, fn) => listeners.get(type)?.delete(fn),
    exit: () => call("exit"),
    ifconfig: () => call("ifconfig"),
    send: (dst, payload) => call("send", { dst, payload }, [payload]),
    appSecret: () => call("appSecret"),
    endorseMe: (key) => call("endorseMe", { key }),
    verifyEndorsement: (key, principal, endorsement) => call("verifyEndorsement", { key, principal, endorsement }),
    ensureAlive: (boot, signature, publicKey) => call("ensureAlive", { boot, signature, publicKey }),
    verifyLabel: (label) => call("verifyLabel", { label }),
    acceptViewport: (deed) => call("acceptViewport", { deed }),
    mapCanvas: (viewport) => call("mapCanvas", { viewport }),
    updateCanvas: (viewport, bitmap) => call("updateCanvas", { viewport, bitmap }, [bitmap]),
    transferViewport: (viewport) => call("transferViewport", { viewport }),
    subletViewport: (viewport, rect) => call("subletViewport", { viewport, rect }),
    modifyViewport: (sublet, rect) => call("modifyViewport", { sublet, rect }),
    repossessViewport: (sublet) => call("repossessViewport", { sublet }),
    tenantChanged: (sublet) => call("tenantChanged", { sublet }),
    fetch: (url, { method, headers, body } = {}) => call("fetch", { url, method, headers, body }),
  };
})();
