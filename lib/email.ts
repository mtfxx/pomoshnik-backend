// ============================================================
// Помощник — Email (Resend)
// ============================================================
// Sends transactional emails via Resend API.
// Env var: RESEND_API_KEY
// No npm package needed — uses fetch directly.
// ============================================================

import { createLogger } from './logger';

const log = createLogger('email');

const RESEND_API_URL = 'https://api.resend.com/emails';

// Plan display names
const PLAN_NAMES: Record<string, string> = {
  free: 'Безплатен',
  starter: 'Стартер',
  pro: 'Про',
  business: 'Бизнес',
};

/**
 * Send the license key email to a new customer after Stripe checkout.
 */
export async function sendLicenseKeyEmail(
  email: string,
  licenseKey: string,
  plan: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    log.warn('RESEND_API_KEY not set — skipping email send', { email });
    return false;
  }

  const fromAddress = process.env.RESEND_FROM || 'Помощник <noreply@pomoshnik.bg>';
  const planName = PLAN_NAMES[plan] || plan;

  const htmlBody = `
<!DOCTYPE html>
<html lang="bg">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a2e;">
  <div style="text-align: center; padding: 30px 0;">
    <h1 style="color: #6366f1; margin: 0; font-size: 28px;">🤖 Помощник</h1>
    <p style="color: #64748b; margin-top: 8px;">AI Асистент за Браузъра</p>
  </div>

  <div style="background: #f8fafc; border-radius: 12px; padding: 30px; margin: 20px 0;">
    <h2 style="margin-top: 0; color: #1a1a2e;">Добре дошли в план ${planName}! 🎉</h2>
    <p>Благодарим ви за покупката. Ето вашият лицензен ключ:</p>

    <div style="background: #1a1a2e; color: #22d3ee; padding: 16px 20px; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 18px; text-align: center; letter-spacing: 1px; margin: 20px 0;">
      ${licenseKey}
    </div>

    <p style="color: #64748b; font-size: 14px;">Копирайте ключа и го въведете в настройките на extension-а.</p>
  </div>

  <div style="background: #f0f9ff; border-radius: 12px; padding: 24px; margin: 20px 0;">
    <h3 style="margin-top: 0; color: #1a1a2e;">Как да активирате:</h3>
    <ol style="color: #475569; line-height: 1.8;">
      <li>Отворете extension-а Помощник в Chrome</li>
      <li>Кликнете на ⚙️ иконата за настройки</li>
      <li>Поставете лицензния ключ в полето</li>
      <li>Изберете AI модел и започнете!</li>
    </ol>
  </div>

  <div style="text-align: center; padding: 20px 0; color: #94a3b8; font-size: 13px;">
    <p>Ако имате въпроси, отговорете на този имейл.</p>
    <p>© ${new Date().getFullYear()} Помощник — pomoshnik.bg</p>
  </div>
</body>
</html>`;

  const textBody = `Помощник — Вашият лицензен ключ

Добре дошли в план ${planName}!

Вашият лицензен ключ: ${licenseKey}

Как да активирате:
1. Отворете extension-а Помощник в Chrome
2. Кликнете на ⚙️ иконата за настройки
3. Поставете лицензния ключ в полето
4. Изберете AI модел и започнете!

© ${new Date().getFullYear()} Помощник — pomoshnik.bg`;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [email],
        subject: `Помощник — Вашият лицензен ключ (${planName})`,
        html: htmlBody,
        text: textBody,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      log.error('Resend API error', { email, status: response.status, error: errorData });
      return false;
    }

    const result = await response.json();
    log.info('License key email sent', { email, plan, resendId: result.id });
    return true;

  } catch (err: any) {
    log.error('Failed to send email', { email, error: err.message });
    return false;
  }
}
