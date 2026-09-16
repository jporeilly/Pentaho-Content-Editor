import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// One line of the NSIS template, tested, because it decides whether an
// uninstall takes the author's setup with it.
//
// The template is the Content Manager's, adopted wholesale so the two
// apps install the same way. Almost all of it transfers. The uninstall
// page's "delete application data" checkbox does not: over there it is
// ticked by default and should be, because that folder holds a learner's
// course progress and a reinstall means starting over. Here the same
// folder holds the LLM provider, the model, and the path to the Content
// Manager checkout - and it was ticked by default here too, until an
// uninstall of 1.8.0 on the way to 1.9.1 quietly emptied it.
//
// This is not a line anyone would think to re-read. Re-syncing the
// template from the app - the obvious thing to do when the wizard gains
// a page over there - restores the default without a word. So the
// difference is pinned here rather than trusted to the comment beside
// it.

const NSI = fileURLToPath(
  new URL("../desktop/src-tauri/nsis/installer.nsi", import.meta.url),
);
const template = readFileSync(NSI, "utf8");

describe("the course-detection component", () => {
  const section = template.slice(
    template.indexOf('Section "Find my Content Manager courses"'),
    template.indexOf('Section "Ollama runtime'),
  );

  it("reads the hint back from the view the APP reads", () => {
    // The script's exit code only says the script thought it worked.
    // It said so once while writing into WOW6432Node, where the 64-bit
    // editor could never see it - the install claimed the courses were
    // found and the app asked on first run regardless.
    const view = section.indexOf("SetRegView 64");
    const read = section.indexOf('ReadRegStr $1 HKLM "SOFTWARE\\Pentaho\\ContentEditor" "PcmRepo"');
    expect(view).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(view);
  });

  it("checks the recorded folder actually holds courses", () => {
    expect(section).toContain('${FileExists} "$1\\courses\\*.*"');
  });

  it("pauses to report what it found, but never in a silent install", () => {
    const boxes = section.match(/MessageBox /g) || [];
    expect(boxes.length).toBe(3); // found, nothing found, recorded-but-empty
    // Every one of them behind the same guard: an unattended install
    // that stops on a dialog is an install that never finishes.
    const guards = section.match(/\$\{If\} \$PassiveMode <> 1\s*\r?\n\s*\$\{AndIfNot\} \$\{Silent\}/g) || [];
    expect(guards.length).toBe(boxes.length);
  });
});

describe("the uninstaller's delete-app-data checkbox", () => {
  it("is not ticked for the author by default", () => {
    const line = template
      .split(/\r?\n/)
      .find(
        (l) =>
          l.includes("$DeleteAppDataCheckbox ") && l.includes("BM_SETCHECK"),
      );
    expect(line, "the checkbox's initial state is set somewhere").toBeDefined();
    expect(line).toContain("BST_UNCHECKED");
  });

  it("still governs the deletion, so ticking it deliberately works", () => {
    // Unchecked-by-default is the fix; removing the feature is not. The
    // author who does want a clean slate must still get one.
    const guard = template.indexOf("$DeleteAppDataCheckboxState = 1");
    const wipe = template.indexOf('RmDir /r "$APPDATA');
    expect(guard).toBeGreaterThan(-1);
    expect(wipe).toBeGreaterThan(guard);
  });

  it("leaves the state folder alone on an update", () => {
    // /UPDATE runs the old uninstaller before laying down the new build.
    // If that path could reach the wipe, every upgrade would reset the
    // editor no matter how the checkbox was left.
    const after = template.slice(
      template.indexOf("$DeleteAppDataCheckboxState = 1"),
      template.indexOf('RmDir /r "$APPDATA'),
    );
    expect(after).toContain("$UpdateMode <> 1");
  });
});
