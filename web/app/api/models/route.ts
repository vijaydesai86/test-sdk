import { NextResponse } from 'next/server';

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';

// Safe fallback used only when the live catalog is unreachable.
// Contains one confirmed-working model per supported provider.
const SAFE_DEFAULT = [
  { value: 'openai/gpt-4.1',              label: 'OpenAI GPT-4.1',        rateLimitTier: 'high' },
  { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6',     rateLimitTier: 'low'  },
  { value: 'google/gemini-3-flash',       label: 'Gemini 3 Flash',        rateLimitTier: 'low'  },
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
    // 1. Publisher: only OpenAI, Anthropic, Google
    // 2. Capability: tool-calling required (the assistant calls tools on every request)
    // 3. Exclude superseded models: gpt-4o / gpt-4o-mini are replaced by gpt-4.1 / gpt-4.1-mini
    // 4. Keep only the newest models based on catalog timestamps
    //
    // No rate_limit_tier filter — the system prompt and tool definitions have been
    // shortened to ~2,200 tokens total so all models (including gpt-5 at 4,000 input
    // token limit) now have enough headroom for typical queries.
    const ALLOWED_PUBLISHERS = new Set(['openai', 'anthropic', 'google']);
    const SUPERSEDED_IDS     = new Set([
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'openai/gpt-5-chat',
    ]);
    const MAX_MODELS = 8;

    const getModelDate = (model: any) => {
      const raw = model.updated_at || model.created_at || model.released_at;
      const date = raw ? new Date(raw).getTime() : 0;
      return Number.isNaN(date) ? 0 : date;
    };

    const models = catalog
      .filter((m: any) => {
        const publisher = (m.id as string).split('/')[0];
        return (
          ALLOWED_PUBLISHERS.has(publisher) &&
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
    if (models.length === 0) {
      return NextResponse.json(SAFE_DEFAULT);
    }

    const merged = [...models];
    for (const fallback of SAFE_DEFAULT) {
      if (!merged.some((model) => model.value === fallback.value)) {
        merged.push(fallback);
      }
    }

    return NextResponse.json(merged);
  } catch (err) {
    console.error('Failed to fetch GitHub Models catalog:', err);
    return NextResponse.json(SAFE_DEFAULT);
  }
}
