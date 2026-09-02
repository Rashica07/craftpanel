import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ResourcePackConfig } from "../types";
import { Button, Card, Field, StateBlock, TextInput, Toggle, toast } from "./ui";

const EMPTY: ResourcePackConfig = { url: "", sha1: "", prompt: "", required: false };

/**
 * Java-edition resource pack — a URL + SHA-1 pushed to every joining
 * client. CraftPanel doesn't host the pack; you host the .zip somewhere
 * reachable and paste the link, and the app downloads it once just to
 * compute the hash the client needs. Hidden entirely for Bedrock servers
 * by the caller (a different, folder-based system there).
 */
export function ResourcePackSection({
  serverId,
  className,
}: {
  serverId: string;
  className?: string;
}) {
  const [saved, setSaved] = useState<ResourcePackConfig | null>(null);
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getResourcePack(serverId)
      .then((c) => {
        setSaved(c);
        setUrl(c.url);
        setPrompt(c.prompt);
        setRequired(c.required);
      })
      .catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const c = await api.setResourcePack(serverId, url, prompt, required);
      setSaved(c);
      setUrl(c.url);
      toast.ok("Resource pack set — takes effect next start.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await api.clearResourcePack(serverId);
      setSaved(EMPTY);
      setUrl("");
      setPrompt("");
      setRequired(false);
      toast.show("Resource pack cleared");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    saved != null &&
    (url.trim() !== saved.url || prompt.trim() !== saved.prompt || required !== saved.required);

  return (
    <Card
      title="Resource pack"
      icon="image"
      description="A pack every player is offered (or required to accept) on join. You host the .zip — CraftPanel just downloads it once to hash it, then writes the URL + hash into server.properties. Or pick one from Modrinth below."
      className={className}
    >
      {saved === null ? (
        <StateBlock state="loading" title="Reading server.properties…" compact />
      ) : (
        <div className="space-y-3">
          <Field label="Pack URL" hint="A direct link to the .zip — not a page that links to one.">
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mypack.zip"
            />
          </Field>
          <Field label="Prompt (optional)" hint="Shown to players when they're asked to accept it.">
            <TextInput
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="This server uses a custom resource pack"
            />
          </Field>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">
              Require it to join
              <span className="mt-0.5 block text-2xs text-ink-faint">
                Declining the prompt disconnects the player instead of letting them in without it.
              </span>
            </span>
            <Toggle checked={required} onChange={setRequired} />
          </label>

          {saved.sha1 && (
            <p className="font-mono text-2xs text-ink-faint">sha1 {saved.sha1}</p>
          )}

          <div className="flex items-center gap-2 border-t border-line-soft pt-3">
            <Button
              variant="primary"
              size="sm"
              icon="check"
              loading={busy}
              disabled={!url.trim() || (!dirty && !!saved.url)}
              onClick={apply}
            >
              {busy ? "Downloading & hashing…" : dirty ? "Apply" : "Applied"}
            </Button>
            {saved.url && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={clear}>
                Clear
              </Button>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-2xs text-bad-soft">{error}</p>}
    </Card>
  );
}
