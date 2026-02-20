import { NextResponse } from 'next/server';

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';

// Single confirmed safe default — explicitly shown in the official GitHub
// REST API docs example response. Used only when the live catalog cannot be
// reached so the app doesn't show a completely empty dropdown.
const SAFE_DEFAULT = [
  { value: 'openai/gpt-4.1', label: 'GPT-4.1', rateLimitTier: 'high' },
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

    // Exclude embedding-only models — they don't support chat completions.
    // Every other model the catalog returns is guaranteed to exist and be
    // reachable, so we surface all of them (OpenAI, Anthropic, Google, xAI,
    // Qwen, Mistral, …) without any additional filtering.
    const models = catalog
      .filter((m: any) => m.rate_limit_tier !== 'embedding')
      .map((m: any) => ({
        value: m.id as string,
        label: m.name as string,
        rateLimitTier: (m.rate_limit_tier as string) || 'low',
      }));

    return NextResponse.json(models.length > 0 ? models : SAFE_DEFAULT);
  } catch (err) {
    console.error('Failed to fetch GitHub Models catalog:', err);
    return NextResponse.json(SAFE_DEFAULT);
  }
}
