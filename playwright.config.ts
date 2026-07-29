import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Browser specs only; tests/contract runs on Bun and workerd instead.
  testMatch: "*.spec.ts",
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4399",
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
    command: "pnpm preview --host 127.0.0.1 --port 4399",
    url: "http://127.0.0.1:4399/dashboard/",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
