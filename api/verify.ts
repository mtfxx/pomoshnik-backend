import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getLicense } from '../lib/db';
import { PLANS } from '../lib/config';

// ============================================================
// LICENSE KEY VERIFICATION — Помощник
// ============================================================
// GET /api/verify
//   Authorization: Bearer <license-key>
//   OR X-License-Key: <license-key>
//
// Returns: { active: boolean, plan: string, planName: string,
//            tasksUsed: number, taskLimit: number }
// ============================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-License-Key');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract license key
    const xKey = req.headers['x-license-key'];
    const auth = req.headers['authorization'];
    let licenseKey: string | null = null;

    if (xKey && typeof xKey === 'string') {
      licenseKey = xKey;
    } else if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
      licenseKey = auth.slice(7).trim();
    }

    if (!licenseKey) {
      return res.status(401).json({
        active: false,
        error: 'Missing license key',
      });
    }

    // Look up license
    const license = await getLicense(licenseKey);

    if (!license) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(404).json({
        active: false,
        error: 'License key not found',
      });
    }

    if (license.status !== 'active') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(403).json({
        active: false,
        plan: license.plan,
        planName: PLANS[license.plan]?.name || license.plan,
        status: license.status,
        error: `License is ${license.status}`,
      });
    }

    // Active license — return info
    const planConfig = PLANS[license.plan] || PLANS.free;

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
      active: true,
      plan: license.plan,
      planName: planConfig.name,
      email: license.email,
      tasksUsed: license.tasksUsedThisMonth,
      taskLimit: planConfig.taskLimit,
      models: planConfig.models,
      monthResetDate: license.monthResetDate,
    });

  } catch (error: any) {
    console.error('[Verify] Error:', error.message);
    return res.status(500).json({
      active: false,
      error: 'Internal server error',
    });
  }
}
