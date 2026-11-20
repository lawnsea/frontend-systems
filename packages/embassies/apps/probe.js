// The probe app, for tests. It records what the kernel sends it and paints
// solid colors, and tests drive the rest through self.cei from its worker.
self.probe = { packets: [], ui: [], events: [], deeds: [] };
const labelled = cei.verifyLabel(LABELS[VENDOR]);
cei.on("ui", (e) => probe.ui.push(e));
for (const type of ["viewport", "revoked", "tenant"]) cei.on(type, (e) => probe.events.push(e));
cei.on("packet", (p) => probe.packets.push({ src: p.src, dst: p.dst, text: new TextDecoder().decode(p.payload) }));
link.handle("navigate", ({ deed }) => probe.deeds.push(deed));
link.handle("embed", ({ deed }) => probe.deeds.push(deed));

// Accepts a deed and paints the viewport one color. Returns the viewport.
probe.accept = async (deed, color) => {
  await labelled;
  const accepted = await cei.acceptViewport(deed);
  await probe.paint(accepted.viewport, color);
  return accepted;
};

probe.paint = async (viewport, color) => {
  const { width, height } = await cei.mapCanvas(viewport);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  await cei.updateCanvas(viewport, canvas.transferToImageBitmap());
};

// Waits for the next deed someone sends this app.
probe.nextDeed = async () => {
  while (!probe.deeds.length) await new Promise((resolve) => setTimeout(resolve, 10));
  return probe.deeds.shift();
};

probe.hex = (buffer) => buffer && [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
