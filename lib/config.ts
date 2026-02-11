// ============================================================
// Помощник — Plans & Configuration
// ============================================================

export interface PlanConfig {
  name: string;
  taskLimit: number;       // Max tasks per month (-1 = unlimited)
  models: string[];        // Allowed model prefixes
  streaming: boolean;      // Whether streaming is allowed
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    name: 'Безплатен',
    taskLimit: 10,
    models: ['gpt-4o-mini', 'gemini-2.0-flash'],
    streaming: true,
  },
  starter: {
    name: 'Стартер',
    taskLimit: 100,
    models: ['gpt-4o-mini', 'gpt-4o', 'gemini-2.0-flash', 'gemini-2.5-flash', 'claude-sonnet-4-20250514', 'deepseek-chat'],
    streaming: true,
  },
  pro: {
    name: 'Про',
    taskLimit: 500,
    models: ['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'deepseek-chat', 'deepseek-reasoner'],
    streaming: true,
  },
  business: {
    name: 'Бизнес',
    taskLimit: -1,
    models: ['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'deepseek-chat', 'deepseek-reasoner'],
    streaming: true,
  },
};

// Determine the real AI provider from the model name
export function getProviderFromModel(model: string): 'openai' | 'anthropic' | 'gemini' | 'deepseek' | null {
  if (model.startsWith('gpt-') || model.startsWith('o3-') || model.startsWith('o1-')) {
    return 'openai';
  }
  if (model.startsWith('claude-')) {
    return 'anthropic';
  }
  if (model.startsWith('gemini-')) {
    return 'gemini';
  }
  if (model.startsWith('deepseek-')) {
    return 'deepseek';
  }
  return null;
}

// Check if a model is allowed for a given plan
export function isModelAllowed(plan: string, model: string): boolean {
  const planConfig = PLANS[plan] || PLANS.free;
  return planConfig.models.some(allowed => model.startsWith(allowed) || model === allowed);
}
