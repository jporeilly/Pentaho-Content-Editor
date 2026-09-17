// The two Rust version carriers, kept apart from bump-version.mjs so
// they can be tested without running the CLI that file ends in.
//
// Not in the Content Manager's shared machinery, because they are not
// shared: that app leaves its crate pinned at 0.1.0 while shipping
// 0.4.5x. Tauri takes the product version from tauri.conf.json, so it
// gets away with it - but a crate version that disagrees with the
// product is a question someone answers twice, and answering it once
// here is cheaper.

/**
 * The [package] version of a Cargo.toml - the FIRST `version = "x.y.z"`
 * in the file, which is the package's own. A dependency's version is
 * always inside a later table, so the first occurrence is enough.
 */
export function setCargoVersion(text, next) {
  const re = /^(version\s*=\s*")[0-9]+\.[0-9]+\.[0-9]+(")$/m;
  if (!re.test(text)) throw new Error("no [package] version in Cargo.toml");
  return text.replace(re, `$1${next}$2`);
}

/** The [package] version a Cargo.toml currently declares. */
export function cargoVersion(text) {
  return /^version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"$/m.exec(text)?.[1];
}

/** The crate whose entry in Cargo.lock is ours. */
export const CRATE = "pentaho-content-editor-desktop";

/**
 * This crate's entry in Cargo.lock, anchored on the NAME.
 *
 * Emphatically not "the first version in the file", the way Cargo.toml
 * is read above: a lock file is several hundred [[package]] blocks and
 * every one carries a version. Taking the first would rewrite whichever
 * dependency sorts earliest - a failure far worse than not bumping at
 * all, because it would be committed, it would build, and it would be
 * wrong. 479 blocks in this one; the bump must touch exactly one line.
 */
const LOCK_ENTRY = new RegExp(
  `(name\\s*=\\s*"${CRATE}"\\n\\s*version\\s*=\\s*")[0-9]+\\.[0-9]+\\.[0-9]+(")`,
);

export function setCargoLockVersion(text, next) {
  if (!LOCK_ENTRY.test(text)) {
    throw new Error(`no [[package]] entry for ${CRATE} in Cargo.lock`);
  }
  return text.replace(LOCK_ENTRY, `$1${next}$2`);
}

/** The version Cargo.lock records for this crate. */
export function cargoLockVersion(text) {
  return LOCK_ENTRY.exec(text)?.[0].match(/"([0-9]+\.[0-9]+\.[0-9]+)"$/)?.[1];
}
