#!/usr/bin/env node
// Stage a pruned Content Manager tree for a SEEDED installer.
//
//   node desktop/scripts/stage-seed.mjs                       # every course
//   node desktop/scripts/stage-seed.mjs --courses a,b         # a subset
//   node desktop/scripts/stage-seed.mjs --pcm D:\Projects\Pentaho-Content-Manager
//
// Writes src-tauri/vendor/seed/, which tauri.seeded.conf.json maps to
// <install>/seed. On first run the editor lays it out under the author's
// own state directory (api/seed.py) and edits THAT copy, so a clean
// laptop needs no checkout, no git clone, no npm and no first-run screen.
//
// Why Node and not PowerShell like its neighbours: this has to walk
// imports, resolve packages and hash files, and it is the one staging
// step with real logic in it. In Node it runs under pytest on any OS
// (api/test_stage_seed.py); in PowerShell it could only be tried on the
// machine that builds.
//
// What the editor needs from a checkout, and so what is staged
//
//   courses/<id>/...     only files git TRACKS in the checkout. The
//                        distribution repo is public, and an installer is
//                        a second way for an ignored .env to leave the
//                        building. Outside git, a conservative skip list.
//   scripts/, src/       not a hand-kept list: the four scripts the editor
//                        runs are walked for their imports, so a new
//                        import upstream is staged without anyone
//                        remembering to say so. (The TypeScript modules
//                        verify-course.mjs imports are the reason src/ is
//                        here at all.)
//   node_modules/        the closure of the bare packages those files
//                        import - lowlight and what it needs, a few MB -
//                        NOT the checkout's whole tree. Node resolves
//                        them upward from scripts/, so they have to sit
//                        under the seed root.
//   package.json,.nvmrc  "type": "module" decides how Node reads the .ts.
//
// Refuses to run without `npm install` having been done in the checkout:
// the packages come from there.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..");
const repoRoot = resolve(desktopDir, "..");

// The scripts the editor shells out to (api/routers/*.py). Their imports
// are followed; everything else in scripts/ stays behind.
const ENTRY_SCRIPTS = ["new-course.mjs", "new-lab.mjs", "stamp-manifests.mjs", "verify-course.mjs"];
// Read at run time rather than imported, so the walk cannot see them.
const DATA_DIRS = ["scripts/templates"];
const ROOT_FILES = ["package.json", ".nvmrc"];

