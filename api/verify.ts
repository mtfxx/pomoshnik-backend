import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSubscription } from '../lib/db';
import { PLANS } from '../lib/config';

/**
 * GET /api/verify?email=user@example.com
 * 
 * Проверява абонаментния статус на потребител.
 * Разширението извиква този ендпойнт при стартиране и преди всяка задача.
 * 
 * Response: { plan, taskLimit, status }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = req.query.email as string;

  if (!email) {
    return res.status(400).json({ error: 'Missing email parameter' });
  }

  try {
    const subscription = await getSubscription(email);

    // Няма запис или изтекъл абонамент → безплатен план
    if (!subscription || subscription.status === 'expired') {
      return res.status(200).json({
        plan: 'free',
        taskLimit: PLANS.free.taskLimit,
        status: 'active',
      });
    }

    const planConfig = PLANS[subscription.plan];

    return res.status(200).json({
      plan: subscription.plan,
      taskLimit: planConfig?.taskLimit || PLANS.free.taskLimit,
      status: subscription.status,
    });
  } catch (error: any) {
    console.error('Verify error:', error.message);
    return res.status(500).json({ error: 'Failed to verify subscription' });
  }
}
