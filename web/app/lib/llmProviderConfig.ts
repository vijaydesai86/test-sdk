/* eslint-disable @typescript-eslint/no-explicit-any */

export type RuntimeLLMProvider = 'github' | 'gemini';

export type LLMModelOption = {
  value: string;
  label: string;
  rateLimitTier?: string;
};

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';

export const SAFE_GITHUB_MODELS: LLMModelOption[] = [
  { value: 'openai/gpt-4.1', label: 'OpenAI GPT-4.1', rateLimitTier: 'high' },
  { value: 'openai/gpt-4.1-mini', label: 'OpenAI GPT-4.1 Mini', rateLimitTier: 'low' },
  { value: 'google/gemini-3-flash', label: 'Gemini 3 Flash', rateLimitTier: 'low' },
];

export const SAFE_GEMINI_MODELS: LLMModelOption[] = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', rateLimitTier: 'free-tier' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', rateLimitTier: 'free-tier' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', rateLimitTier: 'free-tier' },
];

const GEMINI_LABELS: Record<string, string> = {
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
};

const GEMINI_MODEL_IDS = new Set(SAFE_GEMINI_MODELS.map((model) => model.value));

export function normalizeGeminiModel(model?: string | null): string {
  if (model && GEMINI_MODEL_IDS.has(model)) return model;
  return 'gemini-2.5-flash';
}

export function getGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.COPILOT_GITHUB_TOKEN;
}

export function getConfiguredGeminiModel(): string {
  return normalizeGeminiModel(process.env.GEMINI_MODEL);
}

export function getGeminiFallbackModels(requestedModel?: string | null): string[] {
  return Array.from(new Set([
    normalizeGeminiModel(requestedModel),
    ...SAFE_GEMINI_MODELS.map((model) => model.value),
  ]));
}

export function buildGeminiModelOptions(): LLMModelOption[] {
  return getGeminiFallbackModels().map((value) => ({
    value,
    label: GEMINI_LABELS[value] || value,
    rateLimitTier: 'free-tier',
  }));
}

export async function fetchGitHubModels(): Promise<LLMModelOption[]> {
  const githubToken = getGitHubToken();

  if (!githubToken) {
    return SAFE_GITHUB_MODELS;
  }

  try {
    const response = await fetch(GITHUB_MODELS_CATALOG_URL, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      console.error(`GitHub Models catalog fetch failed: ${response.status}`);
      return SAFE_GITHUB_MODELS;
    }

    const catalog: any[] = await response.json();
    const ALLOWED_PUBLISHERS = new Set(['openai', 'anthropic', 'google']);
    const SUPERSEDED_IDS = new Set(['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/gpt-5-chat']);
    const getModelDate = (model: any) => {
      const raw = model.updated_at || model.created_at || model.released_at;
      const date = raw ? new Date(raw).getTime() : 0;
      return Number.isNaN(date) ? 0 : date;
    };

    const models = catalog
      .filter((model: any) => {
        const publisher = (model.id as string).split('/')[0];
        return (
          ALLOWED_PUBLISHERS.has(publisher) &&
          !SUPERSEDED_IDS.has(model.id as string) &&
          Array.isArray(model.capabilities) &&
          model.capabilities.includes('tool-calling') &&
          !model.deprecated
        );
      })
      .sort((a: any, b: any) => getModelDate(b) - getModelDate(a))
      .map((model: any) => ({
        value: model.id as string,
        label: model.name as string,
        rateLimitTier: model.rate_limit_tier as string,
      }));

    return models.length > 0 ? models : SAFE_GITHUB_MODELS;
  } catch (err) {
    console.error('Failed to fetch GitHub Models catalog:', err);
    return SAFE_GITHUB_MODELS;
  }
}
