// Live preview pane — reuses the app's REAL MarkdownBody renderer so the
// author sees exactly what a learner will see (callouts, :::tabs, code
// copy, videos, glossary terms, launcher/graph buttons). The Tauri-only
// bits MarkdownBody depends on are satisfied by:
//   • Vite aliases (vite.author.config.ts) that shim the @tauri-apps
//     imports to inert browser versions, and
//   • the ToolPanelProvider + GlossaryProvider wrappers below, which the
//     renderer's hooks require.

import { useMemo } from "react";
import { MarkdownBody } from "../components/MarkdownBody";

// Inert progress plumbing for the preview — stable identities so
// MarkdownBody doesn't re-render on every keystroke because of them.
const EMPTY_PROGRESS = new Set<string>();
const noopToggle = () => {};
import { ToolPanelProvider } from "../components/ToolPanelContext";
import { GlossaryProvider, normaliseGlossary } from "../components/GlossaryContext";

interface PreviewProps {
  body: string;
  /** Asset base URL for this lab (api.assetBaseUrl(course, lab)). */
  baseUrl: string;
  labSlug: string;
  glossary?: Record<string, string>;
}

export function Preview({ body, baseUrl, labSlug, glossary }: PreviewProps) {
  const normalised = useMemo(() => normaliseGlossary(glossary ?? {}), [glossary]);

  return (
    <GlossaryProvider glossary={normalised}>
      <ToolPanelProvider>
        <div className="pcm-guide author-preview-guide">
          {/* Pass inert progress props so the preview shows exactly
              what learners see: step checkboxes and the renderer-added
              "Step N:" heading prefixes (nothing persists here). */}
          <MarkdownBody
            body={body}
            baseUrl={baseUrl}
            labSlug={labSlug}
            completed={EMPTY_PROGRESS}
            toggle={noopToggle}
          />
        </div>
      </ToolPanelProvider>
    </GlossaryProvider>
  );
}
