import { useState } from "react";
import { api } from "../api";
import { Button, TextInput } from "./ui";
import { Icon } from "./Icon";
import { LogoMark } from "./Logo";

/**
 * A local PIN gate on the window itself — set up from Settings → Account.
 * Not network auth, not encryption of anything on disk; just "don't let
 * someone who picks this laptop up poke around your servers." Shown by
 * `App.tsx` before anything else renders, once `api.lockStatus()` says
 * one's configured.
 */
export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!pin) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await api.lockCheck(pin);
      if (ok) {
        onUnlocked();
      } else {
        setError("That's not it.");
        setPin("");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-surface px-6">
      <LogoMark size={44} />
      <div className="text-center">
        <h1 className="font-display text-lg font-semibold text-ink">CraftPanel is locked</h1>
        <p className="mt-1 text-xs text-ink-faint">Enter your PIN to continue.</p>
      </div>
      <form
        className="flex w-full max-w-xs flex-col items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextInput
          type="password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="text-center text-base tracking-[0.3em]"
        />
        {error && (
          <p className="flex items-center gap-1 text-2xs text-bad-soft">
            <Icon name="alert" size={11} />
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!pin} className="w-full">
          Unlock
        </Button>
      </form>
      <p className="max-w-xs text-center text-2xs leading-relaxed text-ink-ghost">
        Forgot it? Delete <code>lock.json</code> from CraftPanel's config folder
        to reset — your servers are untouched either way.
      </p>
    </div>
  );
}
