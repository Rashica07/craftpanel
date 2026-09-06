export type Plan = "monthly" | "yearly" | "lifetime";
export type LicenseStatus = "active" | "canceled" | "past_due";

export interface LicenseRecord {
  key: string;
  email: string;
  plan: Plan;
  status: LicenseStatus;
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  createdAt: number;
  currentPeriodEnd?: number; // subscriptions only; undefined for lifetime
}

/** Human-typeable, not a UUID — CraftPanel's own format, easy to read
 * back off a screen or an email. Collisions are astronomically unlikely
 * (80 bits of randomness) so no uniqueness check against KV on write. */
export function generateLicenseKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const groups = hex.match(/.{1,4}/g) ?? [];
  return `CP-${groups.join("-")}`;
}

const licenseDoc = (key: string) => `license:${key}`;
const customerIndex = (stripeCustomerId: string) => `customer:${stripeCustomerId}`;
const sessionIndex = (sessionId: string) => `session:${sessionId}`;

export async function putLicense(kv: KVNamespace, record: LicenseRecord): Promise<void> {
  await kv.put(licenseDoc(record.key), JSON.stringify(record));
  await kv.put(customerIndex(record.stripeCustomerId), record.key);
}

export async function getLicense(kv: KVNamespace, key: string): Promise<LicenseRecord | null> {
  const raw = await kv.get(licenseDoc(key));
  return raw ? (JSON.parse(raw) as LicenseRecord) : null;
}

export async function getLicenseByCustomer(kv: KVNamespace, stripeCustomerId: string): Promise<LicenseRecord | null> {
  const key = await kv.get(customerIndex(stripeCustomerId));
  return key ? getLicense(kv, key) : null;
}

export async function linkSession(kv: KVNamespace, sessionId: string, key: string): Promise<void> {
  // 7-day TTL — only needed long enough for the success page to show the
  // key once right after checkout, not a permanent index.
  await kv.put(sessionIndex(sessionId), key, { expirationTtl: 60 * 60 * 24 * 7 });
}

export async function getLicenseBySession(kv: KVNamespace, sessionId: string): Promise<LicenseRecord | null> {
  const key = await kv.get(sessionIndex(sessionId));
  return key ? getLicense(kv, key) : null;
}
