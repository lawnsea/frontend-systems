# embassies

The [Embassies](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final85.pdf) client execution interface, built from web platform features. A kernel page runs each app's signed boot block in its own process, with an opaque origin and no network, and gives it the 30 Embassies calls: memory, threads, IP-style packets, identity, and pixel-only viewports. See [docs/design.md](docs/design.md).

Chromium only.

## Run the demo

```sh
pnpm start
```

Then open http://localhost:5177/?boot=news.localhost:5177. News embeds weather, and its link opens recipes, which links back. The kernel draws each app's label above its pixels.

## Layout

- `kernel/`: the kernel page, and the container document each app runs in.
- `apps/lib/`: DPI libraries apps bundle: the CEI client, linking and a tiny UI toolkit.
- `apps/`: the demo apps, and a probe app for tests.
- `server.ts`: serves the kernel, and plays each vendor at `<vendor>.localhost`, signing its boot block at startup.

## Commands

- `pnpm test`: Playwright tests, in headed Chromium.
- `pnpm typecheck`
