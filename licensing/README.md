# craftpanel-licensing

Stripe Checkout + webhook + license-key API for CraftPanel Premium, as one
Cloudflare Worker. No database beyond Cloudflare KV — a license record is
just `{ key, email, plan, status, stripeCustomerId, ... }`.

**Status: deployed, not yet wired to Stripe.** The Worker and its KV
namespace are live at `https://craftpanel-licensing.kristiangjergji20.workers.dev`
(confirmed: `GET /api/license/validate?key=x` returns `{"valid":false}`).
`/api/checkout` will 500 until real Stripe price IDs replace the
`REPLACE_WITH_price_...` placeholders in `wrangler.toml` and
`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are set as secrets — that's
the only remaining step, covered below.

Nothing here goes live on its own beyond what's already deployed. It
still needs a Stripe account (yours, not mine to create — see below).

## What it exposes

- `POST /api/checkout` — `{ plan: "monthly" | "yearly" | "lifetime" }` →
  `{ clientSecret }` by default, for **embedded** Stripe Checkout: card
  entry and Link happen inline on the site itself (in Stripe's own
  iframe — CraftPanel's code never sees raw card data), no redirect away
  from the page. Pass `{ uiMode: "hosted" }` to instead get `{ url }`, a
  classic redirect-to-checkout.stripe.com link — kept as a fallback path,
  not currently used by the site.
- `POST /api/webhook` — Stripe calls this, not the browser. Issues or
  updates a license on `checkout.session.completed`, extends it on
  `invoice.paid`, marks it `canceled`/`past_due` on
  `customer.subscription.deleted` / `invoice.payment_failed`.
- `GET /api/license/session?session_id=...` — used by the success page to
  show the key right after checkout.
- `GET /api/license/validate?key=...` — this is the one the **Tauri app**
  calls to check a key. Returns `{ valid, plan, status, currentPeriodEnd }`.

## One-time setup

1. **Stripe** — create your account at stripe.com yourself (this is not
   something I can do on your behalf). In the Dashboard:
   - Product catalog → add a "CraftPanel Premium" product with three
     prices: recurring monthly (€4.99), recurring yearly (€39.99), and a
     one-time price (€79.99). Copy the three `price_...` IDs into
     `wrangler.toml` under `[vars]`.
   - Developers → API keys → copy both the **secret key** (`sk_test_...`
     while testing, `sk_live_...` when you're ready to charge real cards)
     and the **publishable key** (`pk_test_...` / `pk_live_...`). The
     publishable key isn't secret — it's meant to sit in the site's own
     JS — only the secret key goes into the Worker.
   - Payment methods → make sure **Link** is enabled (it usually is by
     default) so it shows up automatically in embedded Checkout alongside
     card entry — nothing to configure beyond that.
   - Developers → Webhooks → add an endpoint pointing at
     `https://<your-worker-subdomain>.workers.dev/api/webhook`, listening
     for `checkout.session.completed`, `invoice.paid`,
     `customer.subscription.deleted`, `invoice.payment_failed`. Copy the
     **signing secret** (`whsec_...`).

2. ✓ **Cloudflare — done.** KV namespace created (`LICENSES`, id
   `a153cd5bb8464cb7913853e64f8189a1`, already in `wrangler.toml`) and the
   Worker is deployed at
   `https://craftpanel-licensing.kristiangjergji20.workers.dev`. Nothing
   left to do here unless the account changes.

3. **Secrets** (never committed — these live in Cloudflare, not in this
   repo) — still needed, once you have the keys from step 1:
   ```bash
   cd licensing
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
   Also replace the three `REPLACE_WITH_price_...` placeholders in
   `wrangler.toml` with the real `price_...` IDs from step 1.

4. **Re-deploy** after the above:
   ```bash
   npm run deploy
   ```

5. ✓ **Wire the site to it — half done.** `LICENSING_API` in
   `CraftPanel Landing/premium.html` already points at the deployed
   Worker. Still need: set `STRIPE_PUBLISHABLE_KEY` (same file) to the
   `pk_...` key from step 1, then redeploy the site — that flips the "Get
   monthly / yearly / lifetime" buttons from a harmless placeholder toast
   into a real embedded Stripe Checkout (card + Link) right on the page.

6. ✓ **Wire the Tauri app to it — done.** `src-tauri/src/premium.rs` +
   Settings → Premium in the app already activate/validate/deactivate a
   key against `GET /api/license/validate`, with a background re-check on
   launch. Gating actual Premium *features* (automation, monitoring,
   etc.) behind `active` is separate, unbuilt work — this only covers
   whether a key is valid, not what it unlocks yet.

## Testing before going live

Use Stripe **test mode** (`sk_test_...` key, test-mode webhook secret,
test-mode prices) and Stripe's test card `4242 4242 4242 4242` with any
future expiry/CVC. Nothing here defaults to live mode — you switch
deliberately by swapping in `sk_live_...` and re-pointing the webhook at
the same endpoint (Stripe keeps test and live webhooks separate).

## What's deliberately not built yet

- **Email delivery of the key.** Right now the key is only shown on the
  success page (via `/api/license/session`). If someone closes that tab
  before copying it, there's no resend today. Adding email needs a
  transactional-email provider (e.g. Resend, Postmark) and its own API
  key — a small, separate addition once you decide on one.
- **A self-serve "manage/cancel subscription" link.** Stripe has a
  built-in customer portal for this (Dashboard → Settings → Billing →
  Customer portal) that needs no code — just enable it and link to it
  from a purchase confirmation.
