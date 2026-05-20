import { NextResponse } from 'next/server';
import {
  buildGeminiModelOptions,
  fetchGitHubModels,
  getGitHubToken,
} from '@/app/lib/llmProviderConfig';
import { getConfiguredEnv } from '@/app/lib/env';

export async function GET() {
  try {
    const githubToken = getGitHubToken();
    const geminiToken = getConfiguredEnv('GEMINI_TOKEN');
    const githubAvailable = Boolean(githubToken);
    const geminiAvailable = Boolean(geminiToken);
    const githubModels = githubAvailable ? await fetchGitHubModels() : [];
    const geminiModels = geminiAvailable ? buildGeminiModelOptions() : [];

    const models = [...githubModels, ...geminiModels];

    return NextResponse.json({ models });
  } catch (err) {
    console.error('Failed to build models list:', err);
    return NextResponse.json({ models: [] }, { status: 500 });
  }
}
