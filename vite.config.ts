import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The Pentaho Content Editor. A plain browser app - no Tauri runtime -
// that reads and writes the courses in the Pentaho Content Manager
// repository next door.
//
// Why it points at a sibling directory: the editor's preview must render
// a lab EXACTLY as the learner app does, so it imports that app's
// renderer (27 modules) rather than keeping a copy. A copy is what the
// two of them had before, and the preview drifted: it showed a heading
// learners never see, at 1.23:1 contrast, and counted steps on labs that
// do not track them. One renderer, imported, is the whole point.
//
// Override the location with PCM_REPO when the app lives elsewhere.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const appRepo = resolve(process.env.PCM_REPO ?? here("../Pentaho-Content-Manager"));
const appSrc = resolve(appRepo, "src");
if (!existsSync(resolve(appSrc, "components", "MarkdownBody.tsx"))) {
  throw new Error(
    `Cannot find the Pentaho Content Manager renderer at ${appSrc}.\n` +
    `The editor imports it so the preview matches the learner app exactly.\n` +
    `Set PCM_REPO to the app's repository root and start again.`,
  );
}

// The editor's OWN version. It used to read the app's, which is how a
// release cut for editor-only work still got built and installed as an
// app release no VM would ever receive.
const pkgVersion = JSON.parse(readFileSync(here("./package.json"), "utf8")).version as string;

export default defineConfig({
  plugins: [react()],
  base: "./",

  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },

  build: {
    target: "esnext",
    outDir: "dist",
  },

  resolve: {
    alias: {
      // The learner app's source, imported for preview fidelity.
      "@app": appSrc,
      // Renderer components import these at module load; outside Tauri
      // they must resolve to browser-safe no-ops. See src/shims/*.
      "@tauri-apps/plugin-opener": here("./src/shims/tauri-opener.ts"),
      "@tauri-apps/api/core": here("./src/shims/tauri-core.ts"),
      "@tauri-apps/api/window": here("./src/shims/tauri-window.ts"),
    },
  },

  server: {
    port: 5273,
    strictPort: true,
    open: "/",
    fs: {
      // Vite refuses to serve files outside the project root unless they
      // are allow-listed, and the renderer lives outside it by design.
      allow: [here("."), appRepo],
    },
  },

  clearScreen: false,
});
