import { defineConfig, devices } from "@playwright/test";

// Deterministic per worktree so parallel checkouts do not collide and
// reuseExistingServer can find its own server. Kept under 32768 — the kernel's
// ephemeral floor — so it is never a port an unrelated outbound socket holds.
const port = process.env.PLAYWRIGHT_PORT ?? String(20_000 + [...process.cwd()].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 12_000);

export default defineConfig({
  testDir: "./tests",
  // Browser specs only; tests/contract runs on Bun and workerd instead.
  testMatch: "*.spec.ts",
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm preview --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/dashboard/`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
