import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getLicense, incrementTaskCount } from '../lib/db';
import { PLANS, getProviderFromModel, isModelAllowed } from '../lib/config';
import { checkRateLimit } from '../lib/ratelimit';
import { createLogger, generateRequestId } from '../lib/logger';

const log = createLogger('ai-proxy');

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
  const xKey = req.headers['x-license-key'];
  if (xKey && typeof xKey === 'string') return xKey;

  const auth = req.headers['authorization'];
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  return null;
}

// ============================================================
// Provider Error Normalization
// ============================================================
// Each provider returns errors in a different format.
// We normalize them all to a consistent structure.

interface NormalizedError {
  message: string;
  type: string;
  code: string;
  provider: string;
  statusCode: number;
}

function normalizeProviderError(
  provider: string,
  statusCode: number,
  rawBody: any,
): NormalizedError {
  const base: NormalizedError = {
    message: 'AI provider returned an error',
    type: 'api_error',
    code: 'provider_error',
    provider,
    statusCode,
  };

  try {
    switch (provider) {
      case 'openai':
      case 'deepseek': {
        // OpenAI format: { error: { message, type, code } }
        const err = rawBody?.error;
        if (err) {
          base.message = err.message || base.message;
          base.type = err.type || base.type;
          base.code = err.code || base.code;
        }
        break;
      }

      case 'anthropic': {
        // Anthropic format: { error: { type, message } } or { type, error: { type, message } }
        const err = rawBody?.error;
        if (err) {
          base.message = err.message || base.message;
          base.type = err.type || base.type;
          base.code = err.type || base.code;
        } else if (rawBody?.type === 'error') {
          base.message = rawBody.message || base.message;
          base.type = rawBody.error?.type || base.type;
        }
        break;
      }

      case 'gemini': {
        // Gemini format: { error: { code, message, status } } or [{ error: { ... } }]
        const err = Array.isArray(rawBody) ? rawBody[0]?.error : rawBody?.error;
        if (err) {
          base.message = err.message || base.message;
          base.code = err.status || String(err.code) || base.code;
          base.type = 'gemini_error';
        }
        break;
      }
    }

    // Map common HTTP status codes to user-friendly messages
    if (statusCode === 401 || statusCode === 403) {
      base.message = `Authentication error with ${provider}. Please contact support.`;
      base.code = 'provider_auth_error';
    } else if (statusCode === 429) {
      base.message = `${provider} rate limit exceeded. Please try again in a moment.`;
      base.code = 'provider_rate_limit';
    } else if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
      base.message = `${provider} is temporarily unavailable. Please try again later.`;
      base.code = 'provider_unavailable';
    }
  } catch {
    // If normalization fails, return the base error
  }

  return base;
}

// ============================================================
// Request Builders (OpenAI, Anthropic, Gemini)
// ============================================================

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
  const requestId = generateRequestId();

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-License-Key, X-Feature');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed', type: 'invalid_request_error' } });
  }

  try {
    // --- Extract license key ---
    const licenseKey = extractLicenseKey(req);
    if (!licenseKey) {
      log.warn('Request without license key', { requestId });
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
      log.warn('Invalid license key used', { requestId, licenseKey });
      return res.status(401).json({
        error: {
          message: 'Invalid or expired license key. Please check your key or renew your subscription.',
          type: 'authentication_error',
          code: 'invalid_license_key',
        },
      });
    }

    // --- Rate limiting ---
    const plan = license.plan || 'free';
    const rateResult = await checkRateLimit(licenseKey, plan);
    if (!rateResult.allowed) {
      log.warn('Rate limit exceeded', {
        requestId,
        licenseKey,
        plan,
        limit: rateResult.limit,
        resetIn: rateResult.resetInSeconds,
      });
      res.setHeader('Retry-After', String(rateResult.resetInSeconds));
      res.setHeader('X-RateLimit-Limit', String(rateResult.limit));
      res.setHeader('X-RateLimit-Remaining', '0');
      return res.status(429).json({
        error: {
          message: `Rate limit exceeded. Maximum ${rateResult.limit} requests per minute on your ${plan} plan. Retry after ${rateResult.resetInSeconds} seconds.`,
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded',
          retryAfter: rateResult.resetInSeconds,
        },
      });
    }

    // Set rate limit headers on all responses
    res.setHeader('X-RateLimit-Limit', String(rateResult.limit));
    res.setHeader('X-RateLimit-Remaining', String(rateResult.remaining));

    // --- Parse body ---
    const { model, messages, stream } = req.body;

    if (!model) {
      return res.status(400).json({ error: { message: 'Missing model', type: 'invalid_request_error' } });
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'Missing or invalid messages', type: 'invalid_request_error' } });
    }

    // --- Check model access ---
    if (!isModelAllowed(plan, model)) {
      log.info('Model not allowed for plan', { requestId, licenseKey, plan, model });
      return res.status(403).json({
        error: {
          message: `Model "${model}" is not available on your ${PLANS[plan]?.name || plan} plan. Please upgrade.`,
          type: 'permission_error',
          code: 'model_not_allowed',
        },
      });
    }

    // --- Check monthly task limit ---
    const planConfig = PLANS[plan] || PLANS.free;
    if (planConfig.taskLimit !== -1 && license.tasksUsedThisMonth >= planConfig.taskLimit) {
      log.info('Monthly task limit reached', { requestId, licenseKey, plan, used: license.tasksUsedThisMonth, limit: planConfig.taskLimit });
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
      log.error('Provider API key not configured', { requestId, provider });
      return res.status(503).json({
        error: {
          message: `Provider ${provider} is temporarily unavailable. Contact support.`,
          type: 'server_error',
          code: 'provider_not_configured',
        },
      });
    }

    // --- Increment task counter ---
    await incrementTaskCount(licenseKey);

    log.info('Proxying AI request', {
      requestId,
      licenseKey,
      provider,
      model,
      streaming: !!stream,
      messageCount: messages.length,
    });

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
        let errorBody: any;
        try {
          errorBody = await providerRes.json();
        } catch {
          errorBody = await providerRes.text();
        }

        const normalized = normalizeProviderError(provider, providerRes.status, errorBody);
        log.error('Provider stream error', {
          requestId,
          licenseKey,
          provider,
          model,
          statusCode: providerRes.status,
          errorCode: normalized.code,
          errorMessage: normalized.message,
        });

        return res.status(providerRes.status).json({
          error: {
            message: normalized.message,
            type: normalized.type,
            code: normalized.code,
          },
        });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Request-Id', requestId);

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
      } catch (streamError: any) {
        log.error('Stream interrupted', { requestId, licenseKey, provider, error: streamError.message });
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
      const normalized = normalizeProviderError(provider, providerRes.status, responseData);
      log.error('Provider error', {
        requestId,
        licenseKey,
        provider,
        model,
        statusCode: providerRes.status,
        errorCode: normalized.code,
        errorMessage: normalized.message,
      });

      return res.status(providerRes.status).json({
        error: {
          message: normalized.message,
          type: normalized.type,
          code: normalized.code,
        },
      });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Request-Id', requestId);

    log.info('Request completed', { requestId, licenseKey, provider, model });
    return res.status(200).json(responseData);

  } catch (error: any) {
    log.error('Unexpected error', { requestId, error: error.message, stack: error.stack?.slice(0, 500) });
    return res.status(500).json({
      error: {
        message: 'AI proxy internal error. Please try again.',
        type: 'server_error',
        code: 'internal_error',
      },
    });
  }
}
