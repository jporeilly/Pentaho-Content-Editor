// The tabs in a guide, and the anchors that link to them.
//
// A `### Title` inside a `::: tabs` block is a TAB, not a heading: the
// Engine renders it as a button and it never gets a heading's anchor. It
// does now carry one derived from its title, so a guide can say
// `[see Troubleshooting](#tab-troubleshooting)` - and this is the half
// that lets the editor offer the link rather than making an author guess
// the slug and find out at review time whether they guessed right.
//
// The slug rule is the Engine's `tabAnchorIds`, which it has to be: two
// implementations of one slug is the bug this project keeps finding
// (four copies of countSteps, two of detectHasVideo). One file cannot
// import across the two repositories, so the rule is mirrored here and
// pinned on both sides against the same cases.

export interface TabRef {
  /** The tab's title, as written. */
  title: string;
  /** The anchor the Engine gives it: `tab-troubleshooting`. */
  slug: string;
  /** 1-based source line, so the editor can jump there too. */
  line: number;
}

/** The Engine's tabStepId, mirrored. */
function slugify(title: string): string {
  return `tab-${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "tab"
  }`;
}

/**
 * Every tab in the body, in document order, with the anchor that reaches
 * it.
 *
 * Duplicate titles get `-2`, `-3` the way duplicate headings do. The
 * Engine dedupes WITHIN a widget; this dedupes across the guide, which
 * is a deliberate difference: two widgets each holding a "Windows" tab
 * both render `#tab-windows`, and a link can only reach the first. The
 * editor numbering them makes the collision visible in the menu instead
 * of producing two identical entries that go to the same place.
 */
export function tabsInBody(body: string): TabRef[] {
  const out: TabRef[] = [];
  const seen = new Map<string, number>();
  const open: number[] = [];
  let fenced = false;

  body.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;

    const run = line.match(/^\s*(:{3,})\s*(\S*)/);
    if (run) {
      const width = run[1].length;
      if (run[2]) {
        open.push(/^tabs/i.test(run[2]) ? width : -width);
      } else {
        const at = open.map(Math.abs).lastIndexOf(width);
        if (at !== -1) open.splice(at, 1);
      }
      return;
    }

    if (!open.some((w) => w > 0)) return;
    const m = line.match(/^###\s+(.+?)\s*$/);
    if (!m) return;

    const title = m[1].trim();
    const base = slugify(title);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ title, slug: n === 1 ? base : `${base}-${n}`, line: i + 1 });
  });

  return out;
}

/** The markdown a link to `tab` is written as. */
export function tabLink(tab: TabRef): string {
  return `[${tab.title}](#${tab.slug})`;
}

/**
 * A nav BUTTON to the same place.
 *
 * An anchor wearing `pcm-btn`, not a `<button>`: the Engine only wires
 * buttons carrying `data-launch` or `data-graph`, so a bare `<button>`
 * in a guide renders and does nothing at all - the trap an author falls
 * into writing one by hand. As a link it also keeps the in-page hash
 * behaviour, keyboard focus and middle-click.
 */
export function navButton(label: string, anchor: string): string {
  return `<a class="pcm-btn" href="#${anchor}">${label}</a>`;
}

// A heading's anchor is NOT mirrored here. `headingAnchorId` is imported
// from the Engine through @app by whoever needs it - the rule has three
// copies in that repository already, and countSteps taught this project
// what a fourth copy of a rule is worth.
