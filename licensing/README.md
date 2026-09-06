# craftpanel-licensing

Stripe Checkout + webhook + license-key API for CraftPanel Premium, as one
Cloudflare Worker. No database beyond Cloudflare KV — a license record is
just `{ key, email, plan, status, stripeCustomerId, ... }`.

**Status: fully wired, live in Stripe test mode.** Deployed at
`https://craftpanel-licensing.kristiangjergji20.workers.dev`, Product +
3 real Prices created, webhook registered, secrets set, and
`CraftPanel Landing/premium.html` points at it with the real publishable
key. Verified end-to-end in-browser: clicking a plan button on the real
site mounts a genuine Stripe embedded Checkout (TEST MODE ribbon, correct
product/price, working card fields) — confirmed by an actual `POST
/api/checkout` call and a real mounted iframe, not just reading the code.

Only remaining step to charge real cards: swap `sk_test_`/`pk_test_` for
`sk_live_`/`pk_live_` (a new webhook + prices in live mode too — Stripe
keeps test and live completely separate) once the account owner has
completed Stripe's identity/payout verification in their own dashboard.

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

## Setup — all done, test mode

1. ✓ **Stripe (test mode).** Product `prod_VD80KR7raQYwr2` ("CraftPanel
   Premium"), three prices (`price_1UChkdCxOclMsWNa5avJ71HD` monthly,
   `price_1UChkeCxOclMsWNa23rpemCS` yearly,
   `price_1UChkfCxOclMsWNaCOK6ZDIr` lifetime — all already in
   `wrangler.toml`), and a webhook endpoint (`we_1UChkmCxOclMsWNa8dOBnvjt`)
   listening for `checkout.session.completed`, `invoice.paid`,
   `customer.subscription.deleted`, `invoice.payment_failed` all exist in
   the account's test mode. Link is on by default, nothing to configure.

2. ✓ **Cloudflare.** KV namespace (`LICENSES`, id
   `a153cd5bb8464cb7913853e64f8189a1`) and the Worker deployed at
   `https://craftpanel-licensing.kristiangjergji20.workers.dev`.

3. ✓ **Secrets.** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set
   on the Worker (`wrangler secret put`, not in any file in this repo).

4. ✓ **Site.** `CraftPanel Landing/premium.html` has both `LICENSING_API`
   and `STRIPE_PUBLISHABLE_KEY` set to the real (test-mode) values — the
   "Get monthly / yearly / lifetime" buttons open a genuine embedded
   Stripe Checkout, confirmed working end-to-end in a real browser.

5. ✓ **Tauri app.** `src-tauri/src/premium.rs` + Settings → Premium
   activate/validate/deactivate a key against `GET
   /api/license/validate`, with a background re-check on launch. Gating
   actual Premium *features* (automation, monitoring, etc.) behind
   `active` is separate, unbuilt work — this only covers whether a key is
   valid, not what it unlocks yet.

## Going live (real cards)

Everything above is Stripe **test mode** — no real card can be charged
regardless of what anyone enters. To accept real payments:

1. In the Stripe Dashboard, flip to **Live mode** and repeat the Product
   + 3 Prices + webhook endpoint creation there (test and live are
   completely separate — nothing carries over automatically). This
   requires Stripe to have your identity/bank details for payouts,
   entered by you in their dashboard — not something done here.
2. `wrangler secret put STRIPE_SECRET_KEY` (the `sk_live_...` one),
   `wrangler secret put STRIPE_WEBHOOK_SECRET` (the new live webhook's
   secret), update the 3 price IDs in `wrangler.toml`, `npm run deploy`.
3. Swap `STRIPE_PUBLISHABLE_KEY` in `premium.html` for the `pk_live_...`
   key, push the site.

Test mode's own card is `4242 4242 4242 4242`, any future expiry/CVC, if
you want to run through a purchase yourself before going live.

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
