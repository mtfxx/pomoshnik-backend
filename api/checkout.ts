import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStripe } from '../lib/stripe';
import { createLogger, generateRequestId } from '../lib/logger';

const log = createLogger('checkout');

// ============================================================
// STRIPE CHECKOUT — Помощник
// ============================================================
// POST /api/checkout
// Body: { email: string, plan: 'starter' | 'pro' | 'business' }
// ============================================================

const PRICE_MAP: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  business: process.env.STRIPE_PRICE_BUSINESS,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = generateRequestId();

  // CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, plan } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }
    if (!plan || !PRICE_MAP[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Choose: starter, pro, business' });
    }

    const priceId = PRICE_MAP[plan];
    if (!priceId) {
      log.error('Price not configured for plan', { requestId, plan });
      return res.status(503).json({ error: `Price for plan "${plan}" is not configured` });
    }

    const stripe = getStripe();

    log.info('Creating checkout session', { requestId, email, plan });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: process.env.SUCCESS_URL || 'https://pomoshnik.bg/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: process.env.CANCEL_URL || 'https://pomoshnik.bg/cancel',
      metadata: { plan, email },
    });

    log.info('Checkout session created', { requestId, sessionId: session.id, email, plan });

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ url: session.url, sessionId: session.id });

  } catch (error: any) {
    log.error('Checkout error', { requestId, error: error.message });
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
