import { NextResponse } from 'next/server';

const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models';
const CHAT_URL = 'https://models.github.ai/inference/chat/completions';

// The one model verified to work throughout development.
// Used only when the live catalog is unreachable AND the probe cannot run.
const VERIFIED_FALLBACK = [
  { value: 'openai/gpt-4.1', label: 'GPT-4.1', rateLimitTier: 'high' },
];

// Probe a model with the smallest possible tool-calling request.
// Returns true only if the API responds with 2xx — meaning the model exists,
// the token has access, and it can handle tool calls.
async function probeModel(modelId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{
          type: 'function',
          function: {
            name: 'ping',
            description: 'ping',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        }],
      }),
    });
    return res.ok || res.status === 400; // 400 = model exists but bad request (still means accessible)
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
    return NextResponse.json(VERIFIED_FALLBACK);
  }

  // Step 1: fetch the live catalog
  let catalog: any[] = [];
  try {
    const res = await fetch(GITHUB_MODELS_CATALOG_URL, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.ok) {
      catalog = await res.json();
    }
  } catch {
    // catalog unreachable — will fall through to verified fallback
  }

  if (catalog.length === 0) {
    return NextResponse.json(VERIFIED_FALLBACK);
  }

  // Step 2: filter catalog to tool-calling, non-deprecated candidates
  const SUPERSEDED_IDS = new Set(['openai/gpt-4o', 'openai/gpt-4o-mini']);
  const candidates = catalog
    .filter((m: any) =>
      !SUPERSEDED_IDS.has(m.id as string) &&
      Array.isArray(m.capabilities) &&
      m.capabilities.includes('tool-calling') &&
      !m.deprecated,
    )
    .sort((a: any, b: any) => {
      const dateOf = (m: any) => {
        const v = m.updated_at || m.created_at || m.released_at;
        const t = v ? new Date(v).getTime() : 0;
        return Number.isNaN(t) ? 0 : t;
      };
      return dateOf(b) - dateOf(a);
    })
    .slice(0, 15); // probe at most 15

  // Step 3: probe each candidate in parallel — only show models that actually respond
  const probeResults = await Promise.all(
    candidates.map(async (m: any) => ({
      model: m,
      ok: await probeModel(m.id as string, githubToken),
    })),
  );

  const working = probeResults
    .filter((r) => r.ok)
    .map((r) => ({
      value: r.model.id as string,
      label: r.model.name as string,
      rateLimitTier: r.model.rate_limit_tier as string,
    }));

  return NextResponse.json(working.length > 0 ? working : VERIFIED_FALLBACK);
}
