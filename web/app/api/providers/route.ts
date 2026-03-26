import { NextResponse } from 'next/server';
import {
  buildGeminiModelOptions,
  fetchGitHubModels,
  getGitHubToken,
  normalizeLLMProvider,
  type LLMProviderType,
} from '@/app/lib/llmProviderConfig';

export async function GET() {
  try {
    const configuredProvider = normalizeLLMProvider(process.env.LLM_PROVIDER);
    const githubToken = getGitHubToken();
    const geminiToken = process.env.GEMINI_TOKEN;
    const githubAvailable = Boolean(githubToken);
    const geminiAvailable = Boolean(geminiToken);
    const githubModels = await fetchGitHubModels();
    const geminiModels = buildGeminiModelOptions();

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

    const order: LLMProviderType[] = [configuredProvider, 'hybrid', 'github', 'gemini'];
    providers.sort((a, b) => {
      const aIndex = order.indexOf(a.id as LLMProviderType);
      const bIndex = order.indexOf(b.id as LLMProviderType);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return Number(b.available) - Number(a.available);
    });

    return NextResponse.json({ providers });
  } catch (err) {
    console.error('Failed to build provider list:', err);
    return NextResponse.json({ providers: [] }, { status: 500 });
  }
}
