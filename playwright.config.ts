import { createRequire } from "node:module";

import { defineConfig, devices } from "@playwright/test";
import type { loadEnvConfig as loadEnvConfigType } from "@next/env";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as {
  loadEnvConfig: typeof loadEnvConfigType;
};

loadEnvConfig(process.cwd());

const port = 3101;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `./node_modules/.bin/next dev --turbo --port ${port}`,
    env: {
      ...process.env,
      BETTER_AUTH_URL: baseURL,
      E2E_TEST_MODE: "true",
      E2E_TEST_OTP: "246810",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
