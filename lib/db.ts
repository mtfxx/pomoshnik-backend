// ============================================================
// Помощник — Database Layer (Upstash Redis)
// ============================================================
// Използва Upstash Redis чрез REST API за съхранение на
// лицензни ключове и абонаменти.
// Env vars: KV_REST_API_URL, KV_REST_API_TOKEN
// ============================================================

export interface LicenseRecord {
  key: string;
  email: string;
  plan: string;          // 'free' | 'starter' | 'pro' | 'business'
  status: string;        // 'active' | 'expired' | 'cancelled'
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  tasksUsedThisMonth: number;
  monthResetDate: string; // ISO date string
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Upstash Redis REST client (no npm package needed)
// ============================================================

/**
 * Execute a Redis command via Upstash REST API.
 * Exported so other modules (e.g. ratelimit.ts) can reuse it.
 */
export async function redisCommand(...args: (string | number)[]): Promise<any> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    const msg = '[DB] CRITICAL: KV_REST_API_URL or KV_REST_API_TOKEN not configured. Redis is required for production.';
    console.error(msg);
    throw new Error(msg);
  }

  try {
    const response = await fetch(`${url}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DB] Redis error (${response.status}):`, errorText);
      return null;
    }

    const data = await response.json();
    return data.result;
  } catch (err: any) {
    console.error('[DB] Redis request error:', err.message);
    return null;
  }
}

// ============================================================
// License Key Operations
// ============================================================

export async function getLicense(licenseKey: string): Promise<LicenseRecord | null> {
  const data = await redisCommand('GET', `license:${licenseKey}`);
  if (!data) return null;

  try {
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return null;
  }
}

export async function setLicense(licenseKey: string, record: LicenseRecord): Promise<void> {
  const json = JSON.stringify(record);
  await redisCommand('SET', `license:${licenseKey}`, json);
  // Also maintain email→key index
  await redisCommand('SET', `email:${record.email}`, licenseKey);
}

export async function incrementTaskCount(licenseKey: string): Promise<number> {
  const record = await getLicense(licenseKey);
  if (!record) return -1;

  // Check if we need to reset the monthly counter
  const now = new Date();
  const resetDate = new Date(record.monthResetDate);
  if (now >= resetDate) {
    record.tasksUsedThisMonth = 0;
    record.monthResetDate = getNextMonthReset();
  }

  record.tasksUsedThisMonth += 1;
  record.updatedAt = now.toISOString();
  await setLicense(licenseKey, record);

  return record.tasksUsedThisMonth;
}

export async function getLicenseByEmail(email: string): Promise<LicenseRecord | null> {
  const licenseKey = await redisCommand('GET', `email:${email}`);
  if (!licenseKey) return null;

  return getLicense(typeof licenseKey === 'string' ? licenseKey : String(licenseKey));
}

// Legacy compatibility — used by existing checkout/webhook code
export async function getSubscription(email: string): Promise<{ plan: string; status: string } | null> {
  const record = await getLicenseByEmail(email);
  if (!record) return null;
  return { plan: record.plan, status: record.status };
}

export async function saveSubscription(email: string, data: {
  plan: string;
  status: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}): Promise<void> {
  let record = await getLicenseByEmail(email);
  if (record) {
    record.plan = data.plan;
    record.status = data.status;
    if (data.stripeCustomerId) record.stripeCustomerId = data.stripeCustomerId;
    if (data.stripeSubscriptionId) record.stripeSubscriptionId = data.stripeSubscriptionId;
    record.updatedAt = new Date().toISOString();
    await setLicense(record.key, record);
  }
}

// ============================================================
// License Key Generation
// ============================================================

export function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
  const segments = 4;
  const segmentLength = 5;
  const parts: string[] = [];

  for (let s = 0; s < segments; s++) {
    let segment = '';
    for (let i = 0; i < segmentLength; i++) {
      segment += chars[Math.floor(Math.random() * chars.length)];
    }
    parts.push(segment);
  }

  return `POM-${parts.join('-')}`; // e.g., POM-A3B5C-D7E9F-G2H4J-K6L8M
}

function getNextMonthReset(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toISOString();
}

// ============================================================
// Create a new license for a user (called after Stripe checkout)
// ============================================================

export async function createLicense(email: string, plan: string, stripeData?: {
  customerId?: string;
  subscriptionId?: string;
}): Promise<string> {
  const key = generateLicenseKey();
  const now = new Date();

  const record: LicenseRecord = {
    key,
    email,
    plan,
    status: 'active',
    stripeCustomerId: stripeData?.customerId,
    stripeSubscriptionId: stripeData?.subscriptionId,
    tasksUsedThisMonth: 0,
    monthResetDate: getNextMonthReset(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await setLicense(key, record);
  return key;
}
