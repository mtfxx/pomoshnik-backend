import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getLicense, incrementTaskCount } from '../lib/db';
import { PLANS, getProviderFromModel, isModelAllowed } from '../lib/config';

// ============================================================
// AI PROXY ENDPOINT — Помощник
// ============================================================
// POST /api/ai  (also rewritten from /api/ai/chat/completions)
//
// Приема OpenAI-compatible заявки от extension-а.
// Автоматично определя provider-а от model name.
// Автентикация чрез license key (Authorization: Bearer <key>).
// ============================================================

// Provider API URLs
const PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/chat/completions',
};

// Get API key for provider from environment
function getApiKey(provider: string): string | null {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY || null;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY || null;
    case 'gemini':
      return process.env.GEMINI_API_KEY || null;
    case 'deepseek':
      return process.env.DEEPSEEK_API_KEY || null;
    default:
      return null;
  }
}

// Extract license key from request headers
function extractLicenseKey(req: VercelRequest): string | null {
  // Check X-License-Key header first
  const xKey = req.headers['x-license-key'];
  if (xKey && typeof xKey === 'string') return xKey;

  // Check Authorization: Bearer <key>
  const auth = req.headers['authorization'];
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  return null;
}

// Build request for OpenAI / DeepSeek (same format)
function buildOpenAIRequest(body: any, apiKey: string, provider: string) {
  const payload: any = {
    model: body.model,
    messages: body.messages,
  };
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.max_tokens !== undefined) payload.max_tokens = body.max_tokens;
  if (body.stream !== undefined) payload.stream = body.stream;
  if (body.response_format !== undefined) payload.response_format = body.response_format;
  if (body.top_p !== undefined) payload.top_p = body.top_p;

  // Stream options for OpenAI
  if (body.stream && body.stream_options) {
    payload.stream_options = body.stream_options;
  }

  const url = provider === 'deepseek' ? PROVIDER_URLS.deepseek : PROVIDER_URLS.openai;

  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  };
}

// Build request for Anthropic
function buildAnthropicRequest(body: any, apiKey: string) {
  const systemMessage = body.messages.find((m: any) => m.role === 'system');
  const nonSystemMessages = body.messages.filter((m: any) => m.role !== 'system');

  const payload: any = {
    model: body.model,
    messages: nonSystemMessages,
    max_tokens: body.max_tokens || 4096,
  };
  if (systemMessage) payload.system = systemMessage.content;
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.stream !== undefined) payload.stream = body.stream;
  if (body.top_p !== undefined) payload.top_p = body.top_p;

  return {
    url: PROVIDER_URLS.anthropic,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  };
}

