import type { VercelRequest, VercelResponse } from '@vercel/node';

// ============================================================
// DEBUG ENDPOINT — Помощник
// ============================================================
// GET /api/debug
// Returns environment status (no secrets exposed)
// ============================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: {
      stripe: !!process.env.STRIPE_SECRET_KEY,
      stripeWebhook: !!process.env.STRIPE_WEBHOOK_SECRET,
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      vercelKv: !!process.env.KV_REST_API_URL,
    },
    prices: {
      starter: process.env.STRIPE_PRICE_STARTER ? 'configured' : 'missing',
      pro: process.env.STRIPE_PRICE_PRO ? 'configured' : 'missing',
      business: process.env.STRIPE_PRICE_BUSINESS ? 'configured' : 'missing',
    },
  });
}
