import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ServerRecord, ServerSettings, SettingField } from "../types";
import {
  Badge,
  Banner,
  Button,
  Card,
  Modal,
  Segmented,
  Select,
  SettingRow,
  StateBlock,
  TextInput,
  Toggle,
  Tooltip,
  cx,
  toast,
} from "./ui";
import { ErrorBanner } from "./ErrorBanner";
import { Icon } from "./Icon";
import { RamSlider } from "./RamSlider";
import { ShareSection } from "./ShareSection";
import { BrandingSection } from "./BrandingSection";
import { AutomationSection } from "./AutomationSection";
import { JvmSection } from "./JvmSection";
import { MgmtSection } from "./MgmtSection";

type View = "common" | "advanced" | "raw";

/**
 * Every settings row gets an icon. server.properties keys are cryptic, and a
 * glyph is the cheapest way to make a list of 30 of them scannable — you find
 * "the world one" by shape long before you read the label.
 */
const KEY_ICON: Record<string, string> = {
  motd: "type",
  "max-players": "users",
  difficulty: "swords",
  gamemode: "gamepad",
  "force-gamemode": "gamepad",
  pvp: "swords",
  hardcore: "heart",
  "online-mode": "shield",
  "white-list": "list",
  "enforce-whitelist": "list",
  "spawn-protection": "shield",
  "view-distance": "eye",
  "simulation-distance": "activity",
  "level-seed": "dice",
  "level-name": "map",
  "level-type": "grass",
  "allow-nether": "globe",
  "allow-flight": "arrow-up",
  "enable-command-block": "terminal",
  "server-port": "hash",
  "query.port": "hash",
  "rcon.port": "hash",
  "enable-rcon": "terminal",
  "enable-query": "search",
  "spawn-monsters": "creeper",
  "spawn-animals": "grass",
  "spawn-npcs": "user",
  "max-world-size": "globe",
  "resource-pack": "package",
  "player-idle-timeout": "clock",
  "op-permission-level": "crown",
  "max-tick-time": "gauge",
  "network-compression-threshold": "activity",
  "entity-broadcast-range-percentage": "activity",
  "sync-chunk-writes": "hard-drive",
  "use-native-transport": "cpu",
  "prevent-proxy-connections": "shield",
  "broadcast-console-to-ops": "terminal",
  "require-resource-pack": "package",
  "hide-online-players": "eye-off",
  "server-ip": "router",
  "generate-structures": "cube",
  "function-permission-level": "crown",
  "rate-limit": "gauge",
  "text-filtering-config": "type",
};

function iconFor(f: SettingField) {
  return (
    KEY_ICON[f.key] ??
    ({ bool: "check", int: "hash", enum: "list", text: "type" }[f.kind] ?? "sliders")
  );
}

