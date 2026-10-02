import { describe, it, expect } from "vitest";

import { BLOCKS } from "./Toolbar";
import { INLINE_ICONS } from "@app/components/sidebarIcons";

// The Pentaho menu's "Icon —" entries write `<span data-icon="…">`, and the
// LEARNER APP's Engine decides what each name draws (sidebarIcons.tsx over
// there, the same components its sidebar uses). Reached through @app, as
// codeMenu.test.ts reaches the code registry: if the editor ever writes a
// name the Engine does not know, the author's icon renders as nothing, and
// this is where that is caught.
describe("toolbar Pentaho menu: sidebar icons", () => {
  const icons = BLOCKS.filter((b) => b.group === "Pentaho" && b.label.startsWith("Icon"));

  it("offers one entry for every icon the Engine knows", () => {
    const names = icons.map((b) => b.build("").text.match(/data-icon="([^"]+)"/)?.[1]);
    expect(names.sort()).toEqual(Object.keys(INLINE_ICONS).sort());
  });

  it("writes the inline span and nothing else, so it can sit mid-sentence", () => {
    icons.forEach((b) => {
      expect(b.build("").text, b.label).toMatch(/^<span data-icon="[a-z]+"><\/span>$/);
    });
  });
});
