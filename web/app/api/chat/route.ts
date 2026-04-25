/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitionsByName, executeTool, type LLMFiller } from '@/app/lib/stockTools';
import { createStockService, StockDataService } from '@/app/lib/stockDataService';
import { buildResearchContext, deleteSession, loadSessionMessages, saveSessionMessages } from '@/app/lib/researchMemoryStore';
import { getDefaultWatchlist } from '@/app/lib/watchlistStore';
import { selectChatToolNames } from '@/app/lib/chatToolPolicy';
import {
  fetchGitHubModels,
  getConfiguredGeminiModel,
  getGeminiFallbackModels,
  getGitHubToken,
  normalizeGeminiModel,
  type RuntimeLLMProvider,
} from '@/app/lib/llmProviderConfig';

// GitHub Models API — new endpoint (azure endpoint deprecated Oct 2025)
// Works with PATs from github.com/settings/personal-access-tokens (models:read scope)
const GITHUB_MODELS_URL = 'https://models.github.ai/inference/chat/completions';
const DEFAULT_MODEL = process.env.COPILOT_MODEL || 'openai/gpt-4.1';
const FALLBACK_MODEL = process.env.COPILOT_FALLBACK_MODEL || DEFAULT_MODEL;
// Gap-fill uses a lighter model so it doesn't burn the user's main model quota.
// gpt-4.1-mini has a separate (much higher) rate limit on GitHub Models.
// Override with FILL_MODEL env var if needed.
const FILL_MODEL = process.env.FILL_MODEL || 'openai/gpt-4.1-mini';

// Gemini API — OpenAI-compatible endpoint; same request/response format as GitHub Models.
// Auth: GEMINI_TOKEN (Bearer). Get a key at: https://aistudio.google.com/api-keys
// IMPORTANT: use a key created at aistudio.google.com, NOT Google Cloud Console —
// AI Studio keys come with free-tier quotas automatically allocated.
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL = getConfiguredGeminiModel();
const GEMINI_FALLBACK_MODELS = getGeminiFallbackModels();
const AUTO_DOWNGRADE_GPT5 = process.env.AUTO_DOWNGRADE_GPT5 !== 'false';
const DEFAULT_FALLBACK_MODELS = [
  DEFAULT_MODEL,
  'openai/gpt-4.1',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4.1-mini',
  'google/gemini-3-flash',
];
// Allow enough rounds for multi-stock research. With parallel batching, each round
// can execute dozens of tool calls simultaneously — so 30 rounds is ample even for
// 20-stock reports (typically: 1 sector list + 2-3 batch rounds + 1 write round).
const MAX_TOOL_ROUNDS = 30;
const MAX_HISTORY_MESSAGE_CHARS = 4000;
const TOOL_RESULT_MAX_DEPTH = 3;
const TOOL_RESULT_MAX_ARRAY = 12;
const TOOL_RESULT_MAX_KEYS = 40;
const TOOL_RESULT_MAX_STRING = 500;
// Per-request timeout for individual LLM API calls. Keeps a hung upstream call
// from consuming the entire Vercel 300s budget — the fallback chain advances
// to the next model instead. Default: 60s. Override via LLM_REQUEST_TIMEOUT_MS.
const LLM_REQUEST_TIMEOUT_MS = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 60000);

const RATE_LIMIT_GUIDANCE =
  'This model allows 50 requests per day. ' +
  'The system will keep walking the automatic fallback ladder, or you can try again tomorrow.';

const MODEL_COOLDOWN_MS = Number(process.env.LLM_MODEL_COOLDOWN_MS || 120000);
const modelCooldowns = new Map<string, number>();

function isModelCoolingDown(modelId: string): boolean {
  const until = modelCooldowns.get(modelId);
  if (!until) return false;
  if (until <= Date.now()) {
    modelCooldowns.delete(modelId);
    return false;
  }
  return true;
}

function markModelCooldown(modelId: string, retryAfterMs?: number) {
  const cooldown = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : MODEL_COOLDOWN_MS;
  modelCooldowns.set(modelId, Date.now() + cooldown);
}

// Vercel: allow up to 5 minutes for deep research requests
export const maxDuration = 300;
export const runtime = 'nodejs';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

function toPersistentMessages(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string | null }> {
  // Save ONLY user messages and final assistant text replies.
  // Drop assistant messages that only contained tool_calls (content null/empty) and all
  // tool result messages — these form an invalid sequence when reloaded because the
  // tool_calls metadata is not persisted, leaving orphaned 'tool' role messages.
  return messages
    .filter((message) => message.role !== 'system')
    .filter((message) => {
      if (message.role === 'tool') return false;
      if (message.role === 'assistant' && !message.content && message.tool_calls?.length) return false;
      return true;
    })
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    }));
}

