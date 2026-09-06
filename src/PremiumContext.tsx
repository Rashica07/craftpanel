import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { PremiumStatus } from "./types";

interface PremiumCtxValue {
  status: PremiumStatus | null;
  active: boolean;
  refresh: () => Promise<void>;
}

const PremiumCtx = createContext<PremiumCtxValue>({
  status: null,
  active: false,
  refresh: async () => {},
});

/**
 * One source of truth for "is Premium active," fetched once at app start —
 * a real network re-validation (`premium_refresh`), not just the cached
 * local flag, since a subscription can lapse without the app being told.
 * Every feature panel's premium gate reads this instead of fetching its
 * own copy, so activating in Settings updates everywhere at once.
 *
 * Convention for anything Premium-gated: wrap it in `{active && <Thing />}`.
 * Not active means the feature doesn't render at all — no greyed-out
 * teaser, no lock icon on something that isn't there. See PremiumBadge for
 * the flip side: marking a *visible* (because active) feature as Premium.
 */
export function PremiumProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PremiumStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.premiumRefresh());
    } catch {
      // Offline, or the licensing API is unreachable — premiumRefresh
      // already preserves last-known-good state server-side; fall back to
      // reading that cached local value instead of showing nothing.
      try {
        setStatus(await api.premiumStatusGet());
      } catch {
        /* first run, or the DB itself isn't readable yet — nothing to show */
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <PremiumCtx.Provider value={{ status, active: status?.active ?? false, refresh }}>
      {children}
    </PremiumCtx.Provider>
  );
}

export function usePremium() {
  return useContext(PremiumCtx);
}
