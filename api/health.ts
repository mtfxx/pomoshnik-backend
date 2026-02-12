import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redisCommand } from '../lib/db';

// ============================================================
// HEALTH CHECK — Помощник
// ============================================================
// GET /api/health
// Returns system health status including Redis connectivity.
// ============================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // --- Redis check ---
  try {
    const start = Date.now();
    const pong = await redisCommand('PING');
    const latency = Date.now() - start;
    checks.redis = {
      status: pong === 'PONG' ? 'healthy' : 'degraded',
      latencyMs: latency,
    };
  } catch (err: any) {
    checks.redis = { status: 'unhealthy', error: err.message };
  }

  // --- Environment check ---
  const envVars = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'OPENAI_API_KEY',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
  ];
  const missingVars = envVars.filter(v => !process.env[v]);
  checks.environment = {
    status: missingVars.length === 0 ? 'healthy' : 'degraded',
    ...(missingVars.length > 0 && { error: `Missing: ${missingVars.join(', ')}` }),
  };

  // --- Overall status ---
  const allHealthy = Object.values(checks).every(c => c.status === 'healthy');
  const anyUnhealthy = Object.values(checks).some(c => c.status === 'unhealthy');

  const overallStatus = anyUnhealthy ? 'unhealthy' : allHealthy ? 'healthy' : 'degraded';
  const httpStatus = anyUnhealthy ? 503 : 200;

  return res.status(httpStatus).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks,
  });
}
