import { useState } from "react";
import { api } from "../api";
import { Button, Field, TextInput } from "./ui";

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-lg rounded-xl border border-edge bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="text-sm font-semibold">Cloud sync setup (Cloudflare R2)</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">
            ✕
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
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

          <p className="text-[11px] text-ink-faint">
            Stored locally in CraftPanel's config folder. It never leaves your
            machine except to talk to R2.
          </p>

          {error && (
            <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
              {error}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-edge px-5 py-3">
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
