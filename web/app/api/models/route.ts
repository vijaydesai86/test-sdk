import { NextResponse } from 'next/server';
import { fetchGitHubModelsCatalog, resolveGitHubToken, SAFE_DEFAULT_MODELS } from '@/app/lib/githubModels';

/** GET /api/models — returns the filtered list of available GitHub Models. */
export async function GET() {
  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json(SAFE_DEFAULT_MODELS);
  }

  try {
    const models = await fetchGitHubModelsCatalog(token);
    return NextResponse.json(models);
  } catch (err) {
    console.error('Failed to fetch GitHub Models catalog:', err);
    return NextResponse.json(SAFE_DEFAULT_MODELS);
  }
}
