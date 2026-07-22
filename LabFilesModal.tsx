// Lab Files manager — upload .ktr/.kjb/data into a lab's files/ folder and
// insert the matching "Open in PDI" / "View graph" button for a file.

import { useEffect, useRef, useState } from "react";
import { api } from "./api";

interface LabFilesModalProps {
  course: string;
  lab: string;
  onClose: () => void;
  /** Insert markdown at the editor caret (e.g. a launch/graph button). */
  onInsert: (text: string) => void;
}

export function LabFilesModal({ course, lab, onClose, onInsert }: LabFilesModalProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = () => api.listLabFiles(course, lab).then(setFiles).catch(() => setFiles([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [course, lab]);

  async function upload(f: File) {
    setBusy(true);
    setError("");
    try {
      await api.uploadLabFile(course, lab, f);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isPipeline = (n: string) => /\.(ktr|kjb)$/i.test(n);

  return (
    <div className="author-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="author-modal" onClick={(e) => e.stopPropagation()}>
        <div className="author-modal-head">
          <span>Lab files — {lab}</span>
          {!busy && <button type="button" className="author-mini-btn" onClick={onClose}>✕</button>}
        </div>
        <div className="author-modal-body">
          <p className="author-hint">
            Files here live in the lab's <code>files/</code> folder. Add
            <code>.ktr</code>/<code>.kjb</code> transformations or data, then insert a
            button that opens them in Spoon or the graph viewer.
          </p>
          <div>
            <button type="button" className="author-tool" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? "Uploading…" : "Upload file"}
            </button>
            <input
              ref={inputRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
            />
          </div>
          {files.length === 0 ? (
            <p className="author-hint">No files yet.</p>
          ) : (
            files.map((f) => (
              <div key={f} className="author-outline-lab">
                <span className="author-input" style={{ flex: "1 1 auto", background: "transparent", border: "none" }}>{f}</span>
                {isPipeline(f) && (
                  <>
                    <button type="button" className="author-mini-btn" title="Insert Open-in-PDI button"
                      onClick={() => onInsert(`<button data-launch="spoon" data-path="files/${f}">Open in Pentaho Data Integration</button>\n\n`)}>
                      + PDI
                    </button>
                    <button type="button" className="author-mini-btn" title="Insert View-graph button"
                      onClick={() => onInsert(`<button data-graph="files/${f}">View graph</button>\n\n`)}>
                      + Graph
                    </button>
                  </>
                )}
                <button type="button" className="author-mini-btn" title="Insert download link"
                  onClick={() => onInsert(`[${f}](files/${f})\n\n`)}>
                  + Link
                </button>
              </div>
            ))
          )}
          {error && <p className="author-error">{error}</p>}
        </div>
        <div className="author-modal-foot">
          <button type="button" className="author-tool" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
