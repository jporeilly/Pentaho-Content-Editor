// Build a callout: pick the kind, give it a title, write the body.
//
// The quick entries in the Callout menu stay one click, because that is
// the common case. This exists for the thing they cannot do: the
// renderer promotes a leading `#### heading` inside a callout to the
// panel's title strip, and nothing in the editor ever wrote one, so the
// feature was invisible unless an author had read the source.

import { useState } from "react";

import { Modal } from "./Modal";
import { CALLOUT_KINDS, buildCallout } from "./callouts";

interface CalloutModalProps {
  /** Whatever was selected when the dialog opened. */
  initialBody?: string;
  onInsert: (markdown: string) => void;
  onClose: () => void;
}

export function CalloutModal({ initialBody, onInsert, onClose }: CalloutModalProps) {
  const [tag, setTag] = useState(CALLOUT_KINDS[0].tag);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState(initialBody?.trim() || "");

  const kind = CALLOUT_KINDS.find((k) => k.tag === tag) ?? CALLOUT_KINDS[0];
  const markdown = buildCallout({ tag, title, body: body.trim() || kind.sample });

  return (
    <Modal
      title="Insert callout"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="author-tool" onClick={onClose}>Cancel</button>
          <button type="button" className="author-save" onClick={() => { onInsert(markdown); onClose(); }}>
            Insert callout
          </button>
        </>
      }
    >
      <label className="author-field">
        <span>Kind</span>
        <select className="author-input" value={tag} onChange={(e) => setTag(e.target.value)}>
          {CALLOUT_KINDS.map((k) => (
            <option key={k.tag} value={k.tag}>{k.label}</option>
          ))}
        </select>
        <span className="author-hint">{kind.title}</span>
      </label>

      <label className="author-field">
        <span>Title strip (optional)</span>
        <input
          className="author-input"
          value={title}
          autoFocus
          placeholder="e.g. Why that worked"
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className="author-hint">
          Shown in the panel’s header. Under the hood panels collapse, so the title is what the learner sees first.
        </span>
      </label>

      <label className="author-field">
        <span>Body</span>
        <textarea
          className="author-input author-callout-body"
          value={body}
          rows={5}
          placeholder={kind.sample}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      <div className="author-field">
        <span>What gets inserted</span>
        <pre className="author-table-preview">{markdown.trimEnd()}</pre>
      </div>
    </Modal>
  );
}