/** One server.properties key, rendered as icon · label · help · control. */
function FieldRow({
  field,
  value,
  dirty,
  onChange,
}: {
  field: SettingField;
  value: string;
  dirty: boolean;
  onChange: (key: string, v: string) => void;
}) {
  const id = `set-${field.key}`;

  const control =
    field.kind === "bool" ? (
      <Toggle
        id={id}
        checked={value === "true"}
        label={field.label}
        onChange={(v) => onChange(field.key, v ? "true" : "false")}
      />
    ) : field.kind === "enum" ? (
      <Select
        id={id}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        className="w-40 capitalize"
      >
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    ) : (
      <TextInput
        id={id}
        type={field.kind === "int" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        className={field.kind === "int" ? "w-24 text-right tabular-nums" : "w-56"}
      />
    );

  return (
    <div className={cx("relative", dirty && "bg-accent-muted/40")}>
      {dirty && (
        <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" />
      )}
      <SettingRow
        icon={iconFor(field)}
        htmlFor={id}
        label={
          <span className="flex items-center gap-1.5">
            {field.label}
            {dirty && (
              <Badge tone="accent" size="sm">
                edited
              </Badge>
            )}
            <Tooltip label={<span className="font-mono">{field.key}</span>}>
              <Icon
                name="info"
                size={11}
                className="text-ink-ghost hover:text-ink-faint"
              />
            </Tooltip>
          </span>
        }
        help={field.help}
        note={field.note}
        control={control}
      />
    </div>
  );
}

export function SettingsPanel({
  server,
  locked,
  onServersChanged,
  onNeedsRestart,
}: {
  server: ServerRecord;
  locked: boolean;
  onServersChanged: () => void;
  onNeedsRestart: () => void;
}) {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("common");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ram, setRam] = useState(server.ram_mb);
  const [keepAwake, setKeepAwake] = useState(server.keep_awake);
  const [expert, setExpert] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [rawFilter, setRawFilter] = useState("");

  useEffect(() => {
    api
      .appSettingsGet()
      .then((s) => setExpert(s.expertMode))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!expert && view === "raw") setView("advanced");
  }, [expert, view]);

  const load = useCallback(() => {
    api
      .getSettings(server.id)
      .then((s) => {
        setSettings(s);
        setDraft({});
      })
      .catch((e) => setError(String(e)));
  }, [server.id]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);
  useEffect(() => setRam(server.ram_mb), [server.id, server.ram_mb]);
  useEffect(
    () => setKeepAwake(server.keep_awake),
    [server.id, server.keep_awake],
  );

  function toggleKeepAwake(next: boolean) {
    setKeepAwake(next);
    api
      .setKeepAwake(server.id, next)
      .then(onServersChanged)
      .catch((e) => setError(String(e)));
  }

  const dirty = Object.keys(draft).length > 0;
  const val = (key: string, fallback: string) => draft[key] ?? fallback;
  const edit = (key: string, v: string) => setDraft((d) => ({ ...d, [key]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.applySettings(
        server.id,
        Object.entries(draft) as [string, string][],
      );
      toast.ok(
        r.changed.length
          ? `Saved ${r.changed.length} change${r.changed.length > 1 ? "s" : ""}`
          : "Nothing to save",
        r.changed.join(", ") || undefined,
      );
      if (r.restartRequired) onNeedsRestart();
      load();
    } catch (e) {
      setError(String(e));
      toast.bad("Couldn't save", String(e));
    } finally {
      setBusy(false);
    }
  }

  function saveRam(mb: number) {
    setRam(mb);
    api
      .setServerRam(server.id, mb)
      .then(onServersChanged)
      .catch((e) => setError(String(e)));
  }

  const fields: SettingField[] =
    view === "common"
      ? (settings?.common ?? [])
      : view === "advanced"
        ? (settings?.advanced ?? [])
        : [];

  const rawRows = (settings?.all ?? []).filter(([k]) =>
    rawFilter ? k.toLowerCase().includes(rawFilter.toLowerCase()) : true,
  );

  return (
    <div className="relative h-full overflow-y-auto pr-1">
      <div className="cp-stagger space-y-3 pb-24">
        {/* ── this computer ─────────────────────────────────────────── */}
        <Card
          title="Machine"
          icon="cpu"
          description="How much of this computer the server is allowed to use."
        >
          <RamSlider valueMb={ram} onChange={saveRam} disabled={locked} />
          {locked && (
            <p className="mt-2 flex items-center gap-1.5 text-2xs text-ink-faint">
              <Icon name="lock" size={11} />
              Stop the server to change its memory.
            </p>
          )}
          <div className="-mx-3.5 mt-3 border-t border-line-soft">
            <SettingRow
              icon="sun"
              label="Keep this computer awake while the server runs"
              help="Stops idle-sleep so friends don't get dropped when you walk away. Applies on the next start. On macOS a closed lid still sleeps unless you're plugged in; Windows support is coming."
              control={<Toggle checked={keepAwake} onChange={toggleKeepAwake} />}
            />
          </div>
        </Card>

        <BrandingSection serverId={server.id} />
        <AutomationSection serverId={server.id} />
        <JvmSection serverId={server.id} onNeedsRestart={onNeedsRestart} />
        <MgmtSection serverId={server.id} onNeedsRestart={onNeedsRestart} />
        <ShareSection server={server} onServersChanged={onServersChanged} />

        {/* ── server.properties ─────────────────────────────────────── */}
        {!settings ? (
          <Card>
            <StateBlock state="loading" title="Reading server.properties…" compact />
          </Card>
        ) : !settings.present ? (
          <Card title="Game rules" icon="sliders">
            <StateBlock
              state="empty"
              icon="file"
              title="No settings file yet"
              message={
                <>
                  Minecraft writes <code>server.properties</code> the first time
                  it boots. Start the server once and every rule shows up here.
                </>
              }
              compact
            />
          </Card>
        ) : (
          <Card
            title="Game rules"
            icon="sliders"
            description={
              view === "common"
                ? "The settings most people actually change."
                : view === "advanced"
                  ? "Performance and behaviour knobs. Safe to leave alone."
                  : "Every key in the file, unvalidated. Here be dragons."
            }
            right={
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: "common" as View, label: "Basics" },
                  { value: "advanced" as View, label: "Advanced" },
                  ...(expert
                    ? [{ value: "raw" as View, label: "Raw", icon: "terminal" }]
                    : []),
                ]}
              />
            }
            pad={false}
          >
            {view === "raw" ? (
              <div className="p-3.5">
                <Banner tone="warn" className="mb-3">
                  Nothing here is checked before it's written. A typo can stop
                  the server from booting.
                </Banner>
                <TextInput
                  icon="search"
                  value={rawFilter}
                  placeholder="Filter keys…"
                  onChange={(e) => setRawFilter(e.target.value)}
                  className="mb-2"
                />
                <div className="space-y-1">
                  {rawRows.map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span
                        className={cx(
                          "w-60 shrink-0 truncate font-mono text-2xs",
                          k in draft ? "text-accent-soft" : "text-ink-faint",
                        )}
                        title={k}
                      >
                        {k}
                      </span>
                      <TextInput
                        mono
                        value={val(k, v)}
                        onChange={(e) => edit(k, e.target.value)}
                      />
                    </div>
                  ))}
                  {rawRows.length === 0 && (
                    <p className="py-6 text-center text-2xs text-ink-faint">
                      No keys match “{rawFilter}”.
                    </p>
                  )}
                </div>
              </div>
            ) : fields.length === 0 ? (
              <StateBlock
                state="empty"
                title="Nothing in this tier"
                message="Try the other tab."
                compact
              />
            ) : (
              <div className="divide-y divide-line-soft">
                {fields.map((f) => (
                  <FieldRow
                    key={f.key}
                    field={f}
                    value={val(f.key, f.value)}
                    dirty={f.key in draft}
                    onChange={edit}
                  />
                ))}
              </div>
            )}

            {!expert && view === "advanced" && (
              <div className="border-t border-line-soft px-3.5 py-2.5 text-2xs text-ink-faint">
                <Icon name="info" size={11} className="mr-1 inline" />
                Want to edit the raw file? Turn on{" "}
                <strong className="text-ink-dim">expert mode</strong> in
                CraftPanel settings.
              </div>
            )}
          </Card>
        )}

        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        {/* ── where it lives ────────────────────────────────────────── */}
        <Card title="On disk" icon="folder" pad={false}>
          <dl className="divide-y divide-line-soft text-2xs">
            {[
              ["Folder", server.path],
              ["Launches", server.launch_target],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3 px-3.5 py-2.5">
                <dt className="w-16 shrink-0 text-ink-faint">{k}</dt>
                <dd
                  data-selectable
                  className="min-w-0 flex-1 break-all font-mono text-ink-dim"
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        {/* ── danger zone ───────────────────────────────────────────── */}
        <Card
          title="Remove this server"
          icon="trash"
          tone="bad"
          description="Takes it out of CraftPanel's list. Your world and files stay exactly where they are on disk."
        >
          <Button
            variant="danger"
            icon="trash"
            onClick={() => setConfirmRemove(true)}
            disabled={locked}
            title={locked ? "Stop the server first" : undefined}
          >
            Remove from CraftPanel
          </Button>
        </Card>
      </div>

      {/* ── floating save bar ─────────────────────────────────────────
          Anchored rather than inline, so you can edit a rule at the bottom of
          Advanced and still see the button that saves it. */}
      {dirty && (
        <div className="cp-toast pointer-events-none sticky bottom-0 left-0 right-0 z-20 flex justify-center pb-1">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface-3 py-1.5 pl-4 pr-1.5 shadow-e3">
            <span className="text-xs text-ink-dim">
              <strong className="tabular-nums text-ink">
                {Object.keys(draft).length}
              </strong>{" "}
              unsaved change{Object.keys(draft).length > 1 ? "s" : ""}
            </span>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setDraft({})}
              disabled={busy}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="save"
              onClick={save}
              loading={busy}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <Modal
          title={`Remove “${server.name}”?`}
          icon="trash"
          size="sm"
          onClose={() => setConfirmRemove(false)}
          footer={
            <>
              <Button
                variant="quiet"
                onClick={() => setConfirmRemove(false)}
                className="mr-auto"
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                icon="trash"
                onClick={async () => {
                  await api.removeServer(server.id);
                  setConfirmRemove(false);
                  onServersChanged();
                  toast.show(`Removed ${server.name}`, "The folder is untouched.");
                }}
              >
                Remove it
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-dim">
            This only removes it from CraftPanel's sidebar.
          </p>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-line-soft bg-surface-2 p-3 text-xs">
            <Icon name="folder" size={14} className="mt-0.5 shrink-0 text-ok" />
            <span className="text-ink-dim">
              Your world, mods and backups stay at{" "}
              <span data-selectable className="break-all font-mono text-ink">
                {server.path}
              </span>
              . You can add it back any time.
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
