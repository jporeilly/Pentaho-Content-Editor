import { describe, it, expect } from "vitest";

import { skippedIgnoredNote } from "./publishNote";

describe("the skipped-ignored note", () => {
  it("says nothing when nothing was skipped", () => {
    expect(skippedIgnoredNote([])).toBe("");
    expect(skippedIgnoredNote(undefined)).toBe("");
  });

  it("names the file", () => {
    expect(skippedIgnoredNote(["05-x/files/config/.kettle/kettle.properties"]))
      .toBe("1 gitignored file not published: 05-x/files/config/.kettle/kettle.properties");
  });

  it("caps the list but keeps the count honest", () => {
    const note = skippedIgnoredNote(["a/.env", "b/.env", "c/.env", "d/.env", "e/.env"]);
    expect(note).toBe("5 gitignored files not published: a/.env, b/.env, c/.env and 2 more");
    expect(skippedIgnoredNote(["a/.env", "b/.env"], 1)).toBe(
      "2 gitignored files not published: a/.env and 1 more",
    );
  });
});