function fail(message) {
  console.error(`\n  stage-seed: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { pcm: null, courses: null, out: null, check: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i] ?? fail(`${arg} needs a value`);
    if (arg === "--pcm") opts.pcm = value();
    else if (arg === "--courses") opts.courses = value().split(",").map((c) => c.trim()).filter(Boolean);
    else if (arg === "--out") opts.out = value();
    else if (arg === "--no-check") opts.check = false;
    else fail(`unknown argument ${arg}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
// `npm run dist:seeded` chains several scripts and cannot pass a flag to
// this one, so the subset can also come from the environment.
if (!opts.courses && process.env.PCE_SEED_COURSES) {
  opts.courses = process.env.PCE_SEED_COURSES.split(",").map((c) => c.trim()).filter(Boolean);
}
const pcm = resolve(opts.pcm ?? process.env.PCM_REPO ?? join(repoRoot, "..", "Pentaho-Content-Manager"));
const out = resolve(opts.out ?? join(desktopDir, "src-tauri", "vendor", "seed"));
const seedRoot = join(out, "pcm");

// ── Preconditions ───────────────────────────────────────────────────

if (!existsSync(join(pcm, "courses"))) {
  fail(`no courses/ in ${pcm}. Point --pcm (or PCM_REPO) at a Pentaho-Content-Manager checkout.`);
}
for (const entry of ENTRY_SCRIPTS) {
  if (!existsSync(join(pcm, "scripts", entry))) fail(`${pcm} has no scripts/${entry}.`);
}
if (!existsSync(join(pcm, "node_modules", "lowlight", "package.json"))) {
  fail(`${pcm} has no node_modules/lowlight. Run "npm install" there first: verify-course.mjs imports it,\n  and the seed carries the packages from that folder.`);
}
// rmSync below is recursive. Never aim it at, or around, the checkout.
const inside = (a, b) => a === b || a.startsWith(b + sep);
if (inside(pcm, out) || inside(out, pcm)) fail(`--out (${out}) and the checkout (${pcm}) must not contain each other.`);
if (existsSync(out) && readdirSync(out).length > 0 && !existsSync(join(out, "manifest.json"))) {
  fail(`${out} exists and is not a seed directory (no manifest.json) - not deleting it.`);
}

// ── Which courses ───────────────────────────────────────────────────

const allCourses = readdirSync(join(pcm, "courses"))
  .filter((n) => !n.startsWith("_") && existsSync(join(pcm, "courses", n, "course.json")))
  .sort();
const courses = opts.courses ?? allCourses;
for (const c of courses) {
  if (!allCourses.includes(c)) fail(`no course "${c}" in ${join(pcm, "courses")}. Have: ${allCourses.join(", ")}`);
}
if (courses.length === 0) fail("no courses to stage.");

// ── Helpers ─────────────────────────────────────────────────────────

const hash = createHash("sha1");
let fileCount = 0;
let byteCount = 0;

function copyFile(from, to, { hashed = false } = {}) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  fileCount++;
  byteCount += statSync(to).size;
  if (hashed) hash.update(relative(seedRoot, to).replaceAll("\\", "/")).update(readFileSync(to));
}

function walk(dir, skip = () => false) {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink() || skip(name, st)) continue;
    if (st.isDirectory()) found.push(...walk(full, skip));
    else if (st.isFile()) found.push(full);
  }
  return found;
}

/** Files git tracks under `rel`, or null when `pcm` is not a git checkout. */
function trackedFiles(rel) {
  try {
    const raw = execFileSync("git", ["-C", pcm, "ls-files", "-z", "--", rel], {
      maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"],
    });
    return raw.toString("utf8").split("\0").filter(Boolean).map((p) => join(pcm, ...p.split("/")));
  } catch {
    return null;
  }
}

// Only used outside git, where "tracked" is not a question that can be
// asked. Deliberately small: it exists to keep the obvious secrets out.
const UNTRACKED_SKIP = (name) =>
  name === ".git" || name === "node_modules" || name === "__pycache__" ||
  name === ".DS_Store" || name === "Thumbs.db" ||
  /\.(pem|key)$/i.test(name) ||
  (/^\.env(\.|$)/.test(name) && !/^\.env\.(template|example)$/.test(name));

/** Relative specifiers and bare package names a source file imports. */
function importsOf(file) {
  const text = readFileSync(file, "utf8");
  const found = new Set();
  const re = /(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of text.matchAll(re)) found.add(m[1] ?? m[2] ?? m[3]);
  return [...found];
}

/** "highlight.js/lib/languages/dos" -> "highlight.js"; "@a/b/c" -> "@a/b". */
function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** The directory holding `name`, searching upward from `from` as Node does. */
function resolvePackage(name, from) {
  for (let dir = from; inside(dir, pcm); dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dir === pcm) break;
  }
  return null;
}

// ── Stage ───────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(seedRoot, { recursive: true });

console.log(`\n  Staging the seed from ${pcm}`);

// 1. Tooling: walk the imports of the scripts the editor runs.
const seen = new Set();
const packages = new Set();
const queue = ENTRY_SCRIPTS.map((s) => join(pcm, "scripts", s));
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  for (const spec of importsOf(file)) {
    if (spec.startsWith("node:")) continue;
    if (spec.startsWith(".")) {
      const target = resolve(dirname(file), spec);
      if (!inside(target, pcm) || !existsSync(target)) {
        fail(`${relative(pcm, file)} imports "${spec}", which is not a file in the checkout.`);
      }
      queue.push(target);
    } else {
      packages.add(packageName(spec));
    }
  }
}
for (const file of [...seen].sort()) copyFile(file, join(seedRoot, relative(pcm, file)), { hashed: true });

