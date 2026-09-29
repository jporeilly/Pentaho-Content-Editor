// The pages a guide can link to, and the link the toolbar writes.
//
// The link itself is the Engine's: `pageLinkMarkdown` comes from the
// Content Manager through @app, the same module that FOLLOWS these
// links in the learner app. What the editor writes and what the Engine
// reads are one rule in one file, not a mirror kept in step by hand.

import { pageLinkMarkdown } from "@app/components/pageLinks";
import type { StructureTopic } from "./api";

export interface CoursePage {
  slug: string;
  title: string;
  /** Sub-topic depth of the section it sits in, for indenting the menu. */
  depth: number;
}

/**
 * Every page of the course in sidebar order: a section's own page, then
 * its labs, then its sub-topics - the order the Engine's flattenLabs and
 * Previous/Next use, so the menu reads like the course does.
 *
 * Recursive on purpose. Anything that walks SUMMARY.md and stops at the
 * top level misses every page under a sub-topic.
 */
export function coursePages(topics: StructureTopic[], depth = 0): CoursePage[] {
  const out: CoursePage[] = [];
  for (const t of topics) {
    if (t.page) out.push({ slug: t.page.slug, title: t.page.title, depth });
    for (const l of t.labs) out.push({ slug: l.slug, title: l.title, depth });
    if (t.children?.length) out.push(...coursePages(t.children, depth + 1));
  }
  return out;
}

/**
 * The markdown for a link to `page`, worded by the selection when it
 * reads as link text: one line, with no link syntax of its own.
 * Otherwise the page's title - the words the reader will see in the
 * sidebar when they arrive.
 */
export function pageLinkFor(page: CoursePage, selection: string): string {
  const text = selection.trim() && !/[\n[\]()]/.test(selection) ? selection.trim() : page.title;
  return pageLinkMarkdown(text, page.slug);
}
