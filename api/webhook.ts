import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStripe } from '../lib/stripe';
import { createLicense, saveSubscription, getLicenseByEmail } from '../lib/db';
import { createLogger } from '../lib/logger';

const log = createLogger('webhook');

// ============================================================
// STRIPE WEBHOOK — Помощник
// ============================================================
// POST /api/webhook
// Handles: checkout.session.completed, customer.subscription.updated,
//          customer.subscription.deleted
//
// Security: Stripe webhook signature verification is REQUIRED.
// The STRIPE_WEBHOOK_SECRET env var must be set in production.
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
    log.error('STRIPE_WEBHOOK_SECRET not set — webhook verification disabled. This is a critical security issue in production.');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'] as string;

    if (!sig) {
      log.warn('Webhook request without stripe-signature header');
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err: any) {
      log.error('Webhook signature verification failed', { error: err.message });
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    log.info('Webhook event received', { eventType: event.type, eventId: event.id });

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
            log.info('Updated existing license', { email, plan, licenseKey: existing.key });
          } else {
            // Create new license
            const licenseKey = await createLicense(email, plan, {
              customerId,
              subscriptionId,
            });
            log.info('Created new license', { email, plan, licenseKey });
            // TODO: Send email with license key to user via Resend
          }
        } else {
          log.warn('Checkout completed without email', { sessionId: session.id });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer;
        log.info('Subscription updated', {
          customerId,
          status: subscription.status,
          subscriptionId: subscription.id,
        });
        // TODO: Find license by stripeCustomerId and update status/plan
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer;
        log.info('Subscription cancelled', {
          customerId,
          subscriptionId: subscription.id,
        });
        // TODO: Find license by stripeCustomerId and set status to 'cancelled'
        break;
      }

      default:
        log.debug('Unhandled webhook event type', { eventType: event.type });
    }

    return res.status(200).json({ received: true });

  } catch (error: any) {
    log.error('Webhook processing error', { error: error.message, stack: error.stack?.slice(0, 500) });
    return res.status(500).json({ error: 'Webhook processing error' });
  }
}
