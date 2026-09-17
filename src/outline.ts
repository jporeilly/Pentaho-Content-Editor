// The outline of a guide: its headings, and where they start.
//
// Guides run long - the try-it lab's metadata-injection lab is over 400
// lines - and the editor gave no way to move around one except
// scrolling. This turns the body into a jump list.
//
// The one thing it must get right is fenced code. A guide that
// documents markdown, or a shell script full of comments, contains
// lines starting with "#" that are not headings; treating them as
// headings would fill the outline with noise and jump to the wrong
// place. So the scan tracks fences, exactly as the Engine does.

export interface OutlineEntry {
  /** 1-6. Steps are h2, sub-steps h3. */
  level: number;
  text: string;
  /** 0-based line number. */
  line: number;
  /** Character offset of the start of the heading line. */
  offset: number;
}

/** Headings in document order, ignoring anything inside a code fence. */
export function outlineOf(body: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const lines = body.split("\n");
  let offset = 0;
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fences open and close with the same character, and a closing
    // fence must be at least as long as the one that opened it.
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = marker[0].repeat(marker.length);
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      offset += line.length + 1;
      continue;
    }

    if (fence === null) {
      const h = /^(#{1,6})\s+(\S.*?)\s*#*\s*$/.exec(line);
      if (h) {
        out.push({ level: h[1].length, text: h[2].trim(), line: i, offset });
      }
    }
    offset += line.length + 1;
  }
  return out;
}

/**
 * Roughly where a line sits in the textarea, so a jump can scroll to it.
 * Textareas give no per-line geometry, so this is line * lineHeight -
 * good enough to put the heading near the top of the view, which is
 * what a jump list needs.
 */
export function scrollTopForLine(line: number, lineHeight: number, padding = 2): number {
  return Math.max(0, (line - padding) * lineHeight);
}
