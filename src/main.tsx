import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TitleBar } from "./components/TitleBar";
import "./index.css";

/**
 * Stamp the platform on <html> before first paint so the token layer can pick
 * the right radii / font stack / shadow weight (see index.css :root[data-os]).
 * This is what makes the same build feel like a Mac app on macOS and a Fluent
 * app on Windows without maintaining two frontends.
 */
function detectOs(): "mac" | "win" | "other" {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad/.test(ua)) return "mac";
  if (/Win/.test(ua)) return "win";
  return "other";
}

const root = document.documentElement;
root.dataset.os = detectOs();
// dark-first; a light swap is one attribute away once there's a UI for it
root.dataset.theme = "dark";

/**
 * WebView2/WKWebView's default right-click menu ("Back", "Reload",
 * "Inspect Element"…) is a browser menu, not an app one — it doesn't
 * belong here. Left on for genuinely editable text (inputs, textareas,
 * contenteditable, anything explicitly marked selectable) since Cut/Copy/
 * Paste there is real functionality, not chrome.
 */
document.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement;
  const editable =
    el.closest("input, textarea, [contenteditable], [data-selectable]") !== null;
  if (!editable) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="min-h-0 flex-1">
        <App />
      </div>
    </div>
  </React.StrictMode>,
);
