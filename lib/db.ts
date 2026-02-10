// ============================================================
// DATABASE LAYER — Помощник
// ============================================================
// Използва Vercel KV (Redis) за съхранение на абонаменти.
// Ако нямаш Vercel KV, може да се замени с Supabase, 
// PlanetScale, или дори прост JSON файл за тестване.
//
// Структура: email → { plan, stripeCustomerId, subscriptionId, status, updatedAt }
// ============================================================

export interface Subscription {
  email: string;
  plan: string;
  stripeCustomerId: string;
  subscriptionId: string;
  status: 'active' | 'canceled' | 'past_due' | 'expired';
  updatedAt: string;
}

// --- In-Memory Store (за локално тестване) ---
// При деплой на Vercel, замени с Vercel KV или Supabase.
const memoryStore = new Map<string, Subscription>();

export async function getSubscription(email: string): Promise<Subscription | null> {
  // --- Vercel KV вариант (разкоментирай при деплой): ---
  // import { kv } from '@vercel/kv';
  // return await kv.get<Subscription>(`sub:${email}`);

  return memoryStore.get(email.toLowerCase()) || null;
}

export async function saveSubscription(sub: Subscription): Promise<void> {
  // --- Vercel KV вариант (разкоментирай при деплой): ---
  // import { kv } from '@vercel/kv';
  // await kv.set(`sub:${sub.email}`, sub);

  memoryStore.set(sub.email.toLowerCase(), sub);
}

export async function deleteSubscription(email: string): Promise<void> {
  // --- Vercel KV вариант (разкоментирай при деплой): ---
  // import { kv } from '@vercel/kv';
  // await kv.del(`sub:${email}`);

  memoryStore.delete(email.toLowerCase());
}
