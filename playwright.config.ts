import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? String(20_000 + [...process.cwd()].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 40_000);

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
