import { describe, expect, it } from "vitest";

import { parsePageLink } from "@app/components/pageLinks";
import { coursePages, pageLinkFor } from "./pageLinks";
import type { StructureTopic } from "./api";

const lab = (slug: string, title: string) => ({ slug, title, kind: "workshop" as const });

const TOPICS: StructureTopic[] = [
  {
    title: "Get Ready",
    page: lab("00-overview", "Overview"),
    labs: [lab("01-start", "Before You Start")],
    children: [
      { title: "Deeper", labs: [lab("02-deep", "Deep Dive")], children: [] },
    ],
  },
  { title: "Make It Real", labs: [lab("10-prod", "From Lab to Production")] },
];

describe("coursePages", () => {
  it("lists every page in sidebar order, sub-topics included", () => {
    expect(coursePages(TOPICS)).toEqual([
      { slug: "00-overview", title: "Overview", depth: 0 },
      { slug: "01-start", title: "Before You Start", depth: 0 },
      { slug: "02-deep", title: "Deep Dive", depth: 1 },
      { slug: "10-prod", title: "From Lab to Production", depth: 0 },
    ]);
  });
});

describe("pageLinkFor", () => {
  const page = { slug: "02-deep", title: "Deep Dive", depth: 1 };

  it("words the link with the page title when nothing is selected", () => {
    expect(pageLinkFor(page, "")).toBe("[Deep Dive](../02-deep/guide.md)");
  });

  it("words it with the selection when that reads as link text", () => {
    expect(pageLinkFor(page, " the deep dive ")).toBe("[the deep dive](../02-deep/guide.md)");
  });

  it("does not wrap a selection that is already a link, or a block", () => {
    expect(pageLinkFor(page, "[x](y)")).toBe("[Deep Dive](../02-deep/guide.md)");
    expect(pageLinkFor(page, "two\nlines")).toBe("[Deep Dive](../02-deep/guide.md)");
  });

  it("writes a link the Engine follows to that page", () => {
    // The point of the whole feature: what the toolbar writes is read
    // back by the learner app's own parser as the page it names.
    const href = pageLinkFor(page, "").match(/\]\(([^)]+)\)/)![1];
    expect(parsePageLink(href)).toEqual({ slug: "02-deep", anchor: null });
  });
});
