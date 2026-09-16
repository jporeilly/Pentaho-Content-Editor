import { describe, it, expect } from "vitest";

import config from "../vite.config";

// The build configuration, tested, because one line of it decides whether
// the production bundle runs at all - and nothing else in this project
// would notice if it stopped.
//
// The editor ran from the Vite dev server for its whole life. `npm run
// build` was treated as the check that the cross-repo wiring still holds,
// and it does type-check and bundle - but nobody ever RAN the artifact.
// The first thing that did was the Windows installer, and it opened to a
// blank window: "Cannot read properties of null (reading 'useState')".
//
// Two Reacts. The preview imports the Content Manager's source through
// `@app`, those files `import React from "react"`, and a bare specifier
// resolves relative to the importing file - so it found the app's
// node_modules (19.2.5) while the editor used its own (19.3.0). Two
// copies means two hook dispatchers, the second one null. The dev server
// resolves both to this project's copy, which is exactly why the bug
// could sit there unseen.

describe("vite config", () => {
  const resolve = (config as any).resolve;

  it("keeps ONE React for both this project and the imported renderer", () => {
    expect(resolve.dedupe).toContain("react");
    expect(resolve.dedupe).toContain("react-dom");
  });

  it("pins the React alias inside THIS repo, not the app's node_modules", () => {
    // The alias covers the sub-paths (react/jsx-runtime) that dedupe
    // alone does not, and it must point here: aliasing to the Content
    // Manager's copy would fix nothing and reverse the symptom.
    for (const pkg of ["react", "react-dom"]) {
      const target = String(resolve.alias[pkg]).replace(/\\/g, "/");
      expect(target).toMatch(/node_modules\/react(-dom)?$/);
      expect(target).not.toMatch(/Pentaho-Content-Manager/i);
    }
  });

  it("still aliases the renderer and the Tauri shims", () => {
    // The dedupe fix sits in the same block as these; a careless edit
    // that drops one is the kind of thing this file is for.
    expect(resolve.alias["@app"]).toBeTruthy();
    expect(resolve.alias["@tauri-apps/api/core"]).toMatch(/shims/);
  });
});
