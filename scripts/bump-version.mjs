#!/usr/bin/env node
// Bump the editor's version everywhere it is written down.
//
// The carriers differ from the Content Manager's. There is no Tauri
// bundle and no VERSION.md here; there IS a lockfile, and it counts:
//
//   package.json                        "version"
//   package-lock.json                   "version" (top level)
//   package-lock.json                   packages[""].version
//   CHANGELOG.md                        the newest "## [x.y.z]" heading
//   desktop/package.json                "version"
//   desktop/src-tauri/tauri.conf.json   "version"
//   desktop/src-tauri/Cargo.toml        [package] version
//   desktop/src-tauri/Cargo.lock        this crate's [[package]] version
//
// The last two arrived with the Windows installer. They are what the
// SHIPPED artifact claims: tauri.conf.json's version names the setup
// exe, fills Add/Remove Programs, and is what the shell's splash and
// startup report print. An installer that says 1.5.0 while the app says
// 1.6.0 is a support question nobody can answer.
//
// The lockfile is included deliberately. The app's carries the same two
// keys and for a long time nothing checked them: its lock read 0.4.41
// while the project shipped 0.4.46, and the drift only surfaced when an
// unrelated `npm install` quietly corrected it. npm rewrites those keys
// on install, so they drift whenever a version moves without one.
//
// Cargo.lock is the eighth and arrived the same way. cargo rewrites this
// crate's version entry whenever it builds, so a release committed
// BEFORE the build left the lock one version behind - 1.13.1 sitting
// beside a Cargo.toml reading 1.14.0. It self-heals on the next build,
// which is exactly what makes it easy to miss, and "a version written
// down in a file that disagrees with the others" is the thing this
// script exists to make impossible. Bumping it here means the tree is
// consistent at commit time rather than at build time.
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
const DESKTOP_PKG = p("desktop", "package.json");
const TAURI_CONF = p("desktop", "src-tauri", "tauri.conf.json");
const CARGO_TOML = p("desktop", "src-tauri", "Cargo.toml");
const CARGO_LOCK = p("desktop", "src-tauri", "Cargo.lock");

// The Rust carriers live in their own module so they can be tested
// without importing this file, which ends by running the CLI.
const {
  setCargoVersion, cargoVersion, setCargoLockVersion, cargoLockVersion,
} = await import(pathToFileURL(p("scripts", "lib", "cargo-version.mjs")).href);

/** The version each carrier currently claims. */
function current() {
  const lock = lockVersions(readText(LOCK).text);
  return {
    "package.json": JSON.parse(readText(PKG).text).version,
    "package-lock.json": lock.top,
    "package-lock.json (root pkg)": lock.rootPkg,
    "CHANGELOG.md (latest)": changelogVersion(readText(CHANGELOG).text),
    "desktop/package.json": JSON.parse(readText(DESKTOP_PKG).text).version,
    "desktop tauri.conf.json": JSON.parse(readText(TAURI_CONF).text).version,
    "desktop Cargo.toml": cargoVersion(readText(CARGO_TOML).text),
    "desktop Cargo.lock": cargoLockVersion(readText(CARGO_LOCK).text),
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

  // The desktop shell. setJsonVersion touches the top-level key alone,
  // which is what both of these need: tauri.conf.json carries other
  // versions (the schema URL) that must not move.
  for (const file of [DESKTOP_PKG, TAURI_CONF]) {
    const { text, crlf } = readText(file);
    stage(file, text, setJsonVersion(text, next, rel(file)), crlf);
  }

  {
    const { text, crlf } = readText(CARGO_TOML);
    stage(CARGO_TOML, text, setCargoVersion(text, next), crlf);
  }

  {
    const { text, crlf } = readText(CARGO_LOCK);
    stage(CARGO_LOCK, text, setCargoLockVersion(text, next), crlf);
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
