import { useState, type ReactNode } from "react";
import { humanizeError } from "../data/humanizeError";
import { Banner, Button } from "./ui";
import { JavaInstallFix } from "./JavaInstallFix";

/**
 * The one place every panel's `catch (e) { setError(String(e)) }` should
 * render through. Leads with a plain-English headline (see humanizeError.ts
 * for how that's decided), offers a concrete next step when there is one,
 * and — only when the underlying text actually looks technical — tucks the
 * original error behind a "Show technical details" toggle instead of either
 * hiding it or leading with it.
 *
 * When the error is specifically "no Java" and the caller passes `serverId`
 * (only `ServerDetail`'s top-level error banner does — that's the one that
 * actually reflects a failed start), this renders a real inline fix: install
 * a matching Temurin runtime and point the server at it. Everywhere else it
 * behaves exactly as before.
 *
 * Drop-in replacement for the old `<Banner tone="bad" onDismiss={...}>{error}</Banner>`
 * pattern used across the app.
 */
export function ErrorBanner({
  message,
  onDismiss,
  onRetry,
  actions,
  serverId,
  mcVersion,
  className = "",
}: {
  message: string | null | undefined;
  onDismiss?: () => void;
  onRetry?: () => void;
  /** overrides the default "Try again" button — for a more specific fix */
  actions?: ReactNode;
  /** enables the inline "Install Java" fix when the error is Java-shaped */
  serverId?: string;
  mcVersion?: string | null;
  className?: string;
}) {
  const [showDetail, setShowDetail] = useState(false);
  if (!message) return null;

  const f = humanizeError(message);
  const showToggle = f.technical && f.detail && f.detail !== f.title;

  return (
    <Banner
      tone="bad"
      icon={f.icon}
      title={f.title}
      onDismiss={onDismiss}
      className={className}
      actions={
        actions ??
        (onRetry ? (
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined)
      }
    >
      {f.hint && <p className="opacity-90">{f.hint}</p>}
      {f.id === "java" && serverId && (
        <JavaInstallFix serverId={serverId} mcVersion={mcVersion ?? null} />
      )}
      {showToggle && (
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="mt-1 text-2xs text-bad-soft/70 underline-offset-2 hover:text-bad-soft hover:underline"
        >
          {showDetail ? "Hide" : "Show"} technical details
        </button>
      )}
      {showToggle && showDetail && (
        <pre
          data-selectable
          className="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-black/25 px-2 py-1.5 font-mono text-2xs text-bad-soft/90"
        >
          {f.detail}
        </pre>
      )}
    </Banner>
  );
}
