// ============================================================
// КОНФИГУРАЦИЯ НА ПЛАНОВЕТЕ — Помощник
// ============================================================
// Промени цените и лимитите тук. Не е нужно да пипаш друг код.
// След промяна, трябва да създадеш съответните Products/Prices
// в Stripe Dashboard и да обновиш priceId-тата по-долу.
// ============================================================

export interface PlanConfig {
  name: string;
  nameEn: string;
  taskLimit: number;
  priceId: string; // Stripe Price ID — ще се попълни след създаване в Stripe Dashboard
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    name: 'Безплатен',
    nameEn: 'Free',
    taskLimit: 20,
    priceId: '', // Безплатният план няма Price ID
  },
  starter: {
    name: 'Starter',
    nameEn: 'Starter',
    taskLimit: 100,
    priceId: process.env.STRIPE_PRICE_STARTER || 'price_1SzMIzGslp9oqPrIMrHeX3wT',
  },
  pro: {
    name: 'Pro',
    nameEn: 'Pro',
    taskLimit: 300,
    priceId: process.env.STRIPE_PRICE_PRO || 'price_1SzMKNGslp9oqPrIGMvuL3y8',
  },
  business: {
    name: 'Business',
    nameEn: 'Business',
    taskLimit: 1000,
    priceId: process.env.STRIPE_PRICE_BUSINESS || 'price_1SzML2Gslp9oqPrIFGhJsgir',
  },
};

// Обратно търсене: от Stripe Price ID → план
export function getPlanByPriceId(priceId: string): PlanConfig | null {
  for (const plan of Object.values(PLANS)) {
    if (plan.priceId === priceId) return plan;
  }
  return null;
}

// URL-и за пренасочване след плащане
export const URLS = {
  success: process.env.SUCCESS_URL || 'https://pomoshnik.bg/success',
  cancel: process.env.CANCEL_URL || 'https://pomoshnik.bg/cancel',
};
