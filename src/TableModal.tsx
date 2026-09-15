// Insert a markdown table: pick the shape and the column alignment,
// see exactly what will be written, then insert it.
//
// Tables are the third most used construct in the courses and the
// toolbar used to insert a fixed 2x2 stub, so anything else meant
// hand-editing pipes. The preview is the point: markdown tables are
// the one construct authors get wrong most often, and seeing the
// delimiter row before it lands is quicker than fixing it after.

import { useState } from "react";

import { Modal } from "./Modal";
import { buildTable, type Align } from "./tableBuilder";

interface TableModalProps {
  onInsert: (markdown: string) => void;
  onClose: () => void;
}

const ALIGNS: { value: Align; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];

export function TableModal({ onInsert, onClose }: TableModalProps) {
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [align, setAlign] = useState<Align[]>([]);

  const alignOf = (c: number): Align => align[c] ?? "left";
  const setAlignOf = (c: number, a: Align) =>
    setAlign((prev) => {
      const next = [...prev];
      while (next.length < cols) next.push("left");
      next[c] = a;
      return next;
    });

  const markdown = buildTable(cols, rows, align);

  return (
    <Modal
      title="Insert table"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="author-tool" onClick={onClose}>Cancel</button>
          <button type="button" className="author-save" onClick={() => { onInsert(markdown); onClose(); }}>
            Insert table
          </button>
        </>
      }
    >
      <div className="author-table-shape">
        <label className="author-field">
          <span>Columns</span>
          <input
            className="author-input"
            type="number"
            min={1}
            max={8}
            value={cols}
            onChange={(e) => setCols(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        <label className="author-field">
          <span>Rows (not counting the header)</span>
          <input
            className="author-input"
            type="number"
            min={1}
            max={20}
            value={rows}
            onChange={(e) => setRows(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
      </div>

      <div className="author-field">
        <span>Column alignment</span>
        <div className="author-table-aligns">
          {Array.from({ length: cols }, (_, c) => (
            <label key={c} className="author-table-align">
              <span>Column {c + 1}</span>
              <select
                className="author-input"
                value={alignOf(c)}
                onChange={(e) => setAlignOf(c, e.target.value as Align)}
              >
                {ALIGNS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="author-field">
        <span>What gets inserted</span>
        <pre className="author-table-preview">{markdown.trimEnd()}</pre>
      </div>
    </Modal>
  );
}
