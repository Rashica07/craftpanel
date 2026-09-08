# craftpanel-licensing

Stripe Checkout + webhook + license-key API for CraftPanel Premium, as one
Cloudflare Worker. No database beyond Cloudflare KV — a license record is
just `{ key, email, plan, status, stripeCustomerId, ... }`.

**Status: LIVE as of 2026-09-08. Real cards can be charged.** Deployed at
`https://craftpanel-licensing.kristiangjergji20.workers.dev` with a live
Product (`prod_VDuMxL5lznGMdi`), 3 live Prices, a live webhook
(`we_1UDSXwCfgxs3Bvp12uE0ompu`), live secrets, and
`CraftPanel Landing/premium.html` pointed at the live publishable key.
Verified without charging anyone: a real `POST /api/checkout` against
the live Worker returns a genuine `clientSecret` — session creation
alone doesn't charge a card, so that's as far as automated verification
here goes deliberately. A real end-to-end purchase (real card, real €)
hasn't been run by this session and shouldn't be, for obvious reasons.

The test-mode Product/Prices/webhook from before (`prod_VD80KR7raQYwr2`
and friends) still exist in the Stripe account's test-mode view if
you ever want to test something without it touching real money again —
just re-point the Worker's secrets back at the test keys temporarily.

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

## Setup — all done, live mode

1. ✓ **Stripe (live).** Product `prod_VDuMxL5lznGMdi` ("CraftPanel
   Premium"), three prices (`price_1UDSXfCfgxs3Bvp1a3c6Ebgr` monthly,
   `price_1UDSXhCfgxs3Bvp1afNrmrhY` yearly,
   `price_1UDSXiCfgxs3Bvp1HkAUnNiu` lifetime — all in `wrangler.toml`),
   and a live webhook (`we_1UDSXwCfgxs3Bvp12uE0ompu`) listening for
   `checkout.session.completed`, `invoice.paid`,
   `customer.subscription.deleted`, `invoice.payment_failed`. Link is on
   by default, nothing to configure.

2. ✓ **Cloudflare.** KV namespace (`LICENSES`, id
   `a153cd5bb8464cb7913853e64f8189a1`) and the Worker deployed at
   `https://craftpanel-licensing.kristiangjergji20.workers.dev`.

3. ✓ **Secrets.** `STRIPE_SECRET_KEY` (live) and `STRIPE_WEBHOOK_SECRET`
   (live) are set on the Worker (`wrangler secret put`, not in any file
   in this repo).

4. ✓ **Site.** `CraftPanel Landing/premium.html` has `LICENSING_API` and
   the live `STRIPE_PUBLISHABLE_KEY` set — the "Get monthly / yearly /
   lifetime" buttons open a genuine, live embedded Stripe Checkout.
   Verified without charging anyone: a real `POST /api/checkout` returns
   a genuine `clientSecret` — that's as far as this session's own
   automated verification goes, deliberately, since actually completing
   a purchase would be a real charge.

5. ✓ **Tauri app.** `src-tauri/src/premium.rs` + Settings → Premium
   activate/validate/deactivate a key against `GET
   /api/license/validate`, with a background re-check on launch. Gating
   actual Premium *features* (automation, monitoring, etc.) behind
   `active` is separate work, tracked in the main repo's `ROADMAP.md`.

## Test mode, if you need it again

The original test-mode Product (`prod_VD80KR7raQYwr2`), its 3 prices, and
webhook (`we_1UChkmCxOclMsWNa8dOBnvjt`) are all still sitting in the
Stripe account's test-mode view — nothing about going live deleted them.
To test something without touching real money: `wrangler secret put
STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` back to the `sk_test_`/
`whsec_...` test values, swap the 3 price IDs in `wrangler.toml` back to
the test ones above, `npm run deploy`, and swap
`STRIPE_PUBLISHABLE_KEY` in `premium.html` back to `pk_test_...` — then
reverse all of that to go live again. Stripe's own test card is
`4242 4242 4242 4242`, any future expiry/CVC.

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
