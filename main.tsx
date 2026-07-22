// Editor entrypoint — a standalone Vite app (npm run author) separate
// from the learner-facing Tauri app. It reuses the app's renderer
// components and stylesheet so the preview matches production.
import "highlight.js/styles/github.css";
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";

// The app's own stylesheet — the preview relies on its `pcm-` classes.
import "../styles/fonts.css";
import "../styles/app.css";
// Editor chrome on top.
import "./author.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found in index.html");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
