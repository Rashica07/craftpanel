import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./Icon";

/**
 * A custom title bar, Windows only. The native WebView2 chrome renders a
 * plain white strip with light-mode minimize/maximize/close glyphs that
 * can't be restyled — it never matches a dark app no matter what the page
 * does. `decorations: false` (see `tauri.windows.conf.json`) removes it
 * entirely; this replaces it with one that actually belongs to the app.
 *
 * macOS keeps its native traffic-light decorations — nobody asked for
 * those to change, and a native title bar is the expected feel there.
 */
export function TitleBar() {
  const [isWin, setIsWin] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    setIsWin(document.documentElement.dataset.os === "win");
  }, []);

  useEffect(() => {
    if (!isWin) return;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((f) => (unlisten = f))
      .catch(() => {});
    return () => unlisten?.();
  }, [isWin]);

  if (!isWin) return null;

  const win = getCurrentWindow();

  return (
    <div className="flex h-8 shrink-0 items-center border-b border-line-soft bg-surface text-ink-faint select-none">
      {/*
        The drag region — and ONLY the drag region — lives on this empty
        spacer, not on a wrapper around the caption buttons below. Tauri's
        drag-region listener grabs the mousedown on anything inside an
        element carrying the attribute, including descendants, which was
        swallowing clicks on the buttons before they ever registered
        (the reported "buttons don't work" bug). No logo/wordmark here
        either — the sidebar already shows the CraftPanel branding right
        below this bar; repeating it here just doubled it up.
      */}
      <div
        data-tauri-drag-region
        onDoubleClick={() => win.toggleMaximize()}
        className="h-full flex-1"
      />
      <div className="flex h-full shrink-0 items-stretch">
        <CaptionButton title="Minimize" onClick={() => win.minimize()}>
          <Icon name="minus" size={12} />
        </CaptionButton>
        <CaptionButton
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => win.toggleMaximize()}
        >
          {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
        </CaptionButton>
        <CaptionButton title="Close" danger onClick={() => win.close()}>
          <Icon name="x" size={12} />
        </CaptionButton>
      </div>
    </div>
  );
}

function CaptionButton({
  title,
  danger,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={
        "flex w-11 items-center justify-center text-ink-faint transition-colors duration-100 " +
        (danger ? "hover:bg-[#e81123] hover:text-white" : "hover:bg-surface-3 hover:text-ink")
      }
    >
      {children}
    </button>
  );
}

function MaximizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" />
    </svg>
  );
}

function RestoreGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor" />
      <path d="M0.5 2.5V9.5H7.5" stroke="currentColor" fill="none" />
      <rect x="0.5" y="2.5" width="7" height="7" fill="var(--cp-surface)" stroke="currentColor" />
    </svg>
  );
}
