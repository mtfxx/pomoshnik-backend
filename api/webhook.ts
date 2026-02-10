import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import stripe from '../lib/stripe';
import { getPlanByPriceId } from '../lib/config';
import { saveSubscription, deleteSubscription } from '../lib/db';

// Vercel не парсва body-то автоматично за webhooks — трябва raw body
export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * POST /api/webhook
 * 
 * Обработва събития от Stripe:
 * - checkout.session.completed → нов абонамент
 * - customer.subscription.updated → промяна на план
 * - customer.subscription.deleted → отказ от абонамент
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      // Нов абонамент — потребителят е платил успешно
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const email = session.customer_email;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const plan = session.metadata?.plan || 'starter';

        if (email) {
          await saveSubscription({
            email,
            plan,
            stripeCustomerId: customerId,
            subscriptionId,
            status: 'active',
            updatedAt: new Date().toISOString(),
          });
          console.log(`✅ New subscription: ${email} → ${plan}`);
        }
        break;
      }

      // Промяна на абонамент (upgrade/downgrade или подновяване)
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Вземане на имейла от Stripe Customer обекта
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        const email = customer.email;

        if (email) {
          const priceId = subscription.items.data[0]?.price?.id;
          const planConfig = priceId ? getPlanByPriceId(priceId) : null;

          await saveSubscription({
            email,
            plan: planConfig?.nameEn.toLowerCase() || 'starter',
            stripeCustomerId: customerId,
            subscriptionId: subscription.id,
            status: subscription.status === 'active' ? 'active' : 'past_due',
            updatedAt: new Date().toISOString(),
          });
          console.log(`🔄 Subscription updated: ${email} → ${subscription.status}`);
        }
        break;
      }

      // Отказ от абонамент
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        const email = customer.email;

        if (email) {
          await saveSubscription({
            email,
            plan: 'free',
            stripeCustomerId: customerId,
            subscriptionId: subscription.id,
            status: 'expired',
            updatedAt: new Date().toISOString(),
          });
          console.log(`❌ Subscription canceled: ${email}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('Webhook handler error:', error.message);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
