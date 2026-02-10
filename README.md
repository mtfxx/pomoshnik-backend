# Помощник Backend

Минимален backend за обработка на плащания чрез Stripe и AI proxy за LLM заявки. Готов за деплой на Vercel.

## Структура

```
pomoshnik-backend/
├── api/
│   ├── ai.ts         — AI proxy endpoint (OpenAI, Anthropic, Gemini)
│   ├── checkout.ts   — Създава Stripe Checkout сесия (Apple Pay автоматично)
│   ├── debug.ts      — Debug endpoint за диагностика
│   ├── webhook.ts    — Обработва Stripe webhook събития
│   └── verify.ts     — Проверява абонаментен статус
├── lib/
│   ├── config.ts     — Планове и цени (лесно конфигурируеми)
│   ├── stripe.ts     — Stripe клиент
│   └── db.ts         — Database layer (in-memory → Vercel KV при деплой)
├── .env.example      — Шаблон за environment variables
├── vercel.json       — Vercel конфигурация
└── tsconfig.json     — TypeScript конфигурация
```

## Деплой на Vercel

1. Създай акаунт в [vercel.com](https://vercel.com) (безплатно)
2. Качи проекта в GitHub repo
3. Импортирай repo-то в Vercel
4. Добави Environment Variables (от `.env.example`)
5. Deploy!

## Stripe Настройка

1. Създай акаунт в [stripe.com](https://stripe.com)
2. Създай Products и Prices в Stripe Dashboard
3. Копирай Price ID-тата в environment variables
4. Създай Webhook endpoint: `https://your-domain.vercel.app/api/webhook`
5. Избери events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

## AI Provider Настройка

Добави следните environment variables в Vercel:
- `OPENAI_API_KEY` — от [platform.openai.com](https://platform.openai.com)
- `ANTHROPIC_API_KEY` — от [console.anthropic.com](https://console.anthropic.com)
- `GEMINI_API_KEY` — от [aistudio.google.com](https://aistudio.google.com)

## API Endpoints

### POST /api/ai — AI Proxy
Проксира LLM заявки от разширението. Поддържа streaming.

```json
{
  "email": "user@example.com",
  "provider": "openai",
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": false
}
```
