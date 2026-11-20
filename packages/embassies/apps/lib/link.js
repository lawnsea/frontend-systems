// Linking (§4.1 of the Embassies paper), embedding (§4.3) and back navigation
// (§4.5) as a protocol between apps over CEI packets. The kernel knows nothing of
// it. A caller resolves a label to a vendor key and boot block, starts the target
// with ensureAlive, finds it by broadcast, checks its kernel endorsement, and
// sends it a message encrypted to its endorsed key.
self.link = (() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const ECDH = { name: "ECDH", namedCurve: "P-256" };
  const subtle = crypto.subtle ?? cei.subtle;
  const handlers = new Map();
  const waiting = new Map();

  const wellKnown = (label, file) =>
    `${/\.localhost(:\d+)?$/.test(label) ? "http" : "https"}://${label}/.well-known/embassies/${file}`;
  const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer;
  const packet = (message) => encoder.encode(JSON.stringify(message)).buffer;

  const setup = (async () => {
    await cei.ready;
    const me = await cei.ifconfig();
    const keys = await subtle.generateKey(ECDH, false, ["deriveKey"]);
    const publicKey = await subtle.exportKey("raw", keys.publicKey);
    const endorsement = await cei.endorseMe(publicKey.slice(0));
    return { me, keys, publicKey, endorsement };
  })();
  // Listens now, before the app's code, so no packet goes only to the app.
  cei.on("packet", (p) => receive(p).catch(() => {}));

  async function receive({ src, payload }) {
    const { me, keys, publicKey, endorsement } = await setup;
    let message;
    try {
      message = JSON.parse(decoder.decode(payload));
    } catch {
      return;
    }
    if (message.type === "who" && message.principal === me.principal) {
      await cei.send(src, packet({ type: "here", principal: me.principal, key: toBase64(publicKey), endorsement: toBase64(endorsement) }));
    } else if (message.type === "here") {
      waiting.get(message.principal)?.({ ...message, address: src });
    } else if (message.type === "root-viewport" && src === me.kernel) {
      handlers.get("navigate")?.({ deed: message.deed, entry: "/" });
    } else if (message.type === "deliver") {
      const peer = await subtle.importKey("raw", fromBase64(message.ephemeral), ECDH, false, []);
      const key = await subtle.deriveKey({ name: "ECDH", public: peer }, keys.privateKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      const plain = await subtle.decrypt({ name: "AES-GCM", iv: fromBase64(message.iv) }, key, fromBase64(message.data));
      const body = JSON.parse(decoder.decode(plain));
      handlers.get(body.kind)?.(body);
    }
  }

  // Starts the app the label names, if it isn't running, and returns its
  // address and endorsed key once it answers.
  async function open(label) {
    await setup;
    const [publicKey, boot, signature] = await Promise.all(
      ["key", "boot.js", "boot.sig"].map(async (file) => {
        const response = await cei.fetch(wellKnown(label, file));
        if (response.status !== 200) throw new Error(`Couldn't fetch ${response.url}: ${response.status}`);
        return response.body;
      }),
    );
    const principal = await cei.ensureAlive(boot, signature, publicKey);
    const { broadcast } = (await setup).me;
    for (let attempt = 0; attempt < 50; attempt++) {
      const here = new Promise((resolve) => {
        waiting.set(principal, resolve);
        setTimeout(() => resolve(null), 100);
      });
      await cei.send(broadcast, packet({ type: "who", principal }));
      const answer = await here;
      if (!answer) continue;
      waiting.delete(principal);
      const key = fromBase64(answer.key);
      if (!(await cei.verifyEndorsement(key.slice(0), principal, fromBase64(answer.endorsement)))) {
        throw new Error(`${label} answered with a key the kernel didn't endorse for it`);
      }
      return { principal, address: answer.address, key };
    }
    waiting.delete(principal);
    throw new Error(`${label} didn't answer; check that its app loads the link library`);
  }

  // Sends a message to the app the label names. Kinds are "navigate", with the
  // caller's root deed, and "embed", with a sublet deed.
  async function send(label, body) {
    const peer = await open(label);
    const ephemeral = await subtle.generateKey(ECDH, true, ["deriveKey"]);
    const theirs = await subtle.importKey("raw", peer.key, ECDH, false, []);
    const key = await subtle.deriveKey({ name: "ECDH", public: theirs }, ephemeral.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(body)));
    await cei.send(
      peer.address,
      packet({ type: "deliver", ephemeral: toBase64(await subtle.exportKey("raw", ephemeral.publicKey)), iv: toBase64(iv), data: toBase64(data) }),
    );
  }

  return {
    // Handles "navigate" or "embed" messages: { kind, deed, entry, back }.
    handle: (kind, fn) => handlers.set(kind, fn),
    open,
    send,
  };
})();
