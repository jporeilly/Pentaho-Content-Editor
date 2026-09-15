#!/usr/bin/env node
// Bump the editor's version everywhere it is written down.
//
// A sibling of the Content Manager's scripts/bump-version.mjs, which is
// where this started. It did not come across in the 2026-09-15 split, so
// `npm run version:check` and `npm run bump` failed with
// MODULE_NOT_FOUND - the editor had a version and a changelog and no
// working way to move either.
//
// The carriers differ from the app's. There is no Tauri bundle and no
// VERSION.md here; there IS a lockfile, and it counts:
//
//   package.json            "version"
//   package-lock.json       "version" (top level)
//   package-lock.json       packages[""].version
//   CHANGELOG.md            the newest "## [x.y.z]" heading
//
// The lockfile is included deliberately. The app's carries the same two
// keys and nothing was checking them: its lock still read 0.4.41 while
// the project shipped 0.4.46, and the drift only surfaced when an
// unrelated `npm install` quietly corrected it. npm rewrites those keys
// on install, so they drift whenever a version is bumped without one.
//
//   node scripts/bump-version.mjs 1.1.0             bump everything
//   node scripts/bump-version.mjs 1.1.0 --dry-run   show what would change
//   node scripts/bump-version.mjs --check           assert they agree
//
// --check exits non-zero on a mismatch, so CI can hold the line.
//
// Line endings are load-bearing here. This machine has core.autocrlf
// true and the repo has no .gitattributes, so every checked-out file is
// CRLF while npm writes the lockfile LF. Everything below works on
// LF-normalised text and writes back in whatever style the file already
// used - otherwise the lockfile guard can never pass on a Windows
// checkout, and a changelog edit injects LF lines into a CRLF file.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => join(root, ...s);

const PKG = p("package.json");
const LOCK = p("package-lock.json");
const CHANGELOG = p("CHANGELOG.md");

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/** Read a file as LF-normalised text, remembering how it was stored. */
function read(file) {
  const raw = readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  return { text: crlf ? raw.replace(/\r\n/g, "\n") : raw, crlf };
}

/** Write LF text back in the file's original line-ending style. */
function write(file, text, crlf) {
  writeFileSync(file, crlf ? text.replace(/\n/g, "\r\n") : text);
}

/** The version each carrier currently claims. */
function current() {
  const pkg = JSON.parse(read(PKG).text).version;
  const lock = JSON.parse(read(LOCK).text);
  const changelog = /^## \[([0-9]+\.[0-9]+\.[0-9]+)\]/m.exec(read(CHANGELOG).text)?.[1];
  return {
    "package.json": pkg,
    "package-lock.json": lock.version,
    "package-lock.json (root pkg)": lock.packages?.[""]?.version,
    "CHANGELOG.md (latest)": changelog,
  };
}

function check() {
  const c = current();
  const values = Object.values(c);
  const agree = values.every((v) => v && v === values[0]);
  for (const [k, v] of Object.entries(c)) {
    console.log(`  ${v && v === values[0] ? "ok  " : "DIFF"} ${k.padEnd(30)} ${v ?? "(not found)"}`);
  }
  if (!agree) {
    console.error("\nVersions disagree. Run: node scripts/bump-version.mjs <version>");
    process.exit(1);
  }
  console.log(`\nAll in step at ${values[0]}.`);
}

// npm writes the lockfile as 2-space JSON with a trailing newline, so a
// parse/stringify round trip is normally identical and safe. Prove that
// on the file in hand before relying on it: if npm ever changes the
// format, reformatting the whole lockfile during a version bump would
// bury the real change in thousands of lines of noise.
function rewriteLock(text, next) {
  const parsed = JSON.parse(text);
  if (JSON.stringify(parsed, null, 2) + "\n" !== text) {
    throw new Error(
      "package-lock.json is not the 2-space JSON npm writes, so this script will " +
      "not rewrite it - doing so would reformat the whole file. Bump package.json, " +
      "then run `npm install --package-lock-only`.",
    );
  }
  parsed.version = next;
  if (parsed.packages?.[""]) parsed.packages[""].version = next;
  return JSON.stringify(parsed, null, 2) + "\n";
}

