import Stripe from "stripe";
import {
  type Plan,
  generateLicenseKey,
  getLicense,
  getLicenseByCustomer,
  getLicenseBySession,
  linkSession,
  putLicense,
} from "./license";

export interface Env {
  LICENSES: KVNamespace;
  ALLOWED_ORIGINS: string;
  STRIPE_PRICE_MONTHLY: string;
  STRIPE_PRICE_YEARLY: string;
  STRIPE_PRICE_LIFETIME: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

function stripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-02-24.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

function corsHeaders(req: Request, env: Env): HeadersInit {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

function priceIdFor(env: Env, plan: Plan): string {
  switch (plan) {
    case "monthly": return env.STRIPE_PRICE_MONTHLY;
    case "yearly": return env.STRIPE_PRICE_YEARLY;
    case "lifetime": return env.STRIPE_PRICE_LIFETIME;
  }
}

async function handleCheckout(req: Request, env: Env): Promise<Response> {
  type CheckoutBody = { plan?: string; uiMode?: string; successUrl?: string; cancelUrl?: string; returnUrl?: string };
  const body = await req.json<CheckoutBody>().catch(() => ({}) as CheckoutBody);
  const plan = body.plan as Plan;
  if (plan !== "monthly" && plan !== "yearly" && plan !== "lifetime") {
    return json({ error: "plan must be monthly, yearly, or lifetime" }, { status: 400 });
  }

  const stripe = stripeClient(env);
  const origin = req.headers.get("Origin") || env.ALLOWED_ORIGINS.split(",")[0];
  const mode = plan === "lifetime" ? "payment" : "subscription";
  const lineItems = [{ price: priceIdFor(env, plan), quantity: 1 }];

  // Embedded is the default — card entry and Link happen inline on the
  // site itself (Stripe's own iframe, so raw card data never touches
  // CraftPanel's code) instead of leaving to checkout.stripe.com.
  // `uiMode: "hosted"` is kept as a fallback path, not currently used by
  // the site, in case an embedded-unfriendly payment method is ever added.
  if (body.uiMode === "hosted") {
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: lineItems,
      success_url: body.successUrl || `${origin}/premium.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: body.cancelUrl || `${origin}/premium.html?checkout=cancelled`,
      metadata: { plan },
    });
    return json({ url: session.url });
  }

  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded",
    mode,
    line_items: lineItems,
    return_url: body.returnUrl || `${origin}/premium.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    metadata: { plan },
  });
  return json({ clientSecret: session.client_secret });
}

async function issueLicenseForSession(env: Env, stripe: Stripe, session: Stripe.Checkout.Session): Promise<void> {
  const plan = (session.metadata?.plan as Plan) ?? "monthly";
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const email = session.customer_details?.email ?? undefined;
  if (!customerId || !email) return; // nothing sane to issue a key against

  // Renewal / re-checkout by an existing customer reuses their key rather
  // than minting a new one each time they're billed.
  const existing = await getLicenseByCustomer(env.LICENSES, customerId);
  const key = existing?.key ?? generateLicenseKey();

  let currentPeriodEnd: number | undefined;
  let subscriptionId: string | undefined;
  if (plan !== "lifetime" && typeof session.subscription === "string") {
    subscriptionId = session.subscription;
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    currentPeriodEnd = sub.current_period_end * 1000;
  }

  await putLicense(env.LICENSES, {
    key,
    email,
    plan,
    status: "active",
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    createdAt: existing?.createdAt ?? Date.now(),
    currentPeriodEnd,
  });
  await linkSession(env.LICENSES, session.id, key);
}

async function handleWebhook(req: Request, env: Env): Promise<Response> {
  const stripe = stripeClient(env);
  const signature = req.headers.get("Stripe-Signature");
  const rawBody = await req.text();
  if (!signature) return json({ error: "missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return json({ error: `invalid signature: ${(err as Error).message}` }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await issueLicenseForSession(env, stripe, session);
      break;
    }
    case "invoice.paid": {
      // Subscription renewed — extend currentPeriodEnd so the app's
      // periodic re-validate keeps passing without the user doing anything.
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (customerId) {
        const record = await getLicenseByCustomer(env.LICENSES, customerId);
        if (record && record.stripeSubscriptionId) {
          const sub = await stripe.subscriptions.retrieve(record.stripeSubscriptionId);
          await putLicense(env.LICENSES, {
            ...record,
            status: "active",
            currentPeriodEnd: sub.current_period_end * 1000,
          });
        }
      }
      break;
    }
    case "customer.subscription.deleted":
    case "invoice.payment_failed": {
      const obj = event.data.object as Stripe.Subscription | Stripe.Invoice;
      const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
      if (customerId) {
        const record = await getLicenseByCustomer(env.LICENSES, customerId);
        if (record) {
          await putLicense(env.LICENSES, {
            ...record,
            status: event.type === "customer.subscription.deleted" ? "canceled" : "past_due",
          });
        }
      }
      break;
    }
  }

  return json({ received: true });
}

async function handleLicenseFromSession(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return json({ error: "session_id required" }, { status: 400 });
  const record = await getLicenseBySession(env.LICENSES, sessionId);
  if (!record) return json({ found: false }, { status: 404 });
  return json({ found: true, key: record.key, plan: record.plan, email: record.email });
}

async function handleValidate(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) return json({ valid: false, error: "key required" }, { status: 400 });
  const record = await getLicense(env.LICENSES, key);
  if (!record) return json({ valid: false });

  // A cancelled subscription stays valid through the period already paid
  // for; lifetime keys have no currentPeriodEnd and never expire this way.
  const expired = record.currentPeriodEnd !== undefined && record.currentPeriodEnd < Date.now();
  const valid = record.status !== "canceled" ? true : !expired;

  return json({
    valid: valid && !expired,
    plan: record.plan,
    status: record.status,
    currentPeriodEnd: record.currentPeriodEnd ?? null,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(req, env) });
    }

    try {
      let res: Response;
      if (req.method === "POST" && url.pathname === "/api/checkout") {
        res = await handleCheckout(req, env);
      } else if (req.method === "POST" && url.pathname === "/api/webhook") {
        // Stripe calls this server-to-server — no CORS headers needed or added.
        return handleWebhook(req, env);
      } else if (req.method === "GET" && url.pathname === "/api/license/session") {
        res = await handleLicenseFromSession(req, env);
      } else if (req.method === "GET" && url.pathname === "/api/license/validate") {
        res = await handleValidate(req, env);
      } else {
        res = json({ error: "not found" }, { status: 404 });
      }

      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders(req, env))) headers.set(k, v as string);
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      return json({ error: (err as Error).message }, { status: 500, headers: corsHeaders(req, env) });
    }
  },
};
