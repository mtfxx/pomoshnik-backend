import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStripe } from '../lib/stripe';
import { getLicenseByEmail } from '../lib/db';

// ============================================================
// LICENSE KEY RETRIEVAL — Помощник
// ============================================================
// GET /api/license?session_id=cs_xxx
//
// Called from the Success page after Stripe checkout.
// Retrieves the license key associated with the checkout session.
// ============================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionId = req.query.session_id as string;

    if (!sessionId) {
      return res.status(400).json({ error: 'Missing session_id parameter' });
    }

    // Retrieve the Stripe checkout session
    const stripe = getStripe();
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err: any) {
      console.error('[License] Stripe session retrieval error:', err.message);
      return res.status(404).json({ error: 'Invalid or expired session' });
    }

    // Get email from session
    const email = session.customer_email || (session.metadata as any)?.email;
    if (!email) {
      return res.status(404).json({ error: 'No email found in session' });
    }

    // Look up license by email
    const license = await getLicenseByEmail(email);

    if (!license) {
      // License might not be created yet (webhook delay)
      return res.status(202).json({
        status: 'pending',
        message: 'Вашият лиценз се обработва. Моля, опреснете страницата след няколко секунди.',
        email,
      });
    }

    // Return the license key
    return res.status(200).json({
      status: 'ready',
      licenseKey: license.key,
      email: license.email,
      plan: license.plan,
      planName: getPlanName(license.plan),
    });

  } catch (error: any) {
    console.error('[License] Error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function getPlanName(plan: string): string {
  const names: Record<string, string> = {
    free: 'Безплатен',
    starter: 'Стартер',
    pro: 'Про',
    business: 'Бизнес',
  };
  return names[plan] || plan;
}