function bump(next, dryRun) {
  const today = new Date().toISOString().slice(0, 10);
  const edits = [];

  // package.json - touch only the top-level version key, so formatting
  // and every other field survive untouched.
  //
  // "did the text change?" is NOT a test for "was the key there": bumping
  // to the version a file already holds is a legitimate no-op (it happens
  // whenever one carrier has drifted and the others have not), and
  // treating it as a missing key reported a bewildering "could not find a
  // version key" about a file whose version was staring you in the face.
  {
    const { text, crlf } = read(PKG);
    if (!/("version"\s*:\s*")[0-9]+\.[0-9]+\.[0-9]+(")/.test(text)) {
      throw new Error("Could not find a version key in package.json");
    }
    const after = text.replace(/("version"\s*:\s*")[0-9]+\.[0-9]+\.[0-9]+(")/, `$1${next}$2`);
    if (text !== after) edits.push([PKG, text, after, crlf]);
  }

  // package-lock.json - both version keys, via a proven-safe round trip.
  {
    const { text, crlf } = read(LOCK);
    const after = rewriteLock(text, next);
    if (text !== after) edits.push([LOCK, text, after, crlf]);
  }

  // CHANGELOG - promote Unreleased to a dated heading and open a fresh
  // Unreleased above it. Refuses when Unreleased is empty, so a release
  // cannot be cut with no notes.
  //
  // Skipped entirely when the changelog already has a heading for this
  // version, which is what a drift-repair bump looks like: one carrier
  // fell behind, the changelog did not. Promoting again would leave two
  // "## [x.y.z]" headings and quietly re-date the release.
  {
    const { text, crlf } = read(CHANGELOG);
    const already = new RegExp(`^## \\[${next.replace(/\./g, "\\.")}\\]`, "m").test(text);
    if (!already) {
      const m = /## \[Unreleased\]\s*\n([\s\S]*?)(?=\n## \[)/.exec(text);
      if (!m) throw new Error("Could not find an [Unreleased] section in CHANGELOG.md");
      const body = m[1].trim();
      if (!body || /^nothing yet\.?$/i.test(body)) {
        throw new Error("CHANGELOG [Unreleased] is empty - write the release notes before bumping.");
      }
      const after = text.replace(
        m[0],
        `## [Unreleased]\n\nNothing yet.\n\n## [${next}] - ${today}\n\n${body}\n\n`,
      );
      edits.push([CHANGELOG, text, after, crlf]);
    }
  }

  if (!edits.length) {
    console.log(`  Every carrier already reads ${next}. Nothing to do.`);
    return;
  }

  for (const [file, before, after, crlf] of edits) {
    const rel = file.slice(root.length + 1);
    if (dryRun) {
      const beforeLines = before.split("\n");
      const changed = after.split("\n").filter((l, i) => l !== beforeLines[i]);
      console.log(`  ${rel}`);
      changed.slice(0, 4).forEach((l) => console.log(`      + ${l.trim().slice(0, 80)}`));
    } else {
      write(file, after, crlf);
      console.log(`  updated ${rel}`);
    }
  }
  console.log(dryRun ? `\nDry run - nothing written. Would bump to ${next}.` : `\nBumped to ${next}.`);
}

// A failed bump is a normal outcome (empty release notes, most often),
// not a crash. Print the reason, not a stack trace.
try {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    check();
  } else {
    const next = args.find((a) => SEMVER.test(a));
    if (!next) {
      console.error("Usage: node scripts/bump-version.mjs <x.y.z> [--dry-run]");
      console.error("       node scripts/bump-version.mjs --check");
      process.exit(2);
    }
    bump(next, args.includes("--dry-run"));
  }
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
}
