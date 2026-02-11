// ============================================================
// Помощник — Database Layer
// ============================================================
// Използва Vercel KV (Redis) за съхранение на лицензни ключове
// и абонаменти. Ако KV не е наличен, използва in-memory store.
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

// In-memory store (fallback when Vercel KV is not available)
const memoryStore = new Map<string, LicenseRecord>();

// ============================================================
// Vercel KV helpers (if @vercel/kv is installed)
// ============================================================
let kv: any = null;

async function getKV() {
  if (kv !== null) return kv;
  try {
    // Dynamic import — only works if @vercel/kv is installed
    const mod = await (Function('return import("@vercel/kv")')() as Promise<any>);
    kv = mod.kv || mod.default;
    return kv;
  } catch {
    kv = false; // Mark as unavailable
    return null;
  }
}

// ============================================================
// License Key Operations
// ============================================================

export async function getLicense(licenseKey: string): Promise<LicenseRecord | null> {
  const store = await getKV();
  
  if (store) {
    try {
      const record = await store.get(`license:${licenseKey}`);
      return record as LicenseRecord | null;
    } catch (err) {
      console.error('[DB] KV get error:', err);
    }
  }
  
  // Fallback to memory
  return memoryStore.get(licenseKey) || null;
}

export async function setLicense(licenseKey: string, record: LicenseRecord): Promise<void> {
  const store = await getKV();
  
  if (store) {
    try {
      await store.set(`license:${licenseKey}`, record);
      // Also maintain email→key index
      await store.set(`email:${record.email}`, licenseKey);
      return;
    } catch (err) {
      console.error('[DB] KV set error:', err);
    }
  }
  
  // Fallback to memory
  memoryStore.set(licenseKey, record);
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
  const store = await getKV();
  
  if (store) {
    try {
      const key = await store.get(`email:${email}`);
      if (key) {
        return getLicense(key as string);
      }
    } catch (err) {
      console.error('[DB] KV email lookup error:', err);
    }
  }
  
  // Fallback: search memory store
  for (const [, record] of memoryStore) {
    if (record.email === email) return record;
  }
  
  return null;
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
