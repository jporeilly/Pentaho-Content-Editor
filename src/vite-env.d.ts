/// <reference types="vite/client" />

/** Injected by vite.config.ts from this project's package.json - the
 *  EDITOR's version, not the learner app's. */
declare const __APP_VERSION__: string;

/** Injected by vite.config.ts from the Content Manager's package.json -
 *  the version of the Engine the preview is drawn with. Bundled at
 *  BUILD time, so an installed editor can be carrying an older one than
 *  the checkout it is editing. */
declare const __PCM_VERSION__: string;
