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

// The renderer's version, baked in beside the editor's own.
//
// It costs nothing from a checkout, where the preview always imports
// whatever the sibling repo has this minute. It matters once the editor
// is INSTALLED: the renderer is bundled at build time, so a packaged
// editor previews with the renderer it shipped with while pointing at a
// checkout that has moved on. That drift is invisible unless the app
// says which one it is carrying - and "the preview doesn't match the
// app" is precisely the bug this whole alias exists to prevent.
const appVersion = (() => {
  try {
    return JSON.parse(readFileSync(resolve(appRepo, "package.json"), "utf8")).version as string;
  } catch {
    return "unknown";
  }
})();

export default defineConfig({
  plugins: [react()],
  base: "./",

  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __PCM_VERSION__: JSON.stringify(appVersion),
  },

  build: {
    target: "esnext",
    outDir: "dist",
  },

  resolve: {
    // ONE React, whoever imports it.
    //
    // The preview imports the Content Manager's source through `@app`,
    // and those files `import React from "react"` - which resolves
    // relative to THEIR location, so it finds the app's node_modules and
    // the bundle ends up with two Reacts. Two Reacts means two hook
    // dispatchers, and the second one is null: the production bundle
    // died on the first `useState` with "Cannot read properties of null".
    //
    // It was invisible for as long as the editor only ever ran from the
    // dev server, which resolves the bare specifier to this project's
    // copy. The packaged build is the first thing to actually RUN the
    // bundle, and it crashed to a blank window on launch.
    //
    // dedupe fixes resolution; the aliases make it explicit for the
    // sub-paths (react/jsx-runtime) that dedupe alone does not cover.
    dedupe: ["react", "react-dom"],
    alias: {
      react: here("./node_modules/react"),
      "react-dom": here("./node_modules/react-dom"),
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
