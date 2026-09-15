import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// The same aliases the dev server uses. Without them the tests that
// reach into the learner app's renderer - the callout-coverage test,
// which exists precisely so the editor's menu and that renderer cannot
// drift - would fail to resolve once the editor moved out of its repo.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const appSrc = resolve(process.env.PCM_REPO ?? here("../Pentaho-Content-Manager"), "src");

export default defineConfig({
  resolve: {
    alias: {
      "@app": appSrc,
      "@tauri-apps/plugin-opener": here("./src/shims/tauri-opener.ts"),
      "@tauri-apps/api/core": here("./src/shims/tauri-core.ts"),
      "@tauri-apps/api/window": here("./src/shims/tauri-window.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
