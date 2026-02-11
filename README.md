# Помощник Backend

Backend за AI proxy и управление на абонаменти чрез Stripe. Готов за деплой на Vercel.

## Структура

```
pomoshnik-backend/
├── api/
│   ├── ai.ts          — AI proxy (OpenAI, Anthropic, Gemini, DeepSeek)
│   ├── checkout.ts    — Stripe Checkout сесия
│   ├── debug.ts       — Диагностичен endpoint
│   ├── verify.ts      — Валидация на лицензен ключ
│   └── webhook.ts     — Stripe webhook handler
├── lib/
│   ├── config.ts      — Планове, модели, routing логика
│   ├── db.ts          — License key storage (Vercel KV / in-memory)
│   └── stripe.ts      — Stripe клиент
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

### POST /api/webhook
Stripe webhook — обработва `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

### GET /api/debug
Показва статус на конфигурацията (без секрети).

## Деплой на Vercel

1. Качи проекта в GitHub repo
2. Импортирай в Vercel
3. Добави Environment Variables (от `.env.example`)
4. Deploy

## Планове и лимити

| План | Задачи/месец | Модели |
|------|-------------|--------|
| Безплатен | 10 | gpt-4o-mini, gemini-2.0-flash |
| Стартер | 100 | + gpt-4o, gemini-2.5-flash, claude-sonnet, deepseek |
| Про | 500 | + o3-mini, gemini-2.5-pro, claude-opus, deepseek-reasoner |
| Бизнес | Неограничено | Всички модели |

## Лицензни ключове

Формат: `POM-XXXXX-XXXXX-XXXXX-XXXXX`

Ключовете се създават автоматично при успешно Stripe плащане (webhook). За тестване можете да създадете ключ ръчно чрез Vercel KV или in-memory store.
