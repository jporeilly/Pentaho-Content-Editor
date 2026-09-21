// What the Questions button says, and whether it can be pressed.
//
// Split out of App because the wording is the hard part and the wording
// is what a test can hold. Three things have to be true of it:
//
//  1. **It must not promise a round trip.** Since the bank's `7c3147d`
//     it really does open ON the course it is launched with, so the
//     hedge about that is gone. What must still not be promised is the
//     way back: the bank exports `exam.json` as a DOWNLOAD the author
//     places themselves, because its exporter regenerates the file from
//     a fixed parameter list and would drop `intake` — a key THIS
//     editor owns. When publishing merges instead of regenerating, that
//     sentence can go too, and not before.
//
//     "Opens on the pool" is also only the happy path. Two of the
//     eleven real courses have been adopted into the bank so far, so
//     what most authors will meet is a course it knows of but holds no
//     questions for — which opens with a note saying how to adopt it
//     rather than an empty table. The tooltip says so, because an empty
//     bank that was expected reads as a fault when it is not one.
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
      "It opens on this course's question pool. A course the bank has not " +
      "adopted yet opens with a note saying how, rather than an empty " +
      "table.\n\n" +
      "The bank owns the questions; this editor owns the exam settings " +
      "beside them — pass mark, questions per attempt, the intake form.\n\n" +
      "Questions do not flow back on their own yet: the bank exports an " +
      "exam.json you place yourself.",
    disabled: busy,
  };
}
