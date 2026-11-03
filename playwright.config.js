import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "*.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: "list",
  use: {
    baseURL: process.env.RECIPEBOX_TEST_URL || "http://localhost:31991",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1366, height: 900 } },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.RECIPEBOX_TEST_URL
    ? undefined
    : {
        command: "node tests/browser/server.js",
        url: "http://localhost:31991/health",
        reuseExistingServer: false,
        timeout: 30000,
      },
});
