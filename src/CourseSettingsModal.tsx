// Course settings — edit course.json metadata (title, description, accent,
// and the Ollama assistant models the learner app uses per CPU/GPU profile)
// in a form instead of raw JSON.

import { useEffect, useState } from "react";
import { api, type PublishDiff, type ExamSettings } from "./api";
import { Modal } from "./Modal";

/** course.json `contact` — the learner app's Contact Us form, which is
 *  always a mailto: handoff to `to`. `webhookUrl`/`webhookSecret` exist
 *  in the schema and in some course.json files, but are not offered
 *  here and are preserved rather than edited. */
interface Contact {
  to?: string;
  heading?: string;
  blurb?: string;
  messagePlaceholder?: string;
  sendLabel?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  /** Anything course.json carries that this dialog doesn't name. */
  [key: string]: unknown;
}

// Contact Us is always a mailto: handoff, so the relay URL and secret
// are deliberately NOT edited here. They stay out of this list, which
// means any values already in course.json ride along in `contactRest`
// untouched rather than being wiped by a save.
const CONTACT_FIELDS = [
  "to", "heading", "blurb", "messagePlaceholder", "sendLabel",
];

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
  const [version, setVersion] = useState("");
  const [accent, setAccent] = useState("#16a34a");
  const [welcomeVideo, setWelcomeVideo] = useState("");
  const [welcomeCaption, setWelcomeCaption] = useState("");
  const [welcomeEyebrow, setWelcomeEyebrow] = useState("");
  const [analyticsNote, setAnalyticsNote] = useState("");
  // Any welcome keys this dialog doesn't edit ride along untouched on save.
  const [welcomeRest, setWelcomeRest] = useState<Record<string, unknown>>({});
  const [mode, setMode] = useState<"free" | "sequential">("free");
  const [assistant, setAssistant] = useState<Assistant>({});
  const [contact, setContact] = useState<Contact>({});
  // Same treatment as welcomeRest: contact keys this dialog doesn't show
  // ride along untouched rather than being dropped on save.
  const [contactRest, setContactRest] = useState<Record<string, unknown>>({});
  const [exam, setExam] = useState<ExamSettings | null>(null);
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
      setVersion(c.version ?? "");
      setAccent(c.theme?.accent ?? "#16a34a");
      setWelcomeVideo(c.welcome?.video ?? "");
      setWelcomeCaption(c.welcome?.caption ?? "");
      setWelcomeEyebrow(c.welcome?.eyebrow ?? "");
      setAnalyticsNote(c.welcome?.analyticsNote ?? "");
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(c.welcome ?? {})) {
        if (!["video", "caption", "eyebrow", "analyticsNote"].includes(k)) rest[k] = v;
      }
      setWelcomeRest(rest);
      setMode(c.mode === "sequential" ? "sequential" : "free");
      setAssistant(c.assistant ?? {});
      const ct = (c.contact ?? {}) as Record<string, unknown>;
      setContact(ct as Contact);
      const ctRest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(ct)) {
        if (!CONTACT_FIELDS.includes(k)) ctRest[k] = v;
      }
      setContactRest(ctRest);
      setLoaded(true);
    }).catch((e) => setError((e as Error).message));
    // Exam settings live in exam.json, not course.json, so they load and
    // save independently. A course without one still opens this dialog.
    api.getExam(course)
      .then(setExam)
      .catch(() => setExam({ exists: false, questionCount: 0 }));
  }, [course]);

  function setModel(profile: "cpu" | "gpu", v: string) {
    setAssistant((a) => ({ ...a, models: { ...(a.models ?? {}), [profile]: v } }));
  }

  function setContactField(key: keyof Contact, v: string) {
    setContact((c) => ({ ...c, [key]: v }));
  }

  function setExamField<K extends keyof ExamSettings>(key: K, v: ExamSettings[K]) {
    setExam((e) => (e ? { ...e, [key]: v } : e));
  }

  function setIntakeField(key: keyof NonNullable<ExamSettings["intake"]>, v: boolean | string) {
    setExam((e) => (e ? { ...e, intake: { ...(e.intake ?? {}), [key]: v } } : e));
  }

  /** Trim every string, dropping the ones left empty so the API removes
   *  an all-blank block rather than storing "". */
  function trimmed(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== "string") { out[k] = v; continue; }
      const t = v.trim();
      if (t) out[k] = t;
    }
    return out;
  }

  async function save() {
    if (!title.trim()) { setError("Title can't be empty."); return; }
    setBusy(true);
    setError("");
    try {
      await api.putCourse(course, {
        title: title.trim(),
        description: description.trim(),
        version: version.trim() || undefined,
        theme: { accent },
        assistant,
        mode,
        // Blank fields are dropped by JSON.stringify; an all-blank block
        // arrives as {} and the API removes the key.
        welcome: {
          ...welcomeRest,
          video: welcomeVideo.trim() || undefined,
          caption: welcomeCaption.trim() || undefined,
          eyebrow: welcomeEyebrow.trim() || undefined,
          analyticsNote: analyticsNote.trim() || undefined,
        },
        contact: { ...contactRest, ...trimmed(contact) },
      });
      // Two files, two writes. course.json first: if the exam PUT is
      // rejected (a bad pass mark, an http:// webhook) the author sees
      // the message with their exam edits still in the form.
      if (exam?.exists) {
        await api.putExam(course, {
          title: exam.title,
          description: exam.description,
          passMark: exam.passMark,
          questionsPerAttempt: exam.questionsPerAttempt,
          shuffle: exam.shuffle,
          webhookUrl: (exam.webhookUrl ?? "").trim(),
          webhookSecret: (exam.webhookSecret ?? "").trim(),
          intake: exam.intake ?? {},
        });
      }
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
                <span>Version</span>
                <input
                  className="author-input" placeholder="e.g. 1.2.0"
                  value={version} onChange={(e) => setVersion(e.target.value)}
                />
                <span className="author-hint">Course content version — bump it when you publish meaningful changes. Independent of the app's version.</span>
              </label>
              <label className="author-field">
                <span>Accent colour</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
                  <input className="author-input" style={{ flex: "1 1 auto" }} value={accent} onChange={(e) => setAccent(e.target.value)} />
                </div>
              </label>
              <label className="author-field">
                <span>Lab order</span>
                <select className="author-input" value={mode} onChange={(e) => setMode(e.target.value as "free" | "sequential")}>
                  <option value="free">Free — learners can open any lab</option>
                  <option value="sequential">Sequential — each lab unlocks when the previous one is complete</option>
                </select>
                <span className="author-hint">Learners can still override this for themselves in the app's own settings.</span>
              </label>
              <fieldset className="author-fieldset">
                <legend>Welcome screen</legend>
                <label className="author-field">
                  <span>Course tour video</span>
                  <input
                    className="author-input"
                    placeholder="YouTube / Vimeo / Loom URL, or _assets/videos/tour.mp4"
                    value={welcomeVideo} onChange={(e) => setWelcomeVideo(e.target.value)}
                  />
                </label>
                <label className="author-field">
                  <span>Video caption (optional)</span>
                  <input
                    className="author-input" placeholder="Course tour (3 min)"
                    value={welcomeCaption} onChange={(e) => setWelcomeCaption(e.target.value)}
                  />
                </label>
                <p className="author-hint">
                  Shown at the top of the course's Welcome page — a walkthrough
                  of the course's features before the learner begins. Paste a
                  YouTube / Vimeo / Loom link, or a path to a bundled video
                  (upload to _assets first).
                </p>
                <label className="author-field">
                  <span>Eyebrow label (optional)</span>
                  <input
                    className="author-input" placeholder="Practitioner Workshop"
                    value={welcomeEyebrow} onChange={(e) => setWelcomeEyebrow(e.target.value)}
                  />
                  <span className="author-hint">The small-caps line above the course title. Blank uses the tier default (Practitioner Workshop / Specialty / Certified).</span>
                </label>
                <label className="author-field">
                  <span>Analytics &amp; privacy note (optional)</span>
                  <textarea
                    className="author-input" rows={6}
                    placeholder="This course reports anonymous usage analytics…"
                    value={analyticsNote} onChange={(e) => setAnalyticsNote(e.target.value)}
                  />
                  <span className="author-hint">
                    Replaces the default disclosure on the Welcome page. Say exactly what
                    leaves the machine for this course: what the analytics record, and what
                    each form (exam, feedback, contact) sends, to whom and why. Blank shows
                    the default, which describes a course with an exam certificate.
                  </span>
                </label>
              </fieldset>
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
                <legend>Contact Us</legend>
                <p className="author-hint">
                  The learner app's Contact Us form. It always hands the message
                  to the machine's mail client as a pre-filled email to the
                  address below — nothing is POSTed anywhere.
                </p>
                <label className="author-field">
                  <span>Send to</span>
                  <input
                    className="author-input" type="email" placeholder="academy@pentaho.com"
                    value={contact.to ?? ""} onChange={(e) => setContactField("to", e.target.value)}
                  />
                </label>
                <label className="author-field">
                  <span>Heading</span>
                  <input
                    className="author-input" placeholder="Contact Us"
                    value={contact.heading ?? ""} onChange={(e) => setContactField("heading", e.target.value)}
                  />
                </label>
                <label className="author-field">
                  <span>Blurb</span>
                  <textarea
                    className="author-input" rows={2}
                    placeholder="Ask us anything about the course…"
                    value={contact.blurb ?? ""} onChange={(e) => setContactField("blurb", e.target.value)}
                  />
                </label>
                <label className="author-field">
                  <span>Message placeholder</span>
                  <input
                    className="author-input" placeholder="What would you like to know?"
                    value={contact.messagePlaceholder ?? ""}
                    onChange={(e) => setContactField("messagePlaceholder", e.target.value)}
                  />
                </label>
                <label className="author-field">
                  <span>Send button label</span>
                  <input
                    className="author-input" placeholder="Send"
                    value={contact.sendLabel ?? ""} onChange={(e) => setContactField("sendLabel", e.target.value)}
                  />
                </label>
              </fieldset>
              <fieldset className="author-fieldset">
                <legend>Exam &amp; results</legend>
                {!exam ? (
                  <p className="author-hint">Loading…</p>
                ) : !exam.exists ? (
                  <p className="author-hint">
                    This course has no <code>exam.json</code>, so there is nothing to
                    configure. Add one to the course folder and reopen this dialog.
                  </p>
                ) : (
                  <>
                    <label className="author-field">
                      <span>Exam title</span>
                      <input
                        className="author-input" placeholder="Practitioner Exam"
                        value={exam.title ?? ""} onChange={(e) => setExamField("title", e.target.value)}
                      />
                    </label>
                    <label className="author-field">
                      <span>Description</span>
                      <textarea
                        className="author-input" rows={3}
                        value={exam.description ?? ""}
                        onChange={(e) => setExamField("description", e.target.value)}
                      />
                    </label>
                    <label className="author-field">
                      <span>Pass mark (%)</span>
                      <input
                        className="author-input" type="number" min={0} max={100}
                        value={exam.passMark ?? ""}
                        onChange={(e) => setExamField("passMark", e.target.value === "" ? undefined : Number(e.target.value))}
                      />
                    </label>
                    <label className="author-field">
                      <span>Questions per attempt</span>
                      <input
                        className="author-input" type="number" min={1} max={exam.questionCount || undefined}
                        value={exam.questionsPerAttempt ?? ""}
                        onChange={(e) => setExamField("questionsPerAttempt", e.target.value === "" ? undefined : Number(e.target.value))}
                      />
                    </label>
                    <p className="author-hint">
                      Drawn from a pool of {exam.questionCount} question
                      {exam.questionCount === 1 ? "" : "s"}. The questions themselves are
                      authored in <code>exam.json</code>.
                    </p>
                    <label className="author-check">
                      <input
                        type="checkbox" checked={exam.shuffle !== false}
                        onChange={(e) => setExamField("shuffle", e.target.checked)}
                      />
                      <span>Shuffle the questions on each attempt</span>
                    </label>

                    <label className="author-field">
                      <span>Results webhook</span>
                      <input
                        className="author-input" placeholder="https://script.google.com/macros/s/…/exec"
                        value={exam.webhookUrl ?? ""}
                        onChange={(e) => setExamField("webhookUrl", e.target.value)}
                      />
                    </label>
                    <label className="author-field">
                      <span>Shared secret</span>
                      <input
                        className="author-input" placeholder="pcm_…"
                        value={exam.webhookSecret ?? ""}
                        onChange={(e) => setExamField("webhookSecret", e.target.value)}
                      />
                    </label>
                    <p className="author-hint">
                      {exam.webhookUrl?.trim()
                        ? "Attempts POST to this Apps Script, which writes the results sheet. Retries are safe — it upserts on attempt id."
                        : "No webhook set — attempts are graded on the machine and nothing is sent anywhere."}
                    </p>

                    <label className="author-check">
                      <input
                        type="checkbox" checked={exam.intake?.collectCandidate !== false}
                        onChange={(e) => setIntakeField("collectCandidate", e.target.checked)}
                      />
                      <span>Ask for the candidate's name and email before the exam</span>
                    </label>
                    <label className="author-check">
                      <input
                        type="checkbox" checked={exam.intake?.consent !== false}
                        disabled={exam.intake?.collectCandidate === false}
                        onChange={(e) => setIntakeField("consent", e.target.checked)}
                      />
                      <span>Show the consent line with those fields</span>
                    </label>
                    <label className="author-check">
                      <input
                        type="checkbox" checked={exam.intake?.optional === true}
                        onChange={(e) => setIntakeField("optional", e.target.checked)}
                      />
                      <span>Let the learner skip the form and sit the exam anyway</span>
                    </label>
                    <label className="author-check">
                      <input
                        type="checkbox" checked={exam.intake?.trackResults !== false}
                        onChange={(e) => setIntakeField("trackResults", e.target.checked)}
                      />
                      <span>Record the attempt (off = a practice recap, unlimited retries, nothing stored)</span>
                    </label>
                    <label className="author-field">
                      <span>Intake lead-in</span>
                      <textarea
                        className="author-input" rows={2}
                        placeholder="Shown above the name and email fields."
                        value={exam.intake?.lead ?? ""}
                        onChange={(e) => setIntakeField("lead", e.target.value)}
                      />
                    </label>
                  </>
                )}
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
                    className="author-input" placeholder={`Update ${course} from the Content Editor`}
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
