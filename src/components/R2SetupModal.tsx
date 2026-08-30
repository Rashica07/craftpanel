import { useState } from "react";
import { api } from "../api";
import { Button, Field, IconButton, TextInput, useDismissOnEscape } from "./ui";

export function R2SetupModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [bucket, setBucket] = useState("craftpanel-sync");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.r2ConfigSet({
        accountId: accountId.trim(),
        bucket: bucket.trim(),
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
      });
      onSaved();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const ready = accountId.trim() && bucket.trim() && accessKeyId.trim() && secretAccessKey.trim();


  useDismissOnEscape(busy ? undefined : onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" className="cp-pop flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-e3">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          <h2 className="font-display text-base font-semibold text-ink">Cloud sync setup (Cloudflare R2)</h2>
          <IconButton icon="x" title="Close" size="sm" onClick={onClose} />
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-xs text-ink-dim">
            One-time setup. In the{" "}
            <a
              href="https://dash.cloudflare.com/?to=/:account/r2/api-tokens"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              Cloudflare dashboard
            </a>{" "}
            → R2 → <b>Manage API Tokens</b> → <b>Create API Token</b> with
            "Object Read &amp; Write" scoped to your bucket. It shows the Access
            Key ID, Secret Access Key, and your account id once.
          </p>

          <Field label="Account ID" hint="the part before .r2.cloudflarestorage.com">
            <TextInput value={accountId} onChange={(e) => setAccountId(e.target.value)} />
          </Field>
          <Field label="Bucket name">
            <TextInput value={bucket} onChange={(e) => setBucket(e.target.value)} />
          </Field>
          <Field label="Access Key ID">
            <TextInput value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
          </Field>
          <Field label="Secret Access Key">
            <TextInput
              type="password"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
            />
          </Field>

          <p className="text-2xs text-ink-faint">
            Stored locally in CraftPanel's config folder. It never leaves your
            machine except to talk to R2.
          </p>

          {error && (
            <div className="rounded-md border border-bad/30 bg-bad-muted px-3 py-2 text-xs text-bad-soft">
              {error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-line-soft bg-surface-2/60 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !ready}>
            {busy ? "Checking…" : "Save & verify"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
