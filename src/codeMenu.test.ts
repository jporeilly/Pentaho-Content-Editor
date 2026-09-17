import { describe, it, expect } from "vitest";
import { createLowlight } from "lowlight";

import { BLOCKS } from "./Toolbar";
import { CODE_LANGUAGES, HIGHLIGHT_ALIASES, HIGHLIGHT_LANGUAGES, codeFence } from "@app/components/codeLanguages";

// The editor's Code menu writes fences that the LEARNER APP's Engine
// has to be able to highlight. That registry lives in the app's repo,
// which this test reaches through the same @app alias the preview uses -
// so if the editor ever drifts from the Engine it is caught here, on
// the side that did the drifting.
//
// The other half of the contract, that every language in the registry
// has a grammar behind it, is tested in the app's own repo. Neither
// file can cover both halves: one test cannot import across two repos.
const lowlight = createLowlight(HIGHLIGHT_LANGUAGES);
lowlight.registerAlias(HIGHLIGHT_ALIASES);
describe("toolbar Code menu", () => {
  const code = BLOCKS.filter((b) => b.group === "Code");

  it("offers exactly the registry's languages, in registry order", () => {
    expect(code.map((b) => b.label)).toEqual(CODE_LANGUAGES.map((l) => l.label));
  });

  it("writes a fence the highlighter knows, with the sample body when nothing is selected", () => {
    code.forEach((b, i) => {
      const lang = CODE_LANGUAGES[i];
      const text = b.build("").text;
      expect(text, b.label).toBe(codeFence(lang, ""));
      const tag = text.match(/^```(\S+)\n/)?.[1];
      expect(tag, b.label).toBe(lang.tag);
      expect(lowlight.registered(tag!), b.label).toBe(true);
      expect(text, b.label).toContain(lang.sample);
    });
  });

  it("wraps a selection instead of the sample", () => {
    const sql = code.find((b) => b.label === "SQL")!;
    expect(sql.build("SELECT * FROM orders;").text).toBe("```sql\nSELECT * FROM orders;\n```\n\n");
  });

  it("no longer keeps a lone Code entry in the Block menu", () => {
    expect(BLOCKS.find((b) => b.group === "Block" && b.label === "Code")).toBeUndefined();
  });
});
