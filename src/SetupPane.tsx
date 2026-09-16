// First run: where are the courses?
//
// From a checkout this screen never appears — the Content Manager is the
// sibling directory and always has been. It exists for the installed
// editor, which starts knowing nothing about the machine it landed on
// and cannot ask the author to set an environment variable, because
// there is no shell in sight and PCM_REPO is not a thing anyone should
// have to know.
//
// It also reports what the machine is MISSING but does not block on it.
// A content-only clone, or a laptop without Node, still gives a usable
// editor: you can open, edit, save, preview and use the AI actions. Only
// scaffolding, Verify and Publish need more. Saying that once, here, is
// better than four features failing later in four different ways.

import { useState } from "react";
import { api, type SetupStatus } from "./api";

export function SetupPane({ setup, onReady }: { setup: SetupStatus; onReady: () => void }) {
  const [path, setPath] = useState(setup.pcmRepo || setup.defaultRepo);
  const [error, setError] = useState<string | null>(setup.reason);
  const [busy, setBusy] = useState(false);

  async function choose(candidate?: string) {
    const target = (candidate ?? path).trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.setRepo(target);
      onReady();
    } catch (e) {
      // The backend's own sentence, not a paraphrase of it.
      setError(String((e as Error).message).replace(/^\d+:\s*/, ""));
      // Put a rejected candidate in the field so it can be corrected
      // rather than retyped from nothing.
      if (candidate) setPath(candidate);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="author-splash">
      <h1>Pentaho Content Editor</h1>
      <p>
        This editor works on the courses in a <strong>Pentaho Content Manager</strong>{" "}
        checkout — that repository is where courses live and where they are published
        from. Point it at your copy.
      </p>

      {/* What the machine already has, before asking anyone to type an
          absolute path from memory. The installed editor cannot even
          offer a sensible default — its sibling directory resolves to
          somewhere inside Program Files that has never existed. */}
      {setup.candidates.length > 0 && (
        <div className="author-setup-found">
          <p className="author-setup-found-head">Found on this machine:</p>
          <ul>
            {setup.candidates.map((c) => (
              <li key={c.path}>
                <button
                  type="button"
                  className="author-setup-candidate"
                  onClick={() => choose(c.path)}
                  disabled={busy}
                  title="Use this folder"
                >
                  <span className="author-setup-candidate-path">{c.path}</span>
                  {/* A courses-only clone is genuinely usable; it just
                      cannot scaffold or verify. Saying which is which
                      here beats four buttons failing later. */}
                  {!c.scaffolding && (
                    <em className="author-setup-candidate-note">no scripts/ — editing only</em>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="author-hint">Or give the path yourself:</p>
        </div>
      )}

      <div className="author-setup-row">
        <input
          className="author-setup-input"
          value={path}
          spellCheck={false}
          placeholder={setup.defaultRepo || "C:\\path\\to\\Pentaho-Content-Manager"}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void choose(); }}
          aria-label="Content Manager folder"
        />
        <button type="button" className="author-save" onClick={() => choose()} disabled={busy || !path.trim()}>
          {busy ? "Checking…" : "Use this folder"}
        </button>
      </div>

      {error && <p className="author-error">{error}</p>}

      <p className="author-hint">
        The folder that contains <code>courses/</code> — typically a clone of{" "}
        <code>Pentaho-Content-Manager</code>. Setting <code>PCM_REPO</code> in the
        environment overrides this and skips the question entirely.
      </p>

      {/* Reported, never blocking: the editor is worth having without
          either tool, and an author who knows which buttons are dark
          will not file the bug for them. */}
      {(!setup.tools.node.found || !setup.tools.git.found) && (
        <div className="author-setup-tools">
          <p className="author-setup-tools-head">On this machine:</p>
          <ul>
            <li>
              <strong>Node.js</strong> — {setup.tools.node.found ? "found" : "not found"}.{" "}
              {setup.tools.node.found
                ? "New Course, New Lab, Import and Verify are available."
                : "New Course, New Lab, Import and Verify will be unavailable; they run the Content Manager's own scripts."}
            </li>
            <li>
              <strong>git</strong> — {setup.tools.git.found ? "found" : "not found"}.{" "}
              {setup.tools.git.found ? "Publish is available." : "Publish will be unavailable."}
            </li>
          </ul>
          <p className="author-hint">
            Editing, saving, the live preview and the AI actions need neither.
          </p>
        </div>
      )}
    </div>
  );
}
