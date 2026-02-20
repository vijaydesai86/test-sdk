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

    // Filter to only models that support tool-calling — the stock assistant
    // calls multiple tools on every request, so models without this capability
    // won't work. This also naturally limits the dropdown to a useful subset
    // (GPT-5.x, Claude 4.x, Gemini 3.x, etc.) instead of every model in the
    // marketplace (embedding models, image-gen models, tiny instruct models…).
    const models = catalog
      .filter((m: any) => Array.isArray(m.capabilities) && m.capabilities.includes('tool-calling'))
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
