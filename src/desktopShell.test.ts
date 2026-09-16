import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The desktop shell opens its window hidden, and that is a promise to
// show it later. This file is the proof that the promise is kept by
// something that cannot fail quietly.
//
// A splash the author never sees is the goal - the backend answers in
// about 1.4 seconds and the learner app beside it has no startup screen
// at all. But "hidden until ready" fails in a uniquely bad way: not a
// visible error, not a blank window, but an app that appears not to
// start. The taskbar is empty, nothing is wrong on screen, and there is
// nothing to read. That failure has to be impossible rather than
// unlikely, so the reveal does not depend on the backend, on the webview
// or on any JavaScript running at all.

const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const conf = JSON.parse(read("../desktop/src-tauri/tauri.conf.json"));
const main = read("../desktop/src-tauri/src/main.rs");
const splash = read("../desktop/dist/index.html");

describe("the shell's hidden window", () => {
  it("starts hidden, which is what makes the rest of this file necessary", () => {
    expect(conf.app.windows[0].visible).toBe(false);
  });

  it("is revealed by a watchdog that asks nothing and waits for nobody", () => {
    // Started from setup(), before the backend is known to exist, so a
    // backend that never starts - or a splash whose own invoke is
    // broken - still ends with a window on screen.
    expect(main).toContain("fn reveal_watchdog");
    expect(main).toMatch(/\.setup\(move \|app\| \{[\s\S]{0,200}reveal_watchdog\(/);
  });

  it("is revealed at once when the splash gives up", () => {
    // The failure screen carries the diagnostics, the log and the
    // restart button. Hiding that would be worse than the old always-on
    // splash, not better.
    const fail = splash.slice(splash.indexOf("function fail("));
    expect(fail.slice(0, 400)).toContain('invoke("reveal")');
  });

  it("is revealed on the way to the app, not after it", () => {
    // reveal_soon is called BEFORE location.replace: the delay lives in
    // Rust because this page is about to stop existing, and a timer in a
    // document that has been navigated away from never fires.
    const ready = splash.indexOf('invoke("reveal_soon")');
    const navigate = splash.indexOf("window.location.replace(url)");
    expect(ready).toBeGreaterThan(-1);
    expect(navigate).toBeGreaterThan(ready);
  });
});