const SYSTEM_PROMPT = `You are an elite buy-side equity research analyst. You read EVERY user message, understand intent, then act immediately. Produce institutional-quality, data-driven financial research — thorough, precise, immediately actionable.

**NON-NEGOTIABLE RULES:**

**1. NEVER ask for clarification. Always act immediately.** If the user mentions a company or topic, act on your best interpretation right now. If you need to resolve a name to a ticker, call search_stock — do not ask the user. If the request is genuinely ambiguous (e.g. two companies with the same name), pick the most likely one and proceed.

**2. Fetch before you write.** Never state a fact about a stock without first calling the relevant tool. No estimates, no speculation, no filler.

**3. No training-data facts.** Never use model memory/training data for numeric or time-sensitive market facts. If tools return nothing, state that the data is unavailable.

**4. Batch all parallel calls in ONE round.** Researching N stocks? Issue ALL tool calls simultaneously — never one at a time.

**5. Three report types — use the right one:**
- **generate_stock_report** — single stock deep-dive (earnings, financials, valuation, moat, conclusion). Use when the user asks about ONE company.
- **generate_research_report** — for EVERYTHING multi-company or thematic: comparisons ("NVDA vs AMD"), sector/theme/industry ("cloud computing", "EVs"), deep research on any topic ("growth stocks", "dividend plays", "AI infrastructure"), portfolio ideas. Handles all of it.
- **generate_watchlist_daily_report** — daily update across the user's saved watchlist.

**6. Interactive context.** After delivering a report, stay in context — if the user asks follow-up questions, changes, or refinements, answer using that same research context without re-running the full report unless explicitly asked.

**7. Resolve company names to tickers first.** If the user gives names ("Google", "ARM semiconductors", "Microsoft"), call search_stock immediately to get the correct ticker, then pass tickers to report tools. Do NOT ask the user for the ticker.

**8. Never skip a tool** when that data would strengthen the analysis. If a tool fails, say so explicitly and continue with available data.

**OUTPUT STANDARDS:**
- Tables for comparisons of 2+ stocks.
- ### headers for sections in deep research.
- Emoji markers: 📊 📈 💰 🏦 🔍 ⚠️ ✅ — bold key metrics.
- Show calculations: FCF = Op.CF − CapEx = $X − $Y = $Z.
- Numbers: prices 2 decimals, % 1 decimal, large numbers 2 sig figs ($2.3B).
`;

const COMPACT_SYSTEM_PROMPT = `You are a buy-side equity research analyst.

Rules:
- NEVER ask clarifying questions. Act immediately on your best interpretation.
- If the user gives a company name ("Google", "ARM semiconductors"), call search_stock immediately to resolve the ticker. Do NOT ask the user for the ticker.
- Fetch data via tools before stating facts. Never use training data for numeric facts.
- Batch tool calls in one round.
- Three report tools:
  • generate_stock_report — one company deep-dive.
  • generate_research_report — comparisons, sectors, themes, industries, or any research topic.
  • generate_watchlist_daily_report — user's saved watchlist daily update.
- After a report, stay in context for follow-up questions — no need to re-run unless explicitly asked.
- Use tables for comparisons; show calculations.

Keep answers concise unless the user requests depth.`;

/**
 * Trim conversation history to prevent token limit errors (413) on subsequent turns.
 *
 * All messages loaded from persistence are COMPLETE exchanges (previous turns).
 * Strategy: keep the last `maxExchanges` complete exchanges, each compacted to
 * [user, final-assistant-text] only — dropping all intermediate tool_calls and
 * tool result messages, which are bulky and invalid to replay across turns.
 */
function trimHistory(messages: ChatMessage[], maxExchanges = 2): ChatMessage[] {
  if (messages.length === 0) return messages;

  const system = messages[0]; // always index 0

  // Collect complete exchanges: each exchange = one user message + everything
  // after it until (but not including) the next user message.
  const exchanges: ChatMessage[][] = [];
  let current: ChatMessage[] = [];

  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'user' && current.length > 0) {
      exchanges.push(current);
      current = [];
    }
    current.push(messages[i]);
  }
  if (current.length > 0) exchanges.push(current);

  if (exchanges.length === 0) return messages;

  // From each exchange, keep only [user, final assistant text reply].
  // Tool_calls and tool result messages are dropped — they are bulky, only needed
  // during that turn's reasoning loop, and invalid to replay (tool_calls metadata
  // is not persisted, so reloaded 'tool' messages would be orphaned).
  const compactExchange = (exchange: ChatMessage[]): ChatMessage[] => {
    const userMsg = exchange[0]; // the user message that started this exchange
    // Find the final assistant message that has text content (not just tool_calls)
    const finalAssistant = [...exchange].reverse().find(
      (m) => m.role === 'assistant' && m.content
    );
    if (finalAssistant) return [userMsg, truncateMessageContent(finalAssistant)];
    // No text response found — keep only the user message (drop orphaned tool msgs)
    return [userMsg];
  };

  // Keep the last N complete exchanges, all compacted
  const keepExchanges = exchanges.slice(-maxExchanges);
  const compacted = keepExchanges.flatMap((ex) => compactExchange(ex));

  return [system, ...compacted.map(truncateMessageContent)];
}

