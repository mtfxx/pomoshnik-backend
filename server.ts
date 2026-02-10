/**
 * Локален тест сървър — симулира Vercel serverless functions
 * Стартирай с: npx ts-node server.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as http from 'http';
import * as url from 'url';

// Import handlers
import checkoutHandler from './api/checkout';
import verifyHandler from './api/verify';
import webhookHandler from './api/webhook';

const PORT = 3000;

// Minimal adapter: convert Node.js req/res to Vercel-like req/res
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url || '', true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse JSON body for POST requests
  let body: any = {};
  if (req.method === 'POST' && pathname !== '/api/webhook') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      body = {};
    }
  }

  // Create Vercel-like request object
  const vercelReq: any = {
    method: req.method,
    headers: req.headers,
    query: parsedUrl.query,
    body,
    url: req.url,
    [Symbol.asyncIterator]: req[Symbol.asyncIterator]?.bind(req),
  };

  // Create Vercel-like response object
  const vercelRes: any = {
    statusCode: 200,
    _headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { this._headers[key] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) {
      res.writeHead(this.statusCode, { ...this._headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    },
    end() {
      res.writeHead(this.statusCode, this._headers);
      res.end();
    },
  };

  try {
    switch (pathname) {
      case '/api/checkout':
        await checkoutHandler(vercelReq, vercelRes);
        break;
      case '/api/verify':
        await verifyHandler(vercelReq, vercelRes);
        break;
      case '/api/webhook':
        await webhookHandler(vercelReq, vercelRes);
        break;
      default:
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'Помощник Backend is running',
          endpoints: ['/api/checkout', '/api/verify', '/api/webhook'],
        }));
    }
  } catch (error: any) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Помощник Backend running at http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /api/checkout  — Create Stripe Checkout session`);
  console.log(`  GET  /api/verify    — Check subscription status`);
  console.log(`  POST /api/webhook   — Stripe webhook handler`);
  console.log(`\nStripe Key: ${process.env.STRIPE_SECRET_KEY?.substring(0, 20)}...`);
});
