import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSubscription } from '../lib/db';
import { PLANS } from '../lib/config';

// ============================================================
// AI PROXY ENDPOINT — Помощник
// ============================================================
// POST /api/ai
//
// Проксира LLM заявки от разширението към OpenAI, Anthropic
// или Gemini, използвайки server-side API ключове.
//
// Body: {
//   email: string,
//   provider: "openai" | "anthropic" | "gemini",
//   model: string,
//   messages: Array<{ role: string, content: string }>,
//   temperature?: number,
//   max_tokens?: number,
//   stream?: boolean,
//   response_format?: object
// }
//
// Supports streaming (SSE) when stream: true
// ============================================================

// Provider API URLs
const PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
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
    default:
      return null;
  }
}

// Build request for OpenAI
function buildOpenAIRequest(body: any, apiKey: string) {
  const payload: any = {
    model: body.model,
    messages: body.messages,
  };
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.max_tokens !== undefined) payload.max_tokens = body.max_tokens;
  if (body.stream !== undefined) payload.stream = body.stream;
  if (body.response_format !== undefined) payload.response_format = body.response_format;
  if (body.top_p !== undefined) payload.top_p = body.top_p;

  return {
    url: PROVIDER_URLS.openai,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  };
}

// Build request for Anthropic
function buildAnthropicRequest(body: any, apiKey: string) {
  // Convert OpenAI-style messages to Anthropic format
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
  // Convert OpenAI-style messages to Gemini format
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
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, provider, model, messages, temperature, max_tokens, stream, response_format, top_p } = req.body;

    // --- Валидация ---
    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }
    if (!provider || !['openai', 'anthropic', 'gemini'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider. Choose: openai, anthropic, gemini' });
    }
    if (!model) {
      return res.status(400).json({ error: 'Missing model' });
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid messages array' });
    }

    // --- Проверка на абонамент ---
    const subscription = await getSubscription(email);
    const plan = subscription?.status === 'active' ? subscription.plan : 'free';
    const planConfig = PLANS[plan] || PLANS.free;

    // TODO: Track task usage and enforce limits
    // For now, just check if user has a valid plan
    // In production, increment a counter and check against planConfig.taskLimit

    // --- Получаване на API ключ ---
    const apiKey = getApiKey(provider);
    if (!apiKey) {
      return res.status(503).json({ 
        error: `Provider ${provider} is not configured. Contact support.`,
        code: 'PROVIDER_NOT_CONFIGURED'
      });
    }

    // --- Изграждане на заявка към провайдъра ---
    let providerRequest: { url: string; headers: Record<string, string>; body: string };

    switch (provider) {
      case 'openai':
        providerRequest = buildOpenAIRequest(req.body, apiKey);
        break;
      case 'anthropic':
        providerRequest = buildAnthropicRequest(req.body, apiKey);
        break;
      case 'gemini':
        providerRequest = buildGeminiRequest(req.body, apiKey);
        break;
      default:
        return res.status(400).json({ error: 'Invalid provider' });
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
          error: `${provider} API error`,
          status: providerRes.status,
          details: errorBody
        });
      }

      // Stream the response back to the client
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = providerRes.body?.getReader();
      if (!reader) {
        return res.status(500).json({ error: 'Failed to read stream from provider' });
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
        error: `${provider} API error`,
        status: providerRes.status,
        details: responseData,
      });
    }

    // Return the provider's response as-is
    return res.status(200).json(responseData);

  } catch (error: any) {
    console.error('[AI Proxy] Unexpected error:', error.message);
    return res.status(500).json({ 
      error: 'AI proxy internal error',
      details: error.message 
    });
  }
}
