import { useState } from "react";
import { api } from "../api";
import {
  SERVER_TYPE_META,
  type DetectionResult,
  type ServerType,
  type ServerRecord,
} from "../types";
import { Badge, Button, Field, TextInput } from "./ui";

const ALL_TYPES: ServerType[] = ["fabric", "forge", "paper", "spigot", "vanilla"];

export function AddServerModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (s: ServerRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);

  // editable confirm-step fields
  const [name, setName] = useState("");
  const [type, setType] = useState<ServerType>("vanilla");
  const [launchTarget, setLaunchTarget] = useState("");
  const [mcVersion, setMcVersion] = useState("");
  const [javaPath, setJavaPath] = useState("java");
  const [ram, setRam] = useState(2048);

  async function pickAndDetect() {
    setError(null);
    const folder = await api.pickFolder();
    if (!folder) return;
    setBusy(true);
    try {
      const result = await api.detectServer(folder);
      setDetection(result);
      const base = folder.split(/[\\/]/).filter(Boolean).pop() ?? "My Server";
      setName(base);
      if (result.server_type) setType(result.server_type);
      if (result.launch_target) setLaunchTarget(result.launch_target);
      if (result.mc_version) setMcVersion(result.mc_version);
      if (result.java?.path) setJavaPath(result.java.path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!detection) return;
    setBusy(true);
    setError(null);
    try {
      const rec = await api.addServer({
        name: name.trim() || "My Server",
        path: detection.path,
        server_type: type,
        launch_target: launchTarget.trim(),
        mc_version: mcVersion.trim() || null,
        java_path: javaPath.trim() || "java",
        ram_mb: ram,
      });
      onAdded(rec);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-xl rounded-xl border border-edge bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="text-sm font-semibold">Add a server</h2>
          <button
            onClick={onClose}
            className="text-ink-faint hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {!detection ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <p className="max-w-sm text-sm text-ink-dim">
                Point CraftPanel at a folder that contains a Minecraft server.
                It'll figure out the type and check your Java version.
              </p>
              <Button variant="primary" onClick={pickAndDetect} disabled={busy}>
                {busy ? "Scanning…" : "Choose folder…"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-edge bg-panel-2 p-3">
                <div className="flex items-center gap-2">
                  {detection.detected ? (
                    <Badge tone="accent">
                      Detected: {detection.server_type_label}
                    </Badge>
                  ) : (
                    <Badge tone="warn">Nothing detected — set it manually</Badge>
                  )}
                  {detection.mc_version && (
                    <Badge tone="neutral">MC {detection.mc_version}</Badge>
                  )}
                  {detection.java && (
                    <Badge tone="neutral">
                      Java {detection.java.major}
                      {detection.java.is_64bit ? " (64-bit)" : ""}
                    </Badge>
                  )}
                </div>
                <div className="mt-2 truncate font-mono text-xs text-ink-faint">
                  {detection.path}
                </div>
                {detection.evidence.length > 0 && (
                  <div className="mt-1 text-xs text-ink-faint">
                    matched: {detection.evidence.join(", ")}
                  </div>
                )}
              </div>

              {detection.warnings.map((w, i) => (
                <div
                  key={i}
                  className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn"
                >
                  {w}
                </div>
              ))}

              <Field label="Display name">
                <TextInput value={name} onChange={(e) => setName(e.target.value)} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Server type">
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as ServerType)}
                    className="w-full rounded-md border border-edge bg-panel-2 px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
                  >
                    {ALL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {SERVER_TYPE_META[t].label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Minecraft version" hint="optional, helps Java checks">
                  <TextInput
                    value={mcVersion}
                    placeholder="1.20.4"
                    onChange={(e) => setMcVersion(e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Launch target" hint="jar or run script, relative to the folder">
                <TextInput
                  value={launchTarget}
                  placeholder="server.jar"
                  onChange={(e) => setLaunchTarget(e.target.value)}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Java path">
                  <TextInput
                    value={javaPath}
                    onChange={(e) => setJavaPath(e.target.value)}
                  />
                </Field>
                <Field label="RAM (MB)" hint="-Xms and -Xmx set equal">
                  <TextInput
                    type="number"
                    min={512}
                    step={512}
                    value={ram}
                    onChange={(e) => setRam(Number(e.target.value) || 2048)}
                  />
                </Field>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-edge px-5 py-3">
          <div>
            {detection && (
              <Button
                variant="subtle"
                onClick={() => {
                  setDetection(null);
                  setError(null);
                }}
                disabled={busy}
              >
                ← Pick another folder
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {detection && (
              <Button
                variant="primary"
                onClick={save}
                disabled={busy || !launchTarget.trim()}
              >
                {busy ? "Saving…" : "Add server"}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
