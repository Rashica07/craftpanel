import { useEffect, useState } from "react";
import { api } from "../api";
import type { NbtNode } from "../types";
import { Badge, Button, Modal, StateBlock, TextInput, cx, toast } from "./ui";
import { Icon } from "./Icon";

/** Every path segment is an index into a compound's or list's own
 * `value` array — simpler and more robust than keying by name (NBT
 * doesn't guarantee unique names the way this editor's compound rows
 * assume for display, but list items obviously have none at all). */
type Path = number[];

function setAtPath(root: NbtNode, path: Path, next: NbtNode): NbtNode {
  if (path.length === 0) return next;
  const [i, ...rest] = path;
  if (root.kind === "compound") {
    const value = root.value.slice();
    const [key, child] = value[i];
    value[i] = [key, setAtPath(child, rest, next)];
    return { kind: "compound", value };
  }
  if (root.kind === "list") {
    const value = root.value.slice();
    value[i] = setAtPath(value[i], rest, next);
    return { kind: "list", value };
  }
  return root;
}

function parseNumList(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

function NbtRow({
  label,
  node,
  path,
  depth,
  onChange,
}: {
  label: string;
  node: NbtNode;
  path: Path;
  depth: number;
  onChange: (path: Path, next: NbtNode) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: 8 + depth * 16 };

  if (node.kind === "compound" || node.kind === "list") {
    const count = node.value.length;
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={pad}
          className="flex w-full items-center gap-1.5 py-1 text-left text-xs hover:bg-surface-2"
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={11} className="shrink-0 text-ink-faint" />
          <span className="font-mono text-ink">{label}</span>
          <span className="text-ink-faint">
            {node.kind === "compound" ? `{${count}}` : `[${count}]`}
          </span>
        </button>
        {open &&
          node.value.map((entry, i) => {
            const [childLabel, child]: [string, NbtNode] =
              node.kind === "compound" ? (entry as [string, NbtNode]) : [String(i), entry as NbtNode];
            return (
              <NbtRow
                key={i}
                label={childLabel}
                node={child}
                path={[...path, i]}
                depth={depth + 1}
                onChange={onChange}
              />
            );
          })}
      </div>
    );
  }

  const isArray = node.kind === "byteArray" || node.kind === "intArray" || node.kind === "longArray";

  return (
    <div style={pad} className="flex items-center gap-2 py-1 pr-3 text-xs hover:bg-surface-2">
      <span className="w-4 shrink-0" />
      <span className="w-36 shrink-0 truncate font-mono text-ink">{label}</span>
      <Badge tone="neutral" size="sm" className="shrink-0">
        {node.kind}
      </Badge>
      {node.kind === "string" ? (
        <TextInput
          value={node.value}
          onChange={(e) => onChange(path, { kind: "string", value: e.target.value })}
          className="flex-1 font-mono text-xs"
        />
      ) : node.kind === "long" ? (
        <TextInput
          value={node.value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^-?\d*$/.test(v)) onChange(path, { kind: "long", value: v || "0" });
          }}
          className="w-48 font-mono text-xs tabular-nums"
        />
      ) : isArray ? (
        <TextInput
          value={node.value.join(", ")}
          onChange={(e) => {
            const nums = parseNumList(e.target.value);
            if (node.kind === "byteArray") onChange(path, { kind: "byteArray", value: nums });
            else if (node.kind === "intArray") onChange(path, { kind: "intArray", value: nums });
          }}
          className="flex-1 font-mono text-xs tabular-nums"
          placeholder="comma-separated"
        />
      ) : (
        <TextInput
          type="number"
          value={node.value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(path, { ...node, value: n } as NbtNode);
          }}
          className="w-32 font-mono text-xs tabular-nums"
        />
      )}
    </div>
  );
}

/**
 * A generic tree editor for level.dat / playerdata/*.dat — not schema-
 * aware, just an honest view of whatever's actually in the file. Editing
 * raw NBT can genuinely corrupt a world if a value ends up somewhere
 * Minecraft doesn't expect, so saving always goes through a confirm step
 * that says so plainly, and the backend keeps one `.bak` copy of
 * whatever was there before the write (not a trash folder — see
 * nbt.rs::write).
 */
export function NbtEditor({
  serverId,
  path,
  onClose,
}: {
  serverId: string;
  path: string;
  onClose: () => void;
}) {
  const [root, setRoot] = useState<NbtNode | null>(null);
  const [gzip, setGzip] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);

  useEffect(() => {
    api
      .nbtRead(serverId, path)
      .then((f) => {
        setRoot(f.root);
        setGzip(f.gzip);
      })
      .catch((e) => setError(String(e)));
  }, [serverId, path]);

  function onChange(p: Path, next: NbtNode) {
    setRoot((cur) => (cur ? setAtPath(cur, p, next) : cur));
    setDirty(true);
  }

  async function save() {
    if (!root) return;
    setBusy(true);
    try {
      await api.nbtWrite(serverId, path, root, gzip);
      setDirty(false);
      setConfirmSave(false);
      toast.ok("Saved", `A backup of the previous file is at ${path}.bak.`);
    } catch (e) {
      toast.bad("Couldn't save", String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={path.split("/").pop() ?? path} icon="layers" size="lg" onClose={onClose}>
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-line-soft pb-2">
        <span className="truncate font-mono text-2xs text-ink-faint">{path}</span>
        {dirty && (
          <Badge tone="accent" size="sm">
            unsaved changes
          </Badge>
        )}
      </div>

      {error ? (
        <StateBlock state="error" title="Couldn't read this as NBT" message={error} compact />
      ) : !root ? (
        <StateBlock state="loading" title="Parsing…" compact />
      ) : (
        <div className={cx("max-h-[55vh] overflow-y-auto rounded-lg border border-line-soft")}>
          <NbtRow label={path.split("/").pop() ?? "root"} node={root} path={[]} depth={0} onChange={onChange} />
        </div>
      )}

      {root && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" icon="save" disabled={!dirty} onClick={() => setConfirmSave(true)}>
            Save
          </Button>
        </div>
      )}

      {confirmSave && (
        <Modal
          title="Save these changes?"
          icon="alert"
          size="sm"
          onClose={() => setConfirmSave(false)}
          footer={
            <>
              <Button variant="quiet" className="mr-auto" onClick={() => setConfirmSave(false)}>
                Cancel
              </Button>
              <Button variant="danger" icon="save" loading={busy} onClick={save}>
                Save anyway
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-dim">
            This is raw save data — a value in the wrong shape can make this file unreadable to
            Minecraft, which can mean a world (or a player's data) that won't load. CraftPanel keeps
            one backup of the file as it is right now (<code>{path}.bak</code>), not more than one —
            a second save overwrites it.
          </p>
        </Modal>
      )}
    </Modal>
  );
}
