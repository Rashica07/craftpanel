import { useEffect, useState } from "react";
import { api } from "./api";
import type { ProcSnapshot, ServerStatus } from "./types";

/**
 * Single subscription to `server:status`, seeded from `all_runtimes`.
 * Returns a map of server id -> latest snapshot.
 */
export function useRuntimes(): Record<string, ProcSnapshot> {
  const [map, setMap] = useState<Record<string, ProcSnapshot>>({});

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;

    api.allRuntimes().then((snaps) => {
      if (!alive) return;
      setMap(Object.fromEntries(snaps.map((s) => [s.serverId, s])));
    });

    api
      .onStatus((snap) => {
        setMap((prev) => ({ ...prev, [snap.serverId]: snap }));
      })
      .then((fn) => {
        if (alive) unlisten = fn;
        else fn();
      });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return map;
}

export function statusOf(
  map: Record<string, ProcSnapshot>,
  id: string,
): ServerStatus {
  return map[id]?.status ?? "stopped";
}
