// @vitest-environment jsdom
//
// Course settings picks a course's TRACK by name (PDI, BA, Architect) from
// the Content Manager's one list, instead of a free colour picker whose
// default (#16a34a) was no track at all. The colour is the course's
// category mark for learners; the Content Manager's own tests fail any
// course whose colour is not a track's.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COURSE_TRACKS } from "@app/content/courseTracks";

const putCourse = vi.fn().mockResolvedValue({});
let stored: Record<string, unknown> = {};

vi.mock("./api", () => ({
  api: {
    getCourse: vi.fn(() => Promise.resolve(stored)),
    getExam: vi.fn(() => Promise.resolve({ exists: false, questionCount: 0 })),
    putCourse: (...args: unknown[]) => putCourse(...args),
    putExam: vi.fn().mockResolvedValue({}),
    exportUrl: vi.fn(() => "about:blank"),
  },
}));

import { CourseSettingsModal } from "./CourseSettingsModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function open(course: Record<string, unknown>) {
  stored = course;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <CourseSettingsModal course="c" onClose={() => {}} onSaved={() => {}} onDeleted={() => {}} />,
    );
  });
}

const tracks = () => [...document.querySelectorAll<HTMLButtonElement>(".author-track")];
const pressed = () => tracks().find((b) => b.getAttribute("aria-pressed") === "true")?.textContent;

beforeEach(() => putCourse.mockClear());
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the track picker", () => {
  it("offers every track by name, and no free colour picker", async () => {
    await open({ title: "A course", theme: { accent: "#b91c1c" } });
    expect(tracks().map((b) => b.textContent)).toEqual(COURSE_TRACKS.map((t) => t.label));
    expect(document.querySelector('input[type="color"]')).toBeNull();
    expect(pressed()).toBe("PDI - Data Integration");
  });

  it("says so when a course's colour is no track, and selects nothing", async () => {
    await open({ title: "A course", theme: { accent: "#1d4ed8" } });
    expect(pressed()).toBeUndefined();
    expect(document.body.textContent).toMatch(/#1d4ed8\) is not a track/);
  });

  it("saves the chosen track's colour as theme.accent", async () => {
    await open({ title: "A course", theme: { accent: "#1d4ed8" } });
    const ba = tracks().find((b) => b.textContent === "BA - Business Analytics")!;
    act(() => ba.click());
    expect(pressed()).toBe("BA - Business Analytics");

    const save = [...document.querySelectorAll("button")].find((b) => /^Save/.test(b.textContent ?? ""))!;
    await act(async () => save.click());
    expect(putCourse).toHaveBeenCalled();
    expect(putCourse.mock.calls[0][1].theme).toEqual({ accent: "#2e7d32" });
  });
});

describe("what the course awards, in its settings", () => {
  // Levels 1-2 award a course accreditation; certification is level 3 only.
  const legends = () => [...document.querySelectorAll("legend")].map((l) => l.textContent);

  it("calls it a course accreditation at level 1", async () => {
    await open({ title: "A course", level: { number: 1, name: "Practitioner" } });
    expect(legends()).toContain("Course accreditation");
    expect(document.body.textContent).not.toMatch(/certificate/i);
  });

  it("calls it a certification at level 3", async () => {
    await open({ title: "A course", level: { number: 3, name: "Certified" } });
    expect(legends()).toContain("Certification");
  });
});
