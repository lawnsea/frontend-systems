import { defineConfig, devices } from "@playwright/test";

// PREVIEW=1 tests the production build instead of the dev server.
const preview = Boolean(process.env.PREVIEW);
const PORT = preview ? 5178 : 5177;

export default defineConfig({
  testDir: "tests",
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "firefox", use: devices["Desktop Firefox"] },
    { name: "webkit", use: devices["Desktop Safari"] },
  ],
  webServer: {
    command: preview
      ? `pnpm exec vite build && pnpm exec vite preview --port ${PORT} --strictPort`
      : `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
