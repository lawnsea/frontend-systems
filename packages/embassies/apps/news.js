// The news app: a page that embeds the weather app in a sublet viewport and links
// to the recipes app.
const SELF = LABELS[VENDOR];
const labelled = cei.verifyLabel(SELF);

link.handle("navigate", async ({ deed }) => {
  await labelled;
  const { viewport } = await cei.acceptViewport(deed);
  let weather = null;
  const page = await ui.surface(viewport, async (ctx, width, height, region) => {
    ctx.fillStyle = "#fffbe6";
    ctx.fillRect(0, 0, width, height);
    ui.text(ctx, "The Daily Embassy", 24, 24, { size: 32 });
    ui.text(ctx, "Pico-datacenter opens on your desktop", 24, 80, { size: 18 });
    const recipes = ui.text(ctx, "Read today's recipes →", 24, 120, { size: 18, color: "#0645ad" });
    region({ ...recipes, onClick: () => navigate(viewport, page) });
    const rect = { x: Math.max(0, width - 284), y: 24, width: 260, height: 160 };
    if (!weather) {
      weather = (async () => {
        const { sublet, deed } = await cei.subletViewport(viewport, rect);
        await link.send(LABELS.weather, { kind: "embed", deed });
        return sublet;
      })();
    } else {
      await cei.modifyViewport(await weather, rect);
    }
  });
});

async function navigate(viewport, page) {
  page.stop();
  const deed = await cei.transferViewport(viewport);
  await link.send(LABELS.recipes, { kind: "navigate", deed, entry: "/", back: { label: SELF, entry: "/" } });
}