for (const dir of DATA_DIRS) {
  if (!existsSync(join(pcm, dir))) fail(`${pcm} has no ${dir}.`);
  for (const file of walk(join(pcm, dir))) copyFile(file, join(seedRoot, relative(pcm, file)), { hashed: true });
}
for (const name of ROOT_FILES) {
  if (existsSync(join(pcm, name))) copyFile(join(pcm, name), join(seedRoot, name), { hashed: true });
}

// 2. node_modules: the closure of the bare packages above.
const staged = new Map();
const pending = [...packages].map((name) => ({ name, from: pcm }));
while (pending.length) {
  const { name, from } = pending.pop();
  const dir = resolvePackage(name, from);
  if (!dir) fail(`cannot resolve package "${name}" from ${from}. Run "npm install" in the checkout.`);
  if (staged.has(dir)) continue;
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  staged.set(dir, `${meta.name}@${meta.version}`);
  for (const dep of Object.keys(meta.dependencies ?? {})) pending.push({ name: dep, from: dir });
}
for (const [dir, id] of [...staged].sort((a, b) => a[1].localeCompare(b[1]))) {
  hash.update(id);
  // A package's own nested node_modules is staged only if something
  // resolved into it, which the loop above has already done.
  for (const file of walk(dir, (n) => n === "node_modules")) {
    copyFile(file, join(seedRoot, relative(pcm, file)));
  }
}

// 3. Courses.
const courseSummary = [];
for (const id of courses) {
  const rel = `courses/${id}`;
  let files = trackedFiles(rel);
  if (files === null) {
    console.log(`  [!]  ${pcm} is not a git checkout: ${id} staged by skip list, not by what git tracks`);
    files = walk(join(pcm, rel), UNTRACKED_SKIP);
  } else if (files.length === 0) {
    fail(`git tracks no files under ${rel}. Commit the course, or pass --pcm a copy that is not a repository.`);
  }
  for (const file of files) copyFile(file, join(seedRoot, relative(pcm, file)));
  courseSummary.push({ id, files: files.length });
}

// 4. Manifest. `id` changes when tooling does, and only then: that is
//    what tells the editor to replace scripts/ and node_modules/ without
//    touching a course the author has been editing.
let commit = null;
try {
  commit = execFileSync("git", ["-C", pcm, "rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch { /* not a repository */ }
const pcmVersion = JSON.parse(readFileSync(join(pcm, "package.json"), "utf8")).version ?? null;
writeFileSync(
  join(out, "manifest.json"),
  JSON.stringify({
    schema: 1,
    id: hash.digest("hex").slice(0, 16),
    builtAt: new Date().toISOString(),
    pcmVersion,
    pcmCommit: commit,
    courses: courseSummary,
    packages: [...staged.values()].sort(),
  }, null, 2) + "\n",
);

// 5. Prove the staged tree runs, with the same kind of check stage-app
//    does for the backend: file existence cannot catch a module left out.
if (opts.check) {
  const run = (args) => spawnSync(process.execPath, args, { cwd: seedRoot, encoding: "utf8" });
  const broken = /ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|ERR_PACKAGE_PATH_NOT_EXPORTED|Cannot find (module|package)/;
  const probes = [
    ["a scripts import", ["--input-type=module", "-e",
      "await import('./scripts/lib/course-authoring.mjs'); await import('./src/content/courseTracks.ts');"]],
    ["verify-course.mjs", ["scripts/verify-course.mjs", courses[0]]],
  ];
  for (const [label, args] of probes) {
    const res = run(args);
    const text = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    if (res.error || broken.test(text)) {
      console.error(text.trim().split("\n").slice(-8).join("\n"));
      fail(`the staged tree cannot run ${label} - something it imports was left out.`);
    }
  }
  console.log("  [ok] the staged tree runs the authoring scripts");
}

const mb = (byteCount / 1048576).toFixed(1);
console.log(`  [ok] staged ${courses.length} course(s), ${staged.size} package(s), ${fileCount} file(s), ${mb} MB`);
console.log(`       -> ${out}\n`);
