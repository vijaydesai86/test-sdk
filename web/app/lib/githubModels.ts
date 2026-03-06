/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Shared GitHub Models catalogue helper.
 *
 * Both `/api/models` (plain list) and `/api/providers` (provider-wrapped list)
 * need to fetch and filter the live GitHub Models catalogue.  This module owns
 * that logic so there is exactly one copy to maintain.
 */

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';

export interface GitHubModel {
  value: string;
  label: string;
  rateLimitTier: string;
}

/** Minimal safe fallback — one confirmed-working model per supported provider. */
export const SAFE_DEFAULT_MODELS: GitHubModel[] = [
  { value: 'openai/gpt-4.1',        label: 'OpenAI GPT-4.1',      rateLimitTier: 'high' },
  { value: 'openai/gpt-4.1-mini',   label: 'OpenAI GPT-4.1 Mini', rateLimitTier: 'low'  },
  { value: 'google/gemini-3-flash',  label: 'Gemini 3 Flash',      rateLimitTier: 'low'  },
];

// Publishers whose models the app supports.
const ALLOWED_PUBLISHERS = new Set(['openai', 'anthropic', 'google']);

// Models superseded by newer releases — excluded from the catalogue list.
const SUPERSEDED_IDS = new Set([
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-5-chat',
]);

const MAX_MODELS = 8;

function getModelDate(model: any): number {
  const raw = model.updated_at || model.created_at || model.released_at;
  const ts = raw ? new Date(raw).getTime() : 0;
  return Number.isNaN(ts) ? 0 : ts;
}

/**
 * Fetch the live GitHub Models catalogue and return a filtered, sorted list.
 *
 * Filters:
 * - Publisher: OpenAI, Anthropic, or Google only
 * - Capability: must include `tool-calling` (required for every request)
 * - Excludes superseded model IDs and deprecated models
 * - Returns at most `MAX_MODELS` results, sorted newest-first
 *
 * Returns `SAFE_DEFAULT_MODELS` when the token is absent or the fetch fails.
 */
export async function fetchGitHubModelsCatalog(githubToken: string): Promise<GitHubModel[]> {
  const response = await fetch(GITHUB_MODELS_CATALOG_URL, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'stock-research-assistant',
    },
  });

  if (!response.ok) {
    console.error(`GitHub Models catalog fetch failed: ${response.status}`);
    return SAFE_DEFAULT_MODELS;
  }

  const catalog: any[] = await response.json();

  const models: GitHubModel[] = catalog
    .filter((m: any) => {
      const publisher = (m.id as string).split('/')[0];
      return (
        ALLOWED_PUBLISHERS.has(publisher) &&
        !SUPERSEDED_IDS.has(m.id as string) &&
        Array.isArray(m.capabilities) &&
        m.capabilities.includes('tool-calling') &&
        !m.deprecated
      );
    })
    .sort((a: any, b: any) => getModelDate(b) - getModelDate(a))
    .slice(0, MAX_MODELS)
    .map((m: any) => ({
      value: m.id as string,
      label: m.name as string,
      rateLimitTier: m.rate_limit_tier as string,
    }));

  return models.length > 0 ? models : SAFE_DEFAULT_MODELS;
}

/**
 * Resolve the GitHub token from the standard env-var candidates.
 * Returns `undefined` if none is set.
 */
export function resolveGitHubToken(): string | undefined {
  return (
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.COPILOT_GITHUB_TOKEN
  );
}
