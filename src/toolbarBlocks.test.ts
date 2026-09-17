import { describe, it, expect } from "vitest";

import { BLOCKS } from "./Toolbar";
import { parseCalloutTag } from "@app/components/Callout";
import type { CalloutKind } from "@app/components/Callout";

// Every callout kind the Engine understands should be reachable from
// the toolbar. It wasn't: parseCalloutTag mapped seven kinds while the
// menu offered six, so "Success" rendered perfectly and no author could
// find it. Nobody decided that - the two lists just live in different
// files with nothing tying them together.
//
// Declaring the expectation as a Record<CalloutKind, true> makes this a
// COMPILE error the moment a kind is added to the union, so a new kind
// cannot be shipped without someone looking at this file.
const EXPECTED_KINDS: Record<CalloutKind, true> = {
  info: true,
  tip: true,
  success: true,
  warning: true,
  danger: true,
  objectives: true,
  insight: true,
};

/** The tag line a Callout block emits, as parseCalloutTag sees it. */
function tagLineOf(text: string): string {
  const first = text.split("\n")[0];
  return first.replace(/^>\s*/, "");
}

describe("toolbar callout coverage", () => {
  const callouts = BLOCKS.filter((b) => b.group === "Callout");

  it("offers a block for every callout kind the Engine supports", () => {
    const covered = new Set(
      callouts
        .map((b) => parseCalloutTag(tagLineOf(b.build("body").text))?.kind)
        .filter((k): k is CalloutKind => Boolean(k)),
    );
    const missing = Object.keys(EXPECTED_KINDS).filter((k) => !covered.has(k as CalloutKind));
    expect(missing).toEqual([]);
  });

  it("has a plain quote whose blockquote is deliberately untagged", () => {
    // The casual italic quote depends on parseCalloutTag NOT matching,
    // so this asserts the absence on purpose rather than by accident.
    const quote = callouts.find((b) => b.label === "Quote");
    expect(quote).toBeDefined();
    expect(parseCalloutTag(tagLineOf(quote!.build("Quoted text.").text))).toBeNull();
  });
});

describe("toolbar blocks", () => {
  it("gives every block a group, a label and a title", () => {
    for (const b of BLOCKS) {
      expect(b.label, JSON.stringify(b.label)).toBeTruthy();
      expect(b.title, `title for ${b.label}`).toBeTruthy();
      expect(typeof b.group).toBe("string");
    }
  });

  it("uses no duplicate labels within a group", () => {
    const seen = new Map<string, number>();
    for (const b of BLOCKS) {
      const key = `${b.group}/${b.label}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it("writes a Vimeo link for the Video block, not the old Loom default", () => {
    // Course videos are hosted on Vimeo; the placeholder keeps the
    // Unlisted shape (id + access hash), because the player refuses the
    // bare id for those and shows a "private video" card instead.
    const video = BLOCKS.find((b) => b.group === "Media" && b.label === "Video");
    expect(video).toBeDefined();
    const text = video!.build("Walkthrough").text;
    expect(text).toContain("vimeo.com/");
    expect(text).not.toContain("loom.com");
  });

  it("emits every env-check profile the Engine branches on", () => {
    const envText = BLOCKS.filter((b) => b.label.startsWith("Env check"))
      .map((b) => b.build("").text)
      .join("");
    for (const mode of ["", "tryit", "server", "ai", "streaming"]) {
      expect(envText).toContain(`data-env-check="${mode}"`);
    }
  });
});

describe("captioned video block", () => {
  const block = BLOCKS.find((b) => b.group === "Media" && b.label === "Video — with caption");

  it("exists and carries the caption class the Engine keys on", () => {
    expect(block).toBeDefined();
    const text = block!.build("Walkthrough").text;
    // MarkdownBody's figcaption override only adds the icon when this
    // exact class is present, so the two must not drift apart.
    expect(text).toContain('class="pcm-video-caption"');
    expect(text).toContain("vimeo.com/");
  });

  it("keeps the blank lines that make the image render inside the figure", () => {
    // Without them CommonMark treats the ![…] line as literal text
    // inside the HTML block - the same trap the image wrappers hit.
    const text = block!.build("Walkthrough").text;
    expect(text).toMatch(/<figure>\n\n!\[/);
    expect(text).toMatch(/\n\n<\/figure>/);
  });
});
