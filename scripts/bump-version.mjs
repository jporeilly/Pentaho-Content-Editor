#!/usr/bin/env node
// Bump the editor's version everywhere it is written down.
//
// The carriers differ from the Content Manager's. There is no Tauri
// bundle and no VERSION.md here; there IS a lockfile, and it counts:
//
//   package.json            "version"
//   package-lock.json       "version" (top level)
//   package-lock.json       packages[""].version
//   CHANGELOG.md            the newest "## [x.y.z]" heading
//
// The lockfile is included deliberately. The app's carries the same two
// keys and for a long time nothing checked them: its lock read 0.4.41
// while the project shipped 0.4.46, and the drift only surfaced when an
// unrelated `npm install` quietly corrected it. npm rewrites those keys
// on install, so they drift whenever a version moves without one.
//
//   node scripts/bump-version.mjs 1.1.0             bump everything
//   node scripts/bump-version.mjs 1.1.0 --dry-run   show what would change
//   node scripts/bump-version.mjs --check           assert they agree
//
// --check exits non-zero on a mismatch, so CI can hold the line.
//
// Through npm, pass arguments after `--`: npm claims --dry-run for
// itself and never forwards it, so `npm run bump 1.1.0 --dry-run`
// performs a REAL bump. Use `npm run bump -- 1.1.0 --dry-run`.
//
// The machinery lives in the Content Manager, at
// scripts/lib/version-carriers.mjs, and is shared with its own bump
// script - line-ending-safe I/O, the lockfile guard, changelog
// promotion, the report, the CLI shell. Only the carrier list above is
// ours. That is the same direction every other dependency here runs: the
// editor resolves the app through PCM_REPO for the renderer, the courses
// and the authoring scripts, and never the other way.

import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => join(root, ...s);
const rel = (f) => f.slice(root.length + 1);

// Same resolution as vite.config.ts and api/core.py: the sibling
// directory unless PCM_REPO says otherwise.
const appRepo = resolve(process.env.PCM_REPO ?? join(root, "..", "Pentaho-Content-Manager"));
const libPath = join(appRepo, "scripts", "lib", "version-carriers.mjs");

if (!existsSync(libPath)) {
  console.error(`\n  Cannot find the Content Manager's version library at:\n    ${libPath}\n`);
  console.error("  The editor shares its release machinery with that app, so install the");
  console.error("  Pentaho Content Manager first, then set PCM_REPO to its root.\n");
  process.exit(1);
}

const {
  readText, writeText,
  setJsonVersion, setLockVersion, lockVersions,
  promoteChangelog, changelogVersion,
  checkCarriers, runVersionCli, describeEdit,
} = await import(pathToFileURL(libPath).href);

const PKG = p("package.json");
const LOCK = p("package-lock.json");
const CHANGELOG = p("CHANGELOG.md");

/** The version each carrier currently claims. */
function current() {
  const lock = lockVersions(readText(LOCK).text);
  return {
    "package.json": JSON.parse(readText(PKG).text).version,
    "package-lock.json": lock.top,
    "package-lock.json (root pkg)": lock.rootPkg,
    "CHANGELOG.md (latest)": changelogVersion(readText(CHANGELOG).text),
  };
}

function check() {
  const { agree, version, lines } = checkCarriers(current());
  lines.forEach((l) => console.log(l));
  if (!agree) {
    console.error("\nVersions disagree. Run: node scripts/bump-version.mjs <version>");
    process.exit(1);
  }
  console.log(`\nAll in step at ${version}.`);
}

function bump(next, dryRun) {
  const today = new Date().toISOString().slice(0, 10);
  const edits = [];
  const stage = (file, text, after, crlf) => {
    if (text !== after) edits.push([file, text, after, crlf]);
  };

  {
    const { text, crlf } = readText(PKG);
    stage(PKG, text, setJsonVersion(text, next, rel(PKG)), crlf);
  }

  {
    const { text, crlf } = readText(LOCK);
    stage(LOCK, text, setLockVersion(text, next), crlf);
  }

  {
    const { text, crlf } = readText(CHANGELOG);
    const after = promoteChangelog(text, next, today);
    if (after) stage(CHANGELOG, text, after, crlf);
  }

  if (!edits.length) {
    console.log(`  Every carrier already reads ${next}. Nothing to do.`);
    return;
  }

  for (const [file, before, after, crlf] of edits) {
    if (dryRun) {
      describeEdit(rel(file), before, after).forEach((l) => console.log(l));
    } else {
      writeText(file, after, crlf);
      console.log(`  updated ${rel(file)}`);
    }
  }
  console.log(dryRun ? `\nDry run - nothing written. Would bump to ${next}.` : `\nBumped to ${next}.`);
}

runVersionCli({ check, bump });
