// The weather app: a widget other apps embed.
const labelled = cei.verifyLabel(LABELS[VENDOR]);

link.handle("embed", async ({ deed }) => {
  await labelled;
  const { viewport } = await cei.acceptViewport(deed);
  await ui.surface(viewport, (ctx, width, height) => {
    ctx.fillStyle = "#e6f2ff";
    ctx.fillRect(0, 0, width, height);
    ui.text(ctx, "Weather", 12, 12, { size: 18 });
    ui.text(ctx, "21°C, clear", 12, 48, { size: 28 });
  });
});
