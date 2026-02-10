# Помощник Backend

Минимален backend за обработка на плащания чрез Stripe. Готов за деплой на Vercel.

## Структура

```
pomoshnik-backend/
├── api/
│   ├── checkout.ts   — Създава Stripe Checkout сесия (Apple Pay автоматично)
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
