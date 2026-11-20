// The recipes app: a page other apps link to. Its back link returns the viewport
// to the app that linked here.
const labelled = cei.verifyLabel(LABELS[VENDOR]);

link.handle("navigate", async ({ deed, back }) => {
  await labelled;
  const { viewport } = await cei.acceptViewport(deed);
  const page = await ui.surface(viewport, (ctx, width, height, region) => {
    ctx.fillStyle = "#eefbea";
    ctx.fillRect(0, 0, width, height);
    if (back) {
      const backLink = ui.text(ctx, "← Back", 24, 24, { size: 18, color: "#0645ad" });
      region({ ...backLink, onClick: () => goBack(viewport, page, back) });
    }
    ui.text(ctx, "Recipes", 24, 64, { size: 32 });
    ui.text(ctx, "Lentil soup, in 30 minutes", 24, 120, { size: 18 });
  });
});

async function goBack(viewport, page, back) {
  page.stop();
  const deed = await cei.transferViewport(viewport);
  await link.send(back.label, { kind: "navigate", deed, entry: back.entry });
}
