import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { PluginConfigField, PluginConfigView } from "../types";
import { Button, Card, Select, SettingRow, TextInput, Toggle, Tooltip, toast } from "./ui";
import { ErrorBanner } from "./ErrorBanner";
import { Icon } from "./Icon";

/**
 * Real toggles/sliders for the handful of EssentialsX/LuckPerms/Geyser
 * settings CraftPanel knows about, instead of hand-editing YAML for them —
 * see `pluginconfig.rs` for exactly which keys and why only these ones.
 * Only renders anything for plugins actually detected in this server's
 * folder; renders nothing at all if none of the three are installed.
 */
export function PluginConfigSection({ serverId }: { serverId: string }) {
  const [views, setViews] = useState<PluginConfigView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .pluginConfigViews(serverId)
      .then((v) => {
        setViews(v);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setViews(null);
    load();
  }, [load]);

  if (error) return <ErrorBanner message={error} onRetry={load} className="mt-2" />;
  if (!views || views.length === 0) return null;

  return (
    <>
      {views.map((v) => (
        <PluginCard key={v.plugin} serverId={serverId} view={v} onSaved={load} />
      ))}
    </>
  );
}

function PluginCard({
  serverId,
  view,
  onSaved,
}: {
  serverId: string;
  view: PluginConfigView;
  onSaved: () => void;
}) {
  return (
    <Card
      title={view.name}
      icon="sliders"
      description={`Detected at ${view.file} — a few common settings, visually. Everything else is still just a file, editable in Files.`}
      pad={false}
    >
      <div className="divide-y divide-line-soft">
        {view.fields.map((f) => (
          <FieldRow key={f.key} serverId={serverId} plugin={view.plugin} field={f} onSaved={onSaved} />
        ))}
      </div>
    </Card>
  );
}

function FieldRow({
  serverId,
  plugin,
  field,
  onSaved,
}: {
  serverId: string;
  plugin: string;
  field: PluginConfigField;
  onSaved: () => void;
}) {
  const id = `plugincfg-${plugin}-${field.key}`;
  const [draft, setDraft] = useState(field.value ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDraft(field.value ?? "");
    setErr(null);
  }, [field.value]);

  async function save(v: string) {
    setBusy(true);
    setErr(null);
    try {
      await api.setPluginConfig(serverId, plugin, field.key, v);
      toast.ok(`${field.label} updated`);
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const dirty = field.kind !== "bool" && field.kind !== "select" && draft !== (field.value ?? "");

  const control =
    field.kind === "bool" ? (
      <Toggle
        id={id}
        checked={draft === "true"}
        label={field.label}
        disabled={busy}
        onChange={(v) => {
          const s = v ? "true" : "false";
          setDraft(s);
          save(s);
        }}
      />
    ) : field.kind === "select" ? (
      <Select
        id={id}
        value={draft}
        disabled={busy}
        onChange={(e) => {
          setDraft(e.target.value);
          save(e.target.value);
        }}
        className="w-40"
      >
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    ) : (
      <div className="flex items-center gap-1.5">
        <TextInput
          id={id}
          type={field.kind === "int" ? "number" : "text"}
          value={draft}
          disabled={busy}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && dirty && save(draft)}
          className={field.kind === "int" ? "w-24 text-right tabular-nums" : "w-44"}
        />
        {dirty && (
          <Button variant="ghost" size="sm" icon="save" loading={busy} onClick={() => save(draft)}>
            Save
          </Button>
        )}
      </div>
    );

  return (
    <div className={dirty ? "bg-accent-muted/30" : undefined}>
      <SettingRow
        htmlFor={id}
        label={
          <span className="flex items-center gap-1.5">
            {field.label}
            <Tooltip label={<span className="font-mono">{field.key}</span>}>
              <Icon name="info" size={11} className="text-ink-ghost" />
            </Tooltip>
          </span>
        }
        help={field.hint}
        control={control}
      />
      {err && <ErrorBanner message={err} className="mx-3.5 mb-2" />}
    </div>
  );
}
