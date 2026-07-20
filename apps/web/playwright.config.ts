import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Optionally let Playwright boot the web app itself. In CI we build first and
// run `next start`; locally we reuse a dev server if one is already up. Set
// PLAYWRIGHT_NO_WEBSERVER=1 to point the suite at an already-running deployment.
const webServer = process.env.PLAYWRIGHT_NO_WEBSERVER
  ? undefined
  : {
      command:
        process.env.PLAYWRIGHT_WEB_COMMAND ??
        "pnpm --filter @trading-platform/web start",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    };

export default defineConfig({
  testDir: "./e2e",
  outputDir: ".cache/playwright/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
