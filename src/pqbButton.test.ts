import { describe, it, expect } from "vitest";

import { pqbButtonState } from "./pqbButton";
import type { PqbStatus } from "./api";

const found = (kind: PqbStatus["kind"], path: string | null): PqbStatus => ({
  kind,
  path,
  launcher: path ? `${path}\\run.bat` : null,
  detail: path ? `Running from the checkout at ${path}` : "The Question Bank isn't installed.",
  available: kind === "installed" || kind === "checkout",
});

describe("the Questions button", () => {
  it("waits rather than lying while the lookup is in flight", () => {
    const s = pqbButtonState(null, "developer-di-practitioner", false);
    expect(s.disabled).toBe(true);
    expect(s.title).toMatch(/Looking for/i);
  });

  it("is disabled with the backend's own sentence when the bank is absent", () => {
    const s = pqbButtonState(found(null, null), "developer-di-practitioner", false);
    expect(s.disabled).toBe(true);
    expect(s.title).toContain("isn't installed");
  });

  it("names which copy it will open", () => {
    // Once an install and a checkout can both exist, "why did my edit
    // not show up?" should be answered by the tooltip.
    const s = pqbButtonState(found("checkout", "C:\\Projects\\Pentaho-Question-Bank"), "pdi-2hr-lab", false);
    expect(s.disabled).toBe(false);
    expect(s.title).toContain("C:\\Projects\\Pentaho-Question-Bank");
    expect(s.title).toContain("pdi-2hr-lab");
  });

  it("does not promise a round trip that does not exist yet", () => {
    // The bank exports an exam.json the author places themselves: its
    // exporter regenerates the file from a fixed parameter list and
    // would drop `intake`, a key this editor owns. Wording that implies
    // edits flow back is the thing to guard against.
    const s = pqbButtonState(found("checkout", "C:\\Projects\\Pentaho-Question-Bank"), "pdi-2hr-lab", false);
    expect(s.title).toMatch(/do not flow back|does not flow back/i);
    expect(s.title).not.toMatch(/\bsyncs?\b|automatically/i);
  });

  it("says what each side owns, because that is the whole contract", () => {
    const s = pqbButtonState(found("installed", "C:\\Program Files\\Pentaho Question Bank"), "pdi-2hr-lab", false);
    expect(s.title).toMatch(/exam POOL/);
    expect(s.title).toMatch(/pass mark|intake/);
  });

  it("needs a course, and defers while the app is busy", () => {
    expect(pqbButtonState(found("checkout", "C:\\x"), "", false).disabled).toBe(true);
    expect(pqbButtonState(found("checkout", "C:\\x"), "", false).title).toMatch(/Pick a course/);
    expect(pqbButtonState(found("checkout", "C:\\x"), "pdi-2hr-lab", true).disabled).toBe(true);
  });

  it("keeps one label in every state, so the button never jumps", () => {
    const labels = new Set([
      pqbButtonState(null, "c", false).label,
      pqbButtonState(found(null, null), "c", false).label,
      pqbButtonState(found("checkout", "C:\\x"), "c", false).label,
      pqbButtonState(found("broken", "C:\\y"), "c", false).label,
    ]);
    expect(labels.size).toBe(1);
  });
});
