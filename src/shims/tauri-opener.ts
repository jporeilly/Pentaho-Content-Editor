// Browser shim for @tauri-apps/plugin-opener, aliased in
// vite.config.ts. The editor preview reuses the app's real
// MarkdownBody Engine, which calls openUrl() on external-link clicks —
// outside Tauri we just open a new browser tab.
export async function openUrl(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openPath(path: string): Promise<void> {
  window.open(path, "_blank", "noopener,noreferrer");
}
