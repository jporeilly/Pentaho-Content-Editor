import { describe, it, expect } from "vitest";

import { pebButtonState } from "./pebButton";
import type { PebStatus } from "./api";

const found = (kind: PebStatus["kind"], path: string | null): PebStatus => ({
  kind,
  path,
  launcher: path ? `${path}\\run.bat` : null,
  detail: path ? `Running from the checkout at ${path}` : "The Exam Bank isn't installed.",
  available: kind === "installed" || kind === "checkout",
});

describe("the Questions button", () => {
  it("waits rather than lying while the lookup is in flight", () => {
    const s = pebButtonState(null, "developer-di-practitioner", false);
    expect(s.disabled).toBe(true);
    expect(s.title).toMatch(/Looking for/i);
  });

  it("is disabled with the backend's own sentence when the bank is absent", () => {
    const s = pebButtonState(found(null, null), "developer-di-practitioner", false);
    expect(s.disabled).toBe(true);
    expect(s.title).toContain("isn't installed");
  });

  it("names which copy it will open", () => {
    // Once an install and a checkout can both exist, "why did my edit
    // not show up?" should be answered by the tooltip.
    const s = pebButtonState(found("checkout", "C:\\Projects\\Pentaho-Exam-Bank"), "pdi-2hr-lab", false);
    expect(s.disabled).toBe(false);
    expect(s.title).toContain("C:\\Projects\\Pentaho-Exam-Bank");
    expect(s.title).toContain("pdi-2hr-lab");
  });

  it("does not promise a round trip that does not exist yet", () => {
    // The bank exports an exam.json the author places themselves: its
    // exporter regenerates the file from a fixed parameter list and
    // would drop `intake`, a key this editor owns. Wording that implies
    // edits flow back is the thing to guard against.
    const s = pebButtonState(found("checkout", "C:\\Projects\\Pentaho-Exam-Bank"), "pdi-2hr-lab", false);
    expect(s.title).toMatch(/do not flow back|does not flow back/i);
    expect(s.title).not.toMatch(/\bsyncs?\b|automatically/i);
  });

  it("says what each side owns, because that is the whole contract", () => {
    const s = pebButtonState(found("installed", "C:\\Program Files\\Pentaho Exam Bank"), "pdi-2hr-lab", false);
    expect(s.title).toMatch(/bank owns the questions/i);
    expect(s.title).toMatch(/pass mark|intake/);
  });

  it("warns that an unadopted course opens empty-ish, and why", () => {
    // Since the bank's 7c3147d the button really does open on the
    // course's pool - but only two of eleven real courses have been
    // adopted, so the common case is a course it holds no questions
    // for. That opens with a note on how to adopt it, and an author who
    // was not told will read it as the button having failed.
    const s = pebButtonState(found("checkout", "C:\\Projects\\Pentaho-Exam-Bank"), "developer-ml-specialty", false);
    expect(s.title).toMatch(/question pool/i);
    expect(s.title).toMatch(/not adopted yet/i);
  });

  it("needs a course, and defers while the app is busy", () => {
    expect(pebButtonState(found("checkout", "C:\\x"), "", false).disabled).toBe(true);
    expect(pebButtonState(found("checkout", "C:\\x"), "", false).title).toMatch(/Pick a course/);
    expect(pebButtonState(found("checkout", "C:\\x"), "pdi-2hr-lab", true).disabled).toBe(true);
  });

  it("keeps one label in every state, so the button never jumps", () => {
    const labels = new Set([
      pebButtonState(null, "c", false).label,
      pebButtonState(found(null, null), "c", false).label,
      pebButtonState(found("checkout", "C:\\x"), "c", false).label,
      pebButtonState(found("broken", "C:\\y"), "c", false).label,
    ]);
    expect(labels.size).toBe(1);
  });
});
