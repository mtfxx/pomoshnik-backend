import type { VercelRequest, VercelResponse } from '@vercel/node';
import stripe from '../lib/stripe';
import { PLANS, URLS } from '../lib/config';

/**
 * POST /api/checkout
 * 
 * Създава Stripe Checkout сесия и връща URL за плащане.
 * Apple Pay и Google Pay работят автоматично в Stripe Checkout.
 * 
 * Body: { email: string, plan: "starter" | "pro" | "business" }
 * Response: { url: string }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, plan } = req.body;

    // Валидация
    if (!email || !plan) {
      return res.status(400).json({ error: 'Missing email or plan' });
    }

    const selectedPlan = PLANS[plan];
    if (!selectedPlan || plan === 'free') {
      return res.status(400).json({ error: 'Invalid plan. Choose: starter, pro, or business' });
    }

    // Създаване на Stripe Checkout сесия
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [
        {
          price: selectedPlan.priceId,
          quantity: 1,
        },
      ],
      // Apple Pay + Google Pay работят автоматично тук!
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      locale: 'auto',
      success_url: `${URLS.success}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: URLS.cancel,
      metadata: {
        plan: plan,
        source: 'pomoshnik-extension',
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (error: any) {
    console.error('Checkout error:', error.message, error.type, error.code);
    return res.status(500).json({ 
      error: 'Failed to create checkout session',
      details: error.message,
      type: error.type,
      code: error.code 
    });
  }
}