function truncateMessageContent(message: ChatMessage): ChatMessage {
  if (!message.content || message.content.length <= MAX_HISTORY_MESSAGE_CHARS) {
    return message;
  }
  return {
    ...message,
    content: `${message.content.slice(0, MAX_HISTORY_MESSAGE_CHARS)}… [truncated]`,
  };
}

function compactToolPayload(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length <= TOOL_RESULT_MAX_STRING) return value;
    return `${value.slice(0, TOOL_RESULT_MAX_STRING)}… [truncated]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const sliced = value.slice(0, TOOL_RESULT_MAX_ARRAY);
    return sliced.map((item) => compactToolPayload(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= TOOL_RESULT_MAX_DEPTH) {
      return '[truncated]';
    }
    const entries = Object.entries(value).slice(0, TOOL_RESULT_MAX_KEYS);
    return entries.reduce<Record<string, any>>((acc, [key, val]) => {
      acc[key] = compactToolPayload(val, depth + 1);
      return acc;
    }, {});
  }
  return value;
}

function isSmallContextModel(model?: string | null): boolean {
  if (!model) return false;
  return /mini|flash|gpt-5/i.test(model);
}

function isToolCallLike(content: string | null | undefined): boolean {
  if (!content) return false;
  return /"name"\s*:\s*"functions\./.test(content) || /"arguments"\s*:\s*\{/.test(content);
}

function buildFallbackModels(requestedModel: string, extraModels: string[] = []): string[] {
  const fromEnv = (process.env.COPILOT_FALLBACK_MODELS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const base = fromEnv.length > 0 ? fromEnv : DEFAULT_FALLBACK_MODELS;
  const combined = [requestedModel, ...base, ...extraModels, FALLBACK_MODEL];
  const unique = Array.from(new Set(combined.filter(Boolean)));
  const available = unique.filter((model) => !isModelCoolingDown(model));
  return available.length > 0 ? available : unique;
}

function buildGeminiFallbackModels(requestedModel?: string | null): string[] {
  const combined = [normalizeGeminiModel(requestedModel), ...GEMINI_FALLBACK_MODELS];
  const unique = Array.from(new Set(combined.filter(Boolean)));
  const available = unique.filter((model) => !isModelCoolingDown(model));
  return available.length > 0 ? available : unique;
}

type LLMExecutionStrategy = {
  provider: RuntimeLLMProvider;
  models: string[];
};

function isGitHubModelId(model?: string | null): boolean {
  return Boolean(model && model.includes('/'));
}

/**
 * Build the ordered list of (provider, models) strategies to try.
 * Always uses all available providers — GitHub first (full fallback chain), then Gemini.
 * provider === null means auto (use all available); 'github'/'gemini' restricts to one.
 */
async function buildLLMExecutionStrategies(
  provider: RuntimeLLMProvider | null,
  requestedModel: string,
  githubToken: string | undefined,
  geminiToken: string | undefined,
): Promise<LLMExecutionStrategy[]> {
  const strategies: LLMExecutionStrategy[] = [];
  const githubRequestedModel = isGitHubModelId(requestedModel)
    ? requestedModel
    : DEFAULT_MODEL;
  const normalizedGithubModel = AUTO_DOWNGRADE_GPT5 && /gpt-5/i.test(githubRequestedModel)
    ? DEFAULT_MODEL
    : githubRequestedModel;
  const geminiRequestedModel = isGitHubModelId(requestedModel)
    ? GEMINI_MODEL
    : normalizeGeminiModel(requestedModel || GEMINI_MODEL);

  const useGitHub = provider === null || provider === 'github';
  const useGemini = provider === null || provider === 'gemini';

  if (useGitHub && githubToken) {
    const catalogModels = (await fetchGitHubModels()).map((item) => item.value);
    strategies.push({
      provider: 'github',
      models: buildFallbackModels(normalizedGithubModel, catalogModels),
    });
  }

  if (useGemini && geminiToken) {
    strategies.push({
      provider: 'gemini',
      models: buildGeminiFallbackModels(geminiRequestedModel),
    });
  }

  return strategies;
}

function sanitizeMessagesForGemini(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    content: typeof message.content === 'string' ? message.content : '',
  }));
}

async function callGitHubModelsAPI(
  messages: ChatMessage[],
  githubToken: string,
  model: string,
  tools: ReturnType<typeof getToolDefinitionsByName>
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(GITHUB_MODELS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${githubToken}`,
        // GitHub API recommended headers — including User-Agent is important:
        // Node.js fetch() does NOT add a User-Agent automatically (unlike browsers),
        // so omitting it makes requests appear as anonymous bot/scraper traffic and
        // can trigger GitHub's anti-abuse 429 "scraping" response.
        'User-Agent': 'stock-report-app/1.0',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
      }),
      signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
    });
  } catch (fetchErr: any) {
    if (fetchErr?.name === 'AbortError' || fetchErr?.name === 'TimeoutError') {
      const err = new Error(
        `GitHub Models API request timed out after ${LLM_REQUEST_TIMEOUT_MS / 1000}s for model '${model}'. Will try next model.`
      ) as Error & { statusCode: number; isTransientServerError: boolean };
      err.statusCode = 503;
      err.isTransientServerError = true;
      throw err;
    }
    const err = new Error(
      `GitHub Models API network failure for model '${model}'. Will try next model.`
    ) as Error & { statusCode: number; isTransientServerError: boolean };
    err.statusCode = 503;
    err.isTransientServerError = true;
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`GitHub Models API ${response.status}:`, errorText.slice(0, 300));
    if (response.status === 401) {
      throw new Error(
        'GitHub Models API authentication failed (401). ' +
        'Your GITHUB_TOKEN may be invalid, expired, or missing the required permissions. ' +
        'Please use a classic PAT from https://github.com/settings/tokens with no specific scopes needed, ' +
        'or a fine-grained PAT from https://github.com/settings/personal-access-tokens with "Models" read permission enabled. ' +
        `API response: ${errorText}`
      );
    }
    if (response.status === 403) {
      throw new Error(
        'GitHub Models API access denied (403). ' +
        'Your token does not have permission to use GitHub Models. ' +
        'If using a fine-grained PAT, enable the "Models" permission under "Account permissions". ' +
        `API response: ${errorText}`
      );
    }
    if (response.status === 429) {
      let waitSeconds: number | undefined;
      try {
        const errorJson = JSON.parse(errorText);
        const msg: string = errorJson?.error?.message || '';
        const match = msg.match(/wait (\d+) seconds/i);
        if (match) waitSeconds = parseInt(match[1], 10);
      } catch {
        // ignore JSON parse errors
      }
      let waitMsg = '';
      if (waitSeconds !== undefined) {
        if (waitSeconds < 3600) {
          waitMsg = ` Please wait approximately ${Math.ceil(waitSeconds / 60)} minute(s) before retrying.`;
        } else {
          waitMsg = ` Please wait approximately ${Math.ceil(waitSeconds / 3600)} hour(s) before retrying.`;
        }
      }
      const err = new Error(
        `Rate limit reached for this model.${waitMsg}`
      ) as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    }
    // GitHub Models returns 400 for most unknown model IDs, but 404 for certain
    // variants — treat both identically so the error is surfaced cleanly.
    if (response.status === 400 || response.status === 404) {
      let errorCode = '';
      try {
        const errorJson = JSON.parse(errorText);
        errorCode = errorJson?.error?.code || '';
      } catch {
        // ignore JSON parse errors
      }
      if (errorCode === 'unknown_model' || errorCode === 'model_not_found') {
        const err = new Error(
          'Model not found. Please select a different model from the dropdown.'
        ) as Error & { statusCode: number };
        err.statusCode = 400;
        throw err;
      }
    }
    if (response.status === 413) {
      const err = new Error(
        'Request too large for this model.'
      ) as Error & { statusCode: number };
      err.statusCode = 413;
      throw err;
    }
    // Transient server errors (500, 502, 503) — mark as retriable so the
    // fallback chain can try the next model or provider instead of giving up.
    // 501 (Not Implemented) is excluded — it's not transient.
    if (response.status === 500 || response.status === 502 || response.status === 503) {
      const err = new Error(
        `GitHub Models API server error (${response.status}) for model '${model}'. Will try next model.`
      ) as Error & { statusCode: number; isTransientServerError: boolean };
      err.statusCode = response.status;
      err.isTransientServerError = true;
      throw err;
    }
    throw new Error(`GitHub Models API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Call the Gemini API using its OpenAI-compatible endpoint.
 * The request/response format is identical to the GitHub Models / OpenAI API, so
 * the same message building, tool definitions, and response parsing all work unchanged.
 * Auth uses GEMINI_TOKEN (Bearer) — key obtained at https://aistudio.google.com/api-keys
 * Model names use Gemini format, e.g. 'gemini-2.0-flash' (set via GEMINI_MODEL env var).
 */
async function callGeminiAPI(
  messages: ChatMessage[],
  geminiToken: string,
  model: string,
  tools: ReturnType<typeof getToolDefinitionsByName>
): Promise<any> {
  const body: Record<string, unknown> = { model, messages: sanitizeMessagesForGemini(messages) };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  let response: Response;
  try {
    response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${geminiToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
    });
  } catch (fetchErr: any) {
    if (fetchErr?.name === 'AbortError' || fetchErr?.name === 'TimeoutError') {
      const err = new Error(
        `Gemini API request timed out after ${LLM_REQUEST_TIMEOUT_MS / 1000}s for model '${model}'. Will try next model.`
      ) as Error & { statusCode: number; isTransientServerError: boolean };
      err.statusCode = 503;
      err.isTransientServerError = true;
      throw err;
    }
    const err = new Error(
      `Gemini API network failure for model '${model}'. Will try next model.`
    ) as Error & { statusCode: number; isTransientServerError: boolean };
    err.statusCode = 503;
    err.isTransientServerError = true;
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Gemini API ${response.status}:`, errorText.slice(0, 300));
    if (response.status === 401) {
      throw new Error(
        'Gemini API authentication failed (401). ' +
        'Your GEMINI_TOKEN may be invalid or expired. ' +
        'Get a new key at https://aistudio.google.com/api-keys. ' +
        `API response: ${errorText}`
      );
    }
    if (response.status === 429) {
      let retryAfterMs: number | undefined;
      let waitMsg = '';
      try {
        const errorJson = JSON.parse(errorText);
        // Check structured RetryInfo details from Gemini response
        const details: any[] = errorJson?.error?.details || [];
        for (const detail of details) {
          if (detail['@type']?.includes('RetryInfo') && detail.retryDelay) {
            const match = String(detail.retryDelay).match(/^(\d+(?:\.\d+)?)s?$/);
            if (match) {
              retryAfterMs = Math.ceil(parseFloat(match[1]) * 1000);
              waitMsg = ` Please retry in ${Math.ceil(parseFloat(match[1]))} second(s).`;
            }
          }
        }
        // Also check plain-text hint in the message field
        if (!retryAfterMs) {
          const msgMatch = String(errorJson?.error?.message || '').match(/please retry in (\d+(?:\.\d+)?)s/i);
          if (msgMatch) {
            retryAfterMs = Math.ceil(parseFloat(msgMatch[1]) * 1000);
            waitMsg = ` Please retry in ${Math.ceil(parseFloat(msgMatch[1]))} second(s).`;
          }
        }
      } catch {
        // ignore JSON parse errors
      }
      const err = new Error(
        `Gemini API rate limit reached (429) for model '${model}'.${waitMsg}`
      ) as Error & { statusCode: number; retryAfterMs?: number };
      err.statusCode = 429;
      if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
      throw err;
    }
    if (response.status === 503) {
      const err = new Error(
        `Gemini API model '${model}' temporarily unavailable (503) — high demand. Will try next model.`
      ) as Error & { statusCode: number; isTransientServerError: boolean };
      err.statusCode = 503;
      err.isTransientServerError = true;
      throw err;
    }
    if (response.status === 400) {
      let apiMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        apiMessage = String(errorJson?.error?.message || errorText);
      } catch {
        // ignore JSON parse errors
      }
      const isUnknownModel = /model.*not found|unsupported model|invalid model/i.test(apiMessage);
      const err = new Error(
        isUnknownModel
          ? `Gemini API model '${model}' is unavailable. Will try the next model.`
          : `Gemini API bad request (400): ${apiMessage}`
      ) as Error & { statusCode: number; isUnknownModel?: boolean };
      err.statusCode = 400;
      if (isUnknownModel) err.isUnknownModel = true;
      throw err;
    }
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Call Gemini with automatic model fallback on retriable errors.
 * Steps through GEMINI_FALLBACK_MODELS in order, trying each on:
 *   429 — quota/rate-limit exhausted (separate quota pool per model)
 *   503 — model temporarily unavailable due to high demand
 *   400 — model ID not found / invalid (skip to the next valid model)
 * Any other error (401 auth, 5xx non-503, etc.) is thrown immediately.
 */
