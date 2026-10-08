// What Publish says about the gitignored files it left behind.
//
// Pentaho-Courses is public, so Publish skips whatever the Content
// Manager's .gitignore keeps out of git (a workshop's .env, a
// kettle.properties) unless the file is already in the distribution repo
// (api/routers/publish.py `_publishable`). Skipping silently would make a
// file the author meant to ship simply never arrive, so both places that
// publish - the header's one-button flow and the Course modal - say it.

/** The sentence naming the skipped files, or "" when there are none. */
export function skippedIgnoredNote(paths: string[] | undefined, max = 3): string {
  if (!paths?.length) return "";
  const shown = paths.slice(0, max).join(", ");
  const more = paths.length > max ? ` and ${paths.length - max} more` : "";
  const files = paths.length === 1 ? "1 gitignored file" : `${paths.length} gitignored files`;
  return `${files} not published: ${shown}${more}`;
}
