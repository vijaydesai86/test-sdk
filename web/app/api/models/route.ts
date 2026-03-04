import { NextResponse } from 'next/server';

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';

// Safe fallback used only when the live catalog is unreachable.
const SAFE_DEFAULT = [
  { value: 'openai/gpt-4.1',                    label: 'GPT-4.1',               rateLimitTier: 'high' },
  { value: 'anthropic/claude-sonnet-4-5',        label: 'Claude Sonnet 4.5',     rateLimitTier: 'low'  },
  { value: 'google/gemini-2.0-flash',            label: 'Gemini 2.0 Flash',      rateLimitTier: 'low'  },
  { value: 'meta/meta-llama-3.3-70b-instruct',   label: 'Llama 3.3 70B',         rateLimitTier: 'high' },
];

export async function GET() {
  const githubToken =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.COPILOT_GITHUB_TOKEN;

  if (!githubToken) {
    return NextResponse.json(SAFE_DEFAULT);
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
      return NextResponse.json(SAFE_DEFAULT);
    }

    const catalog: any[] = await response.json();

    // Filters:
    // 1. Capability: tool-calling required (the assistant calls tools on every request)
    // 2. Not deprecated, not superseded
    // 3. Newest 10 by catalog date — covers all providers (OpenAI, Anthropic, Google, Meta, Mistral, etc.)
    //    Every model returned here is one the caller's token has permission to use.
    const SUPERSEDED_IDS = new Set([
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
    ]);
    const MAX_MODELS = 10;

    const getModelDate = (model: any) => {
      const raw = model.updated_at || model.created_at || model.released_at;
      const date = raw ? new Date(raw).getTime() : 0;
      return Number.isNaN(date) ? 0 : date;
    };

    const models = catalog
      .filter((m: any) => {
        return (
          !SUPERSEDED_IDS.has(m.id as string) &&
          Array.isArray(m.capabilities) &&
          m.capabilities.includes('tool-calling') &&
          !m.deprecated
        );
      })
      .sort((a: any, b: any) => getModelDate(b) - getModelDate(a))
      .slice(0, MAX_MODELS)
      .map((m: any) => ({
        value: m.id as string,
        label: m.name as string,
        rateLimitTier: m.rate_limit_tier as string,
      }));
    return NextResponse.json(models.length > 0 ? models : SAFE_DEFAULT);
  } catch (err) {
    console.error('Failed to fetch GitHub Models catalog:', err);
    return NextResponse.json(SAFE_DEFAULT);
  }
}
