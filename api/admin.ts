import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createLicense, getLicense, getLicenseByEmail } from '../lib/db';

// ============================================================
// ADMIN ENDPOINT — Помощник
// ============================================================
// POST /api/admin   — Create a test license
//   Body: { action: 'create-license', email: string, plan: string }
//   Header: Authorization: Bearer <ADMIN_SECRET or STRIPE_SECRET_KEY>
//
// GET /api/admin?action=lookup&key=POM-XXXXX
//   — Look up a license by key
//
// GET /api/admin?action=lookup-email&email=test@example.com
//   — Look up a license by email
// ============================================================

function isAuthorized(req: VercelRequest): boolean {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7).trim();

  // Accept ADMIN_SECRET or STRIPE_SECRET_KEY as admin auth
  const adminSecret = process.env.ADMIN_SECRET || process.env.STRIPE_SECRET_KEY;
  return token === adminSecret;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Auth check
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized. Provide admin secret in Authorization header.' });
  }

  try {
    // --- POST: Create license ---
    if (req.method === 'POST') {
      const { action, email, plan } = req.body;

      if (action !== 'create-license') {
        return res.status(400).json({ error: 'Unknown action. Use: create-license' });
      }

      if (!email) {
        return res.status(400).json({ error: 'Missing email' });
      }

      const validPlans = ['free', 'starter', 'pro', 'business'];
      const selectedPlan = validPlans.includes(plan) ? plan : 'starter';

      // Check if email already has a license
      const existing = await getLicenseByEmail(email);
      if (existing) {
        return res.status(200).json({
          message: 'License already exists for this email',
          licenseKey: existing.key,
          email: existing.email,
          plan: existing.plan,
          status: existing.status,
        });
      }

      // Create new license
      const licenseKey = await createLicense(email, selectedPlan);

      return res.status(201).json({
        message: 'License created successfully',
        licenseKey,
        email,
        plan: selectedPlan,
      });
    }

    // --- GET: Lookup license ---
    if (req.method === 'GET') {
      const action = req.query.action as string;

      if (action === 'lookup') {
        const key = req.query.key as string;
        if (!key) return res.status(400).json({ error: 'Missing key parameter' });

        const license = await getLicense(key);
        if (!license) return res.status(404).json({ error: 'License not found' });

        return res.status(200).json(license);
      }

      if (action === 'lookup-email') {
        const email = req.query.email as string;
        if (!email) return res.status(400).json({ error: 'Missing email parameter' });

        const license = await getLicenseByEmail(email);
        if (!license) return res.status(404).json({ error: 'No license found for this email' });

        return res.status(200).json(license);
      }

      return res.status(400).json({ error: 'Unknown action. Use: lookup, lookup-email' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error: any) {
    console.error('[Admin] Error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
