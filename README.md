# Помощник Backend

Backend за AI proxy и управление на абонаменти чрез Stripe. Готов за деплой на Vercel.

## Структура

```
pomoshnik-backend/
├── api/
│   ├── ai.ts          — AI proxy (OpenAI, Anthropic, Gemini, DeepSeek)
│   ├── admin.ts       — Admin endpoint (license CRUD)
│   ├── checkout.ts    — Stripe Checkout сесия
│   ├── debug.ts       — Диагностичен endpoint
│   ├── license.ts     — License key retrieval (post-checkout)
│   ├── verify.ts      — Валидация на лицензен ключ
│   └── webhook.ts     — Stripe webhook handler
├── lib/
│   ├── config.ts      — Планове, модели, routing логика
│   ├── db.ts          — License key storage (Upstash Redis — REQUIRED)
│   ├── logger.ts      — Structured JSON logging
│   ├── ratelimit.ts   — Per-license rate limiting (Redis sliding window)
│   └── stripe.ts      — Stripe клиент
├── tests/
│   └── integration.test.ts — Integration tests (19 tests)
├── .env.example       — Шаблон за environment variables
├── package.json       — Dependencies
├── tsconfig.json      — TypeScript конфигурация
└── vercel.json        — Vercel routing и CORS
```

## API Endpoints

### POST /api/ai (или /api/ai/chat/completions)
AI proxy — приема OpenAI-compatible заявки, определя provider-а от model name.

**Headers:**
- `Authorization: Bearer <license-key>` или `X-License-Key: <license-key>`

**Body (OpenAI format):**
```json
{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "Hello"}],
  "temperature": 0.7,
  "stream": true
}
```

**Model → Provider routing:**
- `gpt-*`, `o3-*`, `o1-*` → OpenAI
- `claude-*` → Anthropic
- `gemini-*` → Google Gemini
- `deepseek-*` → DeepSeek

**Rate Limit Headers (returned on every response):**
- `X-RateLimit-Limit` — max requests per minute for the plan
- `X-RateLimit-Remaining` — remaining requests in current window
- `Retry-After` — seconds until rate limit resets (only on 429)

### GET /api/verify
Валидация на лицензен ключ.

**Headers:** `Authorization: Bearer <license-key>`

**Response:**
```json
{
  "active": true,
  "plan": "pro",
  "planName": "Про",
  "email": "user@example.com",
  "tasksUsed": 42,
  "taskLimit": 500,
  "models": ["gpt-4o", "claude-sonnet-4-20250514", "..."]
}
```

### POST /api/checkout
Създава Stripe Checkout сесия.

**Body:**
```json
{ "email": "user@example.com", "plan": "pro" }
```

### GET /api/license?session_id=cs_xxx
Извлича лицензен ключ след Stripe checkout. Използва се от Success страницата.

### POST /api/webhook
Stripe webhook — обработва `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Webhook signature verification е задължителна (`STRIPE_WEBHOOK_SECRET`).

### POST /api/admin
Admin endpoint за управление на лицензи. Изисква `Authorization: Bearer <ADMIN_SECRET>`.

### GET /api/debug
Показва статус на конфигурацията (без секрети).

## Деплой на Vercel

1. Качи проекта в GitHub repo
2. Импортирай в Vercel
3. Добави Environment Variables (от `.env.example`)
4. Deploy

## Сигурност

### Webhook Verification
Stripe webhook signature verification е имплементирана в `webhook.ts`. `STRIPE_WEBHOOK_SECRET` е **задължителен** в production — без него webhook endpoint-ът връща 500.

### Rate Limiting
Per-license-key rate limiting чрез Redis sliding window:

| План | Заявки/минута |
|------|--------------|
| Безплатен | 5 |
| Стартер | 15 |
| Про | 30 |
| Бизнес | 60 |

### Database (Upstash Redis)
`KV_REST_API_URL` и `KV_REST_API_TOKEN` са **задължителни**. Без тях backend-ът хвърля грешка (не работи с in-memory fallback). Всички лицензни ключове, email индекси и rate limit данни се съхраняват в Redis.

### Error Handling
Грешките от AI провайдърите се нормализират до единен формат:
```json
{
  "error": {
    "message": "User-friendly error message",
    "type": "api_error",
    "code": "provider_error"
  }
}
```
Суровите провайдър грешки **не** се изпращат на клиента.

### Logging
Structured JSON logging с timestamps, request IDs и masked license keys. Пример:
```json
{"timestamp":"2026-02-12T10:00:00.000Z","level":"info","module":"ai-proxy","message":"Proxying AI request","requestId":"req_abc123","licenseKey":"POM-U3L**-****-****-*****","provider":"openai","model":"gpt-4o-mini"}
```

## Тестове

```bash
# Run integration tests against live deployment
npm test

# Or specify custom backend URL
BACKEND_URL=https://your-deployment.vercel.app npm test
```

19 integration теста покриващи: debug, verify, ai proxy, checkout, license, CORS.

## Планове и лимити

| План | Задачи/месец | Заявки/мин | Модели |
|------|-------------|-----------|--------|
| Безплатен | 10 | 5 | gpt-4o-mini, gemini-2.0-flash |
| Стартер | 100 | 15 | + gpt-4o, gemini-2.5-flash, claude-sonnet, deepseek |
| Про | 500 | 30 | + o3-mini, gemini-2.5-pro, claude-opus, deepseek-reasoner |
| Бизнес | Неограничено | 60 | Всички модели |

## Лицензни ключове

Формат: `POM-XXXXX-XXXXX-XXXXX-XXXXX`

Ключовете се създават автоматично при успешно Stripe плащане (webhook). За тестване можете да създадете ключ ръчно чрез `/api/admin` endpoint.
