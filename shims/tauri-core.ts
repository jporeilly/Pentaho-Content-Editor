// Browser shim for @tauri-apps/api/core, aliased in
// vite.author.config.ts. LauncherButton (pulled in by MarkdownBody)
// imports `invoke` at module load and calls it when a learner clicks a
// launch/graph button. In the editor preview there is no Rust backend,
// so invoke is inert — buttons render, but clicking them is a no-op the
// author is told about rather than a hard crash.
export async function invoke<T = unknown>(cmd: string): Promise<T> {
  console.info(`[editor preview] invoke("${cmd}") is inert outside the app.`);
  // Return a benign shape; callers only read fields on success paths and
  // guard failures.
  return undefined as unknown as T;
}

export function convertFileSrc(filePath: string): string {
  return filePath;
}
