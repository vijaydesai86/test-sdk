import { NextResponse } from 'next/server';

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';

const SAFE_DEFAULT = [
  { value: 'openai/gpt-4.1', label: 'OpenAI GPT-4.1', rateLimitTier: 'high' },
  { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', rateLimitTier: 'low' },
  { value: 'google/gemini-3-flash', label: 'Gemini 3 Flash', rateLimitTier: 'low' },
];

const DEFAULT_PROXY_MODELS = [
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4o-mini',
  'gpt-5-mini',
];

const normalizeProxyModels = (raw?: string | null) => {
  const models = (raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const list = models.length > 0 ? models : DEFAULT_PROXY_MODELS;
  return list.map((model) => ({ value: model, label: model }));
};

const fetchGithubModels = async () => {
  const githubToken =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.COPILOT_GITHUB_TOKEN;

  if (!githubToken) {
    return SAFE_DEFAULT;
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
    return SAFE_DEFAULT;
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

  return models.length > 0 ? models : SAFE_DEFAULT;
};

export async function GET() {
  try {
    const githubModels = await fetchGithubModels();
    const proxyModels = normalizeProxyModels(process.env.OPENAI_PROXY_MODELS);
    const hasProxyKey = Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_TOKEN);

    return NextResponse.json({
      providers: [
        {
          id: 'github',
          label: 'GitHub Models',
          available: true,
          models: githubModels,
        },
        {
          id: 'openai-proxy',
          label: 'OpenAI Proxy',
          available: hasProxyKey,
          models: proxyModels,
          details: hasProxyKey ? undefined : 'Set OPENAI_API_KEY in your environment.',
        },
      ],
    });
  } catch (err) {
    console.error('Failed to build provider list:', err);
    return NextResponse.json({ providers: [] }, { status: 500 });
  }
}
