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

    // Three filters applied together:
    //
    // 1. Publisher: only OpenAI, Anthropic, Google — the three providers the
    //    app is intended to use. Excludes Mistral, Llama, DeepSeek, Cohere, etc.
    //
    // 2. Rate limit tier: only 'high' and 'low' — these are the two standard
    //    GitHub Models tiers that allow 8,000 input tokens on all Copilot plans
    //    (Pro / Business / Enterprise). All special tiers (gpt-5, gpt-5-mini,
    //    gpt-5-nano, gpt-5-chat, o1, o3, o3-mini, o4-mini, DeepSeek-R1, etc.)
    //    have a hard 4,000 input token limit on every plan — this app's system
    //    prompt + tool definitions alone consume ~5,500 tokens, so those models
    //    will always return 413 regardless of subscription level.
    //
    // 3. Capability: only models that advertise 'tool-calling' — the stock
    //    assistant calls tools on every request and won't work without it.
    const ALLOWED_PUBLISHERS = new Set(['openai', 'anthropic', 'google']);
    const USABLE_TIERS       = new Set(['high', 'low']);

    const models = catalog
      .filter((m: any) => {
        const publisher = (m.id as string).split('/')[0];
        return (
          ALLOWED_PUBLISHERS.has(publisher) &&
          USABLE_TIERS.has(m.rate_limit_tier) &&
          Array.isArray(m.capabilities) &&
          m.capabilities.includes('tool-calling')
        );
      })
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
