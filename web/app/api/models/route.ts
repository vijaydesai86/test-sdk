import { NextResponse } from 'next/server';

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';

// Fallback used only when the live catalog is unreachable.
// openai/gpt-4.1 is the one model verified to work throughout development.
const VERIFIED_FALLBACK = [
  { value: 'openai/gpt-4.1', label: 'GPT-4.1', rateLimitTier: 'high' },
];

// IDs superseded by newer releases — excluded to avoid cluttering the dropdown.
const SUPERSEDED_IDS = new Set(['openai/gpt-4o', 'openai/gpt-4o-mini']);

export async function GET() {
  const githubToken =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.COPILOT_GITHUB_TOKEN;

  if (!githubToken) {
    return NextResponse.json(VERIFIED_FALLBACK);
  }

  try {
    const res = await fetch(GITHUB_MODELS_CATALOG_URL, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      console.error(`GitHub Models catalog fetch failed: ${res.status}`);
      return NextResponse.json(VERIFIED_FALLBACK);
    }

    const catalog: any[] = await res.json();

    // Trust the catalog's own `tool-calling` capability flag.
    // No probing — probing burns daily API quota on every page load.
    const models = catalog
      .filter((m: any) =>
        !SUPERSEDED_IDS.has(m.id as string) &&
        Array.isArray(m.capabilities) &&
        m.capabilities.includes('tool-calling') &&
        !m.deprecated,
      )
      .sort((a: any, b: any) => {
        const dateOf = (m: any) => {
          const v = m.updated_at || m.created_at || m.released_at;
          const t = v ? new Date(v).getTime() : 0;
          return Number.isNaN(t) ? 0 : t;
        };
        return dateOf(b) - dateOf(a);
      })
      .slice(0, 10)
      .map((m: any) => ({
        value: m.id as string,
        label: m.name as string,
        rateLimitTier: m.rate_limit_tier as string,
      }));

    return NextResponse.json(models.length > 0 ? models : VERIFIED_FALLBACK);
  } catch (err) {
    console.error('Failed to fetch GitHub Models catalog:', err);
    return NextResponse.json(VERIFIED_FALLBACK);
  }
}
