// Editor theming.
//
// Two independent choices, because they answer different questions:
//
//   • The EDITOR theme is comfort — how the chrome around your work
//     looks while you write.
//   • The PREVIEW theme is correctness — learners can run the app in
//     either theme, and a guide that looks fine on white can be
//     unreadable on the dark surface (a hard-coded colour in inline
//     HTML, a screenshot with a white background, a callout whose
//     custom style never got a dark variant). Being able to flip the
//     preview means those are caught while authoring instead of by a
//     learner.
//
// Both are applied as classes on <html>, which is where the learner
// app already puts `pcm-dark` (see Dock.tsx) — so the preview inherits
// the app's real dark palette rather than an approximation of it.

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const EDITOR_KEY = "pcm-author-theme";
const PREVIEW_KEY = "pcm-author-preview-theme";

function read(key: string, fallback: Theme): Theme {
  try {
    const v = localStorage.getItem(key);
    return v === "light" || v === "dark" ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: Theme) {
  try { localStorage.setItem(key, value); } catch { /* best effort */ }
}

export function useEditorTheme() {
  // The editor has always been dark; the preview has always shown the
  // learner's light default. Keep both as the defaults so nobody's
  // editor changes appearance on upgrade.
  const [editor, setEditorState] = useState<Theme>(() => read(EDITOR_KEY, "dark"));
  const [preview, setPreviewState] = useState<Theme>(() => read(PREVIEW_KEY, "light"));

  useEffect(() => {
    const root = document.documentElement;
    // `author-light` re-points the --author-* tokens; the dark values
    // are the bare :root defaults, so dark needs no class.
    root.classList.toggle("author-light", editor === "light");
    // `pcm-dark` is the learner app's own class — the preview picks up
    // the real dark palette from app.css, not a copy of it.
    root.classList.toggle("pcm-dark", preview === "dark");
  }, [editor, preview]);

  const setEditor = useCallback((t: Theme) => { setEditorState(t); write(EDITOR_KEY, t); }, []);
  const setPreview = useCallback((t: Theme) => { setPreviewState(t); write(PREVIEW_KEY, t); }, []);

  return { editor, preview, setEditor, setPreview };
}
