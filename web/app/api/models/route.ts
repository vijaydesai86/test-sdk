import { NextResponse } from 'next/server';

// Copilot API — the only endpoint reachable via GITHUB_TOKEN
const COPILOT_MODELS_URL = 'https://api.githubcopilot.com/models';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface ModelOption {
  value: string;
  label: string;
  rateLimitTier: string;
}

const AUTO_OPTION: ModelOption = {
  value: 'auto',
  label: '✨ Auto (Recommended)',
  rateLimitTier: 'auto',
};

// Confirmed-working fallback used ONLY when the catalog endpoint is unreachable.
// IDs and names verified via live API call in this environment.
const HARD_FALLBACK: ModelOption[] = [
  { value: 'claude-opus-4.6',   label: 'Claude Opus 4.6',   rateLimitTier: 'low' },
  { value: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', rateLimitTier: 'low' },
  { value: 'gemini-2.5-pro',    label: 'Gemini 2.5 Pro',    rateLimitTier: 'low' },
];

// Module-level cache (warm Vercel invocations reuse it).
let cachedModels: ModelOption[] | null = null;
let cacheExpiry = 0;

/**
 * Version gate — applied to bare model IDs (no vendor prefix) from the
 * Copilot API.  IDs use dots: claude-opus-4.6, gpt-5-mini, gemini-2.5-pro
 *
 * Include:
 *   Claude  >= 4.5  (claude-{tier}-{major}.{minor}, major>4 OR major=4,minor>=5)
 *   GPT     >= 5    (gpt-5-*, but NOT bare "gpt-5" and NOT any "*codex*")
 *   Gemini  any     (gemini-*)
 *
 * Exclude: gpt-4.x, o1, o3, claude-sonnet-4 (4.0), claude-3-*, codex variants
 */
function qualifies(model: {
  id: string;
  model_picker_enabled: boolean;
  capabilities: { supports: { tool_calls: boolean } };
}): boolean {
  // Must be user-picker enabled and support tool calls
  if (!model.model_picker_enabled) return false;
  if (!model.capabilities?.supports?.tool_calls) return false;

  const id = model.id.toLowerCase();

  // Claude: claude-{tier}-{major}.{minor}
  const claudeMatch = id.match(/^claude-[a-z]+-(\d+)\.(\d+)/);
  if (claudeMatch) {
    const maj = parseInt(claudeMatch[1]);
    const min = parseInt(claudeMatch[2]);
    return maj > 4 || (maj === 4 && min >= 5);
  }
  // Claude bare major: claude-{tier}-{major} e.g. claude-opus-5 (future)
  const claudeBare = id.match(/^claude-[a-z]+-(\d+)$/);
  if (claudeBare) return parseInt(claudeBare[1]) >= 5;

  // GPT: gpt-{N}...  must be >=5, not bare "gpt-5", not codex variants
  if (id.startsWith('gpt-')) {
    if (id.includes('codex')) return false;  // codex models need a different endpoint
    if (id === 'gpt-5') return false;        // bare gpt-5 returns "not supported" on /chat/completions
    const gptMatch = id.match(/^gpt-(\d+)/);
    return !!gptMatch && parseInt(gptMatch[1]) >= 5;
  }

  // Gemini: all generations — confirmed working with tool calls
  if (id.startsWith('gemini-')) return true;

  return false;
}

/** Higher score = shown first in dropdown / chosen by Auto. */
function rank(id: string): number {
  const s = id.toLowerCase();
  if (s.includes('opus'))                                              return 100;
  if (s.includes('sonnet'))                                            return  90;
  if (s.startsWith('gpt-5') && !s.includes('mini'))                  return  85;
  if (s.includes('gemini') && (s.includes('pro') || s.includes('ultra'))) return 80;
  if (s.includes('gpt-5'))                                             return  75; // gpt-5-mini etc.
  if (s.includes('haiku'))                                             return  70;
  if (s.includes('gemini') && s.includes('flash'))                    return  65;
  if (s.includes('gemini'))                                            return  72;
  return 50;
}

export async function GET() {
  if (cachedModels && Date.now() < cacheExpiry) {
    return NextResponse.json([AUTO_OPTION, ...cachedModels]);
  }

  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.COPILOT_GITHUB_TOKEN;

  if (!token) {
    return NextResponse.json([AUTO_OPTION, ...HARD_FALLBACK]);
  }

  try {
    const res = await fetch(COPILOT_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[models] catalog HTTP ${res.status}`);
      return NextResponse.json([AUTO_OPTION, ...HARD_FALLBACK]);
    }

    const json = await res.json();
    const catalog: any[] = json.data ?? json; // handles {data:[...]} and plain array

    const models: ModelOption[] = catalog
      .filter((m: any) => qualifies(m))
      .map((m: any): ModelOption => ({
        value: m.id as string,
        label: (m.name || m.id) as string,
        rateLimitTier: 'standard',
      }))
      .sort((a, b) => rank(b.value) - rank(a.value));

    const list = models.length > 0 ? models : HARD_FALLBACK;
    cachedModels = list;
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    console.log('[models] loaded:', list.map(m => m.value).join(', '));
    return NextResponse.json([AUTO_OPTION, ...list]);
  } catch (err) {
    console.error('[models] error:', err);
    return NextResponse.json([AUTO_OPTION, ...HARD_FALLBACK]);
  }
}
