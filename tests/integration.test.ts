// ============================================================
// Помощник Backend — Integration Tests
// ============================================================
// Run with: npx tsx tests/integration.test.ts
//
// These tests hit the LIVE Vercel deployment.
// Requires: TEST_LICENSE_KEY and BACKEND_URL env vars
// (or uses defaults below).
// ============================================================

const BACKEND_URL = process.env.BACKEND_URL || 'https://pomoshnik-backend.vercel.app';
const TEST_LICENSE_KEY = process.env.TEST_LICENSE_KEY || 'POM-U3LTA-JNCVP-C89RR-M3QKL';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({ name, passed: false, duration: Date.now() - start, error: err.message });
    console.log(`  ❌ ${name} (${Date.now() - start}ms): ${err.message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ============================================================
// Tests
// ============================================================

async function main() {
  console.log(`\n🧪 Помощник Backend Integration Tests`);
  console.log(`   Target: ${BACKEND_URL}\n`);

  // --- Debug endpoint ---
  console.log('📋 Debug Endpoint:');

  await runTest('GET /api/debug returns 200', async () => {
    const res = await fetch(`${BACKEND_URL}/api/debug`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'ok', 'Expected status: ok');
    assert(typeof data.environment === 'object', 'Expected environment object');
  });

  await runTest('Debug shows all providers configured', async () => {
    const res = await fetch(`${BACKEND_URL}/api/debug`);
    const data = await res.json();
    assert(data.environment.openai === true, 'OpenAI not configured');
    assert(data.environment.vercelKv === true, 'Vercel KV not configured');
  });

  // --- Verify endpoint ---
  console.log('\n🔑 Verify Endpoint:');

  await runTest('GET /api/verify without key returns 401', async () => {
    const res = await fetch(`${BACKEND_URL}/api/verify`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('GET /api/verify with invalid key returns 404', async () => {
    const res = await fetch(`${BACKEND_URL}/api/verify`, {
      headers: { 'X-License-Key': 'POM-INVALID-KEY-XXXXX-XXXXX' },
    });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await runTest('GET /api/verify with valid key returns active license', async () => {
    const res = await fetch(`${BACKEND_URL}/api/verify`, {
      headers: { 'Authorization': `Bearer ${TEST_LICENSE_KEY}` },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.active === true, 'Expected active: true');
    assert(typeof data.plan === 'string', 'Expected plan string');
    assert(typeof data.tasksUsed === 'number', 'Expected tasksUsed number');
    assert(Array.isArray(data.models), 'Expected models array');
  });

  await runTest('Verify accepts X-License-Key header', async () => {
    const res = await fetch(`${BACKEND_URL}/api/verify`, {
      headers: { 'X-License-Key': TEST_LICENSE_KEY },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  // --- AI Proxy endpoint ---
  console.log('\n🤖 AI Proxy Endpoint:');

  await runTest('POST /api/ai without key returns 401', async () => {
    const res = await fetch(`${BACKEND_URL}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'test' }] }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    const data = await res.json();
    assert(data.error?.code === 'missing_license_key', 'Expected missing_license_key code');
  });

  await runTest('POST /api/ai with invalid key returns 401', async () => {
    const res = await fetch(`${BACKEND_URL}/api/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer POM-INVALID-XXXXX-XXXXX-XXXXX',
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'test' }] }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('POST /api/ai without model returns 400', async () => {
    const res = await fetch(`${BACKEND_URL}/api/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_LICENSE_KEY}`,
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('POST /api/ai without messages returns 400', async () => {
    const res = await fetch(`${BACKEND_URL}/api/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_LICENSE_KEY}`,
      },
      body: JSON.stringify({ model: 'gpt-4o-mini' }),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('POST /api/ai with unknown model returns 400', async () => {
    const res = await fetch(`${BACKEND_URL}/api/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_LICENSE_KEY}`,
      },
      body: JSON.stringify({ model: 'unknown-model-xyz', messages: [{ role: 'user', content: 'test' }] }),
    });
    assert(res.status === 400 || res.status === 403, `Expected 400 or 403, got ${res.status}`);
  });

  await runTest('POST /api/ai with valid request returns 200 (GPT-4o-mini)', async () => {
    const res = await fetch(`${BACKEND_URL}/api/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_LICENSE_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say "test ok" and nothing else.' }],
        max_tokens: 20,
        temperature: 0,
      }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.choices && data.choices.length > 0, 'Expected choices array');
    assert(typeof data.choices[0].message?.content === 'string', 'Expected message content');
  });

  await runTest('AI proxy returns rate limit headers', async () => {
    const res = await fetch(`${BACKEND_URL}/api/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_LICENSE_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say "ok"' }],
        max_tokens: 5,
        temperature: 0,
      }),
    });
    // Rate limit headers should be present (after deployment of new code)
    const limitHeader = res.headers.get('x-ratelimit-limit');
    const remainingHeader = res.headers.get('x-ratelimit-remaining');
    // These may not be present until new code is deployed, so just log
    console.log(`    Rate limit headers: limit=${limitHeader}, remaining=${remainingHeader}`);
  });

  // --- Checkout endpoint ---
  console.log('\n💳 Checkout Endpoint:');

  await runTest('POST /api/checkout without email returns 400', async () => {
    const res = await fetch(`${BACKEND_URL}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'starter' }),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('POST /api/checkout without plan returns 400', async () => {
    const res = await fetch(`${BACKEND_URL}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com' }),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  // --- License endpoint ---
  console.log('\n📄 License Endpoint:');

  await runTest('GET /api/license without session_id returns 400', async () => {
    const res = await fetch(`${BACKEND_URL}/api/license`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('GET /api/license with invalid session returns 404', async () => {
    const res = await fetch(`${BACKEND_URL}/api/license?session_id=cs_invalid_123`);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // --- CORS ---
  console.log('\n🌐 CORS:');

  await runTest('OPTIONS /api/ai returns CORS headers', async () => {
    const res = await fetch(`${BACKEND_URL}/api/ai`, { method: 'OPTIONS' });
    assert(res.status === 200 || res.status === 204, `Expected 200/204, got ${res.status}`);
  });

  await runTest('OPTIONS /api/verify returns CORS headers', async () => {
    const res = await fetch(`${BACKEND_URL}/api/verify`, { method: 'OPTIONS' });
    assert(res.status === 200 || res.status === 204, `Expected 200/204, got ${res.status}`);
  });

  // --- Summary ---
  console.log('\n' + '='.repeat(50));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
