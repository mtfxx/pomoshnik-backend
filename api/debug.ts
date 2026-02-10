import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const hasKey = !!process.env.STRIPE_SECRET_KEY;
  const keyPrefix = process.env.STRIPE_SECRET_KEY?.substring(0, 12) || 'NOT SET';
  const keyLength = process.env.STRIPE_SECRET_KEY?.length || 0;
  
  // Test basic Stripe connection with fetch
  let stripeTest = 'not tested';
  let stripeError = '';
  try {
    const response = await fetch('https://api.stripe.com/v1/prices?limit=1', {
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      },
    });
    stripeTest = `HTTP ${response.status}`;
    if (response.status === 200) {
      const data = await response.json();
      stripeTest = `OK - found ${data.data?.length} prices`;
    } else {
      const data = await response.json();
      stripeError = JSON.stringify(data.error);
    }
  } catch (e: any) {
    stripeTest = 'FAILED';
    stripeError = e.message;
  }

  return res.status(200).json({
    env: {
      hasStripeKey: hasKey,
      keyPrefix,
      keyLength,
      hasStarterPrice: !!process.env.STRIPE_PRICE_STARTER,
      hasProPrice: !!process.env.STRIPE_PRICE_PRO,
      hasBusinessPrice: !!process.env.STRIPE_PRICE_BUSINESS,
      nodeVersion: process.version,
      region: process.env.VERCEL_REGION || 'unknown',
    },
    stripeConnection: stripeTest,
    stripeError: stripeError || undefined,
  });
}
