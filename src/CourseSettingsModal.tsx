// Course settings — edit course.json metadata (title, description, accent,
// and the Ollama assistant models the learner app uses per CPU/GPU profile)
// in a form instead of raw JSON.

import { useEffect, useState } from "react";
import { api, type PublishDiff, type ExamSettings } from "./api";
import { Modal } from "./Modal";
import { skippedIgnoredNote } from "./publishNote";
import { COURSE_TRACKS, trackForColour } from "@app/content/courseTracks";
import { CREDENTIAL_WORDS, credentialFor } from "@app/components/credential";

/** course.json `contact` — the learner app's Contact Us form, which is
 *  always a mailto: handoff to `to`. `webhookUrl` exists in the schema
 *  but is not offered here and is preserved rather than edited. A relay
 *  secret (or a Logic App URL, whose sig= is one) never belongs in
 *  course.json since Content Manager 0.7.2: the API refuses to save one
 *  (api/published_secrets.py). */
interface Contact {
  to?: string;
  heading?: string;
  blurb?: string;
  messagePlaceholder?: string;
  sendLabel?: string;
  webhookUrl?: string;
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

/** course.json `completionCertificate` — the downloadable PDF a learner
 *  gets for passing. Absent means the course offers none, which is the
 *  right answer for a try-it lab whose check is anonymous. */
interface Certificate {
  title?: string;
  topics?: string[];
  capstone?: string;
  watermark?: string;
  validYears?: number;
  signatory?: { name?: string; title?: string };
  [key: string]: unknown;
}

const CERT_FIELDS = [
  "title", "topics", "capstone", "watermark", "validYears", "signatory",
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
  const [accent, setAccent] = useState(COURSE_TRACKS[0].colour);
  // Read only, to word the award: a course accreditation at levels 1-2,
  // certification at level 3 (the learner app's credential.ts).
  const [level, setLevel] = useState<number | undefined>(undefined);
  const award = CREDENTIAL_WORDS[credentialFor(level)];
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
  const [cert, setCert] = useState<Certificate | null>(null);
  // Keys this dialog doesn't show ride along untouched, same as welcome
  // and contact.
  const [certRest, setCertRest] = useState<Record<string, unknown>>({});
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
      const skipped = skippedIgnoredNote(r.skippedIgnored);
      if (r.upToDate) {
        setPublishNote("✓ Already up to date — nothing to publish." + (skipped ? ` ${skipped}.` : ""));
      } else {
        const c = r.changed;
        setPublishNote(`✓ Published ${r.commit.slice(0, 7)}` +
          (c ? ` (+${c.added} ~${c.modified} -${c.removed} files)` : "") +
          " — VMs pick it up on next launch." + (skipped ? ` ${skipped}.` : ""));
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
      setAccent(c.theme?.accent ?? COURSE_TRACKS[0].colour);
      setLevel(typeof c.level?.number === "number" ? c.level.number : undefined);
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
      const cc = c.completionCertificate as Record<string, unknown> | undefined;
      setCert(cc ? (cc as Certificate) : null);
      const ccRest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cc ?? {})) {
        if (!CERT_FIELDS.includes(k)) ccRest[k] = v;
      }
      setCertRest(ccRest);
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

  function setCertField(key: keyof Certificate, v: unknown) {
    setCert((c) => ({ ...(c ?? {}), [key]: v }));
  }

