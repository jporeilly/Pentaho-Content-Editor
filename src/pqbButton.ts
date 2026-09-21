// What the Questions button says, and whether it can be pressed.
//
// Split out of App because the wording is the hard part and the wording
// is what a test can hold. Three things have to be true of it:
//
//  1. **It must not promise a round trip.** The bank adopts a course's
//     questions and exports `exam.json` as a DOWNLOAD the author places
//     themselves; it cannot publish back into the course yet, because
//     its exporter regenerates the file from a fixed parameter list and
//     would drop `intake` — a key THIS editor owns. "Open the question
//     bank for this course" is honest. "Edit this course's questions"
//     is not, until publishing merges instead of regenerating.
//  2. **Absent is not broken.** The bank is a separate product on its
//     own release cycle; most machines will not have it. A disabled
//     button that says what the thing is beats a missing one.
//  3. **It must say WHICH copy it will open.** Once an install and a
//     checkout can both exist, "why did my edit not show up?" is
//     answered by the tooltip rather than by an investigation.

import type { PqbStatus } from "./api";

export interface PqbButtonState {
  label: string;
  title: string;
  disabled: boolean;
}

/** The wording for the button, given what the backend found. */
export function pqbButtonState(
  status: PqbStatus | null,
  course: string,
  busy: boolean,
): PqbButtonState {
  const label = "❓ Questions";

  if (!status) {
    return { label, title: "Looking for the Question Bank…", disabled: true };
  }
  if (!course) {
    return { label, title: "Pick a course first", disabled: true };
  }
  if (!status.available) {
    // The backend's own sentence, which knows whether the answer is
    // "not installed" or "registered but the launcher is missing".
    return { label, title: status.detail, disabled: true };
  }

  const where = status.kind === "installed" ? "the installed copy" : `the checkout at ${status.path}`;
  return {
    label,
    title:
      `Open the Question Bank on "${course}" — ${where}.\n\n` +
      "It edits the exam POOL (the questions). This editor owns the exam " +
      "settings beside them: pass mark, questions per attempt, the intake " +
      "form.\n\n" +
      "Questions do not flow back on their own yet — the bank exports an " +
      "exam.json you place yourself.",
    disabled: busy,
  };
}