// Build request for Gemini
function buildGeminiRequest(body: any, apiKey: string) {
  const systemMessage = body.messages.find((m: any) => m.role === 'system');
  const nonSystemMessages = body.messages.filter((m: any) => m.role !== 'system');

  const contents = nonSystemMessages.map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  const payload: any = {
    contents,
    generationConfig: {} as any,
  };
  if (systemMessage) {
    payload.systemInstruction = { parts: [{ text: systemMessage.content }] };
  }
  if (body.temperature !== undefined) payload.generationConfig.temperature = body.temperature;
  if (body.max_tokens !== undefined) payload.generationConfig.maxOutputTokens = body.max_tokens;
  if (body.top_p !== undefined) payload.generationConfig.topP = body.top_p;

  const method = body.stream ? 'streamGenerateContent' : 'generateContent';
  const url = `${PROVIDER_URLS.gemini}/models/${body.model}:${method}?key=${apiKey}`;

  return {
    url,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

// ============================================================
// Main Handler
// ============================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-License-Key, X-Feature');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // --- Extract license key ---
    const licenseKey = extractLicenseKey(req);
    if (!licenseKey) {
      return res.status(401).json({
        error: {
          message: 'Missing license key. Please enter your license key in extension settings.',
          type: 'authentication_error',
          code: 'missing_license_key',
        },
      });
    }

    // --- Validate license ---
    const license = await getLicense(licenseKey);
    if (!license || license.status !== 'active') {
      return res.status(401).json({
        error: {
          message: 'Invalid or expired license key. Please check your key or renew your subscription.',
          type: 'authentication_error',
          code: 'invalid_license_key',
        },
      });
    }

    // --- Parse body ---
    const { model, messages, temperature, max_tokens, stream, response_format, top_p, stream_options } = req.body;

    if (!model) {
      return res.status(400).json({ error: { message: 'Missing model', type: 'invalid_request_error' } });
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'Missing or invalid messages', type: 'invalid_request_error' } });
    }

    // --- Check model access ---
    const plan = license.plan || 'free';
    if (!isModelAllowed(plan, model)) {
      return res.status(403).json({
        error: {
          message: `Model "${model}" is not available on your ${PLANS[plan]?.name || plan} plan. Please upgrade.`,
          type: 'permission_error',
          code: 'model_not_allowed',
        },
      });
    }

    // --- Check task limit ---
    const planConfig = PLANS[plan] || PLANS.free;
    if (planConfig.taskLimit !== -1 && license.tasksUsedThisMonth >= planConfig.taskLimit) {
      return res.status(429).json({
        error: {
          message: `Monthly task limit reached (${planConfig.taskLimit}). Please upgrade your plan.`,
          type: 'rate_limit_error',
          code: 'task_limit_reached',
        },
      });
    }

    // --- Determine provider ---
    const provider = getProviderFromModel(model);
    if (!provider) {
      return res.status(400).json({
        error: {
          message: `Unknown model: ${model}. Cannot determine provider.`,
          type: 'invalid_request_error',
          code: 'unknown_model',
        },
      });
    }

    // --- Get API key ---
    const apiKey = getApiKey(provider);
    if (!apiKey) {
      return res.status(503).json({
        error: {
          message: `Provider ${provider} is not configured. Contact support.`,
          type: 'server_error',
          code: 'provider_not_configured',
        },
      });
    }

    // --- Increment task counter ---
    await incrementTaskCount(licenseKey);

    // --- Build provider request ---
    let providerRequest: { url: string; headers: Record<string, string>; body: string };

    switch (provider) {
      case 'openai':
      case 'deepseek':
        providerRequest = buildOpenAIRequest(req.body, apiKey, provider);
        break;
      case 'anthropic':
        providerRequest = buildAnthropicRequest(req.body, apiKey);
        break;
      case 'gemini':
        providerRequest = buildGeminiRequest(req.body, apiKey);
        break;
      default:
        return res.status(400).json({ error: { message: 'Invalid provider', type: 'invalid_request_error' } });
    }

    // --- Streaming response ---
    if (stream) {
      const providerRes = await fetch(providerRequest.url, {
        method: 'POST',
        headers: providerRequest.headers,
        body: providerRequest.body,
      });

      if (!providerRes.ok) {
        const errorBody = await providerRes.text();
        console.error(`[AI Proxy] ${provider} error:`, providerRes.status, errorBody);
        return res.status(providerRes.status).json({
          error: {
            message: `${provider} API error: ${providerRes.status}`,
            type: 'api_error',
            details: errorBody,
          },
        });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const reader = providerRes.body?.getReader();
      if (!reader) {
        return res.status(500).json({ error: { message: 'Failed to read stream', type: 'server_error' } });
      }

      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      } catch (streamError) {
        console.error('[AI Proxy] Stream error:', streamError);
      } finally {
        res.end();
      }
      return;
    }

    // --- Non-streaming response ---
    const providerRes = await fetch(providerRequest.url, {
      method: 'POST',
      headers: providerRequest.headers,
      body: providerRequest.body,
    });

    const responseData = await providerRes.json();

    if (!providerRes.ok) {
      console.error(`[AI Proxy] ${provider} error:`, providerRes.status, JSON.stringify(responseData));
      return res.status(providerRes.status).json({
        error: {
          message: `${provider} API error`,
          type: 'api_error',
          status: providerRes.status,
          details: responseData,
        },
      });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(responseData);

  } catch (error: any) {
    console.error('[AI Proxy] Unexpected error:', error.message);
    return res.status(500).json({
      error: {
        message: 'AI proxy internal error',
        type: 'server_error',
        details: error.message,
      },
    });
  }
}
