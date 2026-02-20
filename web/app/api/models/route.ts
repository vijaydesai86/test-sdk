import { NextResponse } from 'next/server';

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';

// Curated fallback list of confirmed tool-calling capable models when the
// catalog API is unavailable (e.g., GITHUB_TOKEN not yet configured).
const FALLBACK_MODELS = [
  { value: 'openai/gpt-4.1', label: 'GPT-4.1 (Recommended)', rateLimitTier: 'high' },
  { value: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini', rateLimitTier: 'high' },
  { value: 'openai/gpt-4.1-nano', label: 'GPT-4.1 Nano', rateLimitTier: 'high' },
  { value: 'openai/gpt-4o', label: 'GPT-4o', rateLimitTier: 'low' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', rateLimitTier: 'high' },
  { value: 'openai/o3-mini', label: 'o3-mini (Reasoning)', rateLimitTier: 'low' },
];

export async function GET() {
  const githubToken =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.COPILOT_GITHUB_TOKEN;

  if (!githubToken) {
    return NextResponse.json(FALLBACK_MODELS);
  }

  try {
    const response = await fetch(GITHUB_MODELS_CATALOG_URL, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      // Cache the catalog for 1 hour to avoid hammering the API on every page load
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      console.error(`GitHub Models catalog fetch failed: ${response.status}`);
      return NextResponse.json(FALLBACK_MODELS);
    }

    const catalog: any[] = await response.json();

    // Only surface models that support tool-calling, since the stock assistant
    // relies on it for all data fetching.
    const models = catalog
      .filter((m: any) => Array.isArray(m.capabilities) && m.capabilities.includes('tool-calling'))
      .map((m: any) => ({
        value: m.id as string,
        label: m.name as string,
        rateLimitTier: (m.rate_limit_tier as string) || 'low',
      }));

    return NextResponse.json(models.length > 0 ? models : FALLBACK_MODELS);
  } catch (err) {
    console.error('Failed to fetch GitHub Models catalog:', err);
    return NextResponse.json(FALLBACK_MODELS);
  }
}
