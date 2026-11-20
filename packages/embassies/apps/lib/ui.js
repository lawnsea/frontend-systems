// A tiny UI toolkit over the CEI's viewport calls. A surface draws a frame into
// an OffscreenCanvas, blits it with updateCanvas, redraws when the kernel resizes
// the viewport, and calls a region's onClick when the user clicks in it.
self.ui = (() => {
  async function surface(viewport, draw) {
    let canvas;
    let regions = [];
    let live = true;

    async function map() {
      const { width, height } = await cei.mapCanvas(viewport);
      canvas = new OffscreenCanvas(width, height);
    }

    async function render() {
      if (!live) return;
      const ctx = canvas.getContext("2d");
      regions = [];
      await draw(ctx, canvas.width, canvas.height, (region) => regions.push(region));
      if (live) await cei.updateCanvas(viewport, canvas.transferToImageBitmap());
    }

    const onUi = (e) => {
      if (e.viewport !== viewport || e.type !== "pointerdown") return;
      const hit = regions.find((r) => e.x >= r.x && e.x < r.x + r.width && e.y >= r.y && e.y < r.y + r.height);
      hit?.onClick();
    };
    const onResize = async (e) => {
      if (e.viewport !== viewport) return;
      await map();
      await render();
    };
    const onRevoked = (e) => e.viewport === viewport && stop();
    cei.on("ui", onUi);
    cei.on("viewport", onResize);
    cei.on("revoked", onRevoked);

    function stop() {
      live = false;
      cei.off("ui", onUi);
      cei.off("viewport", onResize);
      cei.off("revoked", onRevoked);
    }

    await map();
    await render();
    return { viewport, render, stop };
  }

  // Draws text in a box, and returns the box.
  function text(ctx, value, x, y, { size = 16, color = "#000", font = "system-ui, sans-serif" } = {}) {
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    ctx.fillText(value, x, y);
    return { x, y, width: Math.ceil(ctx.measureText(value).width), height: Math.ceil(size * 1.2) };
  }

  return { surface, text };
})();
