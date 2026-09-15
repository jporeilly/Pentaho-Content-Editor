// Markdown tables: build one, and tidy one that already exists.
//
// Tables are the third most used construct in the courses - 1,325 of
// them across 226 guides - and until now the toolbar inserted a fixed
// 2x2 stub and left the author to hand-edit pipes from there. Adding a
// column to a ten-row table by hand is miserable, and the result drifts
// out of alignment, which makes the next edit worse.
//
// Everything here is pure string work so it can be tested without a
// DOM: the dialog and the toolbar only decide WHEN to call it.

export type Align = "left" | "center" | "right";

/** The delimiter cell for a column, e.g. ":---:" for centre. */
function delimiter(align: Align, width: number): string {
  const w = Math.max(width, align === "center" ? 5 : 4);
  if (align === "center") return ":" + "-".repeat(w - 2) + ":";
  if (align === "right") return "-".repeat(w - 1) + ":";
  return "-".repeat(w);
}

/** Read the alignment a delimiter cell declares. */
export function parseAlign(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

/** Pad a cell to width, respecting its column's alignment. */
function pad(text: string, width: number, align: Align): string {
  const gap = Math.max(0, width - text.length);
  if (align === "right") return " ".repeat(gap) + text;
  if (align === "center") {
    const l = Math.floor(gap / 2);
    return " ".repeat(l) + text + " ".repeat(gap - l);
  }
  return text + " ".repeat(gap);
}

/** Split a markdown table row into cells, honouring escaped pipes. */
export function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "|") { cur += "\\|"; i++; continue; }
    if (ch === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** Render rows (first row = header) as an aligned markdown table. */
export function renderTable(rows: string[][], align: Align[]): string {
  const cols = Math.max(...rows.map((r) => r.length), align.length);
  const grid = rows.map((r) => {
    const copy = r.slice(0, cols);
    while (copy.length < cols) copy.push("");
    return copy;
  });
  const aligns: Align[] = [];
  for (let c = 0; c < cols; c++) aligns.push(align[c] ?? "left");

  // Column width is the widest cell, with a floor so the delimiter row
  // never collapses to fewer dashes than the syntax needs.
  const widths = aligns.map((a, c) =>
    Math.max(a === "center" ? 5 : 4, ...grid.map((r) => r[c].length)));

  const line = (cells: string[]) =>
    "| " + cells.map((cell, c) => pad(cell, widths[c], aligns[c])).join(" | ") + " |";

  const [head, ...body] = grid;
  return [
    line(head),
    "| " + aligns.map((a, c) => delimiter(a, widths[c])).join(" | ") + " |",
    ...body.map(line),
  ].join("\n");
}

/** A fresh table: `cols` columns by `rows` body rows, with placeholders. */
export function buildTable(cols: number, rows: number, align: Align[] = []): string {
  const header = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
  const body = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => "Value"));
  return renderTable([header, ...body], align) + "\n\n";
}

export interface TableSpan {
  /** Offsets into the document. */
  start: number;
  end: number;
  rows: string[][];
  align: Align[];
}

/**
 * The markdown table the caret sits in, or null. A table is a run of
 * consecutive lines that all start with a pipe, with a delimiter row
 * second - the same shape GitHub-flavoured markdown requires, so we
 * never reformat something that merely uses pipes.
 */
export function findTableAt(text: string, caret: number): TableSpan | null {
  const lines = text.split("\n");
  // Which line is the caret on?
  let pos = 0, line = 0;
  for (; line < lines.length; line++) {
    const len = lines[line].length + 1;
    if (caret < pos + len) break;
    pos += len;
  }
  if (line >= lines.length) return null;

  const isRow = (l: string | undefined) => !!l && /^\s*\|/.test(l);
  if (!isRow(lines[line])) return null;

  let first = line;
  while (first > 0 && isRow(lines[first - 1])) first--;
  let last = line;
  while (last < lines.length - 1 && isRow(lines[last + 1])) last++;
  if (last - first < 1) return null;

  const delim = lines[first + 1];
  if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(delim) || !delim.includes("-")) return null;

  let start = 0;
  for (let i = 0; i < first; i++) start += lines[i].length + 1;
  let end = start;
  for (let i = first; i <= last; i++) end += lines[i].length + (i < last ? 1 : 0);

  const align = splitRow(delim).map(parseAlign);
  const rows = lines.slice(first, last + 1)
    .filter((_, i) => i !== 1)
    .map(splitRow);
  return { start, end, rows, align };
}

/** Re-pad the table at the caret. Returns null when there isn't one. */
export function tidyTableAt(text: string, caret: number): { text: string; start: number; end: number } | null {
  const span = findTableAt(text, caret);
  if (!span) return null;
  const tidied = renderTable(span.rows, span.align);
  return {
    text: text.slice(0, span.start) + tidied + text.slice(span.end),
    start: span.start,
    end: span.start + tidied.length,
  };
}
