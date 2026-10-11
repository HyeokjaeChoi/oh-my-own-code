import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "/tmp/oh-my-own-code-workbench-e2e-results",
  use: {
    baseURL: "http://127.0.0.1:5420",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command:
      "VITE_BRIDGE_ORIGIN=http://127.0.0.1:5318 pnpm exec vite --config apps/workbench-web/vite.config.ts --host 127.0.0.1 --port 5420 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:5420",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