  function setSignatory(key: "name" | "title", v: string) {
    setCert((c) => ({ ...(c ?? {}), signatory: { ...(c?.signatory ?? {}), [key]: v } }));
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
        // null (the toggle off) sends an empty block, which the API
        // treats as "remove the key" — a course with no block offers no
        // certificate.
        completionCertificate: cert
          ? {
              ...certRest,
              ...trimmed({ ...cert, signatory: undefined, topics: undefined, validYears: undefined }),
              topics: (cert.topics ?? []).map((t) => t.trim()).filter(Boolean),
              validYears: cert.validYears ?? 2,
              signatory: trimmed(cert.signatory ?? {}),
            }
          : {},
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
              {/* The course's category by product family, from the
                  Content Manager's one list (src/content/courseTracks.ts),
                  stored as theme.accent. It is the dot beside the course's
                  title for learners, never the colour of a button. No free
                  colour picker: a colour that is no track is a category of
                  one, and the Content Manager's tests fail it. */}
              <div className="author-field" role="group" aria-labelledby="author-track-label">
                <span id="author-track-label">Track colour</span>
                <div className="author-track-options">
                  {COURSE_TRACKS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="author-track"
                      style={{ ["--track" as string]: t.colour }}
                      aria-pressed={trackForColour(accent)?.id === t.id}
                      onClick={() => setAccent(t.colour)}
                    >
                      <span className="author-track__dot" aria-hidden />
                      {t.label}
                    </button>
                  ))}
                </div>
                <span className="author-hint">
                  {trackForColour(accent)
                    ? "The course's category: a dot beside its title and in the course switcher. Every course's buttons are the same teal."
                    : `This course's colour (${accent}) is not a track. Pick the one it belongs to.`}
                </span>
              </div>
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
                    the default, which mentions the course accreditation only when this
                    course awards one.
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
                    <p className="author-hint">
                      {exam.webhookUrl?.trim()
                        ? "Attempts POST to this Apps Script, which writes the results sheet. Retries are safe — it upserts on attempt id."
                        : "No webhook set — attempts are graded on the machine and nothing is sent anywhere."}
                      {" "}Its shared secret is not set here: course files are published, so the secret
                      reaches each machine through the installer or provisioning (Content Manager docs/SECRETS.md).
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
                <legend>{capitalise(award.name)}</legend>
                {/* A certificate names its holder, so a course whose exam
                    doesn't identify the candidate cannot issue one. That
                    is the try-it lab: its check is anonymous by design,
                    and the option is withdrawn rather than left to be
                    switched on and silently produce nothing. */}
                {exam?.exists && exam.intake?.collectCandidate === false ? (
                  <p className="author-hint">
                    This course's check is <strong>anonymous</strong> — the exam
                    doesn't ask for a name, so there is nobody to award it to and no{" "}
                    {award.name} is offered. Turn on{" "}
                    <em>Ask for the candidate's name and email</em> above if this
                    course should award one.
                  </p>
                ) : (
                  <>
                    <label className="author-check">
                      <input
                        type="checkbox"
                        checked={cert !== null}
                        onChange={(e) => setCert(e.target.checked ? (cert ?? {}) : null)}
                      />
                      <span>
                        Award a downloadable {award.name} for completing the capstone
                        and passing the exam
                      </span>
                    </label>
                    {cert !== null && (
                      <>
                        <label className="author-field">
                          <span>Name as printed</span>
                          <input
                            className="author-input"
                            placeholder="Pentaho Data Integration Developer - Practitioner Level"
                            value={cert.title ?? ""}
                            onChange={(e) => setCertField("title", e.target.value)}
                          />
                        </label>
                        <p className="author-hint">
                          The formal credential name. Deliberately separate from the
                          course title above — the sidebar wants the short working
                          name, the {award.name} the full one. Levels 1 and 2 award a
                          course accreditation; certification is level 3 only.
                        </p>
                        <label className="author-field">
                          <span>Topics — one per line</span>
                          <textarea
                            className="author-input" rows={6}
                            placeholder={"Components and key concepts\nFlat files, databases and storage"}
                            value={(cert.topics ?? []).join("\n")}
                            onChange={(e) => setCertField("topics", e.target.value.split("\n"))}
                          />
                        </label>
                        <p className="author-hint">
                          Listed under the statement, two columns past four. Keep each
                          short — one that wraps breaks the grid.
                        </p>
                        <label className="author-field">
                          <span>Capstone line</span>
                          <textarea
                            className="author-input" rows={3}
                            placeholder="Completed a capstone project: …"
                            value={cert.capstone ?? ""}
                            onChange={(e) => setCertField("capstone", e.target.value)}
                          />
                        </label>
                        <label className="author-field">
                          <span>Watermark</span>
                          <input
                            className="author-input" placeholder="PENTAHO"
                            value={cert.watermark ?? ""}
                            onChange={(e) => setCertField("watermark", e.target.value)}
                          />
                        </label>
                        <label className="author-field">
                          <span>Valid for (years)</span>
                          <input
                            className="author-input" type="number" min={0} max={20}
                            value={cert.validYears ?? 2}
                            onChange={(e) =>
                              setCertField("validYears", e.target.value === "" ? 2 : Number(e.target.value))}
                          />
                        </label>
                        <p className="author-hint">
                          Counted from the pass date. <code>0</code> prints no expiry
                          line at all, rather than a date in the past.
                        </p>
                        <label className="author-field">
                          <span>Signed by</span>
                          <input
                            className="author-input" placeholder="Jason Allaway"
                            value={cert.signatory?.name ?? ""}
                            onChange={(e) => setSignatory("name", e.target.value)}
                          />
                        </label>
                        <label className="author-field">
                          <span>Signatory title</span>
                          <input
                            className="author-input"
                            placeholder="President Pentaho - A Leo Software Group Company"
                            value={cert.signatory?.title ?? ""}
                            onChange={(e) => setSignatory("title", e.target.value)}
                          />
                        </label>
                      </>
                    )}
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
                {diff && !!diff.skippedIgnored?.length && (
                  <p className="author-hint">
                    {skippedIgnoredNote(diff.skippedIgnored, 10)}. What the Content
                    Manager's .gitignore keeps out of git stays out of this public repo too;
                    to publish such a file on purpose, force-add it there
                    (<code>git add -f</code>).
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

/** "course accreditation" -> "Course accreditation", for a legend. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
