import { NextResponse } from 'next/server';
import { fetchGitHubModels } from '@/app/lib/llmProviderConfig';

export async function GET() {
  return NextResponse.json(await fetchGitHubModels());
}
