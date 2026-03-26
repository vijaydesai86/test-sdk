/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';

type ProviderId = 'github' | 'gemini' | 'hybrid';

type ModelOption = {
  value: string;
  label: string;
  rateLimitTier?: string;
};

const SAFE_GITHUB_MODELS: ModelOption[] = [
  { value: 'openai/gpt-4.1', label: 'OpenAI GPT-4.1', rateLimitTier: 'high' },
  { value: 'openai/gpt-4.1-mini', label: 'OpenAI GPT-4.1 Mini', rateLimitTier: 'low' },
  { value: 'google/gemini-3-flash', label: 'Gemini 3 Flash', rateLimitTier: 'low' },
];

const GEMINI_LABELS: Record<string, string> = {
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
  'gemini-3.0-flash': 'Gemini 3.0 Flash',
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
};

function normalizeLLMProvider(provider: string | null | undefined): ProviderId {
  return provider === 'github' || provider === 'gemini' || provider === 'hybrid'
    ? provider
    : 'github';
}

function buildGeminiModels(): ModelOption[] {
  const configuredDefault = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const ids = Array.from(new Set([
    configuredDefault,
    'gemini-2.5-flash-lite',
    'gemini-3.0-flash',
    'gemini-3.1-flash-lite',
  ]));
  return ids.map((value) => ({
    value,
    label: GEMINI_LABELS[value] || value,
    rateLimitTier: 'free-tier',
  }));
}

async function fetchGithubModels(): Promise<ModelOption[]> {
  const githubToken =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.COPILOT_GITHUB_TOKEN;

  if (!githubToken) {
    return SAFE_GITHUB_MODELS;
  }

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
  const MAX_MODELS = 8;

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
    .slice(0, MAX_MODELS)
    .map((model: any) => ({
      value: model.id as string,
      label: model.name as string,
      rateLimitTier: model.rate_limit_tier as string,
    }));

  return models.length > 0 ? models : SAFE_GITHUB_MODELS;
}

export async function GET() {
  try {
    const configuredProvider = normalizeLLMProvider(process.env.LLM_PROVIDER);
    const githubToken =
      process.env.GITHUB_TOKEN ||
      process.env.GH_TOKEN ||
      process.env.COPILOT_GITHUB_TOKEN;
    const geminiToken = process.env.GEMINI_TOKEN;
    const githubAvailable = Boolean(githubToken);
    const geminiAvailable = Boolean(geminiToken);
    const githubModels = await fetchGithubModels();
    const geminiModels = buildGeminiModels();

    const providers = [
      {
        id: 'hybrid',
        label: 'Hybrid',
        available: githubAvailable || geminiAvailable,
        details: githubAvailable && geminiAvailable
          ? 'GitHub Models primary with Gemini fallback on rate limit.'
          : githubAvailable
            ? 'GitHub Models only until GEMINI_TOKEN is configured.'
            : geminiAvailable
              ? 'Gemini only until GITHUB_TOKEN is configured.'
              : 'Requires GITHUB_TOKEN and/or GEMINI_TOKEN.',
        models: githubAvailable ? githubModels : geminiModels,
      },
      {
        id: 'github',
        label: 'GitHub Models',
        available: githubAvailable,
        details: githubAvailable
          ? 'Uses your GitHub token and live GitHub Models catalog.'
          : 'Requires GITHUB_TOKEN, GH_TOKEN, or COPILOT_GITHUB_TOKEN.',
        models: githubModels,
      },
      {
        id: 'gemini',
        label: 'Gemini',
        available: geminiAvailable,
        details: geminiAvailable
          ? 'Uses Gemini with internal model fallback across the configured free-tier set.'
          : 'Requires GEMINI_TOKEN.',
        models: geminiModels,
      },
    ];

    const order = [configuredProvider, 'hybrid', 'github', 'gemini'];
    providers.sort((a, b) => {
      const aIndex = order.indexOf(a.id as ProviderId);
      const bIndex = order.indexOf(b.id as ProviderId);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return Number(b.available) - Number(a.available);
    });

    return NextResponse.json({ providers });
  } catch (err) {
    console.error('Failed to build provider list:', err);
    return NextResponse.json({ providers: [] }, { status: 500 });
  }
}
