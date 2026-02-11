import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStripe } from '../lib/stripe';
import { createLicense, saveSubscription, getLicenseByEmail } from '../lib/db';

// ============================================================
// STRIPE WEBHOOK — Помощник
// ============================================================
// POST /api/webhook
// Handles: checkout.session.completed, customer.subscription.updated,
//          customer.subscription.deleted
// ============================================================

// Vercel requires raw body for webhook signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Webhook] STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'] as string;

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.error('[Webhook] Signature verification failed:', err.message);
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    console.log(`[Webhook] Received event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const email = session.customer_email || session.metadata?.email;
        const plan = session.metadata?.plan || 'starter';
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (email) {
          // Check if user already has a license
          const existing = await getLicenseByEmail(email);
          if (existing) {
            // Update existing license
            await saveSubscription(email, {
              plan,
              status: 'active',
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
            });
            console.log(`[Webhook] Updated license for ${email} to plan: ${plan}`);
          } else {
            // Create new license
            const licenseKey = await createLicense(email, plan, {
              customerId,
              subscriptionId,
            });
            console.log(`[Webhook] Created license ${licenseKey} for ${email}, plan: ${plan}`);
            // TODO: Send email with license key to user
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer;
        // Look up by customer ID would be ideal, but for now log it
        console.log(`[Webhook] Subscription updated for customer: ${customerId}, status: ${subscription.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer;
        console.log(`[Webhook] Subscription cancelled for customer: ${customerId}`);
        // TODO: Find license by stripeCustomerId and set status to 'cancelled'
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });

  } catch (error: any) {
    console.error('[Webhook] Error:', error.message);
    return res.status(500).json({ error: 'Webhook processing error' });
  }
}
