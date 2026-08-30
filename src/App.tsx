import { useEffect, useState } from "react";
import { api } from "./api";
import { AddServerModal } from "./components/AddServerModal";
import { CreateServerModal } from "./components/CreateServerModal";
import { JoinSharedModal } from "./components/JoinSharedModal";
import { ServerDetail } from "./components/ServerDetail";
import { SERVER_TYPE_META, STATUS_META, type ServerRecord } from "./types";
import { Badge, Button } from "./components/ui";
import { Icon } from "./components/Icon";
import { statusOf, useRuntimes } from "./useRuntimes";

export default function App() {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [loading, setLoading] = useState(true);
  const runtimes = useRuntimes();

  async function refresh() {
    const list = await api.listServers();
    setServers(list);
    setSelectedId((cur) =>
      cur && list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? null),
    );
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, []);

  const selected = servers.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-edge bg-panel">
        <div className="flex items-center border-b border-edge px-4 py-3">
          <img src="/wordmark-light.png" className="h-6 w-auto" alt="CraftPanel" />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="px-2 py-4 text-xs text-ink-faint">Loading…</div>
          ) : servers.length === 0 ? (
            <div className="px-2 py-4 text-xs text-ink-faint">No servers yet.</div>
          ) : (
            servers.map((s) => {
              const status = statusOf(runtimes, s.id);
              const st = STATUS_META[status];
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`mb-1 w-full rounded-md px-3 py-2 text-left transition-colors ${
                    s.id === selectedId
                      ? "bg-panel-3 ring-1 ring-accent/40"
                      : "hover:bg-panel-2"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        status === "running"
                          ? "bg-ok"
                          : status === "crashed"
                            ? "bg-bad"
                            : status === "starting" || status === "stopping"
                              ? "bg-warn"
                              : "bg-ink-faint/40"
                      }`}
                      title={st.label}
                    />
                    <span className="truncate text-sm font-medium">{s.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 pl-4">
                    <Badge tone="accent">
                      {SERVER_TYPE_META[s.server_type].label}
                    </Badge>
                    {s.mc_version && <Badge tone="neutral">{s.mc_version}</Badge>}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="space-y-1.5 border-t border-edge p-2">
          <Button
            variant="primary"
            className="flex w-full items-center justify-center gap-1.5"
            onClick={() => setShowCreate(true)}
          >
            <Icon name="wand" size={15} /> Create server
          </Button>
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              className="flex flex-1 items-center justify-center gap-1.5"
              onClick={() => setShowAdd(true)}
            >
              <Icon name="plus" size={14} /> Add
            </Button>
            <Button
              variant="ghost"
              className="flex flex-1 items-center justify-center gap-1.5"
              onClick={() => setShowJoin(true)}
            >
              <Icon name="link" size={14} /> Join
            </Button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden bg-[#0f1013]">
        {selected ? (
          <ServerDetail
            key={selected.id}
            server={selected}
            runtime={runtimes[selected.id]}
            onServersChanged={refresh}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <img src="/wordmark-light.png" className="h-12 w-auto" alt="CraftPanel" />
            <p className="max-w-sm text-sm text-ink-dim">
              Create a new Minecraft server — Vanilla, Paper, Fabric, Forge or
              NeoForge — or add a server folder you already have.
            </p>
            <div className="flex gap-2">
              <Button
                variant="primary"
                className="flex items-center gap-1.5"
                onClick={() => setShowCreate(true)}
              >
                <Icon name="wand" size={15} /> Create server
              </Button>
              <Button
                variant="ghost"
                className="flex items-center gap-1.5"
                onClick={() => setShowAdd(true)}
              >
                <Icon name="plus" size={14} /> Add existing
              </Button>
            </div>
          </div>
        )}
      </main>

      {showAdd && (
        <AddServerModal
          onClose={() => setShowAdd(false)}
          onAdded={async (rec) => {
            setShowAdd(false);
            await refresh();
            setSelectedId(rec.id);
          }}
        />
      )}
      {showCreate && (
        <CreateServerModal
          onClose={() => setShowCreate(false)}
          onCreated={async (rec) => {
            setShowCreate(false);
            await refresh();
            setSelectedId(rec.id);
          }}
        />
      )}
      {showJoin && (
        <JoinSharedModal
          onClose={() => setShowJoin(false)}
          onJoined={async (rec) => {
            setShowJoin(false);
            await refresh();
            setSelectedId(rec.id);
          }}
        />
      )}
    </div>
  );
}
