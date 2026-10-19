// @vitest-environment jsdom
//
// Steps or choices. The guide (Content Manager 0.7.39) shows a tab block
// whose titles are ALL numbered as a stepper and any other block as tabs,
// so the dialog asks which the author means and numbers the titles for
// steps - and never for choices, where a typed "1." would turn a choice
// into a stepper by accident.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { bareTitle, TabsModal, tabsMarkdown } from "./TabsModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const titlesOf = (md: string) => [...md.matchAll(/^### (.+)$/gm)].map((m) => m[1]);

describe("tabsMarkdown", () => {
  it("numbers steps 1., 2., ... in order", () => {
    expect(titlesOf(tabsMarkdown(["Read", "Write", "Run"], "steps"))).toEqual(["1. Read", "2. Write", "3. Run"]);
  });

  it("numbers a step once, even when the author typed a number", () => {
    expect(titlesOf(tabsMarkdown(["2. Read", "1. Write"], "steps"))).toEqual(["1. Read", "2. Write"]);
  });

  it("never numbers choices, and drops a typed number", () => {
    expect(titlesOf(tabsMarkdown(["Windows", "1. macOS / Linux"], "choices"))).toEqual(["Windows", "macOS / Linux"]);
  });

  it("leaves empty titles out and always closes the fence", () => {
    const md = tabsMarkdown(["Read", "  ", "Run"], "steps");
    expect(titlesOf(md)).toEqual(["1. Read", "2. Run"]);
    expect(md.startsWith("::: tabs\n")).toBe(true);
    expect(md.trimEnd().endsWith(":::")).toBe(true);
  });

  it("keeps a number that is part of the title", () => {
    expect(bareTitle("3.1 Simple")).toBe("Simple");
    expect(bareTitle("Customer 360")).toBe("Customer 360");
    expect(bareTitle("Type 0")).toBe("Type 0");
  });
});

describe("the dialog", () => {
  function open(windowsOnly?: boolean) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let inserted = "";
    act(() => {
      createRoot(host).render(
        <TabsModal onInsert={(m) => { inserted = m; }} onClose={() => {}} windowsOnly={windowsOnly} />,
      );
    });
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="tabs-kind"]')];
    const insert = () => {
      const btn = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => /^Insert /.test(b.textContent ?? ""))!;
      act(() => btn.click());
      return inserted;
    };
    return { radios, insert };
  }

  it("starts from steps in a Windows 11 course and inserts them numbered", () => {
    const { radios, insert } = open(true);
    expect(radios[0].checked).toBe(true);
    expect(titlesOf(insert())).toEqual(["1. First step", "2. Second step"]);
    document.body.innerHTML = "";
  });

  it("starts from choices elsewhere, and switching to steps numbers them", () => {
    const { radios, insert } = open();
    expect(radios[1].checked).toBe(true);
    act(() => radios[0].click());
    expect(titlesOf(insert())).toEqual(["1. Windows", "2. macOS / Linux"]);
    document.body.innerHTML = "";
  });
});
