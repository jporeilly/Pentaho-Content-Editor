import { describe, it, expect } from "vitest";

import { applyColour, colourAt } from "./textColour";
import { TEXT_COLOURS, textColourClass } from "@app/components/textColours";

// Colouring a run of text, and getting the colour back off again.
//
// The second half is the part worth testing. A picker that can only ADD
// is a trap - the author paints a phrase red, changes their mind, and
// the only way back is deleting markup by hand. Picking a second colour
// must REPLACE the first rather than nest it, and "None" must actually
// remove it, from a selection made either way round: the words inside
// the span, or the whole span.

const sel = (body: string, word: string) => [body.indexOf(word), body.indexOf(word) + word.length] as const;

describe("applyColour", () => {
  it("wraps the selection", () => {
    const body = "Do not delete the folder.";
    const [s, e] = sel(body, "delete");
    expect(applyColour(body, s, e, "danger").text).toBe(
      'Do not <span class="pcm-c-danger">delete</span> the folder.',
    );
  });

  it("selects the words afterwards, not the markup", () => {
    const body = "Do not delete the folder.";
    const [s, e] = sel(body, "delete");
    const out = applyColour(body, s, e, "danger");
    expect(out.text.slice(out.start, out.end)).toBe("delete");
  });

  it("replaces a colour rather than nesting one inside another", () => {
    const body = 'Do not <span class="pcm-c-danger">delete</span> it.';
    const [s, e] = sel(body, "delete");
    const out = applyColour(body, s, e, "warn");
    expect(out.text).toBe('Do not <span class="pcm-c-warn">delete</span> it.');
    expect(out.text).not.toContain("pcm-c-danger");
  });

  it("removes the colour and leaves the words", () => {
    const body = 'Do not <span class="pcm-c-danger">delete</span> it.';
    const [s, e] = sel(body, "delete");
    expect(applyColour(body, s, e, null).text).toBe("Do not delete it.");
  });

  it("works when the whole span is selected, not just the words", () => {
    const body = 'Do not <span class="pcm-c-danger">delete</span> it.';
    const span = '<span class="pcm-c-danger">delete</span>';
    const s = body.indexOf(span);
    expect(applyColour(body, s, s + span.length, null).text).toBe("Do not delete it.");
    expect(applyColour(body, s, s + span.length, "ok").text).toBe(
      'Do not <span class="pcm-c-ok">delete</span> it.',
    );
  });

  it("round-trips: colour then remove returns the original", () => {
    const body = "Check the value before you run it.";
    const [s, e] = sel(body, "value");
    const on = applyColour(body, s, e, "accent");
    const off = applyColour(on.text, on.start, on.end, null);
    expect(off.text).toBe(body);
  });

  it("leaves a plain span that is not ours alone", () => {
    const body = 'A <span class="pcm-mark">highlight</span> here.';
    const [s, e] = sel(body, "highlight");
    expect(applyColour(body, s, e, "ok").text).toBe(
      'A <span class="pcm-mark"><span class="pcm-c-ok">highlight</span></span> here.',
    );
  });
});

describe("colourAt", () => {
  it("reports the colour on the selection, or none", () => {
    const body = 'Do not <span class="pcm-c-danger">delete</span> it.';
    const [s, e] = sel(body, "delete");
    expect(colourAt(body, s, e)).toBe("danger");
    const [p, q] = sel(body, "it");
    expect(colourAt(body, p, q)).toBe(null);
  });
});

describe("the palette matches the Engine's classes", () => {
  it("writes a class for every colour offered, and only those", () => {
    // One registry, so the palette cannot offer a colour the stylesheet
    // has never heard of - the failure would be invisible in the editor
    // preview's own theme and land on a learner.
    for (const c of TEXT_COLOURS) {
      const out = applyColour("word", 0, 4, c.name);
      expect(out.text, c.name).toContain(`class="${textColourClass(c.name)}"`);
    }
    expect(TEXT_COLOURS.length).toBeGreaterThan(0);
  });
});
