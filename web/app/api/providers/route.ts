import { NextResponse } from 'next/server';
import { fetchGitHubModelsCatalog, resolveGitHubToken, SAFE_DEFAULT_MODELS } from '@/app/lib/githubModels';

/** GET /api/providers — returns available AI providers with their model lists. */
export async function GET() {
  try {
    const token = resolveGitHubToken();
    const models = token
      ? await fetchGitHubModelsCatalog(token)
      : SAFE_DEFAULT_MODELS;

    return NextResponse.json({
      providers: [
        {
          id: 'github',
          label: 'GitHub Models',
          available: true,
          models,
        },
      ],
    });
  } catch (err) {
    console.error('Failed to build provider list:', err);
    return NextResponse.json({ providers: [] }, { status: 500 });
  }
}

