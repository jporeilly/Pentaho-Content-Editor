// Browser shim for @tauri-apps/api/window, aliased in
// vite.config.ts. Some renderer components reference the current
// window (drag regions, etc.); in the editor those behaviours are inert.
export function getCurrentWindow() {
  return {
    async setAlwaysOnTop() {},
    async startDragging() {},
    async minimize() {},
    async close() {},
    async isMaximized() { return false; },
    listen: async () => () => {},
  };
}
