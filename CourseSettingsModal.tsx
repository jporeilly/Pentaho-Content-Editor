// Course settings — edit course.json metadata (title, description, accent,
// and the Ollama assistant models the learner app uses per CPU/GPU profile)
// in a form instead of raw JSON.

import { useEffect, useState } from "react";
import { api, type PublishDiff } from "./api";
import { Modal } from "./Modal";

interface CourseSettingsModalProps {
  course: string;
  onClose: () => void;
  onSaved: () => void;
  /** Called after the course folder has been deleted from disk. */
  onDeleted: () => void;
}

interface Assistant {
  ollamaURL?: string;
  defaultProfile?: "cpu" | "gpu";
  models?: { cpu?: string; gpu?: string };
}

export function CourseSettingsModal({ course, onClose, onSaved, onDeleted }: CourseSettingsModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accent, setAccent] = useState("#16a34a");
  const [assistant, setAssistant] = useState<Assistant>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [installNote, setInstallNote] = useState("");
  const [diff, setDiff] = useState<PublishDiff | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [tag, setTag] = useState("");
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteNote, setDeleteNote] = useState("");
  const deleteArmed = deletePhrase.trim().toLowerCase() === "delete";

  async function install() {
    setInstallNote("Installing locally…");
    try {
      const r = await api.installCourse(course);
      setInstallNote(r.ok ? "✓ Installed into the app's content dir." : `✗ ${r.output.split("\n").slice(-1)[0] || "install failed"}`);
    } catch (e) {
      setInstallNote(`✗ ${(e as Error).message}`);
    }
  }

  async function checkDiff() {
    setPublishBusy(true);
    setPublishNote("Comparing with the distribution repo…");
    setDiff(null);
    try {
      const d = await api.publishDiff(course);
      setDiff(d);
      setPublishNote(d.upToDate
        ? "✓ Up to date — the repo already has this exact course."
        : d.newCourse
          ? "New course — not in the repo yet."
          : "");
    } catch (e) {
      setPublishNote(`✗ ${(e as Error).message}`);
    } finally {
      setPublishBusy(false);
    }
  }

  async function publish() {
    setPublishBusy(true);
    setPublishNote("Publishing…");
    try {
      const r = await api.publishCourse(course, commitMsg.trim() || undefined);
      if (r.upToDate) {
        setPublishNote("✓ Already up to date — nothing to publish.");
      } else {
        const c = r.changed;
        setPublishNote(`✓ Published ${r.commit.slice(0, 7)}` +
          (c ? ` (+${c.added} ~${c.modified} -${c.removed} files)` : "") +
          " — VMs pick it up on next launch.");
        setDiff(null);
        setCommitMsg("");
      }
    } catch (e) {
      setPublishNote(`✗ ${(e as Error).message}`);
    } finally {
      setPublishBusy(false);
    }
  }

  async function tagRelease() {
    if (!tag.trim()) { setPublishNote("✗ Enter a tag, e.g. v2026.07"); return; }
    setPublishBusy(true);
    setPublishNote(`Tagging ${tag.trim()}…`);
    try {
      const r = await api.publishTag(tag.trim());
      setPublishNote(`✓ Tagged ${r.tag} at ${r.commit.slice(0, 7)} — pin VMs with set-git-source -Ref ${r.tag}.`);
      setTag("");
    } catch (e) {
      setPublishNote(`✗ ${(e as Error).message}`);
    } finally {
      setPublishBusy(false);
    }
  }

  async function deleteCourse() {
    if (!deleteArmed) return;
    setBusy(true);
    setDeleteNote("Deleting…");
    try {
      await api.deleteCourse(course, deletePhrase.trim());
      onDeleted();
    } catch (e) {
      setDeleteNote(`✗ ${(e as Error).message}`);
      setBusy(false);
    }
  }

  useEffect(() => {
    api.getCourse(course).then((c: any) => {
      setTitle(c.title ?? "");
      setDescription(c.description ?? "");
      setAccent(c.theme?.accent ?? "#16a34a");
      setAssistant(c.assistant ?? {});
      setLoaded(true);
    }).catch((e) => setError((e as Error).message));
  }, [course]);

  function setModel(profile: "cpu" | "gpu", v: string) {
    setAssistant((a) => ({ ...a, models: { ...(a.models ?? {}), [profile]: v } }));
  }

  async function save() {
    if (!title.trim()) { setError("Title can't be empty."); return; }
    setBusy(true);
    setError("");
    try {
      await api.putCourse(course, {
        title: title.trim(),
        description: description.trim(),
        theme: { accent },
        assistant,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Course settings"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="author-tool" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="author-save" onClick={save} disabled={busy || !loaded}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {!loaded ? <p>Loading…</p> : (
        <>
              <label className="author-field">
                <span>Title</span>
                <input className="author-input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="author-field">
                <span>Description</span>
                <textarea className="author-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="author-field">
                <span>Accent colour</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
                  <input className="author-input" style={{ flex: "1 1 auto" }} value={accent} onChange={(e) => setAccent(e.target.value)} />
                </div>
              </label>
              <fieldset className="author-fieldset">
                <legend>Learner AI assistant (Ollama)</legend>
                <label className="author-field">
                  <span>CPU model</span>
                  <input className="author-input" placeholder="e.g. llama3.2:3b" value={assistant.models?.cpu ?? ""} onChange={(e) => setModel("cpu", e.target.value)} />
                </label>
                <label className="author-field">
                  <span>GPU model</span>
                  <input className="author-input" placeholder="e.g. qwen2.5:7b" value={assistant.models?.gpu ?? ""} onChange={(e) => setModel("gpu", e.target.value)} />
                </label>
                <label className="author-field">
                  <span>Default profile</span>
                  <select className="author-input" value={assistant.defaultProfile ?? "cpu"} onChange={(e) => setAssistant((a) => ({ ...a, defaultProfile: e.target.value as "cpu" | "gpu" }))}>
                    <option value="cpu">CPU</option>
                    <option value="gpu">GPU</option>
                  </select>
                </label>
                <p className="author-hint">These are what the learner app uses on the VM — separate from the editor's own provider (Settings ⚙).</p>
              </fieldset>
              <fieldset className="author-fieldset">
                <legend>Deploy</legend>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a className="author-tool" href={api.exportUrl(course)} download>⬇ Export .zip</a>
                  <button type="button" className="author-tool" onClick={install}>⚙ Install locally</button>
                </div>
                <p className="author-hint">
                  Export a portable zip (hand to install-course or a VM), or install into
                  this machine's app content dir to preview in the real app.
                </p>
                {installNote && <p className="author-hint">{installNote}</p>}
              </fieldset>
              <fieldset className="author-fieldset">
                <legend>Publish to VMs</legend>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="author-tool" onClick={checkDiff} disabled={publishBusy}>
                    ⇄ Check changes
                  </button>
                  <button
                    type="button" className="author-tool" onClick={publish}
                    disabled={publishBusy || (diff !== null && diff.upToDate)}
                  >
                    ⇧ Publish
                  </button>
                </div>
                {diff && !diff.upToDate && (
                  <p className="author-hint">
                    {diff.newCourse ? "New course. " : ""}
                    {diff.added.length} added, {diff.modified.length} changed,{" "}
                    {diff.removed.length} removed file(s) vs {diff.remoteCommit.slice(0, 7)}.
                  </p>
                )}
                <label className="author-field">
                  <span>Commit message (optional)</span>
                  <input
                    className="author-input" placeholder={`Update ${course} from the course editor`}
                    value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)}
                  />
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <label className="author-field" style={{ flex: "1 1 auto" }}>
                    <span>Tag release (freeze for workshop images)</span>
                    <input
                      className="author-input" placeholder="v2026.07"
                      value={tag} onChange={(e) => setTag(e.target.value)}
                    />
                  </label>
                  <button type="button" className="author-tool" onClick={tagRelease} disabled={publishBusy}>
                    🏷 Tag
                  </button>
                </div>
                <p className="author-hint">
                  Pushes this course to the Pentaho-Courses repo. Provisioned VMs
                  tracking a branch pick changes up on next app launch; VMs pinned
                  to a tag stay frozen until you retag.
                </p>
                {publishNote && <p className="author-hint">{publishNote}</p>}
              </fieldset>
              <fieldset className="author-fieldset" style={{ borderColor: "#b91c1c" }}>
                <legend style={{ color: "#ef4444" }}>Danger zone</legend>
                <p className="author-hint">
                  Permanently deletes <code>courses/{course}/</code> from disk —
                  labs, images, exam, everything. Copies already installed in
                  the app or published to Pentaho-Courses are not touched.
                  Type <strong>delete</strong> to confirm.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="author-input"
                    style={{ flex: "1 1 auto" }}
                    placeholder='Type "delete" to enable the button'
                    value={deletePhrase}
                    onChange={(e) => setDeletePhrase(e.target.value)}
                  />
                  <button
                    type="button"
                    className="author-tool"
                    style={deleteArmed ? { background: "#b91c1c", color: "#fff", borderColor: "#b91c1c" } : undefined}
                    onClick={deleteCourse}
                    disabled={!deleteArmed || busy}
                  >
                    🗑 Delete course
                  </button>
                </div>
                {deleteNote && <p className="author-hint">{deleteNote}</p>}
              </fieldset>
              {error && <p className="author-error">{error}</p>}
            </>
          )}
    </Modal>
  );
}