async function callGeminiWithFallback(
  messages: ChatMessage[],
  geminiToken: string,
  tools: ReturnType<typeof getToolDefinitionsByName>,
  requestedModel?: string | null
): Promise<any> {
  // Status codes that mean "this model can't serve right now — try the next one"
  const RETRIABLE = new Set([429, 503, 400]);
  const candidateModels = buildGeminiFallbackModels(requestedModel);
  let lastErr: any;
  for (const model of candidateModels) {
    try {
      const response = await callGeminiAPI(messages, geminiToken, model, tools);
      if (response && typeof response === 'object') {
        (response as any).__model = model;
        (response as any).__fallbackCount = candidateModels.indexOf(model);
      }
      return response;
    } catch (err: any) {
      lastErr = err;
      if (!RETRIABLE.has(err?.statusCode)) throw err;
      const isLast = model === candidateModels[candidateModels.length - 1];
      if (!isLast) {
        console.info(`Gemini model '${model}' unavailable (${err?.statusCode}) — trying next model`);
        // Honor the provider's requested retry delay before moving on (capped at 10 s).
        const delayMs = Math.min(err?.retryAfterMs ?? 0, 10000);
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr;
}

/**
 * Make a targeted LLM call — used for ticker resolution (resolving informal company
 * names or wrong tickers to official US exchange symbols before any API call).
 * Returns the raw response string (expected to be valid JSON).
 * Failures are caught and return '{}' so callers can continue gracefully.
 *
 * Always tries GitHub Models first (FILL_MODEL = gpt-4.1-mini), then falls back to Gemini,
 * exhausting all available models before giving up.
 */
async function callLLMForDataFill(
  prompt: string,
  githubToken: string | undefined,
  geminiToken: string | undefined,
): Promise<string> {
  const fillMessages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a financial data assistant. ' +
        'Do not use training data for numeric financial values (prices, revenues, market caps, etc.) — those come from live APIs. ' +
        'For ticker-resolution prompts and sector/theme company-identification prompts, you MUST use your knowledge of publicly listed companies and their ticker symbols to provide accurate results. ' +
        'Return null for any value you cannot confirm. ' +
        'Respond ONLY with valid JSON — no markdown, no explanation.',
    },
    { role: 'user', content: prompt },
  ];

  const extractContent = (result: any): string => {
    const content = result?.choices?.[0]?.message?.content;
    return content ? String(content) : '{}';
  };

  // Build ordered list of strategies: try multiple GitHub models, then Gemini models
  const strategies: Array<() => Promise<string>> = [];

  // GitHub Models — try FILL_MODEL first, then fallback models
  if (githubToken) {
    const githubModels = [FILL_MODEL, ...DEFAULT_FALLBACK_MODELS].filter(Boolean);
    const seen = new Set<string>();
    for (const model of githubModels) {
      if (seen.has(model)) continue;
      seen.add(model);
      strategies.push(async () => {
        const result = await callGitHubModelsAPI(fillMessages, githubToken, model, []);
        return extractContent(result);
      });
    }
  }

  // Gemini — always available as final fallback when token exists
  if (geminiToken) {
    strategies.push(async () => {
      const result = await callGeminiWithFallback(fillMessages, geminiToken, []);
      return extractContent(result);
    });
  }

  // Try each strategy in order; on retriable errors (429, 5xx), wait and try next
  for (let i = 0; i < strategies.length; i++) {
    try {
      const content = await strategies[i]();
      if (content && content !== '{}') return content;
      // Model returned empty — try next strategy
      console.info(`[callLLMForDataFill] Strategy ${i + 1}/${strategies.length} returned empty, trying next`);
    } catch (err: any) {
      console.info(`[callLLMForDataFill] Strategy ${i + 1}/${strategies.length} failed: ${err?.message || err}`);
      if (err?.statusCode === 429 || (err?.statusCode >= 500 && err?.statusCode <= 503)) {
        const delayMs = Math.min(err?.retryAfterMs ?? 2000, 10000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      // Continue to next strategy
    }
  }

  return '{}';
}

/** Creates an LLMFiller callback bound to the active tokens. */
function createLLMFiller(
  githubToken: string | undefined,
  geminiToken: string | undefined,
): LLMFiller | undefined {
  if (!githubToken && !geminiToken) return undefined;
  return (prompt: string) => callLLMForDataFill(prompt, githubToken, geminiToken);
}

export async function POST(request: NextRequest) {
  const activeProvider: RuntimeLLMProvider | null = null;

  try {
    const body = await request.json();
    const { message, sessionId, model } = body;

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Check if GitHub token is available
    const githubToken = getGitHubToken();
    // Check if Gemini token is available (never exposed client-side — server env only)
    const geminiToken = process.env.GEMINI_TOKEN;
    const usesGeminiPrimary = !githubToken && Boolean(geminiToken);
    const requestedModel = typeof model === 'string' && model.trim()
      ? model
      : usesGeminiPrimary
        ? GEMINI_MODEL
        : DEFAULT_MODEL;

    // Initialize the stock data service — always multi-source using all configured keys.
    const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
    const stockService: StockDataService = createStockService(alphaVantageKey);
    const currentSessionId = typeof sessionId === 'string' && sessionId.trim()
      ? sessionId
      : Math.random().toString(36).substring(7);
    const persistedMessages = await loadSessionMessages(currentSessionId);
    const baseConversationMessages: ChatMessage[] = persistedMessages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const watchlist = await getDefaultWatchlist().catch(() => null);
    const memoryContext = await buildResearchContext({
      sessionId: currentSessionId,
      userMessage: String(message),
      watchlist: watchlist ? {
        name: watchlist.name,
        profile: watchlist.profile,
        items: watchlist.items.map((item) => ({
          symbol: item.symbol,
          companyName: item.companyName,
          position: item,
        })),
      } : undefined,
    });

    // All messages — including report requests — go through the LLM first.
    // The AI model reads user intent and decides which tool to call.
    const preferCompactPrompt = isSmallContextModel(requestedModel);
    const systemPrompt = process.env.USE_FULL_SYSTEM_PROMPT === 'true' && !preferCompactPrompt
      ? SYSTEM_PROMPT
      : COMPACT_SYSTEM_PROMPT;
    let conversationMessages: ChatMessage[] = [
      {
        role: 'system',
        content: memoryContext.summary
          ? `${systemPrompt}\n\nPERSISTENT INVESTOR CONTEXT:\n${memoryContext.summary}`
          : systemPrompt,
      },
      ...baseConversationMessages,
    ];
    if (conversationMessages.length > 1) {
      // Trim accumulated tool messages from previous turns to stay within
      // the model's input token limit (8,000 tokens for high/low tier models,
      // minus ~5,500 tokens of fixed overhead = only ~2,500 tokens for history).
      const maxExchanges = isSmallContextModel(requestedModel) ? 1 : 2;
      conversationMessages = trimHistory(conversationMessages, maxExchanges);
    }

    // Add user message
    conversationMessages.push({ role: 'user', content: message });

    const { toolNames } = selectChatToolNames();
    const toolDefinitions = getToolDefinitionsByName(toolNames);

    // Call the LLM with a provider/model strategy chain.
    let rounds = 0;
    let totalToolCalls = 0;
    let fallbackCount = 0;
    let assistantContent: string | null = null;
    let toolDefinitionsUsed = toolDefinitions;
    const reportArtifacts: Array<{ filename: string; content: string; downloadUrl: string; title?: string; summary?: string; reportDate?: string; reportKind?: string; storagePath?: string }> = [];
     const executionStrategies = await buildLLMExecutionStrategies(
       activeProvider,
       requestedModel,
       githubToken,
       geminiToken,
     );

    if (executionStrategies.length === 0) {
      const err = new Error(
        'No AI provider tokens configured. Set GITHUB_TOKEN and/or GEMINI_TOKEN.'
      ) as Error & { statusCode: number };
      err.statusCode = 503;
      throw err;
    }

    let strategyIndex = 0;
    let modelIndex = 0;
    let activeRuntimeProvider = executionStrategies[strategyIndex].provider;
    let activeModel = executionStrategies[strategyIndex].models[modelIndex];

    const advanceModel = (): boolean => {
      if (modelIndex < executionStrategies[strategyIndex].models.length - 1) {
        modelIndex += 1;
      } else if (strategyIndex < executionStrategies.length - 1) {
        strategyIndex += 1;
        modelIndex = 0;
      } else {
        return false;
      }

      fallbackCount += 1;
      activeRuntimeProvider = executionStrategies[strategyIndex].provider;
      activeModel = executionStrategies[strategyIndex].models[modelIndex];
      return true;
    };

    const callProvider = async (
      runtimeProvider: RuntimeLLMProvider,
      messages: ChatMessage[],
      modelId: string,
      tools: ReturnType<typeof getToolDefinitionsByName>
    ) => {
      if (runtimeProvider === 'gemini') {
        if (!geminiToken) {
          const err = new Error(
            'Gemini token not configured. Set GEMINI_TOKEN environment variable.'
          ) as Error & { statusCode: number };
          err.statusCode = 503;
          throw err;
        }
        return callGeminiWithFallback(messages, geminiToken, tools, modelId);
      }

      if (!githubToken) {
        const err = new Error('GitHub token not configured') as Error & { statusCode: number };
        err.statusCode = 503;
        throw err;
      }
      return callGitHubModelsAPI(messages, githubToken, modelId, tools);
    };

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      let result: any;
      let attempt = 0;
      let retryMessages = conversationMessages;
      let retryTools = toolDefinitions;
      while (attempt < 2) {
        try {
          result = await callProvider(activeRuntimeProvider, retryMessages, activeModel, retryTools);
          toolDefinitionsUsed = retryTools;
          if (typeof result?.__model === 'string') {
            activeModel = result.__model;
          }
          if (typeof result?.__fallbackCount === 'number') {
            fallbackCount += result.__fallbackCount;
          }
          break;
        } catch (error: any) {
          const isRateLimit = error?.statusCode === 429;
          const isServerError = Boolean(error?.isTransientServerError);
          const isUnknownModel = Boolean(error?.isUnknownModel);
          const isBadRequest = error?.statusCode === 400 && !isUnknownModel;
          const isTokensLimit = error?.statusCode === 413;
          // Unknown model: skip to the next fallback without counting as an attempt —
          // retrying with the same invalid model ID would always fail.
          if (isUnknownModel) {
            if (advanceModel()) {
              continue;
            }
            throw error;
          }
          if (attempt === 0 && (isRateLimit || isServerError || isBadRequest)) {
            if (isRateLimit) markModelCooldown(activeModel, error?.retryAfterMs);
            if (advanceModel()) {
              // Honor the provider's requested retry delay (e.g. Gemini RetryInfo), capped at 10 s.
              const delayMs = Math.min(error?.retryAfterMs ?? 0, 10000);
              if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
              }
              attempt++;
              continue;
            }
          }
          if (attempt === 0 && isTokensLimit) {
            retryMessages = [
              { role: 'system', content: COMPACT_SYSTEM_PROMPT },
              { role: 'user', content: message },
            ];
            retryTools = getToolDefinitionsByName(selectChatToolNames().toolNames);
            attempt++;
            continue;
          }
          throw error;
        }
      }
      const choice = result.choices?.[0];

      if (!choice) {
        throw new Error('No response from the model');
      }

      const assistantMessage = choice.message;

      // Add assistant message to conversation
      conversationMessages.push(assistantMessage);

      // If the model wants to call tools, execute all of them in parallel
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        totalToolCalls += assistantMessage.tool_calls.length;
        const loopLLMFill = createLLMFiller(githubToken, geminiToken);
        const toolResults = await Promise.all(
          assistantMessage.tool_calls.map(async (toolCall: { id: string; function: { name: string; arguments: string } }) => {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);
            const toolResult = await executeTool(toolName, { ...toolArgs, sessionId: currentSessionId }, stockService, { llmFill: loopLLMFill });
            // Collect report artifacts; strip full content from model response to avoid echoing
            if (
              (toolName === 'generate_stock_report' || toolName === 'generate_research_report' || toolName === 'generate_watchlist_daily_report') &&
              toolResult.success && toolResult.data?.filename && toolResult.data?.content
            ) {
              reportArtifacts.push({
                filename: toolResult.data.filename as string,
                content: toolResult.data.content as string,
                downloadUrl: toolResult.data.downloadUrl as string,
                title: toolResult.data.title as string | undefined,
                summary: toolResult.data.summary as string | undefined,
                reportDate: toolResult.data.reportDate as string | undefined,
                reportKind: toolResult.data.reportKind as string | undefined,
                storagePath: toolResult.data.storagePath as string | undefined,
              });
              return {
                role: 'tool' as const,
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  success: true,
                  message: `Report saved to Artifacts panel: ${toolResult.data.filename}`,
                  filename: toolResult.data.filename,
                  downloadUrl: toolResult.data.downloadUrl,
                }),
              };
            }
            return {
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: JSON.stringify(compactToolPayload(toolResult)),
            };
          })
        );
        conversationMessages.push(...toolResults);
        // Continue the loop so the model can process tool results
        continue;
      }

      // No tool calls — we have the final response
      assistantContent = assistantMessage.content;
      if (isToolCallLike(assistantContent)) {
        const err = new Error('Model returned tool calls as plain text.') as Error & { statusCode: number };
        err.statusCode = 422;
        throw err;
      }
      break;
    }

    // Save conversation history
    await saveSessionMessages(currentSessionId, toPersistentMessages(conversationMessages), {
      summary: assistantContent || 'Investment research exchange',
    });

    console.info('Chat request stats', {
      runtimeProvider: activeRuntimeProvider,
      requestedModel,
      model: activeModel,
      fallbackCount,
      rounds,
      toolCalls: totalToolCalls,
      toolsProvided: toolDefinitionsUsed.length,
    });

    return NextResponse.json({
      response: assistantContent || "I apologize, but I couldn't generate a response. Please try again.",
      sessionId: currentSessionId,
      model: activeModel,
      requestedModel,
      provider: activeRuntimeProvider,
      runtimeProvider: activeRuntimeProvider,
      fallbackCount,
      reports: reportArtifacts.length > 0 ? reportArtifacts : undefined,
      stats: {
        rounds,
        toolCalls: totalToolCalls,
        toolsProvided: toolDefinitionsUsed.length,
      },
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    const isRateLimit = error.statusCode === 429;
    const isServerError = Boolean(error.isTransientServerError);
    const isUnknownModel = Boolean(error.isUnknownModel);
    const isBadRequest = error.statusCode === 400 && !isUnknownModel;
    const isTokensLimit = error.statusCode === 413;
    const isToolCallText = error.statusCode === 422;
    const isMissingKey = error.statusCode === 503 && !isServerError;
    const statusCode = error.statusCode || (isRateLimit
      ? 429
      : isUnknownModel || isBadRequest
      ? 400
      : isTokensLimit
      ? 413
      : isToolCallText
      ? 422
      : 500);
    let details: string;
    if (isRateLimit) {
      details = RATE_LIMIT_GUIDANCE;
    } else if (isServerError) {
      details = 'The AI providers returned temporary server errors. The system already retried across the available model ladder. Please try again in a few moments.';
    } else if (isUnknownModel) {
      details = 'One or more server-side model IDs are no longer valid. The system exhausted the automatic fallback ladder. Verify `COPILOT_MODEL`, `COPILOT_FALLBACK_MODELS`, and `GEMINI_MODEL` in environment variables.';
    } else if (isBadRequest) {
      details = 'The AI providers rejected the request payload after exhausting the automatic fallback ladder. Please try again in a few moments.';
    } else if (isTokensLimit) {
      details = `The conversation history has grown too large for this model's token limit. Start a new chat to clear the history and try again.`;
    } else if (isToolCallText) {
      details = 'This model returned tool calls as plain text. The system will retry with a different model automatically.';
    } else if (isMissingKey) {
      details =
        'Please set GITHUB_TOKEN and/or GEMINI_TOKEN in your Vercel environment variables. ' +
        'Get a GitHub token at: https://github.com/settings/tokens — Get a Gemini key at: https://aistudio.google.com/api-keys';
    } else {
      details = 'An unexpected error occurred. Check your LLM provider tokens and stock data provider keys in Vercel environment variables, or try again in a few moments.';
    }
    return NextResponse.json(
      {
        error: error.message || 'Failed to process message',
        details,
      },
      { status: statusCode }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (sessionId) {
      await deleteSession(String(sessionId));
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Session cleanup error:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup session' },
      { status: 500 }
    );
  }
}
