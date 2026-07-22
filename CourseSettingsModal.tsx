// Course settings — edit course.json metadata (title, description, accent,
// and the Ollama assistant models the learner app uses per CPU/GPU profile)
// in a form instead of raw JSON.

import { useEffect, useState } from "react";
import { api } from "./api";
import { Modal } from "./Modal";

interface CourseSettingsModalProps {
  course: string;
  onClose: () => void;
  onSaved: () => void;
}

interface Assistant {
  ollamaURL?: string;
  defaultProfile?: "cpu" | "gpu";
  models?: { cpu?: string; gpu?: string };
}

export function CourseSettingsModal({ course, onClose, onSaved }: CourseSettingsModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accent, setAccent] = useState("#16a34a");
  const [assistant, setAssistant] = useState<Assistant>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [installNote, setInstallNote] = useState("");

  async function install() {
    setInstallNote("Installing locally…");
    try {
      const r = await api.installCourse(course);
      setInstallNote(r.ok ? "✓ Installed into the app's content dir." : `✗ ${r.output.split("\n").slice(-1)[0] || "install failed"}`);
    } catch (e) {
      setInstallNote(`✗ ${(e as Error).message}`);
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
              {error && <p className="author-error">{error}</p>}
            </>
          )}
    </Modal>
  );
}
