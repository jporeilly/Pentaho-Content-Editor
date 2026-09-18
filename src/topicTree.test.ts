import { describe, it, expect } from "vitest";

import {
  MAX_TOPIC_DEPTH,
  allTopics,
  deepestUnder,
  indentBlocked,
  indentTopic,
  outdentTopic,
  popLab,
  topicAt,
} from "./topicTree";
import type { Structure, StructureTopic } from "./api";

// Indent/outdent rewrite SUMMARY.md through PUT /structure. A wrong
// move does not throw — it quietly reshuffles the author's course — so
// the shape after each operation is pinned here.

const lab = (slug: string) => ({ slug, title: slug, kind: "workshop" as const });

function topic(title: string, labs: string[] = [], children: StructureTopic[] = []): StructureTopic {
  return { title, labs: labs.map(lab), children };
}

/** Data Sources / Enriching, both flat — the course before restructuring. */
function flat(): Structure {
  return {
    topics: [
      topic("Data Sources", ["overview", "text-file-input", "connecting"]),
      topic("Enriching", ["merge-streams"]),
      topic("Capstone", ["pipeline"]),
    ],
  };
}

/** A shape as it reads after one indent: Enriching nested under Data Sources. */
function nested(): Structure {
  return {
    topics: [
      topic("Data Sources", ["overview"], [topic("Flat Files", ["text-file-input"])]),
      topic("Capstone", ["pipeline"]),
    ],
  };
}

describe("paths", () => {
  it("walks parents before children", () => {
    expect(allTopics(nested().topics).map(({ topic: t, path }) => [t.title, path.join(".")]))
      .toEqual([["Data Sources", "0"], ["Flat Files", "0.0"], ["Capstone", "1"]]);
  });

  it("addresses a nested topic by path", () => {
    expect(topicAt(nested(), [0, 0]).title).toBe("Flat Files");
    expect(topicAt(nested(), [1]).title).toBe("Capstone");
  });
});

describe("indent", () => {
  it("nests a topic under the sibling above it, labs and all", () => {
    const out = indentTopic(flat(), [1])!;
    expect(out.topics.map((t) => t.title)).toEqual(["Data Sources", "Capstone"]);
    expect(out.topics[0].children!.map((c) => c.title)).toEqual(["Enriching"]);
    expect(out.topics[0].children![0].labs.map((l) => l.slug)).toEqual(["merge-streams"]);
  });

  it("leaves the parent's own labs alone", () => {
    const out = indentTopic(flat(), [1])!;
    expect(out.topics[0].labs.map((l) => l.slug))
      .toEqual(["overview", "text-file-input", "connecting"]);
  });

  it("refuses the first topic — nothing above it to nest under", () => {
    expect(indentBlocked(flat(), [0])).toMatch(/Nothing above/);
    expect(indentTopic(flat(), [0])).toBeNull();
  });

  it("refuses to go past the course's depth limit", () => {
    const s = nested();
    // Give Data Sources a second child so [0,1] has a sibling above it.
    s.topics[0].children!.push(topic("Databases", ["connecting"]));
    expect(MAX_TOPIC_DEPTH).toBe(1);
    expect(indentBlocked(s, [0, 1])).toMatch(/deepest level/);
    expect(indentTopic(s, [0, 1])).toBeNull();
  });

  it("refuses when the topic's OWN children would go too deep", () => {
    // Indenting a topic drags its subtree down a level with it — the
    // check has to look below the row, not just at the row.
    const s: Structure = {
      topics: [topic("A", ["a"]), topic("B", ["b"], [topic("B1", ["b1"])])],
    };
    expect(deepestUnder(s.topics[1])).toBe(1);
    expect(indentBlocked(s, [1])).toMatch(/would go deeper/);
  });

  it("does not mutate the structure it was given", () => {
    const before = flat();
    indentTopic(before, [1]);
    expect(before.topics.map((t) => t.title))
      .toEqual(["Data Sources", "Enriching", "Capstone"]);
  });
});

describe("outdent", () => {
  it("lands the topic directly after its old parent", () => {
    const out = outdentTopic(nested(), [0, 0])!;
    expect(out.topics.map((t) => t.title)).toEqual(["Data Sources", "Flat Files", "Capstone"]);
    expect(out.topics[0].children).toEqual([]);
    expect(out.topics[1].labs.map((l) => l.slug)).toEqual(["text-file-input"]);
  });

  it("refuses a topic that is already top level", () => {
    expect(outdentTopic(flat(), [0])).toBeNull();
  });

  it("round-trips with indent", () => {
    const start = flat();
    const there = indentTopic(start, [1])!;
    const back = outdentTopic(there, [0, 0])!;
    expect(JSON.stringify(back)).toBe(JSON.stringify(start));
  });
});

describe("popLab", () => {
  it("finds a lab nested under a sub-topic", () => {
    // The old flat walk stopped at `structure.topics`, so dragging a
    // lab that lived under a `###` found nothing and the drop no-oped.
    const s = nested();
    expect(popLab(s, "text-file-input")?.slug).toBe("text-file-input");
    expect(s.topics[0].children![0].labs).toEqual([]);
  });

  it("returns null for a slug that isn't there", () => {
    expect(popLab(nested(), "ghost")).toBeNull();
  });
});
