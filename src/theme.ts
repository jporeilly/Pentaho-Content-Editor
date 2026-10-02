// Editor theming.
//
// Two independent choices, because they answer different questions:
//
//   • The EDITOR theme is comfort — how the chrome around your work
//     looks while you write. Any of the palettes below.
//   • The PREVIEW theme is correctness — learners can run the app in
//     either theme, and a guide that looks fine on white can be
//     unreadable on the dark surface (a hard-coded colour in inline
//     HTML, a screenshot with a white background, a callout whose
//     custom style never got a dark variant). Being able to flip the
//     preview means those are caught while authoring instead of by a
//     learner.
//
// **The preview stays two-valued on purpose.** It is not a style
// choice, it is a simulation of what a learner can actually have, and
// the app ships exactly light and dark. Adding editor palettes here
// must never grow that list, or the preview stops telling the truth.
//
// Both are applied as classes on <html>, which is where the learner
// app already puts `pcm-dark` (see Dock.tsx) — so the preview inherits
// the app's real dark palette rather than an approximation of it.

import { useCallback, useEffect, useState } from "react";

export type PreviewTheme = "light" | "dark";

export interface EditorThemeDef {
  id: string;
  label: string;
  /** Shown as the menu item's tooltip. */
  hint: string;
  /** Whether the chrome is dark. Drives the preview's sensible default
      and lets rules that need to know (scrollbars) branch once. */
  dark: boolean;
}

// Order is the menu order: the two originals first, so the people who
// had them keep finding them where they were.
export const EDITOR_THEMES: EditorThemeDef[] = [
  { id: "midnight",  label: "Midnight",  hint: "The original dark chrome, green accent",       dark: true  },
  { id: "daylight",  label: "Daylight",  hint: "The original light chrome",                    dark: false },
  { id: "ocean",     label: "Ocean",     hint: "Deep blue, cyan accent",                       dark: true  },
  { id: "ember",     label: "Ember",     hint: "Warm dark, Pentaho amber accent",              dark: true  },
  { id: "forest",    label: "Forest",    hint: "Muted green, easy for long sessions",          dark: true  },
  { id: "plum",      label: "Plum",      hint: "Dark violet, magenta accent",                  dark: true  },
  { id: "parchment", label: "Parchment", hint: "Warm paper, slate text, teal accent - the Exam Bank's look", dark: false },
  { id: "contrast",  label: "Contrast",  hint: "Maximum contrast for small or dim VM screens", dark: true  },
];

// Parchment, not Midnight. The author's own preference, and it only
// affects a machine that has never chosen: the choice is remembered in
// localStorage, so anyone already on another theme keeps it.
export const DEFAULT_EDITOR_THEME = "parchment";

const EDITOR_KEY = "pcm-author-theme";
const PREVIEW_KEY = "pcm-author-preview-theme";

const THEME_IDS = new Set(EDITOR_THEMES.map((t) => t.id));

/** Every class this module may put on <html>, so switching can clear
    the previous one without knowing which it was. */
const ALL_THEME_CLASSES = EDITOR_THEMES.map((t) => `author-theme-${t.id}`);

/**
 * Editor themes used to be the two-valued "light" | "dark". Those are
 * still in people's localStorage, so map them onto their successors
 * rather than silently resetting someone's editor to the default.
 */
export function normaliseEditorTheme(raw: string | null): string {
  if (raw === "dark") return "midnight";
  if (raw === "light") return "daylight";
  return raw && THEME_IDS.has(raw) ? raw : DEFAULT_EDITOR_THEME;
}

export function themeDef(id: string): EditorThemeDef {
  return EDITOR_THEMES.find((t) => t.id === id) ?? EDITOR_THEMES[0];
}

function readPreview(fallback: PreviewTheme): PreviewTheme {
  try {
    const v = localStorage.getItem(PREVIEW_KEY);
    return v === "light" || v === "dark" ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* best effort */ }
}

export function useEditorTheme() {
  const [editor, setEditorState] = useState<string>(() => {
    try { return normaliseEditorTheme(localStorage.getItem(EDITOR_KEY)); }
    catch { return DEFAULT_EDITOR_THEME; }
  });
  // The preview has always shown the learner's light default; keep that
  // so nobody's preview changes meaning on upgrade.
  const [preview, setPreviewState] = useState<PreviewTheme>(() => readPreview("light"));

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove(...ALL_THEME_CLASSES);
    root.classList.add(`author-theme-${editor}`);
    // Kept so any rule or bookmarklet still keyed on the old class works;
    // it now means "this chrome is light", not "this is THE light theme".
    root.classList.toggle("author-light", !themeDef(editor).dark);
    // `pcm-dark` is the learner app's own class — the preview picks up
    // the real dark palette from app.css, not a copy of it.
    root.classList.toggle("pcm-dark", preview === "dark");
  }, [editor, preview]);

  const setEditor = useCallback((t: string) => { setEditorState(t); write(EDITOR_KEY, t); }, []);
  const setPreview = useCallback((t: PreviewTheme) => { setPreviewState(t); write(PREVIEW_KEY, t); }, []);

  return { editor, preview, setEditor, setPreview };
}
