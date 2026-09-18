import { defineConfig, devices } from "@playwright/test";

// Browser net everything after stands on (audit §13 item 3): guest
// send/stop/retry, keyboard-only send, small-viewport composer, the 404
// fallback, and a strict no-console-error / no-pageerror gate. Run
// against the preview server (`npm run test:e2e`, which builds with the
// e2e origin first). Backend staging is NOT required: guest paths are
// memory-only and must work backend-down.
// NOTE: the preview port must match the PUBLIC_BETTER_AUTH_URL the app
// was built with (same-origin session fetch) — see `test:e2e` below.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://localhost:4323",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm.cmd run preview -- --port 4323 --host localhost",
    url: "http://localhost:4323/new",
    reuseExistingServer: false,
    timeout: 120_000,
    // B31(env): the preview serves :4323 while BetterAuth's baseURL is
    // :4321, so every browser sign-up/sign-in POST 403s INVALID_ORIGIN
    // unless :4323 is a trusted origin. Scoped to the server under
    // test — dev (:4321) needs nothing, deployments set their own.
    env: {
      BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:4323",
    },
  },
});
