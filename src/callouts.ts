// Building callout blockquotes.
//
// Callouts are the second most used construct in the courses - 2,274 of
// them - and the toolbar built them by string concatenation, which had
// one real bug: only the FIRST line of a selection was prefixed with
// "> ", so selecting a paragraph and pressing Note produced a one-line
// quote followed by loose prose. CommonMark ends the blockquote at the
// first unprefixed line, so the rest silently fell out of the panel.
//
// It also had a gap: the renderer promotes a leading `#### heading`
// inside a callout to the panel's title strip, and nothing in the
// editor wrote one, so the feature was invisible to authors.
//
// Pure string work, so it is testable without a DOM.

export interface CalloutKind {
  /** The tag written after "> **", e.g. "Note". */
  tag: string;
  /** Menu label and dialog option. */
  label: string;
  /** Menu tooltip. */
  title: string;
  /** Body used when the author inserts with nothing selected. */
  sample: string;
}

/**
 * Every kind the renderer understands, in menu order. `parseCalloutTag`
 * maps these onto its seven kinds; `toolbarBlocks.test.ts` checks that
 * none of them is missing a button.
 */
export const CALLOUT_KINDS: CalloutKind[] = [
  { tag: "Note", label: "Note", title: "Informational note",
    sample: "Something worth highlighting." },
  { tag: "Under the hood", label: "Under the hood",
    title: "Explain what the engine just did — put it AFTER the action",
    sample: "What just happened, and why the tool could do it that way." },
  { tag: "Tip", label: "Tip", title: "Helpful tip",
    sample: "A handy shortcut or idiom." },
  { tag: "Warning", label: "Warning", title: "Warning callout",
    sample: "Something to watch out for." },
  { tag: "Critical", label: "Critical", title: "Critical / danger callout",
    sample: "This can cause data loss or a broken environment." },
  { tag: "Success", label: "Success", title: "Confirm the learner got the right result",
    sample: "What you should be looking at now." },
  { tag: "Objectives", label: "Objectives", title: "Lab objectives callout",
    sample: "By the end of this lab you will…" },
];

/** Prefix every line so the whole passage stays inside the blockquote. */
export function quoteLines(text: string): string {
  return text
    .split("\n")
    .map((l) => (l.trim() === "" ? ">" : `> ${l}`))
    .join("\n");
}

export interface CalloutOptions {
  /** "" for an untagged quote (the casual italic one). */
  tag: string;
  /** Promoted to the panel's title strip by the renderer. */
  title?: string;
  body: string;
}

/** The markdown for a callout, ending with the blank line markdown needs. */
export function buildCallout({ tag, title, body }: CalloutOptions): string {
  const parts: string[] = [];
  if (tag) parts.push(`**${tag}:**`);
  if (title && title.trim()) parts.push(`#### ${title.trim()}`);
  parts.push(body.trim() === "" ? "" : body);
  // A blank quoted line between each part - that separation is what
  // makes the renderer treat the #### as a heading rather than as the
  // first words of the paragraph.
  return quoteLines(parts.join("\n\n")) + "\n\n";
}
