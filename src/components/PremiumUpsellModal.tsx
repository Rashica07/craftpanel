import { api } from "../api";
import { Button, useDismissOnEscape } from "./ui";
import { Icon } from "./Icon";

const PREMIUM_SITE_URL = "https://rashica07.github.io/craftpanel-site/premium.html";

/**
 * Shown rarely — the app itself decides *when* to ask for this via
 * `premium_maybe_show_upsell` (a time gate plus a random roll, see
 * src-tauri/src/premium.rs), not on every launch. This component only
 * renders the ask once App.tsx has already decided to show it.
 */
export function PremiumUpsellModal({ onClose }: { onClose: () => void }) {
  useDismissOnEscape(onClose);

  function seePremium() {
    window.open(PREMIUM_SITE_URL, "_blank", "noreferrer");
    onClose();
  }

  async function dontShowAgain() {
    try {
      await api.premiumDismissUpsellForever();
    } finally {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        className="cp-pop w-full max-w-sm rounded-xl border border-line bg-surface p-6 text-center shadow-e3"
      >
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-accent-muted text-accent-soft">
          <Icon name="crown" size={19} />
        </span>
        <p className="mt-3.5 text-2xs text-ink-faint">Sorry for the disturbance —</p>
        <h2 className="cp-display mt-1 text-base text-ink">Getting good use out of CraftPanel?</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">
          Premium adds automation, monitoring, and management tools on top —
          the free app keeps everything it already does, no strings attached.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="primary" onClick={seePremium} block>
            See Premium
          </Button>
          <Button variant="ghost" onClick={onClose} block>
            Maybe later
          </Button>
        </div>
        <button
          onClick={dontShowAgain}
          className="mt-3.5 text-2xs text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink-dim"
        >
          Don't show this again
        </button>
      </div>
    </div>
  );
}
