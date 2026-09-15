// Live preview pane — reuses the app's REAL renderer so the author sees
// exactly what a learner will see: the same guide header (title, time,
// description, progress bar), the same body rules (leading-H1 strip,
// step numbering only when the manifest tracks progress), and the same
// components (callouts, :::tabs, code copy, videos, glossary terms,
// launcher/graph buttons).
//
// Anything that decides how a guide looks lives in ../components
// (GuideHeader + guideBody) and is imported by BOTH surfaces — the
// preview must never re-implement it, or the two drift apart and the
// editor lies to the author.
//
// The Tauri-only bits MarkdownBody depends on are satisfied by:
//   • Vite aliases (vite.config.ts) that shim the @tauri-apps
//     imports to inert browser versions, and
//   • the ToolPanelProvider + GlossaryProvider wrappers below, which the
//     renderer's hooks require.

import { useMemo } from "react";
import { MarkdownBody } from "@app/components/MarkdownBody";
import { GuideHeader } from "@app/components/GuideHeader";
import { countSteps, stripLeadingH1, tracksProgress } from "@app/components/guideBody";

// Inert progress plumbing for the preview — stable identities so
// MarkdownBody doesn't re-render on every keystroke because of them.
const EMPTY_PROGRESS = new Set<string>();
const noopToggle = () => {};
import { ToolPanelProvider } from "@app/components/ToolPanelContext";
import { GlossaryProvider, normaliseGlossary } from "@app/components/GlossaryContext";

interface PreviewProps {
  body: string;
  /** Asset base URL for this lab (api.assetBaseUrl(course, lab)). */
  baseUrl: string;
  labSlug: string;
  glossary?: Record<string, string>;
  /** The lab's manifest.json — supplies the header fields and the
   *  noProgress flag, so ☑ Tracking / ⏱ changes show up here. */
  manifest?: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined);

export function Preview({ body, baseUrl, labSlug, glossary, manifest }: PreviewProps) {
  const normalised = useMemo(() => normaliseGlossary(glossary ?? {}), [glossary]);

  const track = tracksProgress(manifest?.noProgress);
  const totalSteps = useMemo(
    () => (track ? countSteps(body) : 0),
    [track, body],
  );

  return (
    <GlossaryProvider glossary={normalised}>
      <ToolPanelProvider>
        <article className="pcm-guide author-preview-guide">
          <GuideHeader
            title={str(manifest?.title) ?? labSlug}
            description={str(manifest?.description)}
            estimatedMinutes={num(manifest?.estimatedMinutes)}
            hasVideo={manifest?.hasVideo === true}
            totalSteps={totalSteps}
            doneSteps={0}
          />
          {/* Progress props are passed only when the lab tracks it —
              same condition GuideRenderer uses — so a `noProgress` lab
              previews without step numbers or checkboxes, exactly as
              the learner sees it. */}
          <MarkdownBody
            body={stripLeadingH1(body)}
            baseUrl={baseUrl}
            labSlug={labSlug}
            completed={track ? EMPTY_PROGRESS : undefined}
            toggle={track ? noopToggle : undefined}
          />
        </article>
      </ToolPanelProvider>
    </GlossaryProvider>
  );
}
