// Tree surgery for the course structure panel — indent, outdent, and
// the path addressing the panel uses to reach a nested topic.
//
// Split out of StructurePanel so it can be tested without a DOM: these
// functions decide what SUMMARY.md ends up containing, and getting one
// wrong silently reshuffles an author's course rather than throwing.
//
// A topic's address is a PATH (`[0]`, `[0, 2]`) rather than an index.
// The panel used to address a lab as `[topicIndex, labIndex]`, which
// assumes exactly two levels; with sub-topics an index alone no longer
// says where a row is.

import type { Structure, StructureLab, StructureTopic } from "./api";

/** Deepest sub-topic level an author can indent to. 0 = flat, 1 = one
 *  level of `###`. The Engine's parser and the learner sidebar both
 *  handle `####`, so raising this is a one-line change. */
export const MAX_TOPIC_DEPTH = 1;

/** A topic's `children`, created on demand so callers can push into it. */
export function kids(t: StructureTopic): StructureTopic[] {
  return (t.children ??= []);
}

/** Depth-first list of every topic with its path, parents first. */
export function allTopics(
  topics: StructureTopic[],
  base: number[] = [],
): Array<{ topic: StructureTopic; path: number[] }> {
  return topics.flatMap((topic, i) => {
    const path = [...base, i];
    return [{ topic, path }, ...allTopics(topic.children ?? [], path)];
  });
}

/** The sibling array a path lives in, plus its index within it. */
export function siblingsOf(
  root: Structure,
  path: number[],
): { list: StructureTopic[]; index: number } {
  let list = root.topics;
  for (const step of path.slice(0, -1)) list = kids(list[step]);
  return { list, index: path[path.length - 1] };
}

export function topicAt(root: Structure, path: number[]): StructureTopic {
  const { list, index } = siblingsOf(root, path);
  return list[index];
}

/** How many levels of sub-topics hang below this one (0 = none). */
export function deepestUnder(t: StructureTopic): number {
  const cs = t.children ?? [];
  return cs.length === 0 ? 0 : 1 + Math.max(...cs.map(deepestUnder));
}

/** Why this topic cannot be indented, or null when it can be. */
export function indentBlocked(root: Structure, path: number[]): string | null {
  const { list, index } = siblingsOf(root, path);
  if (index === 0) return "Nothing above this to nest it under";
  if (path.length - 1 >= MAX_TOPIC_DEPTH) return "Already at the deepest level";
  if (path.length - 1 + deepestUnder(list[index]) >= MAX_TOPIC_DEPTH) {
    return "Its own sub-topics would go deeper than the course allows";
  }
  return null;
}

/** Make a topic the last child of the sibling above it (`##` → `###`).
 *  Returns a new Structure, or null when the move isn't allowed. */
export function indentTopic(root: Structure, path: number[]): Structure | null {
  if (indentBlocked(root, path)) return null;
  const next: Structure = structuredClone(root);
  const { list, index } = siblingsOf(next, path);
  const [moved] = list.splice(index, 1);
  kids(list[index - 1]).push(moved);
  return next;
}

/** Move a topic back up a level, landing just after its old parent. */
export function outdentTopic(root: Structure, path: number[]): Structure | null {
  if (path.length < 2) return null;
  const next: Structure = structuredClone(root);
  const { list, index } = siblingsOf(next, path);
  const [moved] = list.splice(index, 1);
  const { list: grand, index: parentIndex } = siblingsOf(next, path.slice(0, -1));
  grand.splice(parentIndex + 1, 0, moved);
  return next;
}

/**
 * Promote a lab to be its topic's own page, or demote the current page
 * back into the topic's lab list.
 *
 * A topic page is the `<!-- topic-page: … -->` comment the Engine reads:
 * the sidebar header becomes clickable and opens that guide, while the
 * chevron still expands the group. Promoting removes the lab's own row,
 * which is the point — the "Review Flat Files" entry stops being a
 * duplicate of the "Flat Files" header above it.
 */
export function setTopicPage(
  root: Structure,
  path: number[],
  slug: string | null,
): Structure {
  const next: Structure = structuredClone(root);
  const topic = topicAt(next, path);
  // Whatever was the page goes back to the top of the lab list, so
  // demoting never silently drops a guide out of the course.
  if (topic.page) topic.labs.unshift(topic.page);
  if (slug === null) {
    topic.page = null;
    return next;
  }
  const lab = popLab(next, slug);
  if (!lab) return root;
  topicAt(next, path).page = lab;
  return next;
}

/** Remove a lab from wherever it sits in the tree and return it. */
export function popLab(root: Structure, slug: string): StructureLab | null {
  for (const { topic } of allTopics(root.topics)) {
    const i = topic.labs.findIndex((l) => l.slug === slug);
    if (i >= 0) return topic.labs.splice(i, 1)[0];
  }
  return null;
}
