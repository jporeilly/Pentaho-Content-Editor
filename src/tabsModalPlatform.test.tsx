// @vitest-environment jsdom
//
// The Tabs dialog starts from the Windows / macOS-Linux pair almost every
// old widget used. In a Windows 11 course (course.json platform
// "windows11", COURSE-STANDARD 3.5: DI, BA and pdi-2hr-lab first) that pair
// is exactly what the course must not have, so it starts from numbered
// steps instead.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { TabsModal } from "./TabsModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function titles(windowsOnly?: boolean): string[] {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    createRoot(host).render(<TabsModal onInsert={() => {}} onClose={() => {}} windowsOnly={windowsOnly} />);
  });
  return [...document.querySelectorAll<HTMLInputElement>("input.author-input")].map((i) => i.value);
}

describe("Tabs dialog defaults", () => {
  it("offers no macOS / Linux tab in a Windows 11 course", () => {
    const t = titles(true);
    expect(t.length).toBeGreaterThan(0);
    expect(t.join(" ")).not.toMatch(/mac|linux/i);
    document.body.innerHTML = "";
  });

  it("keeps the Windows / macOS-Linux pair elsewhere", () => {
    expect(titles()).toEqual(["Windows", "macOS / Linux"]);
    document.body.innerHTML = "";
  });
});
