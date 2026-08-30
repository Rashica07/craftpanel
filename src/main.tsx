import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
