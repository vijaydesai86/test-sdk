import { NextResponse } from 'next/server';

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';
const GITHUB_MODELS_INFERENCE_URL = 'https://models.github.ai/inference/chat/completions';

// Allow up to 30 s so parallel probing can complete before Vercel times out.
export const maxDuration = 30;

const PROBE_TIMEOUT_MS = 6000;          // per-model probe timeout
const VERIFIED_MODELS_CACHE_MS = 30 * 60 * 1000; // 30 minutes

interface ModelOption {
  value: string;
  label: string;
  rateLimitTier: string;
}

// "Auto" virtual option — server picks the best working model automatically.
const AUTO_OPTION: ModelOption = {
  value: 'auto',
  label: '✨ Auto (Recommended)',
  rateLimitTier: 'auto',
};

// Fallback used only when the live catalog is unreachable.
// IDs here are confirmed-working from the existing codebase; only those that
// meet minimum version requirements (Claude 4.5+, GPT-5+, any Gemini) are kept.
const FALLBACK_MODELS: ModelOption[] = [
  AUTO_OPTION,
  { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', rateLimitTier: 'low' },
  { value: 'google/gemini-3-flash',       label: 'Gemini 3 Flash',    rateLimitTier: 'low' },
];

// Cache verified-working models for 30 minutes to avoid probing on every page load.
let workingModelsCache: ModelOption[] | null = null;
let workingModelsCacheExpiry = 0;

/**
 * Returns true only for:
 * - OpenAI: GPT-5 and above (not GPT-4.x, o1, o3, etc.)
 *   Handles: gpt-5, gpt-5.1, gpt-5.2, gpt-5-turbo, gpt-52, …
 * - Anthropic: Claude 4.5 and above (not Claude 3.x or 4.0–4.4)
 *   Handles: claude-sonnet-4-5, claude-opus-5-0, claude-sonnet-5-0-20261001,
 *             claude-5, claude-opus-5, claude-5-sonnet, …
 * - Google: Any Gemini model (all generations welcome)
 */
function meetsVersionRequirement(modelId: string): boolean {
  const id = modelId.toLowerCase();

  if (id.startsWith('openai/')) {
    // Match gpt-{N} where N is the first numeric segment (handles gpt-5, gpt-5.1, gpt-5-turbo, gpt-52 …)
    const m = id.match(/^openai\/gpt-(\d+)/);
    return m ? parseInt(m[1]) >= 5 : false;
  }

  if (id.startsWith('anthropic/')) {
    const path = id.replace('anthropic/', '');

    // ── New tier-first naming: claude-{tier}-{major}[-{minor}[-{suffix}]]
    //    e.g. claude-sonnet-4-5, claude-opus-5-0, claude-sonnet-5-0-20261001
    const tierFirst = path.match(/^claude-[a-z]+-(\d+)(?:-(\d+))?/);
    if (tierFirst) {
      const major = parseInt(tierFirst[1]);
      const minor = tierFirst[2] !== undefined ? parseInt(tierFirst[2]) : 0;
      return major > 4 || (major === 4 && minor >= 5);
    }

    // ── New major-first naming: claude-{major}[-{tier}[-{suffix}]]
    //    e.g. claude-5, claude-5-sonnet, claude-5-opus-20261001
    const majorFirst = path.match(/^claude-(\d+)(?:-[a-z]+)?/);
    if (majorFirst) {
      return parseInt(majorFirst[1]) >= 5;
    }

    // ── Old naming: claude-{major}-{minor}-{tier}  e.g. claude-3-5-sonnet — excluded
    return false;
  }

  if (id.startsWith('google/')) {
    return id.includes('gemini');
  }

  return false;
}

/**
 * Sends a minimal 1-token probe to the inference API to verify the model is
 * actually accessible with this token.
 *
 * 200  → working
 * 429  → rate-limited but accessible (still include in dropdown)
 * 400/403/404 → model unavailable / no access → exclude
 */
async function probeModel(modelId: string, token: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(GITHUB_MODELS_INFERENCE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    // 200 OK or 429 rate-limited both mean the model is accessible.
    return res.ok || res.status === 429;
  } catch {
    return false;
  }
}

export async function GET() {
  const githubToken =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.COPILOT_GITHUB_TOKEN;

  if (!githubToken) {
    return NextResponse.json(FALLBACK_MODELS);
  }

  // Return cached result if still fresh.
  if (workingModelsCache && Date.now() < workingModelsCacheExpiry) {
    return NextResponse.json(workingModelsCache);
  }

  try {
    // 1. Fetch the live model catalog.
    const catalogRes = await fetch(GITHUB_MODELS_CATALOG_URL, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!catalogRes.ok) {
      console.error(`GitHub Models catalog fetch failed: ${catalogRes.status}`);
      return NextResponse.json(FALLBACK_MODELS);
    }

    const catalog: any[] = await catalogRes.json();

    // 2. Filter to qualifying models (version + tool-calling capability).
    const candidates = catalog.filter((m: any) => {
      const id = (m.id as string) || '';
      return (
        meetsVersionRequirement(id) &&
        Array.isArray(m.capabilities) &&
        m.capabilities.includes('tool-calling')
      );
    });

    // 3. Probe all candidates in parallel to verify actual accessibility.
    const probeResults = await Promise.all(
      candidates.map(async (m: any) => ({
        model: m,
        accessible: await probeModel(m.id as string, githubToken),
      }))
    );

    const verified: ModelOption[] = probeResults
      .filter(({ accessible }) => accessible)
      .map(({ model: m }) => ({
        value: m.id as string,
        label: m.name as string,
        rateLimitTier: (m.rate_limit_tier as string) || 'low',
      }));

    const result: ModelOption[] = [
      AUTO_OPTION,
      ...(verified.length > 0 ? verified : FALLBACK_MODELS.slice(1)),
    ];

    // Cache for 30 minutes.
    workingModelsCache = result;
    workingModelsCacheExpiry = Date.now() + VERIFIED_MODELS_CACHE_MS;

    return NextResponse.json(result);
  } catch (err) {
    console.error('Failed to build verified model list:', err);
    return NextResponse.json(FALLBACK_MODELS);
  }
}
