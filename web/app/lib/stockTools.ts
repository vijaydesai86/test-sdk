/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from 'fs';
import path from 'path';
import {
  BlsPublicDataService,
  BeaService,
  EiaService,
  StockDataService,
  SecCompanyFactsService,
  SecEdgarService,
  FredService,
  TreasuryYieldCurveService,
} from './stockDataService';
import { buildStockReport, buildComparisonReport, buildDeepSectorReport, buildDeepStockReport, buildDeepComparisonReport, buildWatchlistDailyReport, saveReport, MoatAnalysis, computeScorecard, computeTechnicalSnapshot, computeVolumeAnalysis } from './reportGenerator';
import { computeDcfValuation } from './dcfValuation';
import { getDefaultWatchlist } from './watchlistStore';
import { buildDecisionSnapshot, decisionSnapshotToLegacyAction } from './decisionEngine';
import { createTrustEntry, getTtlMinutesForKey, summarizeTrust } from './dataTrust';
import { appendDecisionJournal, getLatestDecision, upsertCompanyThesis } from './researchMemoryStore';
import type { DataTrustEntry, DecisionSnapshot } from './investmentTypes';
import { DEFAULT_REPORTS_DIR } from './reportFileStore';
import {
  buildReportRunMetadata,
  buildUpdateNotes,
  findPreviousReportForUpdate,
  type CoverageInput,
  type PreviousReportMatch,
  type ReportKind,
} from './reportUpdate';

/**
 * OpenAI-compatible tool definitions for stock information
 */
export function getToolDefinitions() {
  return buildToolDefinitions();
}

export function getToolDefinitionsByName(toolNames?: string[]) {
  const definitions = buildToolDefinitions();
  if (!toolNames || toolNames.length === 0) {
    return definitions;
  }
  const allowList = new Set(toolNames);
  return definitions.filter((tool) => allowList.has(tool.function.name));
}

const REPORTS_DIR = DEFAULT_REPORTS_DIR;
const CACHE_DIR = path.join(REPORTS_DIR, 'cache');
const CACHE_TTL_MS = Number(process.env.STOCK_CACHE_TTL_MS || 1000 * 60 * 60 * 24 * 7);

function parseBoundedEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  return Math.min(max, Math.max(min, normalized));
}

// Number of companies to include in comparison and research reports.
// Clamp to a free-tier-safe ceiling so a bad env value cannot fan out into dozens of API calls.
const NUM_COMPANIES = parseBoundedEnvInt('NUM_COMPANIES', 10, 2, 15);
// Optional post-core-data ecosystem/refinement passes in research reports.
// Core market data is always fetched before any pass is allowed to run.
const DEEP_RESEARCH_DEPTH = parseBoundedEnvInt('DEEP_RESEARCH_DEPTH', 1, 1, 3);
// Keep enough headroom under Vercel's overall runtime limit for rendering and persistence work.
const DEFAULT_DEEP_RESEARCH_MAX_MS = process.env.VERCEL ? 240000 : 600000;
const MAX_DEEP_RESEARCH_MAX_MS = process.env.VERCEL ? 270000 : 900000;
const DEEP_RESEARCH_MAX_MS = parseBoundedEnvInt(
  'DEEP_RESEARCH_MAX_MS',
  DEFAULT_DEEP_RESEARCH_MAX_MS,
  60000,
  MAX_DEEP_RESEARCH_MAX_MS
);
// Bound parallel fetch fan-out so one request cannot overwhelm free-tier provider quotas.
const DATA_FETCH_CONCURRENCY = parseBoundedEnvInt('DATA_FETCH_CONCURRENCY', 3, 1, 4);
const VERCEL_EXTENDED_DATA_MAX_COMPANIES = parseBoundedEnvInt('VERCEL_EXTENDED_DATA_MAX_COMPANIES', 3, 1, 15);
const VERCEL_REPORT_RETURN_BUFFER_MS = parseBoundedEnvInt('VERCEL_REPORT_RETURN_BUFFER_MS', 45000, 5000, 120000);
const VERCEL_REPORT_LLM_MIN_REMAINING_MS = parseBoundedEnvInt('VERCEL_REPORT_LLM_MIN_REMAINING_MS', 120000, 30000, 240000);
type ReportWorkPriority = 'critical' | 'high' | 'optional' | 'llm';
const REPORT_TASK_TIMEOUT_MS: Record<ReportWorkPriority, number> = {
  critical: process.env.VERCEL ? 12000 : 30000,
  high: process.env.VERCEL ? 8000 : 25000,
  optional: process.env.VERCEL ? 4000 : 15000,
  llm: process.env.VERCEL ? 12000 : 60000,
};

function shouldFetchExtendedReportData(companyCount: number): boolean {
  return !process.env.VERCEL || companyCount <= VERCEL_EXTENDED_DATA_MAX_COMPANIES;
}

function remainingMs(deadlineAt?: number): number {
  if (!deadlineAt) return Number.POSITIVE_INFINITY;
  return deadlineAt - Date.now();
}

function isDeadlineNear(deadlineAt?: number, bufferMs = VERCEL_REPORT_RETURN_BUFFER_MS): boolean {
  return remainingMs(deadlineAt) <= bufferMs;
}

function reportSaveBufferMs(companyCount = 1): number {
  if (!process.env.VERCEL) return VERCEL_REPORT_RETURN_BUFFER_MS;
  const countBuffer = Math.min(30000, Math.max(0, companyCount - 1) * 3000);
  return Math.max(VERCEL_REPORT_RETURN_BUFFER_MS, 35000 + countBuffer);
}

function hasReportWorkBudget(deadlineAt: number | undefined, priority: ReportWorkPriority, companyCount = 1): boolean {
  if (!deadlineAt) return true;
  const saveBuffer = reportSaveBufferMs(companyCount);
  const extra =
    priority === 'critical' ? 10000 :
    priority === 'high' ? 30000 :
    priority === 'optional' ? 60000 :
    Math.max(75000, VERCEL_REPORT_LLM_MIN_REMAINING_MS - saveBuffer);
  return remainingMs(deadlineAt) > saveBuffer + extra;
}

function hasReportLLMBudget(deadlineAt?: number): boolean {
  return hasReportWorkBudget(deadlineAt, 'llm');
}

function reportTaskTimeoutMs(priority: ReportWorkPriority, deadlineAt?: number): number {
  const base = REPORT_TASK_TIMEOUT_MS[priority];
  if (!deadlineAt) return base;
  const saveBuffer = reportSaveBufferMs();
  const usable = remainingMs(deadlineAt) - saveBuffer;
  return Math.max(1000, Math.min(base, usable));
}

async function withReportTaskTimeout<T>(
  task: Promise<T>,
  priority: ReportWorkPriority,
  deadlineAt?: number
): Promise<T> {
  const timeoutMs = reportTaskTimeoutMs(priority, deadlineAt);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Report ${priority} task timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function pushDeadlineNote(notes: string[], deadlineAt?: number): boolean {
  if (!isDeadlineNear(deadlineAt)) return false;
  if (!notes.some((note) => note.includes('Vercel runtime budget'))) {
    notes.push('Vercel runtime budget reached; report returned with the highest-value data collected before the deadline.');
  }
  return true;
}

function budgetedCompanyLimit(requestedCount: number, deadlineAt?: number): number {
  if (!deadlineAt || !process.env.VERCEL) return requestedCount;
  const remaining = remainingMs(deadlineAt);
  if (remaining > 210000) return Math.min(requestedCount, 8);
  if (remaining > 150000) return Math.min(requestedCount, 8);
  if (remaining > 100000) return Math.min(requestedCount, 6);
  return Math.min(requestedCount, 3);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<R>,
  shouldContinue?: () => boolean,
  minItems = 0
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const minimumToStart = Math.min(items.length, Math.max(0, minItems));

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      if (shouldContinue && !shouldContinue() && currentIndex >= minimumToStart) break;
      index += 1;
      results[currentIndex] = await handler(items[currentIndex]);
    }
  });

  await Promise.all(runners);
  return results.filter((result): result is R => result !== undefined);
}
const DEFAULT_SOURCE = 'Multi-source';
const SOURCE_LEGEND =
  '_Legend: Automatic provider chain uses all configured providers: Alpha Vantage, Finnhub, Financial Modeling Prep, Twelve Data, then Stooq where supported._';

type SavedReport = Awaited<ReturnType<typeof saveReport>>;

function buildReportDownloadUrl(saved: SavedReport): string {
  if (saved.supabaseId) return `/api/saved-reports/${saved.supabaseId}`;
  return `/api/reports/${saved.storagePath ?? saved.filename}`;
}

async function prepareReportUpdateContext(args: Record<string, any>, input: {
  kind: ReportKind;
  query?: string;
  symbols?: string[];
}): Promise<{ previous: PreviousReportMatch | null; notes: string[] }> {
  if (!args.updateMode) return { previous: null, notes: [] };
  const previous = await findPreviousReportForUpdate({
    kind: input.kind,
    query: String(args.updateQuery || input.query || ''),
    symbols: input.symbols || [],
  });
  return { previous, notes: buildUpdateNotes(previous, input.kind) };
}

function providerForCoverage(value: any, fallback = DEFAULT_SOURCE): string | undefined {
  return value && typeof value === 'object' && '__source' in value ? String(value.__source) : fallback;
}

function coverageEntry(
  symbol: string,
  key: string,
  label: string,
  data: any,
  priority: CoverageInput['priority'] = 'optional'
): CoverageInput {
  return {
    symbol,
    key,
    label,
    data,
    priority,
    provider: providerForCoverage(data),
  };
}

const RATE_LIMIT_PROVIDERS = [
  { pattern: /finnhub/i, label: 'Finnhub' },
  { pattern: /twelve data|twelvedata/i, label: 'Twelve Data' },
  { pattern: /financial modeling prep|fmp/i, label: 'Financial Modeling Prep' },
  { pattern: /stooq/i, label: 'Stooq' },
  { pattern: /alpha/i, label: 'Alpha Vantage' },
];
const isRateLimitError = (message: string) =>
  /rate limit|too many requests|quota|frequency|thank you for using alpha vantage/i.test(message);
const detectRateLimitProvider = (message: string) =>
  RATE_LIMIT_PROVIDERS.find((entry) => entry.pattern.test(message))?.label || 'Data provider';
const isSuppressedProviderError = (message: string) =>
  /unavailable (in|via) (alpha|finnhub|financial modeling prep|fmp|twelve data|twelvedata|stooq)/i.test(message)
  || /alpha-only mode/i.test(message);

/**
 * Callback that makes a targeted LLM call and returns the raw response string.
 * Used to resolve ambiguous or informal company names/tickers to official US
 * exchange symbols before making any market-data API calls.
 */
export type LLMFiller = (prompt: string) => Promise<string>;

/** Optional options passed to executeTool for report generation tools. */
export interface ExecuteToolOptions {
  /** When provided, called to resolve tickers that the search API could not validate. */
  llmFill?: LLMFiller;
  /** Absolute wall-clock deadline for the current request. Used on Vercel to return before maxDuration kills the function. */
  deadlineAt?: number;
}

/** Parses and cleans an LLM response expected to be JSON. Returns null if unparseable. */
function parseLLMFillJSON(response: string): any | null {
  try {
    const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Attempts to parse an LLM response as a JSON array of ticker strings.
 * Returns an empty array if the response is invalid.
 */
function parseLLMTickerArray(raw: string, maxCount: number): string[] {
  try {
    // Strip markdown fences and surrounding whitespace
    let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    // Some LLMs wrap the JSON array in explanatory text — extract the array portion
    const arrayMatch = cleaned.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      cleaned = arrayMatch[0];
    }
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item: any) => normalizeTickerCandidate(item))
        .filter((t): t is string => Boolean(t))
        .slice(0, maxCount);
    }
    // If the LLM returned an object with a key containing an array (e.g. { tickers: [...] })
    if (parsed && typeof parsed === 'object') {
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key])) {
          return parsed[key]
            .map((item: any) => normalizeTickerCandidate(item))
            .filter((t: string | undefined): t is string => Boolean(t))
            .slice(0, maxCount);
        }
      }
    }
  } catch {
    // Try to extract ticker-like symbols from the raw text as last resort
    const tickerMatches = raw.match(/\b[A-Z]{1,5}\b/g);
    if (tickerMatches && tickerMatches.length >= 2) {
      return [...new Set(tickerMatches)].slice(0, maxCount);
    }
  }
  return [];
}

function normalizeThematicResearchQuery(query: string): string {
  let normalized = query.trim();
  if (!normalized) return normalized;
  normalized = normalized
    .replace(/^\s*(please\s+)?(generate|create|write|make|give\s+me|show\s+me)\s+(a\s+)?/i, '')
    .replace(/^\s*(deep\s+research|research|report|stock\s+report|sector\s+study|study|analysis)\s+(on|for|about|of)\s+/i, '')
    .replace(/^\s*(deep\s+research|research|report|sector\s+study|study|analysis)\s+/i, '')
    .replace(/\b(publicly\s+traded|listed|equity|equities|companies|company|stocks|stock|sector|theme|industry|industries)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || query.trim();
}

function buildUnavailableResearchContent(query: string, reason: string, generatedAt = new Date().toISOString()): string {
  return [
    `# Research Report: ${query}`,
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Verified Data Status',
    '',
    reason,
    '',
    'No market-data-backed decision was generated because the company universe could not be verified from the configured providers before the request deadline.',
    '',
    '## Decision',
    '',
    'Action: Wait for verified inputs.',
    '',
    'This report intentionally does not include guessed tickers, market data, or LLM-derived financial facts.',
  ].join('\n');
}

/**
 * Identifies companies for a sector/theme query.
 *
 * Strategy (all sources are live — no hardcoded lists):
 *   1. LLM call — primary resolver via buildSectorCompaniesPrompt.
 *   2. LLM retry — a shorter, more explicit prompt if the first attempt returned < 2 tickers.
 *   3. API search fallback — calls stockService.searchStock(sector) to find related
 *      real tickers from the live data provider.
 */
async function resolveSectorTickers(
  sector: string,
  count: number,
  llmFill?: LLMFiller,
  stockService?: StockDataService,
): Promise<string[]> {
  const collectedTickers: string[] = [];

  // Attempt 1: LLM with the standard sector prompt
  if (llmFill) {
    const prompt = buildSectorCompaniesPrompt(sector, count);
    try {
      const raw = await llmFill(prompt);
      console.info(`[resolveSectorTickers] LLM attempt 1 raw response (${raw?.length ?? 0} chars):`, raw?.substring(0, 200));
      const tickers = parseLLMTickerArray(raw, count);
      if (tickers.length >= 2) return tickers;
      collectedTickers.push(...tickers);
      console.info(`[resolveSectorTickers] Attempt 1 parsed only ${tickers.length} tickers — retrying`);
    } catch (err: any) {
      console.warn(`[resolveSectorTickers] LLM attempt 1 error:`, err?.message || err);
    }

    // Attempt 2: LLM retry with a shorter, more direct prompt
    try {
      const retryPrompt =
        `List exactly ${count} US-listed stock ticker symbols for the top companies in the "${sector}" sector. ` +
        `Return ONLY a JSON array of ticker strings, nothing else. Example: ["AAPL","MSFT"]`;
      const raw = await llmFill(retryPrompt);
      console.info(`[resolveSectorTickers] LLM attempt 2 raw response (${raw?.length ?? 0} chars):`, raw?.substring(0, 200));
      const tickers = parseLLMTickerArray(raw, count);
      if (tickers.length >= 2) return tickers;
      collectedTickers.push(...tickers);
      console.info(`[resolveSectorTickers] Attempt 2 parsed only ${tickers.length} tickers`);
    } catch (err: any) {
      console.warn(`[resolveSectorTickers] LLM attempt 2 error:`, err?.message || err);
    }

    // Attempt 3: LLM with a plain-text company name prompt, then resolve each to ticker
    try {
      const namePrompt =
        `Name the top ${count} publicly traded US companies in the "${sector}" industry. ` +
        `Return ONLY a JSON array of their stock ticker symbols. Example: ["AAPL","MSFT","GOOGL"]`;
      const raw = await llmFill(namePrompt);
      console.info(`[resolveSectorTickers] LLM attempt 3 raw response (${raw?.length ?? 0} chars):`, raw?.substring(0, 200));
      const tickers = parseLLMTickerArray(raw, count);
      if (tickers.length >= 2) return tickers;
      collectedTickers.push(...tickers);
    } catch (err: any) {
      console.warn(`[resolveSectorTickers] LLM attempt 3 error:`, err?.message || err);
    }
  } else {
    console.warn(`[resolveSectorTickers] No llmFill provided — cannot resolve sector tickers via LLM`);
  }

  // Attempt 4: API search fallback — extract tickers from live search results
  if (stockService) {
    try {
      const results = await stockService.searchStock(sector);
      const candidates = (results?.results || []) as any[];
      console.info(`[resolveSectorTickers] API search returned ${candidates.length} candidates for "${sector}"`);
      if (candidates.length >= 2) {
        return candidates
          .map((c: any) => String(c.symbol || '').toUpperCase())
          .filter((s) => s.length > 0 && /^[A-Z0-9.]+$/.test(s))
          .slice(0, count);
      }
      // Even 1 result helps — collect it and also try peers
      if (candidates.length >= 1) {
        const firstSymbol = String(candidates[0].symbol || '').toUpperCase();
        if (firstSymbol) collectedTickers.push(firstSymbol);
      }
    } catch (err: any) {
      console.warn(`[resolveSectorTickers] API search error:`, err?.message || err);
    }

    // Attempt 5: If we have at least one ticker, get its peers to build the universe
    const unique = [...new Set(collectedTickers)].filter(Boolean);
    if (unique.length >= 1) {
      try {
        const peers = await stockService.getPeers(unique[0]);
        const peerSymbols = (Array.isArray(peers) ? peers : (peers as any)?.peers || [])
          .map((p: any) => typeof p === 'string' ? p.toUpperCase() : String(p?.symbol || '').toUpperCase())
          .filter((s: string) => s.length > 0 && /^[A-Z0-9.]+$/.test(s));
        console.info(`[resolveSectorTickers] Peers of ${unique[0]} returned ${peerSymbols.length} peers`);
        const combined = [...new Set([...unique, ...peerSymbols])].slice(0, count);
        if (combined.length >= 2) return combined;
        collectedTickers.push(...peerSymbols);
      } catch (err: any) {
        console.warn(`[resolveSectorTickers] Peers lookup error:`, err?.message || err);
      }
    }
  }

  // Final: return whatever we collected, even if < 2
  const final = [...new Set(collectedTickers)].filter(Boolean);
  if (final.length > 0) {
    console.info(`[resolveSectorTickers] Returning ${final.length} partial tickers for "${sector}"`);
    return final.slice(0, count);
  }

  console.warn(`[resolveSectorTickers] All attempts failed for sector "${sector}"`);
  return [];
}

/**
 * Builds a prompt asking the LLM to map each query to its official US stock ticker.
 * Used when the market-data search API returns no candidates.
 */
function buildTickerResolutionPrompt(queries: string[]): string {
  const shape = Object.fromEntries(queries.map((q) => [q, 'TICKER | null']));
  return (
    `You are a financial data assistant. For each of the following company names or informal tickers, ` +
    `identify the correct official US stock exchange ticker symbol.\n\n` +
    `Inputs: ${JSON.stringify(queries)}\n\n` +
    `RULES:\n` +
    `- Return the primary US-listed ticker for each company\n` +
    `- For share-class ambiguity, prefer the more liquid class\n` +
    `- Return null for any input you cannot identify with certainty (do NOT provide financial values)\n` +
    `Respond ONLY with valid JSON:\n` +
    JSON.stringify(shape, null, 2)
  );
}

/**
 * Builds a prompt asking the LLM to identify the top N publicly-traded US companies
 * for a given sector or investment theme.
 * NOTE: This call returns ONLY ticker symbols — all financial data is fetched from
 * real market-data APIs immediately after. The LLM must NEVER supply financial values.
 */
function buildSectorCompaniesPrompt(sector: string, count: number): string {
  return (
    `You are a financial analyst. Identify the top ${count} publicly-traded US companies that are leading players in the "${sector}" sector or investment theme.\n\n` +
    `RULES:\n` +
    `- Return ONLY official US stock exchange ticker symbols (NYSE/NASDAQ)\n` +
    `- Select companies that are pure-play or significantly exposed to "${sector}"\n` +
    `- Prefer large-cap, highly liquid stocks — avoid micro-caps and OTC stocks. Return ticker symbols ONLY (no prices, revenues, or financial metrics — those come from live APIs)\n\n` +
    `Respond ONLY with a valid JSON array of exactly ${count} ticker symbols (no markdown, no explanation):\n` +
    `["TICK1", "TICK2", "TICK3"]`
  );
}

/** Prior-pass context fed into subsequent refinement passes for recursive deep research. */
export interface DeepSectorPassContext {
  dependencyAnalysis?: string;
  ecosystemDiagram?: string;
  refinementNotes?: string;
  companySnapshots?: Record<string, string>;
  universe?: string[];
  passIndex?: number;
}

/**
 * Builds a prompt that asks the LLM to:
 *   1. Analyse sector ecosystem dependencies (supply chain, customers, market, news)
 *   2. Produce a Mermaid diagram of the sector ecosystem
 *   3. Refine the candidate list to the best `finalCount` companies
 *   4. Explain the selection rationale
 *
 * The prompt feeds real company overview and news-sentiment data gathered in Phase 2
 * so that the LLM can ground its analysis in actual data rather than training memory.
 *
 * When `previousPass` is supplied (recursive depth > 1), the prior analysis is included
 * so the LLM can deepen and further refine the results from the previous pass.
 */
function buildDeepSectorDependencyPrompt(
  sector: string,
  finalCount: number,
  candidates: Array<{ symbol: string; overview: any; news: any; peers: any }>,
  previousPass?: DeepSectorPassContext
): string {
  const summaries = candidates
    .map(({ symbol, overview, news, peers }) => {
      const name = overview?.name || symbol;
      const desc = overview?.description
        ? String(overview.description).slice(0, 250)
        : 'No description available';
      const sectorInfo =
        overview?.sector
          ? `Sector: ${overview.sector} | Industry: ${overview.industry || 'N/A'}`
          : 'Sector: N/A';
      const sentiment =
        news?.overallSentimentLabel || news?.sentiment || 'Unknown';
      const peerList = Array.isArray(peers?.peers)
        ? peers.peers.slice(0, 5).join(', ')
        : 'N/A';
      return (
        `Ticker: ${symbol} | ${name}\n` +
        `  ${sectorInfo}\n` +
        `  Description: ${desc}\n` +
        `  News sentiment: ${sentiment}\n` +
        `  Peers: ${peerList}`
      );
    })
    .join('\n\n');

  const symbolList = candidates.map((c) => c.symbol).join(', ');

  const previousPassSection = previousPass
    ? (
        `\nPREVIOUS PASS ANALYSIS (pass ${(previousPass.passIndex ?? 0) + 1} — deepen and further refine this):\n` +
        (previousPass.universe?.length
          ? `  Previously refined universe: ${previousPass.universe.join(', ')}\n`
          : '') +
        (previousPass.dependencyAnalysis
          ? `  Prior dependency analysis: ${previousPass.dependencyAnalysis.slice(0, 600)}\n`
          : '') +
        (previousPass.refinementNotes
          ? `  Prior rationale: ${previousPass.refinementNotes.slice(0, 400)}\n`
          : '') +
        `\nUsing the prior analysis above, produce a DEEPER and MORE PRECISE analysis. ` +
        `Correct any gaps, refine the company selection, and expand the ecosystem diagram.\n`
      )
    : '';

  return (
    `You are a senior equity research analyst. Your task is to perform a deep research ecosystem analysis for "${sector}".\n\n` +
    `CRITICAL: All your analysis MUST be grounded in the company data provided below (from live APIs). ` +
    `Do NOT inject financial figures (prices, revenues, margins, etc.) from training memory — use ONLY the data given.\n\n` +
    `CANDIDATE COMPANIES: ${symbolList}\n\n` +
    `COMPANY DATA:\n${summaries}\n` +
    previousPassSection +
    `\nTASKS:\n` +
    `1. ECOSYSTEM ANALYSIS: Write a structured analysis using EXACTLY these four ### markdown subsection headers (one paragraph each):\n` +
    `   ### 🔗 Supply Chain & Dependencies\n` +
    `   (key supplier/input relationships, who depends on whom, upstream/downstream links)\n` +
    `   ### 👥 Customer & Revenue Exposure\n` +
    `   (major end-markets, B2B vs consumer split, revenue concentration, geographic exposure)\n` +
    `   ### 📊 Market & Macro Factors\n` +
    `   (regulation, commodity prices, interest rates, geopolitics affecting the sector)\n` +
    `   ### ⚔️ Competitive Dynamics & Sentiment\n` +
    `   (competitive moats, market-share battles, news sentiment themes across candidates)\n\n` +
    `2. ECOSYSTEM DIAGRAM: Create a concise Mermaid diagram (graph LR direction) showing the most important\n` +
    `   supplier-company-customer relationships or competitive positioning. Keep it to at most 15 nodes.\n` +
    `   Use plain node names without special characters.\n\n` +
    `3. REFINEMENT: Select the best ${finalCount} companies from the candidates for deep financial analysis.\n` +
    `   Criteria: sector relevance, financial strength, market leadership, and portfolio diversification.\n\n` +
    `4. RATIONALE: For EVERY candidate, write exactly one line in this format — no extra text:\n` +
    `   ✅ TICKER (Company Name) — reason this company was selected\n` +
    `   ❌ TICKER (Company Name) — reason this company was excluded\n\n` +
    `5. COMPANY SNAPSHOTS: For each company in the FINAL refined list only, provide a 1-2 sentence summary\n` +
    `   of their role in the sector and key investment relevance. Use the company ticker as the key.\n\n` +
    `Respond ONLY with valid JSON (no markdown fences, no explanation outside the JSON):\n` +
    `{"refinedList":["TICK1","TICK2"],"dependencyAnalysis":"### 🔗 Supply Chain & Dependencies\\n\\ntext...\\n\\n### 👥 Customer & Revenue Exposure\\n\\ntext...","ecosystemDiagram":"graph LR\\n  NodeA-->NodeB","refinementNotes":"✅ TICK1 (Name) — reason\\n❌ TICK2 (Name) — reason","companySnapshots":{"TICK1":"1-2 sentence snapshot...","TICK2":"1-2 sentence snapshot..."}}`
  );
}

/**
 * Builds a prompt for the LLM to assess the competitive moat of a single company.
 * Returns a JSON object with moatType, moatStrength, moatScore, barriers, narrative, and bestFor.
 */
function buildMoatAnalysisPrompt(
  symbol: string,
  overview: any,
  basicFinancials: any,
): string {
  const name = overview?.name || symbol;
  const sector = overview?.sector || 'N/A';
  const industry = overview?.industry || 'N/A';
  const description = overview?.description
    ? String(overview.description).slice(0, 400)
    : 'No description available';
  const grossMargin = basicFinancials?.metric?.grossMarginTTM;
  const operatingMargin = overview?.operatingMargin ?? basicFinancials?.metric?.operatingMarginTTM;
  const roe = overview?.returnOnEquity ?? basicFinancials?.metric?.roeTTM;
  const revenueGrowth = basicFinancials?.metric?.revenueGrowthTTM ?? overview?.quarterlyRevenueGrowth;

  const fmt = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 'N/A';
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return `${pct.toFixed(1)}%`;
  };

  return (
    `You are a senior equity research analyst specialising in Warren Buffett-style economic moat analysis.\n\n` +
    `CRITICAL: Base your entire analysis ONLY on the real API data provided below. ` +
    `Do NOT use training-memory values for prices, margins, revenue, or any financial metric — ` +
    `available financial inputs come from provider/official API data or direct arithmetic on those responses and are provided here. ` +
    `If a moat claim is not supported by the provided description or metrics, mark the moat as None.\n\n` +
    `Assess the competitive moat for the following company and return a JSON object.\n\n` +
    `Company: ${name} (${symbol})\n` +
    `Sector: ${sector}\n` +
    `Industry: ${industry}\n` +
    `Description: ${description}\n` +
    `Gross Margin (TTM): ${fmt(grossMargin)}\n` +
    `Operating Margin (TTM): ${fmt(operatingMargin)}\n` +
    `ROE (TTM): ${fmt(roe)}\n` +
    `Revenue Growth (TTM): ${fmt(revenueGrowth)}\n\n` +
    `MOAT FRAMEWORK:\n` +
    `- Network Effects: value grows as more users/customers join\n` +
    `- Cost Advantage: structurally lower costs than peers\n` +
    `- Switching Costs: expensive or painful for customers to leave\n` +
    `- Intangible Assets: brands, patents, regulatory licenses\n` +
    `- Efficient Scale: niche market where competition is uneconomic\n` +
    `- Mixed: combination of two or more of the above\n` +
    `- None: no durable competitive advantage identified\n\n` +
    `SCORING:\n` +
    `- moatScore 0-30 = None (easily competed away)\n` +
    `- moatScore 31-60 = Narrow (3-10 year advantage)\n` +
    `- moatScore 61-100 = Wide (10+ year durable advantage)\n\n` +
    `Respond ONLY with valid JSON (no markdown, no extra text):\n` +
    `{"moatType":"<Network Effects|Cost Advantage|Switching Costs|Intangible Assets|Efficient Scale|Mixed|None>","moatStrength":"<Wide|Narrow|None>","moatScore":<0-100>,"barriers":["<specific barrier 1>","<specific barrier 2>"],"narrative":"<2-4 sentence analysis of moat sources and sustainability>","bestFor":"<1-2 sentences: what this company excels at and who it is best for>"}`
  );
}

/**
 * Builds a single LLM call that assesses the competitive moat for a batch of companies.
 * Returns a JSON object keyed by ticker symbol.
 */
function buildBatchMoatAnalysisPrompt(
  companies: Array<{ symbol: string; overview: any; basicFinancials: any }>
): string {
  const fmt = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 'N/A';
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return `${pct.toFixed(1)}%`;
  };

  const summaries = companies.map(({ symbol, overview, basicFinancials }) => {
    const name = overview?.name || symbol;
    const sector = overview?.sector || 'N/A';
    const industry = overview?.industry || 'N/A';
    const description = overview?.description ? String(overview.description).slice(0, 200) : '';
    const grossMargin = basicFinancials?.metric?.grossMarginTTM;
    const operatingMargin = overview?.operatingMargin ?? basicFinancials?.metric?.operatingMarginTTM;
    const roe = overview?.returnOnEquity ?? basicFinancials?.metric?.roeTTM;
    const revenueGrowth = basicFinancials?.metric?.revenueGrowthTTM ?? overview?.quarterlyRevenueGrowth;
    return (
      `${symbol}: ${name} | ${sector} / ${industry}\n` +
      `  ${description}\n` +
      `  Gross Margin: ${fmt(grossMargin)} | Operating Margin: ${fmt(operatingMargin)} | ROE: ${fmt(roe)} | Rev Growth: ${fmt(revenueGrowth)}`
    );
  }).join('\n\n');

  const exampleTicker = companies[0]?.symbol || 'TICK';
  const shapeExample = `{"${exampleTicker}":{"moatType":"Mixed","moatStrength":"Wide","moatScore":82,"barriers":["Brand","Ecosystem lock-in"],"narrative":"...","bestFor":"..."}}`;

  return (
    `You are a senior equity research analyst specialising in Warren Buffett-style economic moat analysis.\n\n` +
    `CRITICAL: Base your entire analysis ONLY on the real API data provided below for each company. ` +
    `Do NOT use training-memory values for prices, margins, revenue, or any financial metric. ` +
    `If a moat claim is not supported by the provided description or metrics, mark the moat as None.\n\n` +
    `Assess the competitive moat for EACH of the following companies.\n\n` +
    `COMPANY DATA:\n${summaries}\n\n` +
    `MOAT FRAMEWORK: Network Effects | Cost Advantage | Switching Costs | Intangible Assets | Efficient Scale | Mixed | None\n` +
    `MOAT STRENGTH: Wide (score 61-100, 10+ yr advantage) | Narrow (31-60, 3-10 yr) | None (0-30)\n\n` +
    `Respond ONLY with valid JSON keyed by ticker symbol (no markdown, no extra text):\n` +
    shapeExample
  );
}


type CacheEntry = {
  updatedAt: string;
  data: any;
  provider?: string;
  asOf?: string | null;
};
type SymbolCache = Record<string, CacheEntry>;

/** Normalises a raw ticker string from LLM output to uppercase alphanumeric. */
const cleanTicker = (raw: string): string =>
  String(raw || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase();

const stripExchangePrefix = (raw: string): string =>
  String(raw || '')
    .trim()
    .replace(/^(?:NYSE|NASDAQ|NASDAQGS|NASDAQGM|NASDAQCM|AMEX|NYSEAMERICAN|NYSEARCA|OTC|OTCMKTS)\s*[:.-]?\s*/i, '')
    .trim();

const hasExchangePrefix = (raw: string): boolean =>
  /^(?:NYSE|NASDAQ|NASDAQGS|NASDAQGM|NASDAQCM|AMEX|NYSEAMERICAN|NYSEARCA|OTC|OTCMKTS)\s*[:.-]?\s*/i.test(String(raw || '').trim());

function normalizeTickerCandidate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = cleanTicker(stripExchangePrefix(raw));
  // US tickers are short; allow share-class dots but reject malformed values like ARMNULL.
  if (!/^[A-Z0-9](?:[A-Z0-9.]{0,5})$/.test(cleaned)) return undefined;
  if (cleaned.includes('NULL') || cleaned.includes('NAN') || cleaned.includes('UNDEFINED')) return undefined;
  return cleaned;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'string'
    ? Number(value.trim().replace(/[$£€,]/g, '').replace(/%$/g, ''))
    : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePercentValue(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  return Math.abs(parsed) <= 2 ? parsed * 100 : parsed;
}

function getRecentPriceRange(priceHistory: any): { low: number | null; high: number | null } {
  const prices = Array.isArray(priceHistory?.prices) ? priceHistory.prices : [];
  const dated = prices
    .map((point: any) => ({ point, time: Date.parse(String(point?.date || '')) }))
    .filter((entry: any) => Number.isFinite(entry.time));
  const latest = dated.reduce((max: number, entry: any) => Math.max(max, entry.time), 0);
  const cutoff = latest > 0 ? latest - 370 * 24 * 60 * 60 * 1000 : 0;
  const scoped = latest > 0 ? dated.filter((entry: any) => entry.time >= cutoff).map((entry: any) => entry.point) : prices;
  const values = scoped
    .flatMap((point: any) => [toFiniteNumber(point?.low ?? point?.close), toFiniteNumber(point?.high ?? point?.close)])
    .filter((value: number | null): value is number => value !== null && value > 0);
  if (!values.length) return { low: null, high: null };
  return { low: Math.min(...values), high: Math.max(...values) };
}

function overviewRangeIsPlausible(price: number | null, overview: any): boolean | null {
  const high = toFiniteNumber(overview?.['52WeekHigh']);
  const low = toFiniteNumber(overview?.['52WeekLow']);
  if (price === null || high === null || low === null) return null;
  if (low <= 0 || high < low) return false;
  return price >= low * 0.5 && price <= high * 1.5;
}

function sanitizeMarketScaledOverview(overview: any, price: any, priceHistory: any): { overview: any; notes: string[] } {
  if (!overview || typeof overview !== 'object') return { overview, notes: [] };
  const sanitized = { ...overview };
  const notes: string[] = [];
  const currentPrice = toFiniteNumber(price?.price);
  const historyRange = getRecentPriceRange(priceHistory);
  const rangePlausible = overviewRangeIsPlausible(currentPrice, overview);

  if (historyRange.low !== null && historyRange.high !== null) {
    sanitized['52WeekLow'] = historyRange.low;
    sanitized['52WeekHigh'] = historyRange.high;
  } else if (rangePlausible === false) {
    sanitized['52WeekLow'] = null;
    sanitized['52WeekHigh'] = null;
    notes.push('Provider 52-week range was inconsistent with current price and was suppressed.');
  }

  if (rangePlausible === false) {
    sanitized['50DayMovingAverage'] = null;
    sanitized['200DayMovingAverage'] = null;
    sanitized.bookValue = null;
    sanitized.revenuePerShare = null;
    sanitized.dividendPerShare = null;
    sanitized.analystTargetPrice = null;
    notes.push('Provider per-share market fields were inconsistent with current price and were suppressed.');
  }

  const marketCap = toFiniteNumber(sanitized.marketCapitalization);
  const sharesOutstanding = toFiniteNumber(sanitized.sharesOutstanding);
  if (currentPrice !== null && marketCap !== null && sharesOutstanding !== null && sharesOutstanding > 0) {
    const impliedMarketCap = currentPrice * sharesOutstanding;
    const ratio = marketCap / impliedMarketCap;
    if (ratio < 0.33 || ratio > 3) {
      sanitized.marketCapitalization = null;
      notes.push('Provider market capitalization was inconsistent with price and shares outstanding and was suppressed.');
    }
  }

  const dividendYield = normalizePercentValue(sanitized.dividendYield);
  if (dividendYield !== null && (dividendYield < 0 || dividendYield > 25)) {
    sanitized.dividendYield = null;
    notes.push('Provider dividend yield was outside a plausible range and was suppressed.');
  }

  return { overview: sanitized, notes };
}

async function validateResolvedTicker(stockService: StockDataService, ticker: string): Promise<boolean> {
  try {
    const price = await stockService.getStockPrice(ticker);
    const returnedSymbol = normalizeTickerCandidate(price?.symbol);
    if (!returnedSymbol) return true;
    return returnedSymbol === ticker;
  } catch {
    return false;
  }
}

/**
 * Parses one entry from an LLM batch moat response and returns a validated MoatAnalysis,
 * or null when the entry is missing required fields.
 */
function parseMoatEntry(m: any): MoatAnalysis | null {
  if (!m || typeof m.moatScore !== 'number') return null;
  return {
    moatType: String(m.moatType || 'N/A'),
    moatStrength: String(m.moatStrength || 'N/A'),
    moatScore: Math.min(100, Math.max(0, Math.round(Number(m.moatScore)))),
    barriers: Array.isArray(m.barriers) ? m.barriers.map(String) : [],
    narrative: String(m.narrative || ''),
    bestFor: String(m.bestFor || ''),
  };
}

/**
 * Builds a batch LLM prompt that generates a 1-2 sentence plain-English "Why"
 * rationale for the Position Guidance table in watchlist / comparison reports.
 *
 * Each rationale must:
 *   - Cite real score values (quality, valuation, momentum) from the provided data
 *   - Reference at least one concrete metric (e.g. "34% operating margin", "$135 target")
 *   - State clearly why the action (Buy / Hold / Watch / Sell) follows from those numbers
 *   - Be brief (1-2 sentences) and free of vague filler
 *
 * CRITICAL: The LLM must not invent any figures — only use data from the prompt.
 */
function buildBatchPositionRationalePrompt(
  companies: Array<{
    symbol: string;
    name: string;
    action: string;
    confidence: string;
    overallScore: number | null;
    qualityScore: number | null;
    valuationScore: number | null;
    technicalScore: number | null;
    analystConsensusScore?: number | null;
    insiderScore?: number | null;
    whyNow: string[];
    whyNot: string[];
    missingInputs: string[];
    overview: any;
    basicFinancials: any;
    priceTargets: any;
    analystRatings: any;
    price: any;
  }>
): string {
  const fmt = (v: any): string => {
    if (v === null || v === undefined || v === 'N/A' || v === '') return 'N/A';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (Math.abs(n) <= 2) return `${(n * 100).toFixed(1)}%`;
    return n.toFixed(2);
  };

  const companySections = companies.map(({ symbol, name, action, confidence, overallScore, qualityScore, valuationScore, technicalScore, analystConsensusScore, insiderScore, whyNow, whyNot, missingInputs, overview, basicFinancials, priceTargets, analystRatings, price: priceData }) => {
    const currentPrice = priceData?.price ?? 'N/A';
    const targetMean = priceTargets?.targetMean ?? analystRatings?.analystTargetPrice ?? overview?.analystTargetPrice ?? 'N/A';
    const pe = overview?.peRatio ?? basicFinancials?.metric?.peBasicExclExtraTTM ?? 'N/A';
    const opMargin = fmt(basicFinancials?.metric?.operatingMarginTTM ?? overview?.operatingMargin);
    const roe = fmt(basicFinancials?.metric?.roeTTM ?? overview?.returnOnEquity);
    const revGrowth = fmt(basicFinancials?.metric?.revenueGrowthTTM ?? overview?.quarterlyRevenueGrowth);
    const grossMargin = fmt(basicFinancials?.metric?.grossMarginTTM);

    const reasons = [...whyNow, ...whyNot].slice(0, 4).join(' | ') || 'No specific signals computed.';
    const missing = missingInputs.length ? `Missing: ${missingInputs.join(', ')}.` : 'All key inputs present.';

    return (
      `${symbol}: ${name}\n` +
      `  Action: ${action} | Confidence: ${confidence}\n` +
      `  Scores — Overall: ${overallScore?.toFixed(1) ?? 'N/A'}/100 | Quality: ${qualityScore?.toFixed(1) ?? 'N/A'}/100 | Valuation: ${valuationScore?.toFixed(1) ?? 'N/A'}/100 | Momentum: ${technicalScore?.toFixed(1) ?? 'N/A'}/100 | Analysts: ${analystConsensusScore?.toFixed(1) ?? 'N/A'}/100 | Insiders: ${insiderScore?.toFixed(1) ?? 'N/A'}/100\n` +
      `  Key Metrics — Price: $${currentPrice} | Target: $${targetMean} | P/E: ${pe} | Op Margin: ${opMargin} | Gross Margin: ${grossMargin} | ROE: ${roe} | Rev Growth: ${revGrowth}\n` +
      `  Signal Drivers: ${reasons}\n` +
      `  ${missing}`
    );
  }).join('\n\n');

  const exampleTicker = companies[0]?.symbol || 'TICK';
  const shapeExample = `{"${exampleTicker}":{"rationale":"Quality 72/100 (34% op margin, 18% ROE) with attractive valuation at 23x P/E and 35% target upside (valuation 68/100). Analyst consensus bullish (12 buy vs 2 sell, score 78/100). Hold — thesis intact but not at a high-conviction add point."}}`;

  return (
    `You are a senior equity research analyst writing the "Why" column for a position guidance table in a professional investment report.\n\n` +
    `CRITICAL RULES:\n` +
    `1. Base every claim STRICTLY on the real data provided below — do NOT use training-memory values for any financial figures.\n` +
    `2. Write EXACTLY 1-2 sentences per stock. Be brief but specific.\n` +
    `3. Cite the actual scores (e.g. "quality 67/100") AND at least one concrete metric (e.g. "34% operating margin", "$135 price target", "26x P/E").\n` +
    `4. When analyst consensus or insider data is available, mention it (e.g. "12 buy vs 2 sell", "insider net buying 0.005% of mkt cap").\n` +
    `5. Explain directly why the recommended action (Buy/Hold/Watch/Sell) follows from those numbers.\n` +
    `6. Do NOT write vague phrases like "mixed setup", "some positives and negatives", "room for improvement", or "further research needed".\n` +
    `7. When key data is missing (score is N/A), say explicitly which input is absent and how it limits conviction.\n` +
    `8. Write in active, professional voice. No filler words.\n\n` +
    `SCORING SCALE (0-100, 7-pillar weighted model):\n` +
    `- Quality (25% weight): margins, ROE, ROA. ≥65 = strong, 45-64 = adequate, <45 = weak.\n` +
    `- Growth (15% weight): revenue/EPS growth. ≥65 = fast-growing, <40 = declining.\n` +
    `- Valuation (20% weight): P/E, analyst target upside. ≥60 = attractive, <40 = stretched.\n` +
    `- Momentum (15% weight): price trend. ≥60 = uptrend, <40 = downtrend.\n` +
    `- Analysts (15% weight): consensus buy/sell distribution. ≥65 = bullish, <40 = bearish.\n` +
    `- Insiders (5% weight): net insider buying as % of mkt cap. ≥60 = net buying, <40 = net selling.\n` +
    `- Fin. Health (5% weight): debt/equity, cash flow, FCF yield.\n` +
    `- Overall score ≥65 → Buy/Initiate; 45-64 → Hold/Watch; <45 → Watch/Sell.\n\n` +
    `COMPANY DATA:\n${companySections}\n\n` +
    `Respond ONLY with valid JSON keyed by ticker symbol — no markdown, no extra text:\n` +
    shapeExample
  );
}

/**
 * Parses one entry from an LLM batch position rationale response.
 * Returns the rationale string, or null when the entry is missing or invalid.
 */
function parsePositionRationaleEntry(entry: any): string | null {
  if (!entry || typeof entry.rationale !== 'string') return null;
  const text = entry.rationale.trim();
  return text.length >= 10 ? text : null;
}

/**
 * Builds a rich LLM prompt for a state-of-the-art investment conclusion for a
 * single stock. The LLM receives ALL real API data collected and must produce a
 * 5-7 paragraph research-quality narrative covering:
 *   1. Business overview & competitive position
 *   2. Financial health & growth trajectory
 *   3. Valuation analysis
 *   4. Key risks and catalysts
 *   5. Final recommendation with portfolio role
 *
 * CRITICAL: The LLM must base every statement on the data provided — no training memory.
 */
function formatPromptMetric(value: any): string {
  if (value === null || value === undefined || value === 'N/A' || value === '') return 'N/A';
  const n = Number(value);
  if (Number.isFinite(n)) {
    if (Math.abs(n) <= 2) return `${(n * 100).toFixed(1)}%`;
    return n.toFixed(2);
  }
  return String(value);
}

function buildStockConclusionPrompt(
  symbol: string,
  price: any,
  companyOverview: any,
  basicFinancials: any,
  earningsHistory: any,
  incomeStatement: any,
  balanceSheet: any,
  cashFlow: any,
  analystRatings: any,
  priceTargets: any,
  priceHistory: any,
  newsSentiment: any,
  companyNews: any,
  moatAnalysis: any,
  decisionSnapshot?: DecisionSnapshot
): string {
  const name = companyOverview?.name || symbol;
  const formatPromptCurrency = (value: any): string => {
    if (value === null || value === undefined || value === 'N/A' || value === '') return 'N/A';
    const n = Number(value);
    return Number.isFinite(n) ? `$${n.toLocaleString()}` : String(value);
  };

  const currentPrice = price?.price ?? 'N/A';
  const changePercent = price?.changePercent ?? 'N/A';
  const marketCap = companyOverview?.marketCapitalization ?? 'N/A';
  const pe = companyOverview?.peRatio ?? basicFinancials?.metric?.peBasicExclExtraTTM ?? 'N/A';
  const pb = companyOverview?.priceToBookRatio ?? basicFinancials?.metric?.pbAnnual ?? 'N/A';
  const ps = companyOverview?.priceToSalesRatioTTM ?? basicFinancials?.metric?.psTTM ?? 'N/A';
  const ev = companyOverview?.evToEbitda ?? basicFinancials?.metric?.evToEbitda ?? 'N/A';
  const beta = companyOverview?.beta ?? 'N/A';
  const latestIncome = incomeStatement?.quarterlyReports?.[0] || incomeStatement?.annualReports?.[0];
  const revTTM = companyOverview?.revenueTTM ?? latestIncome?.totalRevenue ?? 'N/A';
  const incomeRevenue = toFiniteNumber(latestIncome?.totalRevenue);
  const incomeGrossProfit = toFiniteNumber(latestIncome?.grossProfit);
  const statementGrossMargin =
    incomeRevenue !== null && incomeRevenue !== 0 && incomeGrossProfit !== null
      ? incomeGrossProfit / incomeRevenue
      : null;
  const grossMargin = formatPromptMetric(basicFinancials?.metric?.grossMarginTTM ?? statementGrossMargin);
  const opMargin = formatPromptMetric(basicFinancials?.metric?.operatingMarginTTM ?? companyOverview?.operatingMargin);
  const netMargin = formatPromptMetric(companyOverview?.profitMargin);
  const roe = formatPromptMetric(basicFinancials?.metric?.roeTTM ?? companyOverview?.returnOnEquity);
  const roa = formatPromptMetric(basicFinancials?.metric?.roaTTM ?? companyOverview?.returnOnAssets);
  const revenueGrowth = formatPromptMetric(basicFinancials?.metric?.revenueGrowthTTM ?? companyOverview?.quarterlyRevenueGrowth);
  const epsGrowth = formatPromptMetric(basicFinancials?.metric?.epsGrowthTTM ?? basicFinancials?.metric?.epsGrowth5Y);
  const debtToEquity = formatPromptMetric(basicFinancials?.metric?.totalDebt_totalEquityAnnual);
  const currentRatio = formatPromptMetric(basicFinancials?.metric?.currentRatioAnnual);
  const fcfPerShare = formatPromptMetric(basicFinancials?.metric?.fcfPerShareTTM);

  // Latest quarterly earnings
  const latestQ = earningsHistory?.quarterlyEarnings?.[0];
  const eps1 = latestQ ? `${latestQ.fiscalQuarter}: EPS ${latestQ.reportedEPS}` : 'N/A';

  // Latest reported income period can be quarterly or annual depending on provider availability.
  const latestIncomePeriod = latestIncome?.fiscalQuarter || latestIncome?.fiscalYear || latestIncome?.fiscalDateEnding || 'N/A';
  const revenue1 = latestIncome ? `${latestIncomePeriod}: Revenue ${formatPromptCurrency(latestIncome.totalRevenue)}` : 'N/A';
  const opIncome1 = latestIncome ? `Op. Income ${formatPromptCurrency(latestIncome.operatingIncome)}` : 'N/A';

  // Balance sheet
  const latestBS = balanceSheet?.quarterlyReports?.[0];
  const totalDebt = latestBS?.shortLongTermDebtTotal ?? latestBS?.longTermDebt ?? 'N/A';
  const cash = latestBS?.cashAndCashEquivalentsAtCarryingValue ?? latestBS?.cash ?? 'N/A';

  // Cash flow
  const latestCF = cashFlow?.quarterlyReports?.[0];
  const ocf = latestCF?.operatingCashflow ?? 'N/A';
  const fcf = latestCF?.capitalExpenditures
    ? String(Number(latestCF.operatingCashflow ?? 0) - Math.abs(Number(latestCF.capitalExpenditures)))
    : 'N/A';

  // Analyst data
  const targetMean = priceTargets?.targetMean ?? analystRatings?.analystTargetPrice ?? companyOverview?.analystTargetPrice ?? 'N/A';
  const targetHigh = priceTargets?.targetHigh ?? 'N/A';
  const targetLow = priceTargets?.targetLow ?? 'N/A';
  const strongBuy = analystRatings?.strongBuy ?? 'N/A';
  const buyCount = analystRatings?.buy ?? 'N/A';
  const holdCount = analystRatings?.hold ?? 'N/A';
  const sellCount = analystRatings?.sell ?? 'N/A';
  const strongSell = analystRatings?.strongSell ?? 'N/A';

  // Price history context
  const prices = priceHistory?.prices;
  const priceHigh = prices?.length
    ? Math.max(...prices.map((p: any) => Number(p.close) || 0)).toFixed(2)
    : 'N/A';
  const priceLow = prices?.length
    ? Math.min(...prices.filter((p: any) => Number(p.close) > 0).map((p: any) => Number(p.close))).toFixed(2)
    : 'N/A';
  const priceStart = prices?.length ? prices[prices.length - 1].close : 'N/A';
  const priceReturn = prices?.length && Number(priceStart) && currentPrice !== 'N/A'
    ? (((Number(currentPrice) - Number(priceStart)) / Number(priceStart)) * 100).toFixed(1) + '%'
    : 'N/A';

  // News / sentiment
  const sentiment = newsSentiment?.sentiment?.sentiment || newsSentiment?.sentiment?.buzz || 'N/A';
  const recentHeadlines = (companyNews?.articles || [])
    .slice(0, 5)
    .map((a: any) => a.headline || a.title)
    .filter(Boolean)
    .join('; ');

  // Moat
  const moatSummary = moatAnalysis
    ? `Type: ${moatAnalysis.moatType}, Strength: ${moatAnalysis.moatStrength}, Score: ${moatAnalysis.moatScore}/100. ${moatAnalysis.narrative}`
    : 'Not assessed';
  const requiredRecommendation = decisionSnapshot ? decisionSnapshotToLegacyAction(decisionSnapshot).toUpperCase() : 'DERIVE FROM DATA';
  const decisionSummary = decisionSnapshot?.summary || 'Unavailable';
  const decisionAction = decisionSnapshot?.action || 'Unavailable';
  const decisionConfidence = decisionSnapshot?.confidence || 'Unavailable';

  return (
    `You are a top-tier equity research analyst writing a definitive investment conclusion for a professional investment report.\n\n` +
    `CRITICAL RULES:\n` +
    `1. Base EVERY factual claim strictly on the real market data provided below — cite actual numbers.\n` +
    `2. Do NOT use your training knowledge for any financial figures (prices, revenues, margins, multiples).\n` +
    `3. If a value is N/A, unavailable, or missing, state that it is unavailable; do NOT estimate, infer, or fill it.\n` +
    `4. Do NOT mention any metric unless it appears in the data block below.\n` +
    `5. Write a COMPREHENSIVE, well-structured narrative of 5-7 paragraphs — NOT bullet points.\n` +
    `6. Each paragraph should build on the previous to form a coherent investment thesis.\n` +
    `7. Be specific: reference actual numbers from the data. Vague statements like "revenue is growing" are unacceptable.\n` +
    `8. The final recommendation MUST align with the structured decision below. Do not contradict the required recommendation label.\n` +
    `9. Conclude with a clear investment recommendation: BUY / HOLD / WATCH / SELL with specific rationale.\n` +
    `10. Output ONLY the narrative paragraphs in plain markdown — no JSON, no section headers, no preamble.\n\n` +
    `═══ STRUCTURED DECISION TO MATCH ═══\n` +
    `Required Recommendation Label: ${requiredRecommendation}\n` +
    `Decision Action: ${decisionAction}\n` +
    `Decision Confidence: ${decisionConfidence}\n` +
    `Decision Summary: ${decisionSummary}\n\n` +
    `═══ COMPANY DATA ═══\n` +
    `Company: ${name} (${symbol})\n` +
    `Sector: ${companyOverview?.sector || 'N/A'} | Industry: ${companyOverview?.industry || 'N/A'}\n` +
    `Description: ${companyOverview?.description ? String(companyOverview.description).slice(0, 500) : 'N/A'}\n\n` +
    `── Price & Valuation ──\n` +
    `Current Price: $${currentPrice} (${changePercent} day change)\n` +
    `52-week Range (period data): Low $${priceLow} | High $${priceHigh} | Period Return: ${priceReturn}\n` +
    `Market Cap: ${marketCap}\n` +
    `P/E: ${pe} | P/B: ${pb} | P/S: ${ps} | EV/EBITDA: ${ev} | Beta: ${beta}\n\n` +
    `── Profitability & Growth ──\n` +
    `Revenue TTM / Latest Reported: ${formatPromptCurrency(revTTM)}\n` +
    `Gross Margin: ${grossMargin} | Operating Margin: ${opMargin} | Net Margin: ${netMargin}\n` +
    `ROE: ${roe} | ROA: ${roa}\n` +
    `Revenue Growth: ${revenueGrowth} | EPS Growth: ${epsGrowth}\n` +
    `Latest Reported Period: ${revenue1}, ${opIncome1}, ${eps1}\n\n` +
    `── Balance Sheet ──\n` +
    `Cash: ${cash} | Total Debt: ${totalDebt} | D/E: ${debtToEquity} | Current Ratio: ${currentRatio}\n` +
    `Operating Cash Flow: ${ocf} | Free Cash Flow (OCF - Capex): ${fcf} | FCF/Share: ${fcfPerShare}\n\n` +
    `── Analyst Consensus ──\n` +
    `Target: Mean $${targetMean} | High $${targetHigh} | Low $${targetLow}\n` +
    `Ratings: Strong Buy ${strongBuy} | Buy ${buyCount} | Hold ${holdCount} | Sell ${sellCount} | Strong Sell ${strongSell}\n\n` +
    `── Competitive Moat ──\n` +
    `${moatSummary}\n\n` +
    `── News & Sentiment ──\n` +
    `Overall Sentiment: ${sentiment}\n` +
    `Recent Headlines: ${recentHeadlines || 'No recent headlines'}\n\n` +
    `═══ END OF DATA ═══\n\n` +
    `Write the comprehensive investment conclusion now (5-7 paragraphs, specific numbers throughout, ends with clear BUY/HOLD/WATCH/SELL recommendation):`
  );
}

/**
 * Builds a rich LLM prompt for a multi-company investment conclusion
 * (comparison, sector, or research report).
 *
 * The LLM receives the full financial snapshot for each company and must produce
 * a 5-7 paragraph narrative covering:
 *   1. Group/sector theme and macro context
 *   2. Comparative financial analysis (growth, margins, moats)
 *   3. Valuation landscape and relative attractiveness
 *   4. Top pick rationale with specific data points
 *   5. Risk factors and portfolio strategy
 *
 * CRITICAL: Every claim must reference numbers from the provided data.
 */
function buildComparisonConclusionPrompt(
  items: Array<{
    symbol: string;
    price?: any;
    overview?: any;
    basicFinancials?: any;
    priceTargets?: any;
    analystRatings?: any;
    incomeStatement?: any;
    moatAnalysis?: any;
  }>,
  reportType: 'comparison' | 'sector' | 'research',
  sectorQuery?: string,
  scored?: Array<{ symbol: string; score: number | null }>
): string {
  const theme =
    reportType === 'comparison' ? 'Peer Comparison'
    : reportType === 'sector' ? `Sector: ${sectorQuery || 'Unknown'}`
    : `Research: ${sectorQuery || 'Unknown'}`;
  const rankedSummary = (scored || [])
    .filter((entry) => entry.score !== null && entry.score !== undefined)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3)
    .map((entry, index) => `${index + 1}. ${entry.symbol}: ${entry.score!.toFixed(1)}/100`)
    .join('\n');

  const companySummaries = items.map((item) => {
    const sym = item.symbol;
    const name = item.overview?.name || sym;
    const price = item.price?.price ?? 'N/A';
    const pe = item.overview?.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM ?? 'N/A';
    const mc = item.overview?.marketCapitalization ?? 'N/A';
    const latestIncome = item.incomeStatement?.quarterlyReports?.[0] || item.incomeStatement?.annualReports?.[0];
    const latestRevenue = toFiniteNumber(latestIncome?.totalRevenue);
    const revenueValue = item.overview?.revenueTTM ?? latestIncome?.totalRevenue ?? 'N/A';
    const revenueLabel = item.overview?.revenueTTM ? 'Revenue TTM' : latestRevenue !== null ? 'Revenue Latest Reported' : 'Revenue';
    const opMargin = formatPromptMetric(item.overview?.operatingMargin ?? item.basicFinancials?.metric?.operatingMarginTTM);
    const incomeRevenue = toFiniteNumber(latestIncome?.totalRevenue);
    const incomeGrossProfit = toFiniteNumber(latestIncome?.grossProfit);
    const statementGrossMargin =
      incomeRevenue !== null && incomeRevenue !== 0 && incomeGrossProfit !== null
        ? incomeGrossProfit / incomeRevenue
        : null;
    const grossMargin = formatPromptMetric(item.basicFinancials?.metric?.grossMarginTTM ?? statementGrossMargin);
    const roe = formatPromptMetric(item.overview?.returnOnEquity ?? item.basicFinancials?.metric?.roeTTM);
    const revGrowth = formatPromptMetric(item.basicFinancials?.metric?.revenueGrowthTTM ?? item.overview?.quarterlyRevenueGrowth);
    const targetMean = item.priceTargets?.targetMean
      ?? (item.analystRatings?.analystTargetPrice !== 'N/A' ? item.analystRatings?.analystTargetPrice : null)
      ?? item.overview?.analystTargetPrice ?? 'N/A';
    const upside = Number(price) && Number(targetMean)
      ? `${(((Number(targetMean) - Number(price)) / Number(price)) * 100).toFixed(1)}%`
      : 'N/A';
    const score = scored?.find((s) => s.symbol === sym)?.score;
    const moat = item.moatAnalysis
      ? `${item.moatAnalysis.moatType} (${item.moatAnalysis.moatStrength}, ${item.moatAnalysis.moatScore}/100)`
      : 'Not assessed';
    const latestRevLine = latestIncome && latestRevenue !== null
      ? `Latest Reported Revenue: $${latestRevenue.toLocaleString()}`
      : '';

    return (
      `▸ ${name} (${sym})\n` +
      `  Price: $${price} | Market Cap: ${mc} | P/E: ${pe}\n` +
      `  ${revenueLabel}: ${revenueValue} | Rev Growth: ${revGrowth} | ${latestRevLine}\n` +
      `  Gross Margin: ${grossMargin} | Op Margin: ${opMargin} | ROE: ${roe}\n` +
      `  Analyst Target: ${targetMean === 'N/A' ? 'N/A' : `$${targetMean}`} | Upside: ${upside}\n` +
      `  Score: ${score !== null && score !== undefined ? score.toFixed(1) + '/100' : 'N/A'} (Decision Score when available; otherwise Composite Score)\n` +
      `  Moat: ${moat}`
    );
  }).join('\n\n');

  return (
    `You are a top-tier equity research analyst writing the Investment Conclusion for a professional ${theme} report.\n\n` +
    `CRITICAL RULES:\n` +
    `1. Base EVERY factual claim strictly on the real market data provided below — cite actual numbers.\n` +
    `2. Do NOT use training knowledge for any financial figures.\n` +
    `3. If a value is N/A, unavailable, or missing, state that it is unavailable; do NOT estimate, infer, or fill it.\n` +
    `4. Do NOT mention any metric unless it appears in the data block below.\n` +
    `5. Write a COMPREHENSIVE narrative of 5-7 paragraphs — NOT bullet points.\n` +
    `6. Cover: (a) sector/group context, (b) comparative financial performance, (c) valuation, (d) moats and competitive dynamics, (e) top pick(s) with clear evidence-based rationale, (f) risks, (g) portfolio strategy.\n` +
    `7. Reference specific numbers from each company. Be precise — avoid vague generalisations.\n` +
    `8. When structured scores are available, keep any top-pick recommendation aligned with the highest-scored company shown below.\n` +
    `9. End with a clear recommendation: which company(ies) to buy, hold, or avoid, and why.\n` +
    `10. Output ONLY the narrative paragraphs in plain markdown — no JSON, no headers, no preamble.\n\n` +
    `═══ STRUCTURED SCORE SUMMARY ═══\n` +
    `${rankedSummary || 'No structured scores available.'}\n\n` +
    `═══ COMPANY DATA ═══\n\n` +
    companySummaries + '\n\n' +
    `═══ END OF DATA ═══\n\n` +
    `Write the comprehensive ${theme} investment conclusion now (5-7 paragraphs, specific numbers throughout):`
  );
}

const loadSymbolCache = async (symbol: string): Promise<SymbolCache> => {
  try {
    const filePath = path.join(CACHE_DIR, `${symbol.toUpperCase()}.json`);
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as SymbolCache;
  } catch {
    return {};
  }
};

const saveSymbolCache = async (symbol: string, cache: SymbolCache) => {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const filePath = path.join(CACHE_DIR, `${symbol.toUpperCase()}.json`);
  await fs.writeFile(filePath, JSON.stringify(cache, null, 2), 'utf8');
};

const getCachedValue = (cache: SymbolCache, key: string) => {
  const entry = cache[key];
  if (!entry) return null;
  const ageMs = Date.now() - new Date(entry.updatedAt).getTime();
  const keyTtlMs = Math.min(CACHE_TTL_MS, getTtlMinutesForKey(key) * 60 * 1000);
  if (Number.isNaN(ageMs) || ageMs > keyTtlMs) return null;
  return entry.data;
};

const getCachedEntry = (cache: SymbolCache, key: string) => cache[key] || null;

const setCachedValue = (
  cache: SymbolCache,
  key: string,
  data: any,
  meta?: { provider?: string; asOf?: string | null }
) => {
  cache[key] = {
    updatedAt: new Date().toISOString(),
    data,
    provider: meta?.provider,
    asOf: meta?.asOf ?? null,
  };
};

const getProviderFromValue = (value: any, cacheEntry?: CacheEntry | null) =>
  cacheEntry?.provider
  || (value && typeof value === 'object' && '__source' in value ? String((value as any).__source) : DEFAULT_SOURCE);

function formatSignalMix(counts: Record<string, number>): string {
  return `Signal mix: Buy ${counts.Buy || 0} | Hold ${counts.Hold || 0} | Watch ${counts.Watch || 0} | Sell ${counts.Sell || 0}.`;
}

const buildTrustSummaryFromCache = (
  cache: SymbolCache,
  entries: Array<{ key: string; label: string; data: any }>
) => summarizeTrust(
  entries
    .filter((entry) => entry.data !== undefined && entry.data !== null)
    .map((entry) => {
      const cacheEntry = getCachedEntry(cache, entry.key);
      return createTrustEntry({
        key: entry.key,
        label: entry.label,
        provider: getProviderFromValue(entry.data, cacheEntry),
        fetchedAt: cacheEntry?.updatedAt || new Date().toISOString(),
        data: entry.data,
      });
    })
);

function hasReportValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '' && value !== 'N/A';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some((entry) => hasReportValue(entry));
  return true;
}

function fillMissingFields<T extends Record<string, any>>(existing: T | undefined, fallback: T | undefined): T | undefined {
  if (!hasReportValue(existing)) return fallback;
  if (!hasReportValue(fallback)) return existing;
  const merged: Record<string, any> = { ...fallback, ...existing };
  for (const [key, fallbackValue] of Object.entries(fallback || {})) {
    const existingValue = existing?.[key];
    if (!hasReportValue(existingValue)) {
      merged[key] = fallbackValue;
    } else if (
      existingValue &&
      fallbackValue &&
      typeof existingValue === 'object' &&
      typeof fallbackValue === 'object' &&
      !Array.isArray(existingValue) &&
      !Array.isArray(fallbackValue)
    ) {
      merged[key] = fillMissingFields(existingValue, fallbackValue);
    }
  }
  return merged as T;
}

function buildSecFinancialFallbacks(symbol: string, secFacts: any, priceData?: any) {
  if (!secFacts || secFacts.error || typeof secFacts !== 'object') return {};
  const facts = secFacts.facts || {};
  const valueOf = (key: string) => toFiniteNumber(facts[key]?.value);
  const endOf = (key: string) => facts[key]?.end ? String(facts[key].end) : null;
  const bestAlignedEnd = (keys: string[]): string | null => {
    const counts = new Map<string, number>();
    for (const key of keys) {
      const end = endOf(key);
      if (end) counts.set(end, (counts.get(end) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return b[0].localeCompare(a[0]);
      })[0]?.[0] || null;
  };
  const valueAtEnd = (key: string, end: string | null) => (end && endOf(key) === end ? valueOf(key) : null);
  const endOfKey = (fact: any) => fact?.end ? String(fact.end) : null;
  const isAnnualSecFact = (fact: any): boolean => {
    if (!fact) return false;
    const form = String(fact.form || '').toUpperCase();
    const fp = String(fact.fp || '').toUpperCase();
    const frame = String(fact.frame || '').toUpperCase();
    return fact.period === 'annual' || fp === 'FY' || /^(10-K|20-F|40-F)$/.test(form) || /^CY\d{4}$/.test(frame);
  };
  const reportBucketForEnd = (keys: string[], end: string | null): 'annualReports' | 'quarterlyReports' => {
    const alignedFacts = keys.map((key) => facts[key]).filter((fact: any) => fact && endOfKey(fact) === end);
    if (!alignedFacts.length) return 'quarterlyReports';
    return alignedFacts.every(isAnnualSecFact) ? 'annualReports' : 'quarterlyReports';
  };
  const dilutedShares = valueOf('dilutedShares');
  const dilutedEps = valueOf('dilutedEps');
  const freeCashFlow = toFiniteNumber(secFacts.freeCashFlow?.value);
  const currentPrice = toFiniteNumber(priceData?.price);
  const incomeEnd = bestAlignedEnd(['revenue', 'grossProfit', 'operatingIncome', 'netIncome']);
  const alignedRevenue = valueAtEnd('revenue', incomeEnd);
  const alignedGrossProfit = valueAtEnd('grossProfit', incomeEnd);
  const alignedOperatingIncome = valueAtEnd('operatingIncome', incomeEnd);
  const alignedNetIncome = valueAtEnd('netIncome', incomeEnd);
  const balanceEnd = bestAlignedEnd(['assets', 'liabilities', 'equity', 'cash']);
  const alignedAssets = valueAtEnd('assets', balanceEnd);
  const alignedLiabilities = valueAtEnd('liabilities', balanceEnd);
  const alignedEquity = valueAtEnd('equity', balanceEnd);
  const alignedCash = valueAtEnd('cash', balanceEnd);
  const cashFlowEnd = bestAlignedEnd(['operatingCashFlow', 'capex']);
  const alignedOperatingCashFlow = valueAtEnd('operatingCashFlow', cashFlowEnd);
  const alignedCapex = valueAtEnd('capex', cashFlowEnd);
  const alignedFreeCashFlow = secFacts.freeCashFlow?.end && cashFlowEnd && secFacts.freeCashFlow.end === cashFlowEnd
    ? freeCashFlow
    : null;

  const metric: Record<string, any> = {};
  if (alignedRevenue !== null && alignedNetIncome !== null && alignedRevenue !== 0) metric.netProfitMarginTTM = alignedNetIncome / alignedRevenue;
  if (alignedRevenue !== null && alignedGrossProfit !== null && alignedRevenue !== 0) metric.grossMarginTTM = alignedGrossProfit / alignedRevenue;
  if (alignedRevenue !== null && alignedOperatingIncome !== null && alignedRevenue !== 0) metric.operatingMarginTTM = alignedOperatingIncome / alignedRevenue;
  if (alignedNetIncome !== null && alignedEquity !== null && alignedEquity > 0) metric.roeTTM = alignedNetIncome / alignedEquity;
  if (alignedNetIncome !== null && alignedAssets !== null && alignedAssets > 0) metric.roaTTM = alignedNetIncome / alignedAssets;
  if (dilutedEps !== null) metric.epsTTM = dilutedEps;
  if (currentPrice !== null && dilutedEps !== null && dilutedEps > 0) metric.peBasicExclExtraTTM = currentPrice / dilutedEps;
  if (alignedRevenue !== null && dilutedShares !== null && dilutedShares > 0 && endOf('dilutedShares') === incomeEnd) metric.revenuePerShareTTM = alignedRevenue / dilutedShares;

  const date = incomeEnd || balanceEnd || cashFlowEnd || secFacts.fetchedAt || null;
  const incomeBucket = reportBucketForEnd(['revenue', 'grossProfit', 'operatingIncome', 'netIncome'], incomeEnd);
  const incomeStatement = alignedRevenue !== null || alignedGrossProfit !== null || alignedOperatingIncome !== null || alignedNetIncome !== null
    ? ({
        symbol,
        [incomeBucket]: [{
          fiscalDateEnding: incomeEnd,
          totalRevenue: alignedRevenue?.toString(),
          grossProfit: alignedGrossProfit?.toString(),
          operatingIncome: alignedOperatingIncome?.toString(),
          netIncome: alignedNetIncome?.toString(),
        }],
        __source: 'SEC companyfacts',
      } as any)
    : undefined;
  const balanceBucket = reportBucketForEnd(['assets', 'liabilities', 'equity', 'cash'], balanceEnd);
  const balanceSheet = alignedAssets !== null || alignedLiabilities !== null || alignedEquity !== null || alignedCash !== null
    ? ({
        symbol,
        [balanceBucket]: [{
          fiscalDateEnding: balanceEnd,
          totalAssets: alignedAssets?.toString(),
          totalLiabilities: alignedLiabilities?.toString(),
          totalShareholderEquity: alignedEquity?.toString(),
          cashAndCashEquivalentsAtCarryingValue: alignedCash?.toString(),
        }],
        __source: 'SEC companyfacts',
      } as any)
    : undefined;
  const cashFlowBucket = reportBucketForEnd(['operatingCashFlow', 'capex'], cashFlowEnd);
  const cashFlow = alignedOperatingCashFlow !== null || alignedCapex !== null || alignedFreeCashFlow !== null
    ? ({
        symbol,
        [cashFlowBucket]: [{
          fiscalDateEnding: cashFlowEnd,
          operatingCashflow: alignedOperatingCashFlow?.toString(),
          capitalExpenditures: alignedCapex?.toString(),
          freeCashFlow: alignedFreeCashFlow?.toString(),
        }],
        __source: 'SEC companyfacts',
      } as any)
    : undefined;
  const basicFinancials = Object.keys(metric).length
    ? {
        symbol,
        metric,
        series: {},
        __source: 'SEC companyfacts',
      }
    : undefined;

  return { basicFinancials, incomeStatement, balanceSheet, cashFlow };
}

function hasStatementReports(stmt: any): boolean {
  return Boolean(
    stmt &&
    (
      (Array.isArray(stmt.quarterlyReports) && stmt.quarterlyReports.length > 0) ||
      (Array.isArray(stmt.annualReports) && stmt.annualReports.length > 0)
    )
  );
}

function shouldFetchSecFinancialFallback(input: {
  basicFinancials?: any;
  incomeStatement?: any;
  balanceSheet?: any;
  cashFlow?: any;
}) {
  const metric = input.basicFinancials?.metric || {};
  const hasProfitability =
    hasReportValue(metric.grossMarginTTM) ||
    hasReportValue(metric.operatingMarginTTM) ||
    hasReportValue(metric.netProfitMarginTTM) ||
    hasReportValue(metric.roeTTM) ||
    hasReportValue(metric.roaTTM);
  const hasHealth =
    hasReportValue(metric.totalDebtToEquityQuarterly) ||
    hasReportValue(metric.longTermDebtToEquityQuarterly) ||
    hasReportValue(metric.currentRatioQuarterly);
  return (
    !hasProfitability ||
    !hasHealth ||
    !hasStatementReports(input.incomeStatement) ||
    !hasStatementReports(input.balanceSheet) ||
    !hasStatementReports(input.cashFlow)
  );
}

const buildUniverseSummary = (
  items: Array<{
    symbol: string;
    overview?: any;
    decisionSnapshot?: DecisionSnapshot;
  }>
) => {
  const actionable = items
    .filter((item) => item.decisionSnapshot)
    .sort((a, b) => (b.decisionSnapshot?.overallScore ?? -Infinity) - (a.decisionSnapshot?.overallScore ?? -Infinity));
  if (actionable.length === 0) return undefined;

  const actionCounts = actionable.reduce<Record<string, number>>((acc, item) => {
    const action = decisionSnapshotToLegacyAction(item.decisionSnapshot!);
    acc[action] = (acc[action] || 0) + 1;
    return acc;
  }, {});
  const top = actionable[0];
  const weakest = actionable[actionable.length - 1];
  const topName = top.overview?.name || top.symbol;
  const weakestName = weakest.overview?.name || weakest.symbol;

  return [
    `Top setup: ${topName} (${top.symbol}) - ${top.decisionSnapshot?.summary}`,
    formatSignalMix(actionCounts),
    weakest !== top ? `Weakest setup: ${weakestName} (${weakest.symbol}) - ${weakest.decisionSnapshot?.summary}` : null,
  ].filter(Boolean).join(' ');
};

const buildWatchlistSummary = (
  items: Array<{
    symbol: string;
    companyName?: string;
    stock?: { decisionSnapshot?: DecisionSnapshot };
  }>
) => {
  const actionable = items
    .filter((item) => item.stock?.decisionSnapshot)
    .sort((a, b) => (b.stock?.decisionSnapshot?.overallScore ?? -Infinity) - (a.stock?.decisionSnapshot?.overallScore ?? -Infinity));
  if (actionable.length === 0) return undefined;

  const counts = actionable.reduce<Record<string, number>>((acc, item) => {
    const action = decisionSnapshotToLegacyAction(item.stock!.decisionSnapshot!);
    acc[action] = (acc[action] || 0) + 1;
    return acc;
  }, {});
  const strongest = actionable[0];
  const strongestName = strongest.companyName || strongest.symbol;

  return [
    `Daily watchlist view. ${formatSignalMix(counts)}`,
    `Strongest setup: ${strongestName} (${strongest.symbol}) - ${strongest.stock?.decisionSnapshot?.summary}`,
  ].join(' ');
};

const getComparisonPromptScore = (item: any) => {
  if (item?.decisionSnapshot?.overallScore !== null && item?.decisionSnapshot?.overallScore !== undefined) {
    return item.decisionSnapshot.overallScore;
  }

  return computeScorecard({
    symbol: item?.symbol || 'N/A',
    generatedAt: new Date(0).toISOString(),
    price: item?.price || {},
    priceHistory: item?.priceHistory,
    companyOverview: item?.overview,
    basicFinancials: item?.basicFinancials,
    incomeStatement: item?.incomeStatement,
    balanceSheet: item?.balanceSheet,
    cashFlow: item?.cashFlow,
    analystRatings: item?.analystRatings,
    priceTargets: item?.priceTargets,
    moatAnalysis: item?.moatAnalysis,
    dataTrust: item?.dataTrust,
    decisionSnapshot: item?.decisionSnapshot,
  }).composite;
};

// Score a search result against the user query.
// `rank` is the 0-based position in Alpha Vantage's own result list — AV already
// ranks by relevance, so earlier results get a small bonus to act as tiebreaker.
const scoreSearchMatch = (query: string, item: any, rank = 0) => {
  const normalized = query.trim().toLowerCase();
  const symbol = String(item?.symbol || '').toLowerCase();
  const name = String(item?.name || '').toLowerCase();
  const region = String(item?.region || '').toLowerCase();
  const currency = String(item?.currency || '').toUpperCase();
  const type = String(item?.type || '').toLowerCase();

  let score = 0;
  if (symbol === normalized) score += 100;
  if (name === normalized) score += 90;
  if (name.startsWith(normalized)) score += 70;
  if (name.includes(normalized)) score += 50;
  if (symbol.startsWith(normalized)) score += 40;
  if (region.includes('united states')) score += 10;
  if (currency === 'USD') score += 10;
  if (type.includes('equity')) score += 5;
  // Trust Alpha Vantage's own ordering as a tiebreaker (first = best match per AV)
  score += Math.max(0, 8 - rank * 2);
  return score;
};

// Strip share-class suffixes so multi-class listings (e.g. Class A and Class C)
// are recognised as the same underlying company.
const baseCompanyName = (name: string) =>
  name
    .replace(/\s+(class\s+[a-z0-9]+|ordinary\s+shares?|adr|preferred|warrants?|rights?|voting).*$/i, '')
    .trim()
    .toLowerCase();

export const resolveSymbolFromQuery = async (stockService: StockDataService, query: string) => {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Empty query', candidates: [] as any[] };
  }

  const exchangeStripped = stripExchangePrefix(trimmed);
  const queryForSearch = exchangeStripped || trimmed;
  const stopwordSet = new Set(['stocks', 'stock', 'companies', 'company', 'compare', 'and']);
  const cleanedTokens = queryForSearch
    .split(/\s+/)
    .filter((token) => token && !stopwordSet.has(token.toLowerCase()));
  const cleanedQuery = cleanedTokens.length ? cleanedTokens.join(' ') : queryForSearch;
  const isLikelyTicker = /^[a-zA-Z]{1,6}$/.test(cleanedQuery);
  try {
    const results = await stockService.searchStock(cleanedQuery);
    const candidates = (results.results || []) as any[];
    if (!candidates.length) {
      if (isLikelyTicker) return { ok: true, symbol: cleanedQuery.toUpperCase(), candidates: [] };
      return { ok: false, reason: 'No matches found', candidates: [] };
    }
    const scored = candidates
      .map((item, i) => ({ item, score: scoreSearchMatch(cleanedQuery, item, i) }))
      .sort((a, b) => b.score - a.score);
    const exactTicker = isLikelyTicker
      ? scored.find((row) => normalizeTickerCandidate(row.item?.symbol) === cleanedQuery.toUpperCase())
      : undefined;
    if (exactTicker) {
      return {
        ok: true,
        symbol: cleanedQuery.toUpperCase(),
        exactProviderMatch: true,
        candidates: scored.slice(0, 5).map((row) => row.item),
      };
    }
    const top = scored[0];
    const second = scored[1];
    // Two results are considered share-class variants of the same company
    // when their base names match.  In that case
    // we trust Alpha Vantage's ranking and pick the top result without flagging ambiguity.
    const sameCompany =
      second &&
      baseCompanyName(String(top.item.name || '')) === baseCompanyName(String(second.item.name || '')) &&
      // require a meaningful base name length to avoid false matches on very short names
      baseCompanyName(String(top.item.name || '')).length > 3;
    const ambiguity =
      !top ||
      top.score < 25 ||
      (!sameCompany && second && top.score - second.score < 10);
    if (ambiguity) {
      return { ok: false, reason: 'Ambiguous match', candidates: scored.slice(0, 5).map((row) => row.item) };
    }
    return { ok: true, symbol: String(top.item.symbol).toUpperCase(), candidates: scored.slice(0, 5).map((row) => row.item) };
  } catch (error: any) {
    if (isLikelyTicker) {
      return { ok: true, symbol: cleanedQuery.toUpperCase(), candidates: [] };
    }
    return { ok: false, reason: error.message || 'Search failed', candidates: [] };
  }
};

const parseExplicitComparisonCompanies = (query: string): string[] => {
  const raw = String(query || '').trim();
  const hasComparisonCue = /\b(compare|comparison|against)\b/i.test(raw);
  if (!/(?:\bvs\.?\b|\bversus\b|,|\/|\+|&|\bagainst\b)/i.test(raw) && !hasComparisonCue) return [];
  const cleaned = raw
    .replace(/^(?:compare|comparison\s+of|comparison|analy[sz]e|deep\s+research\s+on|research\s+on)\s+/i, '')
    .replace(/\b(?:vs\.?|versus|against|to)\b/gi, ',')
    .replace(/[\/+&]/g, ',')
    .replace(/,\s*(?:and\s+)?/gi, ',');
  const normalized = hasComparisonCue ? cleaned.replace(/\s+\band\s+/gi, ',') : cleaned;
  return normalized
    .split(/\s*,\s*/i)
    .map((item) => item.replace(/^(?:and|with|between)\s+/i, '').trim())
    .map((item) => item.trim())
    .filter(Boolean);
};

function shouldTrySingleCompanyDeepResearch(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (/^\$?[A-Z]{1,6}(?:\.[A-Z])?$/i.test(trimmed)) return true;
  const thematicIntent =
    /\b(stocks|companies|sector|theme|industry|industries|ecosystem|leaders|top|best|basket|space|market|plays|beneficiaries|supply\s+chain)\b/i.test(trimmed) ||
    /\b(ai|artificial\s+intelligence|infrastructure|data\s*centers?|datacenters?|cloud|semiconductors?|chips?|cybersecurity|robotics|quantum|nuclear|biotech|fintech)\b/i.test(trimmed);
  if (thematicIntent) return false;
  return /\b(inc\.?|corp\.?|corporation|ltd\.?|limited|plc|holdings?|group|co\.?|company|technologies|systems)\b/i.test(trimmed)
    || trimmed.split(/\s+/).length <= 3;
}
function buildToolDefinitions() {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'search_stock',
        description: 'Search for a US stock ticker by company name or partial ticker.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Company name or ticker symbol' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_stock_price',
        description: 'Get current price, daily change, change percent, and volume for a US stock.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_price_history',
        description: 'Get OHLCV data points for trend and technical analysis. Range supports daily/weekly/monthly or 1w, 1m, 3m, 6m, 1y, 3y, 5y, max.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
            range: { type: 'string', description: '"daily", "weekly", "monthly", "1w", "1m", "3m", "6m", "1y", "3y", "5y", "max". Default: "daily"' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_company_overview',
        description: 'Get company fundamentals: EPS, P/E, PEG, margins, ROE, ROA, market cap, dividend yield, beta, 52-week range, analyst target, insider %, institutional %, short interest, sector, industry, business description.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_basic_financials',
        description: 'Get detailed financial ratios, metrics, and historical series (including PE history) for a US stock.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_insider_trading',
        description: 'Get insider ownership %, institutional ownership %, short interest data, and recent insider buy/sell transactions.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_analyst_ratings',
        description: 'Get analyst ratings breakdown (Strong Buy/Buy/Hold/Sell/Strong Sell counts), consensus price target, and implied upside/downside.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_analyst_recommendations',
        description: 'Get analyst recommendation trends over time (strong buy/buy/hold/sell/strong sell counts).',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_price_targets',
        description: 'Get analyst price target summary (high/low/mean/median) for a US stock.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_peers',
        description: 'Get a list of peer tickers for a US stock.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_earnings_history',
        description: 'Get 8+ quarters of earnings: reported EPS, estimated EPS, surprise amount, surprise %, beat/miss/in-line.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_income_statement',
        description: 'Get quarterly and annual income statement: revenue, gross profit, operating income, net income, EBITDA.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_balance_sheet',
        description: 'Get balance sheet: total assets, liabilities, shareholder equity, cash, and long-term debt.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_cash_flow',
        description: 'Get cash flow statement: operating cash flow, CapEx, free cash flow, dividends paid.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_news_sentiment',
        description: 'Get the latest news headlines and AI sentiment scores (Bullish/Bearish/Neutral) for a US stock.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_company_news',
        description: 'Get recent company news articles for a US stock (typically last 30 days).',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol' },
            days: { type: 'number', description: 'Lookback window in days (optional)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'search_news',
        description: 'Search recent market news for a company, sector, or investment theme. Use this for deep research topics when the question is broader than a single ticker.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Company, sector, or investment-theme search query' },
            days: { type: 'number', description: 'Lookback window in days (optional)' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_stock_report',
        description: 'Generate a comprehensive stock research report and save it as a markdown artifact.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker or company name' },
            range: { type: 'string', description: 'Price history range for charts (e.g., "1y", "3y", "5y", "max"). Default is "5y"' },
            updateMode: { type: 'boolean', description: 'Set true only when the user explicitly asks to update an existing report.' },
            updateQuery: { type: 'string', description: 'Original user update request, used to find the prior saved report.' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_comparison_report',
        description: 'Generate a comparison report for explicit user-given stocks, such as "NVDA vs AMD" or "Compare Nvidia, AMD, and Intel".',
        parameters: {
          type: 'object',
          properties: {
            companies: {
              type: 'array',
              items: { type: 'string' },
              description: 'Ticker symbols or company names to compare',
            },
            range: {
              type: 'string',
              description: 'Price history range for comparison charts (e.g. "1y", "3y"). Default: "1y"',
            },
            updateMode: { type: 'boolean', description: 'Set true only when the user explicitly asks to update an existing report.' },
            updateQuery: { type: 'string', description: 'Original user update request, used to find the prior saved report.' },
          },
          required: ['companies'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_research_report',
        description:
          'Generate a comprehensive research report. Use for thematic deep research, sector/theme/industry studies, baskets, portfolio ideas, or open-ended topics (e.g. \'cloud computing\', \'EVs\', \'growth stocks\', \'AI infrastructure\').',
        parameters: {
          type: 'object',
          properties: {
            sector: {
              type: 'string',
              description: 'Deep research query (sector, theme, basket, industry, or open-ended topic)',
            },
            count: {
              type: 'number',
              description: `Number of companies in the refined final list (default: ${NUM_COMPANIES}, min: 3, max: ${NUM_COMPANIES})`,
            },
            range: {
              type: 'string',
              description: 'Price history range for comparison charts (e.g. "1y", "3y"). Default: "1y"',
            },
            updateMode: { type: 'boolean', description: 'Set true only when the user explicitly asks to update an existing report.' },
            updateQuery: { type: 'string', description: 'Original user update request, used to find the prior saved report.' },
          },
          required: ['sector'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_watchlist_daily_report',
        description: 'Generate one combined daily report for the default watchlist, with a summary table at the top and a full detailed section for every company in the watchlist.',
        parameters: {
          type: 'object',
          properties: {
            range: {
              type: 'string',
              description: 'Price history range for charts inside each company section (e.g. "1y", "3y", "5y"). Default: "1y"',
            },
            updateMode: { type: 'boolean', description: 'Set true only when the user explicitly asks to update an existing watchlist report.' },
            updateQuery: { type: 'string', description: 'Original user update request, used to find the prior saved report.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_sector_performance',
        description:
          'Get real-time sector performance across multiple timeframes (1 day, 5 day, 1 month, 3 month, YTD, 1 year). Use this to understand broad market trends by sector.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_top_gainers_losers',
        description: "Get today's top gaining, top losing, and most actively traded US stocks.",
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_technical_indicators',
        description: 'Get comprehensive technical analysis indicators for a stock: RSI(14), MACD(12,26,9), Bollinger Bands(20,2), Stochastic(14,3), ATR(14), EMA(12/26), SMA(50/200), 52W range position, trend classification, and volume analysis. All computed from price data — no extra API calls.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_sec_filings',
        description: 'Get recent SEC EDGAR filings for a company: 10-K (annual), 10-Q (quarterly), 8-K (current events), DEF 14A (proxy), and insider Form 4 filings. Includes filing dates and links to SEC documents. Free — no API key required.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
            count: { type: 'number', description: 'Number of filings to return (default 10, max 20)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_sec_company_facts',
        description: 'Get compact official SEC XBRL company facts for a ticker. Returns selected real us-gaap facts with tag, unit, filing date, period end, and source provenance. Free — no API key required.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_sec_financial_statements',
        description: 'Get normalized official SEC XBRL fundamentals for a ticker: revenue, net income, assets, liabilities, equity, cash, operating cash flow, capex, free cash flow, diluted shares, and diluted EPS when available. Free — no API key required.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_economic_indicators',
        description: 'Get key macroeconomic indicators from FRED (Federal Reserve): GDP growth, CPI/inflation rate, Federal Funds rate, unemployment rate, 10Y & 2Y Treasury yields, yield curve spread (recession indicator), consumer sentiment, and initial jobless claims. Requires free FRED_API_KEY.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_treasury_yield_curve',
        description: 'Get the latest official U.S. Treasury daily yield curve rates and key spreads (10Y-2Y, 30Y-3M). Free — no API key required.',
        parameters: {
          type: 'object',
          properties: {
            year: { type: 'number', description: 'Calendar year to fetch. Defaults to the current year.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_bls_macro_indicators',
        description: 'Get official BLS macro indicators from the public API: CPI-U, core CPI, unemployment, nonfarm payrolls, and average hourly earnings. Uses unregistered free tier unless BLS_API_KEY is configured.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_bea_macro_indicators',
        description: 'Get official BEA NIPA macro indicators: real GDP growth, PCE growth, investment, trade, government spending, nominal GDP, and personal consumption. Requires free BEA_API_KEY.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_eia_energy_indicators',
        description: 'Get official EIA energy indicators: WTI crude, Henry Hub natural gas, U.S. retail electricity prices, and electricity generation. Requires free EIA_API_KEY.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_dividend_analysis',
        description: 'Get comprehensive dividend analysis for a stock: current yield, annual dividend per share, payout ratio, ex-dividend date, payment date, dividend frequency estimate, and dividend safety assessment based on free cash flow coverage. Derived from existing company overview and cash flow data.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_dcf_valuation',
        description: 'Compute a simplified Discounted Cash Flow (DCF) model value for a stock. Uses trailing free cash flow, provider growth inputs or FCF trend, and a discount rate (WACC proxy) derived from official risk-free rate and provider beta. Returns intrinsic value per share, margin of safety, and valuation verdict. All inputs come from real provider/official data; unavailable inputs return N/A rather than assumptions.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_market_sentiment',
        description: 'Get a composite market sentiment indicator (similar to Fear & Greed index). Aggregates sector performance breadth, top gainers vs losers ratio, and market momentum to produce a sentiment score (0-100) with classification: Extreme Fear, Fear, Neutral, Greed, Extreme Greed. Uses real market data only.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
  ];
}

/**
 * Execute a tool by name with the given arguments.
 * Pass `options.llmFill` to enable LLM-based gap-filling for missing report fields.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  stockService: StockDataService,
  options?: ExecuteToolOptions
): Promise<{ success: boolean; data?: any; message?: string; error?: string }> {
  try {
    switch (toolName) {
      case 'search_stock': {
        const results = await stockService.searchStock(args.query || '');
        return {
          success: true,
          data: results,
          message: `Found ${results.results?.length || 0} matching stocks for "${args.query || ''}"`,
        };
      }
      case 'get_stock_price': {
        const price = await stockService.getStockPrice(args.symbol || '');
        return {
          success: true,
          data: price,
          message: `Current price for ${args.symbol}: $${price.price} (${price.changePercent})`,
        };
      }
      case 'get_price_history': {
        const history = await stockService.getPriceHistory(args.symbol || '', args.range || 'daily');
        return {
          success: true,
          data: history,
          message: `Retrieved ${history.prices?.length || 0} ${args.range || 'daily'} price points for ${args.symbol}`,
        };
      }
      case 'get_company_overview': {
        const overview = await stockService.getCompanyOverview(args.symbol || '');
        return {
          success: true,
          data: overview,
          message: `Retrieved company overview for ${overview.name} (${args.symbol})`,
        };
      }
      case 'get_basic_financials': {
        const metrics = await stockService.getBasicFinancials(args.symbol || '');
        return {
          success: true,
          data: metrics,
          message: `Retrieved basic financials for ${args.symbol}`,
        };
      }
      case 'get_insider_trading': {
        const insiderData = await stockService.getInsiderTrading(args.symbol || '');
        return {
          success: true,
          data: insiderData,
          message: `Retrieved insider trading data for ${args.symbol}`,
        };
      }
      case 'get_analyst_ratings': {
        const ratings = await stockService.getAnalystRatings(args.symbol || '');
        return {
          success: true,
          data: ratings,
          message: `Retrieved analyst ratings for ${args.symbol}`,
        };
      }
      case 'get_analyst_recommendations': {
        const recs = await stockService.getAnalystRecommendations(args.symbol || '');
        return {
          success: true,
          data: recs,
          message: `Retrieved analyst recommendations for ${args.symbol}`,
        };
      }
      case 'get_price_targets': {
        const targets = await stockService.getPriceTargets(args.symbol || '');
        return {
          success: true,
          data: targets,
          message: `Retrieved price targets for ${args.symbol}`,
        };
      }
      case 'get_peers': {
        const peers = await stockService.getPeers(args.symbol || '');
        return {
          success: true,
          data: peers,
          message: `Retrieved peers for ${args.symbol}`,
        };
      }
      case 'get_earnings_history': {
        const earnings = await stockService.getEarningsHistory(args.symbol || '');
        return {
          success: true,
          data: earnings,
          message: `Retrieved earnings history for ${args.symbol}`,
        };
      }
      case 'get_income_statement': {
        const income = await stockService.getIncomeStatement(args.symbol || '');
        return {
          success: true,
          data: income,
          message: `Retrieved income statement for ${args.symbol}`,
        };
      }
      case 'get_balance_sheet': {
        const balanceSheet = await stockService.getBalanceSheet(args.symbol || '');
        return {
          success: true,
          data: balanceSheet,
          message: `Retrieved balance sheet for ${args.symbol}`,
        };
      }
      case 'get_cash_flow': {
        const cashFlow = await stockService.getCashFlow(args.symbol || '');
        return {
          success: true,
          data: cashFlow,
          message: `Retrieved cash flow data for ${args.symbol}`,
        };
      }
      case 'get_news_sentiment': {
        const news = await stockService.getNewsSentiment(args.symbol || '');
        return {
          success: true,
          data: news,
          message: `Retrieved news and sentiment for ${args.symbol}`,
        };
      }
      case 'get_company_news': {
        const news = await stockService.getCompanyNews(args.symbol || '', args.days ? Number(args.days) : undefined);
        return {
          success: true,
          data: news,
          message: `Retrieved company news for ${args.symbol}`,
        };
      }
      case 'search_news': {
        const news = await stockService.searchNews(args.query || '', args.days ? Number(args.days) : undefined);
        return {
          success: true,
          data: news,
          message: `Retrieved market news for "${args.query || ''}"`,
        };
      }
      case 'get_sector_performance': {
        const data = await stockService.getSectorPerformance();
        return { success: true, data, message: 'Retrieved sector performance data' };
      }
      case 'get_top_gainers_losers': {
        const data = await stockService.getTopGainersLosers();
        return { success: true, data, message: 'Retrieved top gainers, losers, and most active stocks' };
      }
      case 'get_technical_indicators': {
        const sym = (args.symbol || '').toUpperCase();
        if (!sym) return { success: false, error: 'Symbol is required' };
        const priceHist = await stockService.getPriceHistory(sym, '1y');
        const overview = await stockService.getCompanyOverview(sym);
        const priceData = await stockService.getStockPrice(sym);
        const currentPrice = priceData?.price != null ? Number(priceData.price) : null;
        const prices = priceHist?.prices || [];

        // Compute all technical indicators from the raw price data
        const snapshot = computeTechnicalSnapshot(currentPrice, prices, overview || {});
        const volumeData = computeVolumeAnalysis(priceHist?.prices);
        return {
          success: true,
          data: {
            symbol: sym,
            price: currentPrice,
            ...snapshot,
            volume: volumeData,
          },
          message: `Technical indicators for ${sym}: RSI=${snapshot.rsi14?.toFixed(1) || 'N/A'}, MACD trend=${snapshot.macd?.trend || 'N/A'}, Stochastic=${snapshot.stochastic?.state || 'N/A'}`,
        };
      }
      case 'get_sec_filings': {
        const sym = (args.symbol || '').toUpperCase();
        if (!sym) return { success: false, error: 'Symbol is required' };
        const count = Math.min(args.count || 10, 20);
        const edgar = new SecEdgarService();
        const filings = await edgar.getRecentFilings(sym, count);
        return {
          success: true,
          data: filings,
          message: `Retrieved ${filings.filings?.length || 0} SEC filings for ${sym}`,
        };
      }
      case 'get_sec_company_facts': {
        const sym = (args.symbol || '').toUpperCase();
        if (!sym) return { success: false, error: 'Symbol is required' };
        const secFacts = new SecCompanyFactsService();
        const data = await secFacts.getNormalizedFinancialFacts(sym);
        if (data.error) return { success: false, error: data.error, data };
        return {
          success: true,
          data,
          message: `Retrieved official SEC XBRL company facts for ${sym}`,
        };
      }
      case 'get_sec_financial_statements': {
        const sym = (args.symbol || '').toUpperCase();
        if (!sym) return { success: false, error: 'Symbol is required' };
        const secFacts = new SecCompanyFactsService();
        const data = await secFacts.getNormalizedFinancialFacts(sym);
        if (data.error) return { success: false, error: data.error, data };
        const available = Object.values(data.facts || {}).filter(Boolean).length;
        return {
          success: true,
          data,
          message: `Retrieved ${available} normalized official SEC financial facts for ${sym}`,
        };
      }
      case 'get_economic_indicators': {
        const fred = new FredService();
        if (!fred.isConfigured()) {
          return {
            success: false,
            error: 'FRED_API_KEY not configured. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html',
          };
        }
        const indicators = await fred.getEconomicIndicators();
        return {
          success: true,
          data: indicators,
          message: 'Retrieved macroeconomic indicators from FRED',
        };
      }
      case 'get_treasury_yield_curve': {
        const treasury = new TreasuryYieldCurveService();
        const data = await treasury.getLatestYieldCurve(args.year ? Number(args.year) : undefined);
        return {
          success: true,
          data,
          message: data.latest
            ? `Latest Treasury yield curve date ${data.latest.date}; 10Y=${data.latest.year10 ?? 'N/A'}%, 2Y=${data.latest.year2 ?? 'N/A'}%`
            : 'Treasury yield curve data unavailable',
        };
      }
      case 'get_bls_macro_indicators': {
        const bls = new BlsPublicDataService();
        const data = await bls.getMacroIndicators();
        return {
          success: true,
          data,
          message: `Retrieved ${data.indicators?.length || 0} BLS macro indicators (${data.quotaMode || 'unregistered'} mode)`,
        };
      }
      case 'get_bea_macro_indicators': {
        const bea = new BeaService();
        const data = await bea.getMacroIndicators();
        if (data.error) return { success: false, error: data.error, data };
        const available = Object.values(data.indicators || {}).filter(Boolean).length;
        return {
          success: true,
          data,
          message: `Retrieved ${available} BEA macro indicators`,
        };
      }
      case 'get_eia_energy_indicators': {
        const eia = new EiaService();
        const data = await eia.getEnergyIndicators();
        if (data.error) return { success: false, error: data.error, data };
        const available = (data.indicators || []).filter((item: any) => item.latest?.value !== null && item.latest?.value !== undefined).length;
        return {
          success: true,
          data,
          message: `Retrieved ${available} EIA energy indicators`,
        };
      }
      case 'get_dividend_analysis': {
        const sym = (args.symbol || '').toUpperCase();
        if (!sym) return { success: false, error: 'Symbol is required' };
        const overview = await stockService.getCompanyOverview(sym);
        const cashFlowData = await stockService.getCashFlow(sym);
        const priceData = await stockService.getStockPrice(sym);
        const currentPrice = priceData?.price != null ? Number(priceData.price) : null;

        const dividendYield = overview?.dividendYield != null ? Number(overview.dividendYield) : null;
        const dividendPerShare = overview?.dividendPerShare != null ? Number(overview.dividendPerShare) : null;
        const exDividendDate = overview?.exDividendDate || null;
        const dividendDate = overview?.dividendDate || null;
        const eps = overview?.eps != null ? Number(overview.eps) : null;
        const payoutRatio = dividendPerShare && eps && eps > 0 ? (dividendPerShare / eps) * 100 : null;

        // Compute FCF coverage from cash flow data
        const reports = cashFlowData?.annualReports || cashFlowData?.quarterlyReports || [];
        const latestCF = reports[0];
        const ocf = latestCF?.operatingCashflow != null ? Number(latestCF.operatingCashflow) : null;
        const capex = latestCF?.capitalExpenditures != null ? Math.abs(Number(latestCF.capitalExpenditures)) : null;
        const divPaid = latestCF?.dividendPayout != null ? Math.abs(Number(latestCF.dividendPayout)) : null;
        const fcf = ocf != null && capex != null ? ocf - capex : null;
        const fcfCoverage = fcf != null && divPaid != null && divPaid > 0 ? fcf / divPaid : null;
        const sharesOutstanding = overview?.sharesOutstanding != null ? Number(overview.sharesOutstanding) : null;
        const fcfPerShare = fcf != null && sharesOutstanding && sharesOutstanding > 0 ? fcf / sharesOutstanding : null;

        let dividendSafety = 'Unavailable';
        if (fcfCoverage !== null) {
          if (fcfCoverage >= 3) dividendSafety = 'Very Safe (FCF covers dividend 3x+)';
          else if (fcfCoverage >= 2) dividendSafety = 'Safe (FCF covers dividend 2x+)';
          else if (fcfCoverage >= 1.5) dividendSafety = 'Adequate (FCF covers dividend 1.5x+)';
          else if (fcfCoverage >= 1) dividendSafety = 'At Risk (FCF barely covers dividend)';
          else dividendSafety = 'Unsafe (FCF does not cover dividend)';
        }

        const isDividendPayer = (dividendYield != null && dividendYield > 0) || (dividendPerShare != null && dividendPerShare > 0);

        return {
          success: true,
          data: {
            symbol: sym,
            isDividendPayer,
            currentPrice,
            dividendYield: dividendYield != null && Number.isFinite(dividendYield) ? dividendYield : null,
            dividendPerShare: dividendPerShare != null && Number.isFinite(dividendPerShare) ? dividendPerShare : null,
            payoutRatioPercent: payoutRatio != null && Number.isFinite(payoutRatio) ? payoutRatio : null,
            exDividendDate,
            dividendDate,
            fcfPerShare: fcfPerShare != null && Number.isFinite(fcfPerShare) ? fcfPerShare : null,
            fcfCoverageRatio: fcfCoverage != null && Number.isFinite(fcfCoverage) ? fcfCoverage : null,
            dividendSafety,
          },
          message: isDividendPayer
            ? `${sym} dividend analysis: yield ${dividendYield != null ? (dividendYield * 100).toFixed(2) + '%' : 'N/A'}, safety: ${dividendSafety}`
            : `${sym} does not currently pay a dividend`,
        };
      }
      case 'get_dcf_valuation': {
        const sym = (args.symbol || '').toUpperCase();
        if (!sym) return { success: false, error: 'Symbol is required' };
        const overview = await stockService.getCompanyOverview(sym);
        const balanceSheet = await stockService.getBalanceSheet(sym).catch(() => null);
        const cashFlowData = await stockService.getCashFlow(sym);
        const priceData = await stockService.getStockPrice(sym);
        const currentPrice = priceData?.price != null ? Number(priceData.price) : null;

        const treasuryRates = await new TreasuryYieldCurveService().getLatestYieldCurve().catch(() => null);
        const treasury10Y = treasuryRates?.latest?.year10 != null ? Number(treasuryRates.latest.year10) : null;
        const riskFreeRate = treasury10Y !== null && Number.isFinite(treasury10Y) ? treasury10Y / 100 : null;
        const dcf = computeDcfValuation({
          overview,
          balanceSheet,
          cashFlow: cashFlowData,
          currentPrice,
          riskFreeRate,
          riskFreeRateSource: treasury10Y !== null && Number.isFinite(treasury10Y)
            ? `U.S. Treasury 10Y (${treasuryRates?.latest?.date || 'latest available'})`
            : undefined,
        });

        return {
          success: true,
          data: {
            symbol: sym,
            currentPrice,
            intrinsicValuePerShare: dcf.intrinsicValuePerShare,
            marginOfSafetyPercent: dcf.marginOfSafetyPercent,
            verdict: dcf.verdict,
            confidence: dcf.confidence,
            notes: dcf.notes,
            assumptions: dcf.assumptions,
          },
          message: `DCF valuation for ${sym}: intrinsic value $${dcf.intrinsicValuePerShare?.toFixed(2) || 'N/A'} vs current $${currentPrice?.toFixed(2) || 'N/A'} — ${dcf.verdict}`,
        };
      }
      case 'get_market_sentiment': {
        // Composite sentiment from multiple real market data signals
        const [sectorPerf, gainersLosers] = await Promise.all([
          stockService.getSectorPerformance().catch(() => null),
          stockService.getTopGainersLosers().catch(() => null),
        ]);

        const signals: Array<{ name: string; score: number; weight: number }> = [];

        // Signal 1: Sector breadth — how many sectors are positive today
        if (sectorPerf) {
          const sectors = Object.entries(sectorPerf).filter(([, val]) => typeof val === 'string' || typeof val === 'number');
          const positive = sectors.filter(([, val]) => Number(String(val).replace('%', '')) > 0).length;
          const breadthScore = sectors.length > 0 ? (positive / sectors.length) * 100 : 50;
          signals.push({ name: 'Sector Breadth', score: breadthScore, weight: 0.3 });
        }

        // Signal 2: Gainers vs losers ratio
        if (gainersLosers) {
          const gainers = gainersLosers.top_gainers?.length || gainersLosers.topGainers?.length || 0;
          const losers = gainersLosers.top_losers?.length || gainersLosers.topLosers?.length || 0;
          const total = gainers + losers;
          const glScore = total > 0 ? (gainers / total) * 100 : 50;
          signals.push({ name: 'Gainers/Losers Ratio', score: glScore, weight: 0.3 });

          // Signal 3: Average magnitude of gains vs losses
          const gainerChanges = (gainersLosers.top_gainers || gainersLosers.topGainers || [])
            .map((g: any) => Math.abs(Number(String(g.change_percentage || g.changePercent || '0').replace('%', ''))))
            .filter((v: number) => Number.isFinite(v));
          const loserChanges = (gainersLosers.top_losers || gainersLosers.topLosers || [])
            .map((l: any) => Math.abs(Number(String(l.change_percentage || l.changePercent || '0').replace('%', ''))))
            .filter((v: number) => Number.isFinite(v));
          const avgGain = gainerChanges.length > 0 ? gainerChanges.reduce((s: number, v: number) => s + v, 0) / gainerChanges.length : 0;
          const avgLoss = loserChanges.length > 0 ? loserChanges.reduce((s: number, v: number) => s + v, 0) / loserChanges.length : 0;
          const magnitudeScore = avgGain + avgLoss > 0 ? (avgGain / (avgGain + avgLoss)) * 100 : 50;
          signals.push({ name: 'Gain/Loss Magnitude', score: magnitudeScore, weight: 0.2 });
        }

        // Signal 4: Market momentum from sector YTD performance
        if (sectorPerf) {
          const ytdValues = Object.entries(sectorPerf)
            .map(([, val]) => Number(String(val).replace('%', '')))
            .filter((v) => Number.isFinite(v));
          if (ytdValues.length > 0) {
            const avgYtd = ytdValues.reduce((s, v) => s + v, 0) / ytdValues.length;
            // Map YTD to 0-100: -20% → 0, 0% → 50, +20% → 100
            const momentumScore = Math.max(0, Math.min(100, (avgYtd + 20) * 2.5));
            signals.push({ name: 'Market Momentum', score: momentumScore, weight: 0.2 });
          }
        }

        if (signals.length === 0) {
          return {
            success: true,
            data: { score: null, classification: 'Unavailable', signals: [] },
            message: 'Market sentiment data unavailable',
          };
        }

        const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
        const compositeScore = signals.reduce((s, sig) => s + sig.score * (sig.weight / totalWeight), 0);
        const clampedScore = Math.max(0, Math.min(100, Math.round(compositeScore)));

        let classification: string;
        if (clampedScore <= 20) classification = 'Extreme Fear';
        else if (clampedScore <= 40) classification = 'Fear';
        else if (clampedScore <= 60) classification = 'Neutral';
        else if (clampedScore <= 80) classification = 'Greed';
        else classification = 'Extreme Greed';

        return {
          success: true,
          data: {
            score: clampedScore,
            classification,
            signals: signals.map((s) => ({ name: s.name, score: Math.round(s.score), weight: s.weight })),
            fetchedAt: new Date().toISOString(),
          },
          message: `Market sentiment: ${clampedScore}/100 (${classification})`,
        };
      }
      case 'generate_stock_report': {
        const symbolQuery = args.symbol || '';
        const deadlineAt = options?.deadlineAt;
        // When called from watchlist/comparison with a known ticker, skip per-company
        // LLM calls (ticker resolution, moat, conclusion) to avoid redundant API/LLM
        // load.  The caller does batch LLM calls afterward.
        const skipPerCompanyLLM = Boolean(args.skipLLM);
        const coreOnly = Boolean(args.coreOnly);
        const forceCriticalData = Boolean(args.forceCriticalData);
        const trustedTickerInput = Boolean(args.trustedTicker);

        // Resolve to a live provider-confirmed ticker before fetching financials.
        // Search comes before LLM for company names so a model cannot map a live
        // company to a stale or unrelated ticker such as an old delisted symbol.
        let symbol: string | undefined;
        let apiResolved: Awaited<ReturnType<typeof resolveSymbolFromQuery>> | undefined;
        const directTicker = normalizeTickerCandidate(symbolQuery);
        if (trustedTickerInput && directTicker) {
          symbol = directTicker;
        } else if (hasExchangePrefix(symbolQuery)) {
          if (directTicker && await validateResolvedTicker(stockService, directTicker)) {
            symbol = directTicker;
          }
        } else {
          apiResolved = await resolveSymbolFromQuery(stockService, symbolQuery);
          const apiTicker = normalizeTickerCandidate((apiResolved as any)?.symbol);
          if (apiResolved.ok && apiTicker) {
            if ((apiResolved as any).exactProviderMatch || await validateResolvedTicker(stockService, apiTicker)) {
              symbol = apiTicker;
            }
          }
          if (!symbol && directTicker && await validateResolvedTicker(stockService, directTicker)) {
            symbol = directTicker;
          }
        }

        if (!symbol && !skipPerCompanyLLM && options?.llmFill) {
          const prompt = buildTickerResolutionPrompt([symbolQuery]);
          try {
            const raw = await withReportTaskTimeout(options.llmFill(prompt), 'llm', deadlineAt);
            const parsed = parseLLMFillJSON(raw);
            const llmTicker = normalizeTickerCandidate(parsed?.[symbolQuery]);
            if (llmTicker && await validateResolvedTicker(stockService, llmTicker)) {
              symbol = llmTicker;
            }
          } catch {
            // LLM unavailable; fall through to API search
          }
        }

        if (!symbol) {
          const candidates = (apiResolved?.candidates || [])
            .map((item: any) => `${item.name || item.symbol} (${item.symbol})`)
            .join(', ');
          return {
            success: false,
            error: `Could not resolve "${symbolQuery}" to a live provider-confirmed ticker. ${candidates ? `Did you mean: ${candidates}?` : 'No matches found.'}`,
            data: { candidates: apiResolved?.candidates || [] },
          };
        }
        const range = args.range || '5y';
        const notes: string[] = [];
        const updateContext = await prepareReportUpdateContext(args, {
          kind: 'stock',
          query: String(args.updateQuery || symbolQuery || symbol),
          symbols: [symbol],
        });
        notes.push(...updateContext.notes);
        const sources = new Map<string, string>();
        const cache = await loadSymbolCache(symbol);
        const trustEntries: DataTrustEntry[] = [];
        let rateLimitHit = false;
        const watchlist = await getDefaultWatchlist().catch(() => null);
        const watchlistItem = watchlist?.items.find((item) => item.symbol === symbol.toUpperCase());
        const portfolioProfile = watchlist?.profile;
        const previousDecision = await getLatestDecision(symbol).catch(() => null);
        const isRateLimit = (message: string) => isRateLimitError(message);
        const safeFetch = async <T>(
          label: string,
          key: string,
          request: () => Promise<T>,
          allowRequest = true,
          allowNearDeadline = false,
          priority: ReportWorkPriority = 'critical'
        ) => {
          const cachedEntry = getCachedEntry(cache, key);
          const cachedValue = getCachedValue(cache, key);
          const registerTrust = (value: any, fetchedAt: string, provider: string) => {
            trustEntries.push(createTrustEntry({ key, label, provider, fetchedAt, data: value }));
          };
          if (cachedValue !== null) {
            const provider = cachedEntry?.provider
              || (cachedValue && typeof cachedValue === 'object' && '__source' in cachedValue ? String((cachedValue as any).__source) : DEFAULT_SOURCE);
            if (cachedValue && typeof cachedValue === 'object') {
              sources.set(label, provider);
            }
            registerTrust(cachedValue, cachedEntry?.updatedAt || new Date().toISOString(), provider);
            return cachedValue as T;
          }
          if (rateLimitHit || !allowRequest) return undefined as T;
          if (allowNearDeadline) {
            pushDeadlineNote(notes, deadlineAt);
          } else if (pushDeadlineNote(notes, deadlineAt)) {
            return undefined as T;
          }
          try {
            const result = await withReportTaskTimeout(request(), priority, deadlineAt);
            const provider = result && typeof result === 'object' && '__source' in result
              ? String((result as any).__source)
              : DEFAULT_SOURCE;
            if (result && typeof result === 'object') {
              sources.set(label, provider);
            }
            setCachedValue(cache, key, result, { provider });
            registerTrust(result, new Date().toISOString(), provider);
            return result;
          } catch (error: any) {
            const message = error?.message || 'Unavailable';
            if (isRateLimit(message)) {
              rateLimitHit = true;
              const providerLabel = detectRateLimitProvider(message);
              notes.push(`${providerLabel} rate limit reached; remaining sections skipped.`);
              return cachedValue !== null ? (cachedValue as T) : (undefined as T);
            }
            if (!isSuppressedProviderError(message)) {
              notes.push(`${label}: ${message}`);
            }
            if (cachedValue && typeof cachedValue === 'object') {
              const provider = cachedEntry?.provider
                || ('__source' in cachedValue ? String((cachedValue as any).__source) : DEFAULT_SOURCE);
              sources.set(label, provider);
              registerTrust(cachedValue, cachedEntry?.updatedAt || new Date().toISOString(), provider);
            }
            return cachedValue !== null ? (cachedValue as T) : (undefined as T);
          }
        };
        const buildBasicFinancialsFallback = (overview: any) => {
          if (!overview) return undefined;
          const revenue = Number(overview.revenueTTM);
          const grossProfit = Number(overview.grossProfitTTM);
          const grossMarginTTM = Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(grossProfit)
            ? grossProfit / revenue
            : null;
          return {
            symbol: overview.symbol,
            metric: {
              peBasicExclExtraTTM: overview.peRatio,
              epsTTM: overview.eps,
              revenueGrowthTTM: overview.quarterlyRevenueGrowth,
              epsGrowthTTM: overview.quarterlyEarningsGrowth,
              grossMarginTTM,
              operatingMarginTTM: overview.operatingMargin,
              roeTTM: overview.returnOnEquity,
              revenuePerShareTTM: overview.revenuePerShare,
            },
            series: {},
          };
        };


        /** Returns true when a fetched financial statement has at least one report row. */
        const hasReports = (stmt: any): boolean =>
          stmt != null &&
          (
            (Array.isArray(stmt.quarterlyReports) && stmt.quarterlyReports.length > 0) ||
            (Array.isArray(stmt.annualReports) && stmt.annualReports.length > 0)
          );

        const allowCritical = forceCriticalData || hasReportWorkBudget(deadlineAt, 'critical', 1);
        const price = await safeFetch('Price', 'price', () => stockService.getStockPrice(symbol), allowCritical, forceCriticalData, 'critical');
        const rawCompanyOverview = await safeFetch('Company overview', 'overview', () => stockService.getCompanyOverview(symbol), allowCritical, forceCriticalData, 'critical');
        const basicFinancials = await safeFetch('Basic financials', 'basicFinancials', () => stockService.getBasicFinancials(symbol), allowCritical, forceCriticalData, 'critical');
        const priceHistory = await safeFetch('Price history', `priceHistory:${range}`, () => stockService.getPriceHistory(symbol, range), allowCritical, forceCriticalData, 'critical');
        const { overview: companyOverview, notes: overviewNotes } = sanitizeMarketScaledOverview(rawCompanyOverview, price, priceHistory);
        notes.push(...overviewNotes);
        const earningsHistory = await safeFetch('Earnings history', 'earningsHistory', () => stockService.getEarningsHistory(symbol), !coreOnly && hasReportWorkBudget(deadlineAt, 'high', 1), false, 'high');
        const incomeStatement = await safeFetch('Income statement', 'incomeStatement', () => stockService.getIncomeStatement(symbol), !coreOnly && hasReportWorkBudget(deadlineAt, 'high', 1), false, 'high');
        const balanceSheet = await safeFetch('Balance sheet', 'balanceSheet', () => stockService.getBalanceSheet(symbol), !coreOnly && hasReportWorkBudget(deadlineAt, 'high', 1), false, 'high');
        const cashFlow = await safeFetch('Cash flow', 'cashFlow', () => stockService.getCashFlow(symbol), !coreOnly && hasReportWorkBudget(deadlineAt, 'high', 1), false, 'high');
        const analystRatings = await safeFetch('Analyst ratings', 'analystRatings', () => stockService.getAnalystRatings(symbol), hasReportWorkBudget(deadlineAt, 'high', 1), false, 'high');
        const analystRecommendations = await safeFetch(
          'Analyst recommendations',
          'analystRecommendations',
          () => stockService.getAnalystRecommendations(symbol),
          !coreOnly && hasReportWorkBudget(deadlineAt, 'optional', 1),
          false,
          'optional'
        );
        const insiderTrading = await safeFetch('Insider trading', 'insiderTrading', () => stockService.getInsiderTrading(symbol), !coreOnly && hasReportWorkBudget(deadlineAt, 'optional', 1), false, 'optional');
        const priceTargets = await safeFetch('Price targets', 'priceTargets', () => stockService.getPriceTargets(symbol), hasReportWorkBudget(deadlineAt, 'high', 1), false, 'high');
        const peers = await safeFetch('Peers', 'peers', () => stockService.getPeers(symbol), !coreOnly && hasReportWorkBudget(deadlineAt, 'optional', 1), false, 'optional');
        const newsSentiment = await safeFetch('News sentiment', 'newsSentiment', () => stockService.getNewsSentiment(symbol), !coreOnly && hasReportWorkBudget(deadlineAt, 'optional', 1), false, 'optional');
        const companyNews = await safeFetch('Company news', 'companyNews', () => stockService.getCompanyNews(symbol, 14), !coreOnly && hasReportWorkBudget(deadlineAt, 'optional', 1), false, 'optional');
        const shouldUseSecFallback = shouldFetchSecFinancialFallback({ basicFinancials, incomeStatement, balanceSheet, cashFlow });
        const secFinancialFacts = shouldUseSecFallback
          ? await safeFetch(
              'SEC companyfacts',
              'secFinancialFacts',
              () => new SecCompanyFactsService().getNormalizedFinancialFacts(symbol),
              forceCriticalData || (!coreOnly && hasReportWorkBudget(deadlineAt, 'high', 1)),
              false,
              'high'
            )
          : undefined;
        const secFallbacks = buildSecFinancialFallbacks(symbol, secFinancialFacts, price);


        // Build basic financials from the overview. These are direct provider fields
        // or simple arithmetic on provider fields, not synthetic statement rows.
        const overviewFinancials = companyOverview ? buildBasicFinancialsFallback(companyOverview) : undefined;
        const finalBasicFinancials = fillMissingFields(fillMissingFields(basicFinancials, overviewFinancials), secFallbacks.basicFinancials);

        const hasIncomeData = hasReports(incomeStatement);
        const hasBalanceData = hasReports(balanceSheet);
        const finalIncomeStatement = hasIncomeData ? incomeStatement : secFallbacks.incomeStatement;
        const finalBalanceSheet = hasBalanceData ? balanceSheet : secFallbacks.balanceSheet;
        const finalCashFlow = hasReports(cashFlow) ? cashFlow : secFallbacks.cashFlow;
        const hasEarningsData = earningsHistory?.quarterlyEarnings?.length > 0;
        const finalEarningsHistory = hasEarningsData ? earningsHistory : undefined;

        if (!hasIncomeData && !finalIncomeStatement) {
          notes.push('Income statement unavailable from providers and SEC companyfacts; no synthetic fallback was used.');
        } else if (!hasIncomeData && finalIncomeStatement) {
          notes.push('Income statement vendor endpoint unavailable; filled available revenue, gross profit, operating income, and net income from official SEC companyfacts.');
        }
        if (!hasBalanceData && !finalBalanceSheet) {
          notes.push('Balance sheet unavailable from providers and SEC companyfacts; no synthetic fallback was used.');
        } else if (!hasBalanceData && finalBalanceSheet) {
          notes.push('Balance sheet vendor endpoint unavailable; filled available assets/liabilities/equity/cash from official SEC companyfacts.');
        }
        if (!finalCashFlow) {
          notes.push('Cash flow unavailable from providers and SEC companyfacts; report shows this section as unavailable.');
        } else if (!hasReports(cashFlow) && finalCashFlow) {
          notes.push('Cash flow vendor endpoint unavailable; filled available operating cash flow, capex, and FCF from official SEC companyfacts.');
        }
        if (!hasEarningsData) {
          notes.push('Quarterly EPS history unavailable from providers; no synthetic EPS series was generated.');
        }

        const trustSummary = summarizeTrust(trustEntries);
        if (!trustSummary.criticalFresh && trustSummary.staleLabels.length > 0) {
          notes.push(`Critical inputs are stale: ${trustSummary.staleLabels.join(', ')}. Recommendation confidence has been reduced.`);
        }

        // LLM moat analysis — best-effort; report still builds without it
        // Skipped when called from batch callers (watchlist/comparison) that do their own batch moat.
        let moatAnalysis: MoatAnalysis | undefined;
        if (!skipPerCompanyLLM && options?.llmFill && hasReportLLMBudget(deadlineAt)) {
          try {
            const moatPrompt = buildMoatAnalysisPrompt(symbol, companyOverview, finalBasicFinancials);
            const raw = await withReportTaskTimeout(options.llmFill(moatPrompt), 'llm', deadlineAt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            moatAnalysis = parseMoatEntry(parsed) ?? undefined;
          } catch {
            // LLM unavailable or invalid JSON — proceed without moat analysis
          }
        }

        const decisionSnapshot = buildDecisionSnapshot({
          symbol: symbol.toUpperCase(),
          price,
          priceHistory,
          companyOverview,
          basicFinancials: finalBasicFinancials,
          incomeStatement: finalIncomeStatement,
          balanceSheet: finalBalanceSheet,
          cashFlow: finalCashFlow,
          analystRatings,
          priceTargets,
          insiderTrading,
          newsSentiment,
          companyNews,
          trust: trustSummary,
          position: watchlistItem,
          portfolioProfile,
          previousDecision,
        });

        // LLM investment conclusion — rich narrative, best-effort
        // Skipped when called from batch callers that provide their own summary.
        let llmConclusion: string | undefined;
        if (!skipPerCompanyLLM && options?.llmFill && hasReportLLMBudget(deadlineAt)) {
          try {
            const conclusionPrompt = buildStockConclusionPrompt(
              symbol,
              price,
              companyOverview,
              finalBasicFinancials,
              finalEarningsHistory,
              finalIncomeStatement,
              finalBalanceSheet,
              finalCashFlow,
              analystRatings,
              priceTargets,
              priceHistory,
              newsSentiment,
              companyNews,
              moatAnalysis,
              decisionSnapshot
            );
            llmConclusion = (await withReportTaskTimeout(options.llmFill(conclusionPrompt), 'llm', deadlineAt)).trim();
          } catch {
            // LLM unavailable — use structured fallback
          }
        }

        const generatedAt = new Date().toISOString();
        const reportBody = buildStockReport({
          symbol: symbol.toUpperCase(),
          generatedAt,
          price,
          priceHistory,
          companyOverview,
          basicFinancials: finalBasicFinancials,
          earningsHistory: finalEarningsHistory,
          incomeStatement: finalIncomeStatement,
          balanceSheet: finalBalanceSheet,
          cashFlow: finalCashFlow,
          analystRatings,
          analystRecommendations,
          insiderTrading,
          priceTargets,
          peers,
          newsSentiment,
          companyNews,
          moatAnalysis,
          llmConclusion,
          dataTrust: trustSummary,
          decisionSnapshot,
          portfolioProfile,
          watchlistPosition: watchlistItem,
        });

        const content = notes.length
          ? reportBody.replace(
              '## 📊 Snapshot',
              `## ⚠️ Data Gaps\n${notes.map((item) => `- ${item}`).join('\n')}\n\n## 📊 Snapshot`
            )
          : reportBody;

        const debugMode = process.env.DEBUG === 'true';
        const sourceSection = debugMode && sources.size
          ? `## 🧾 Data Sources\n${SOURCE_LEGEND}\n${Array.from(sources.entries()).map(([key, value]) => `- ${key}: ${value}`).join('\n')}`
          : '';
        const finalContent = sourceSection
          ? content.replace('## 📊 Snapshot', `${sourceSection}\n\n## 📊 Snapshot`)
          : content;
        const runMetadata = buildReportRunMetadata({
          kind: 'stock',
          query: String(args.updateQuery || symbolQuery || symbol),
          symbols: [symbol],
          range,
          generatedAt,
          updatedFrom: updateContext.previous,
          notes,
          coverage: [
            coverageEntry(symbol, 'price', 'Price', price, 'critical'),
            coverageEntry(symbol, 'overview', 'Company overview', companyOverview, 'critical'),
            coverageEntry(symbol, 'basicFinancials', 'Basic financials', finalBasicFinancials, 'critical'),
            coverageEntry(symbol, `priceHistory:${range}`, 'Price history', priceHistory, 'critical'),
            coverageEntry(symbol, 'earningsHistory', 'Earnings history', finalEarningsHistory, 'high'),
            coverageEntry(symbol, 'incomeStatement', 'Income statement', finalIncomeStatement, 'high'),
            coverageEntry(symbol, 'balanceSheet', 'Balance sheet', finalBalanceSheet, 'high'),
            coverageEntry(symbol, 'cashFlow', 'Cash flow', finalCashFlow, 'high'),
            coverageEntry(symbol, 'analystRatings', 'Analyst ratings', analystRatings, 'high'),
            coverageEntry(symbol, 'analystRecommendations', 'Analyst recommendations', analystRecommendations, 'optional'),
            coverageEntry(symbol, 'insiderTrading', 'Insider trading', insiderTrading, 'optional'),
            coverageEntry(symbol, 'priceTargets', 'Price targets', priceTargets, 'high'),
            coverageEntry(symbol, 'peers', 'Peers', peers, 'optional'),
            coverageEntry(symbol, 'newsSentiment', 'News sentiment', newsSentiment, 'optional'),
            coverageEntry(symbol, 'companyNews', 'Company news', companyNews, 'optional'),
            coverageEntry(symbol, 'secFinancialFacts', 'SEC companyfacts', secFinancialFacts, 'high'),
          ],
        });
        await saveSymbolCache(symbol, cache);
        if (args.skipSave) {
          return {
            success: true,
            data: {
              content: finalContent,
              symbol: symbol.toUpperCase(),
              range,
              summary: decisionSnapshot.summary,
              decisionSnapshot,
              dataTrust: trustSummary,
              runMetadata,
              rawData: args.includeRawData ? {
                symbol: symbol.toUpperCase(),
                generatedAt,
                price,
                priceHistory,
                companyOverview,
                basicFinancials: finalBasicFinancials,
                earningsHistory: finalEarningsHistory,
                incomeStatement: finalIncomeStatement,
                balanceSheet: finalBalanceSheet,
                cashFlow: finalCashFlow,
                analystRatings,
                analystRecommendations,
                insiderTrading,
                priceTargets,
                peers,
                newsSentiment,
                companyNews,
                moatAnalysis,
                llmConclusion,
                dataTrust: trustSummary,
                decisionSnapshot,
                portfolioProfile,
                watchlistPosition: watchlistItem,
              } : undefined,
            },
            message: `Built stock report content for ${symbol}`,
          };
        }
        const saved = await saveReport(finalContent, `${symbol}-stock-report`, undefined, {
          reportKind: 'stock',
          summary: decisionSnapshot.summary,
          runMetadata,
        });
        await appendDecisionJournal({
          sessionId: typeof args.sessionId === 'string' ? args.sessionId : undefined,
          symbol: symbol.toUpperCase(),
          action: decisionSnapshot.action,
          confidence: decisionSnapshot.confidence,
          summary: decisionSnapshot.summary,
          score: decisionSnapshot.overallScore,
          price,
        }).catch(() => {});
        await upsertCompanyThesis({
          symbol: symbol.toUpperCase(),
          thesis: watchlistItem?.thesis || decisionSnapshot.summary,
          conviction: watchlistItem?.conviction || 'medium',
          invalidation: watchlistItem?.invalidation || decisionSnapshot.invalidation,
          lastAction: decisionSnapshot.action,
          summary: decisionSnapshot.summary,
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
        return {
          success: true,
          data: {
            content: finalContent,
            symbol: symbol.toUpperCase(),
            range,
            decisionSnapshot,
            dataTrust: trustSummary,
            ...saved,
            downloadUrl: buildReportDownloadUrl(saved),
          },
          message: `Saved stock report to ${saved.filePath}`,
        };
      }
      case 'generate_comparison_report': {
        const range = args.range || '1y';
        const deadlineAt = options?.deadlineAt;
        const rawCompanies = args.companies ?? args.symbols;
        const companiesInput = Array.isArray(rawCompanies)
          ? rawCompanies
          : parseExplicitComparisonCompanies(String(rawCompanies || ''));
        const companies = companiesInput.map((item: string) => item.trim()).filter(Boolean);
        if (companies.length < 2 || companies.length > NUM_COMPANIES) {
          return { success: false, error: `Provide between 2 and ${NUM_COMPANIES} company names or tickers.` };
        }

        // Step 1: LLM resolves ALL inputs to official tickers in one batch call.
        // LLM is the primary resolver — no API search is needed for well-known names.
        const resolvedMap = new Map<string, string>(); // query → official ticker
        for (const query of companies) {
          const directTicker = hasExchangePrefix(query) ? normalizeTickerCandidate(query) : undefined;
          if (directTicker) resolvedMap.set(query, directTicker);
        }
        if (options?.llmFill && hasReportLLMBudget(deadlineAt)) {
          const prompt = buildTickerResolutionPrompt(companies);
          try {
            const raw = await withReportTaskTimeout(options.llmFill(prompt), 'llm', deadlineAt);
            const parsed = parseLLMFillJSON(raw);
            if (parsed && typeof parsed === 'object') {
              for (const query of companies) {
                const llmTicker = parsed[query];
                const clean = normalizeTickerCandidate(llmTicker);
                if (clean && await validateResolvedTicker(stockService, clean)) resolvedMap.set(query, clean);
              }
            }
          } catch {
            // LLM unavailable; fall through to API search for all
          }
        }

        // Step 2: For anything LLM couldn't resolve, fall back to AV symbol search.
        const needsApiSearch = companies.filter((q) => !resolvedMap.has(q));
        const minimumSearches = Math.min(2, needsApiSearch.length);
        for (let searchIndex = 0; searchIndex < needsApiSearch.length; searchIndex++) {
          if (isDeadlineNear(deadlineAt) && searchIndex >= minimumSearches) break;
          const query = needsApiSearch[searchIndex];
          const result = await resolveSymbolFromQuery(stockService, query);
          if (result.ok && result.symbol) {
            resolvedMap.set(query, result.symbol);
          }
        }

        // Step 3: Error if anything is still unresolved.
        const unresolved = companies.filter((q) => !resolvedMap.has(q));
        if (unresolved.length) {
          return {
            success: false,
            error: `Could not resolve to a ticker: ${unresolved.join(', ')}. Please use official ticker symbols.`,
          };
        }

        const universe = companies.map((q) => resolvedMap.get(q) as string);
        const notes: string[] = [];
        const updateContext = await prepareReportUpdateContext(args, {
          kind: 'comparison',
          query: String(args.updateQuery || companies.join(', ')),
          symbols: universe,
        });
        notes.push(...updateContext.notes);
        const sourceMap: Record<string, Record<string, string>> = {};
        const watchlist = await getDefaultWatchlist().catch(() => null);
        const portfolioProfile = watchlist?.profile;
        const fetchExtendedData = shouldFetchExtendedReportData(universe.length);
        if (!fetchExtendedData) {
          notes.push('Large-report Vercel mode: prioritized core decision inputs and cached optional sections to stay within free-tier limits.');
        }
        let rateLimitHit = false;
        const isRateLimit = (message: string) => isRateLimitError(message);
        const safeFetch = async <T>(
          symbol: string,
          cache: SymbolCache,
          label: string,
          key: string,
          request: () => Promise<T>,
          allowRequest = true,
          priority: ReportWorkPriority = 'critical'
        ) => {
          const cachedValue = getCachedValue(cache, key);
          if (cachedValue !== null) {
            if (cachedValue && typeof cachedValue === 'object') {
              const sourceValue = '__source' in cachedValue
                ? String((cachedValue as any).__source)
                : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
            }
            return cachedValue as T;
          }
          if (rateLimitHit || !allowRequest) return undefined as T;
          if (pushDeadlineNote(notes, deadlineAt)) return undefined as T;
          try {
            const result = await withReportTaskTimeout(request(), priority, deadlineAt);
            if (result && typeof result === 'object') {
              const sourceValue = '__source' in result ? String((result as any).__source) : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
              setCachedValue(cache, key, result, { provider: sourceValue });
            } else {
              setCachedValue(cache, key, result);
            }
            return result;
          } catch (error: any) {
            const message = error?.message || 'Unavailable';
            if (isRateLimit(message)) {
              rateLimitHit = true;
              const providerLabel = detectRateLimitProvider(message);
              notes.push(`${providerLabel} rate limit reached; remaining sections skipped.`);
              return cachedValue !== null ? (cachedValue as T) : (undefined as T);
            }
            if (!isSuppressedProviderError(message)) {
              notes.push(`${label}: ${message}`);
            }
            if (cachedValue && typeof cachedValue === 'object') {
              const sourceValue = '__source' in cachedValue
                ? String((cachedValue as any).__source)
                : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
            }
            return cachedValue !== null ? (cachedValue as T) : (undefined as T);
          }
        };
        const buildBasicFinancialsFallback = (overview: any) => {
          if (!overview) return undefined;
          const revenue = Number(overview.revenueTTM);
          const grossProfit = Number(overview.grossProfitTTM);
          const grossMarginTTM = Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(grossProfit)
            ? grossProfit / revenue
            : null;
          return {
            symbol: overview.symbol,
            metric: {
              peBasicExclExtraTTM: overview.peRatio,
              epsTTM: overview.eps,
              revenueGrowthTTM: overview.quarterlyRevenueGrowth,
              epsGrowthTTM: overview.quarterlyEarningsGrowth,
              grossMarginTTM,
              operatingMarginTTM: overview.operatingMargin,
              roeTTM: overview.returnOnEquity,
              revenuePerShareTTM: overview.revenuePerShare,
            },
            series: {},
          };
        };

        // Phase 1: Fetch all API data for all companies
        type RawCompanyData = {
          symbol: string;
          cache: SymbolCache;
          price: any;
          overview: any;
          basicFinancials: any;
          priceHistory: any;
          incomeStatement: any;
          balanceSheet: any;
          cashFlow: any;
          analystRatings: any;
          insiderTrading: any;
          priceTargets: any;
          peers: any;
          newsSentiment: any;
          companyNews: any;
          secFinancialFacts: any;
        };
        const rawItems = await mapWithConcurrency<string, RawCompanyData>(
          universe,
          DATA_FETCH_CONCURRENCY,
          async (symbol) => {
            const cache = await loadSymbolCache(symbol);
            const companyCount = universe.length;
            const price = await safeFetch(symbol, cache, 'Price', 'price', () => stockService.getStockPrice(symbol), hasReportWorkBudget(deadlineAt, 'critical', companyCount), 'critical');
            const overview = await safeFetch(symbol, cache, 'Company overview', 'overview', () => stockService.getCompanyOverview(symbol), hasReportWorkBudget(deadlineAt, 'critical', companyCount), 'critical');
            const basicFinancials = await safeFetch(symbol, cache, 'Basic financials', 'basicFinancials', () => stockService.getBasicFinancials(symbol), hasReportWorkBudget(deadlineAt, 'critical', companyCount), 'critical');
            const priceHistory = await safeFetch(symbol, cache, 'Price history', `priceHistory:${range}`, () => stockService.getPriceHistory(symbol, range), hasReportWorkBudget(deadlineAt, 'critical', companyCount), 'critical');
            const incomeStatement = await safeFetch(symbol, cache, 'Income statement', 'incomeStatement', () => stockService.getIncomeStatement(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'high', companyCount), 'high');
            const balanceSheet = await safeFetch(symbol, cache, 'Balance sheet', 'balanceSheet', () => stockService.getBalanceSheet(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'high', companyCount), 'high');
            const cashFlow = await safeFetch(symbol, cache, 'Cash flow', 'cashFlow', () => stockService.getCashFlow(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'high', companyCount), 'high');
            const analystRatings = await safeFetch(symbol, cache, 'Analyst ratings', 'analystRatings', () => stockService.getAnalystRatings(symbol), hasReportWorkBudget(deadlineAt, 'high', companyCount), 'high');
            const insiderTrading = await safeFetch(symbol, cache, 'Insider trading', 'insiderTrading', () => stockService.getInsiderTrading(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'optional', companyCount), 'optional');
            const priceTargets = await safeFetch(symbol, cache, 'Price targets', 'priceTargets', () => stockService.getPriceTargets(symbol), hasReportWorkBudget(deadlineAt, 'high', companyCount), 'high');
            const peers = await safeFetch(symbol, cache, 'Peers', 'peers', () => stockService.getPeers(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'optional', companyCount), 'optional');
            const newsSentiment = await safeFetch(symbol, cache, 'News sentiment', 'newsSentiment', () => stockService.getNewsSentiment(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'optional', companyCount), 'optional');
            const companyNews = await safeFetch(symbol, cache, 'Company news', 'companyNews', () => stockService.getCompanyNews(symbol, 14), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'optional', companyCount), 'optional');
            const shouldUseSecFallback = shouldFetchSecFinancialFallback({ basicFinancials, incomeStatement, balanceSheet, cashFlow });
            const secFinancialFacts = shouldUseSecFallback
              ? await safeFetch(
                  symbol,
                  cache,
                  'SEC companyfacts',
                  'secFinancialFacts',
                  () => new SecCompanyFactsService().getNormalizedFinancialFacts(symbol),
                  hasReportWorkBudget(deadlineAt, 'high', companyCount),
                  'high'
                )
              : undefined;
            return {
              symbol,
              cache,
              price,
              overview,
              basicFinancials,
              priceHistory,
              incomeStatement,
              balanceSheet,
              cashFlow,
              analystRatings,
              insiderTrading,
              priceTargets,
              peers,
              newsSentiment,
              companyNews,
              secFinancialFacts,
            };
          },
          () => !isDeadlineNear(deadlineAt),
          Math.min(2, universe.length)
        );

        // Phase 2: Build items from API data
        const items: any[] = [];
        for (const item of rawItems) {
          const { symbol } = item;
          const { overview, notes: overviewNotes } = sanitizeMarketScaledOverview(item.overview, item.price, item.priceHistory);
          notes.push(...overviewNotes.map((note) => `${symbol}: ${note}`));
          const secFallbacks = buildSecFinancialFallbacks(symbol, item.secFinancialFacts, item.price);
          const overviewFinancials = overview ? buildBasicFinancialsFallback(overview) : undefined;
          const basicFinancials = fillMissingFields(fillMissingFields(item.basicFinancials, overviewFinancials), secFallbacks.basicFinancials);
          const incomeStatement = hasStatementReports(item.incomeStatement) ? item.incomeStatement : secFallbacks.incomeStatement;
          const balanceSheet = hasStatementReports(item.balanceSheet) ? item.balanceSheet : secFallbacks.balanceSheet;
          const cashFlow = hasStatementReports(item.cashFlow) ? item.cashFlow : secFallbacks.cashFlow;
          const watchlistItem = watchlist?.items.find((entry) => entry.symbol === symbol.toUpperCase());
          const previousDecision = await getLatestDecision(symbol).catch(() => null);
          const trustSummary = buildTrustSummaryFromCache(item.cache, [
            { key: 'price', label: 'Price', data: item.price },
            { key: 'overview', label: 'Company overview', data: item.overview },
            { key: 'basicFinancials', label: 'Basic financials', data: item.basicFinancials },
            { key: `priceHistory:${range}`, label: 'Price history', data: item.priceHistory },
            { key: 'incomeStatement', label: 'Income statement', data: item.incomeStatement },
            { key: 'balanceSheet', label: 'Balance sheet', data: item.balanceSheet },
            { key: 'cashFlow', label: 'Cash flow', data: item.cashFlow },
            { key: 'analystRatings', label: 'Analyst ratings', data: item.analystRatings },
            { key: 'insiderTrading', label: 'Insider trading', data: item.insiderTrading },
            { key: 'priceTargets', label: 'Price targets', data: item.priceTargets },
            { key: 'peers', label: 'Peers', data: item.peers },
            { key: 'newsSentiment', label: 'News sentiment', data: item.newsSentiment },
            { key: 'companyNews', label: 'Company news', data: item.companyNews },
            { key: 'secFinancialFacts', label: 'SEC companyfacts', data: item.secFinancialFacts },
          ]);
          const decisionSnapshot = buildDecisionSnapshot({
            symbol,
            price: item.price,
            priceHistory: item.priceHistory,
            companyOverview: overview,
            basicFinancials,
            incomeStatement,
            balanceSheet,
            cashFlow,
            analystRatings: item.analystRatings,
            priceTargets: item.priceTargets,
            insiderTrading: item.insiderTrading,
            newsSentiment: item.newsSentiment,
            companyNews: item.companyNews,
            trust: trustSummary,
            position: watchlistItem,
            portfolioProfile,
            previousDecision,
          });
          items.push({
            symbol,
            price: item.price,
            overview,
            basicFinancials,
            priceHistory: item.priceHistory,
            incomeStatement,
            balanceSheet,
            cashFlow,
            analystRatings: item.analystRatings,
            insiderTrading: item.insiderTrading,
            priceTargets: item.priceTargets,
            peers: item.peers,
            newsSentiment: item.newsSentiment,
            companyNews: item.companyNews,
            dataTrust: trustSummary,
            decisionSnapshot,
          });
          await saveSymbolCache(symbol, item.cache);
        }

        if (items.length === 0) {
          return { success: false, error: 'Could not collect enough data before the runtime deadline to build a comparison report.' };
        }

        // Phase 3: LLM batch moat analysis for all companies (single call)
        if (options?.llmFill && items.length > 0 && hasReportLLMBudget(deadlineAt)) {
          try {
            const moatPrompt = buildBatchMoatAnalysisPrompt(
              items.map((item) => ({ symbol: item.symbol, overview: item.overview, basicFinancials: item.basicFinancials }))
            );
            const raw = await withReportTaskTimeout(options.llmFill(moatPrompt), 'llm', deadlineAt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              for (const sym of Object.keys(parsed)) {
                const entry = parseMoatEntry(parsed[sym]);
                if (entry) {
                  const ticker = cleanTicker(sym);
                  const target = items.find((it) => it.symbol === ticker);
                  if (target) target.moatAnalysis = entry;
                }
              }
            }
          } catch {
            // LLM unavailable or invalid JSON — proceed without moat analysis
          }
        }

        // LLM position rationale — clear 1-2 sentence "Why" for the guidance table
        if (options?.llmFill && items.length > 0 && hasReportLLMBudget(deadlineAt)) {
          try {
            const rationalePrompt = buildBatchPositionRationalePrompt(
              items.map((item) => {
                const ds = item.decisionSnapshot;
                return {
                  symbol: item.symbol,
                  name: item.overview?.name || item.symbol,
                  action: ds?.action ?? 'Wait',
                  confidence: ds?.confidence ?? 'Medium',
                  overallScore: ds?.overallScore ?? null,
                  qualityScore: ds?.qualityScore ?? null,
                  valuationScore: ds?.valuationScore ?? null,
                  technicalScore: ds?.technicalScore ?? null,
                  analystConsensusScore: ds?.analystConsensusScore ?? null,
                  insiderScore: ds?.insiderScore ?? null,
                  whyNow: ds?.whyNow ?? [],
                  whyNot: ds?.whyNot ?? [],
                  missingInputs: ds?.missingInputs ?? [],
                  overview: item.overview,
                  basicFinancials: item.basicFinancials,
                  priceTargets: item.priceTargets,
                  analystRatings: item.analystRatings,
                  price: item.price,
                };
              })
            );
            const raw = await withReportTaskTimeout(options.llmFill(rationalePrompt), 'llm', deadlineAt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              for (const sym of Object.keys(parsed)) {
                const rationale = parsePositionRationaleEntry(parsed[sym]);
                if (!rationale) continue;
                const ticker = cleanTicker(sym);
                const target = items.find((it) => it.symbol === ticker);
                if (target?.decisionSnapshot) {
                  target.decisionSnapshot = { ...target.decisionSnapshot, summary: rationale };
                }
              }
            }
          } catch {
            // Proceed without LLM rationale — structured summary is the fallback
          }
        }

        // Phase 4: LLM investment conclusion — rich narrative, best-effort
        let llmConclusionComparison: string | undefined;
        if (options?.llmFill && items.length > 0 && hasReportLLMBudget(deadlineAt)) {
          try {
            const conclusionPrompt = buildComparisonConclusionPrompt(
              items,
              'comparison',
              undefined,
              items.map((item) => ({
                symbol: item.symbol,
                score: getComparisonPromptScore(item),
              }))
            );
            llmConclusionComparison = (await withReportTaskTimeout(options.llmFill(conclusionPrompt), 'llm', deadlineAt)).trim();
          } catch {
            // LLM unavailable — use structured fallback
          }
        }

        const generatedAt = new Date().toISOString();
        const runMetadata = buildReportRunMetadata({
          kind: 'comparison',
          query: String(args.updateQuery || companies.join(', ')),
          symbols: universe,
          range,
          generatedAt,
          updatedFrom: updateContext.previous,
          notes,
          coverage: items.flatMap((item) => [
            coverageEntry(item.symbol, 'price', 'Price', item.price, 'critical'),
            coverageEntry(item.symbol, 'overview', 'Company overview', item.overview, 'critical'),
            coverageEntry(item.symbol, 'basicFinancials', 'Basic financials', item.basicFinancials, 'critical'),
            coverageEntry(item.symbol, `priceHistory:${range}`, 'Price history', item.priceHistory, 'critical'),
            coverageEntry(item.symbol, 'incomeStatement', 'Income statement', item.incomeStatement, 'high'),
            coverageEntry(item.symbol, 'balanceSheet', 'Balance sheet', item.balanceSheet, 'high'),
            coverageEntry(item.symbol, 'cashFlow', 'Cash flow', item.cashFlow, 'high'),
            coverageEntry(item.symbol, 'analystRatings', 'Analyst ratings', item.analystRatings, 'high'),
            coverageEntry(item.symbol, 'insiderTrading', 'Insider trading', item.insiderTrading, 'optional'),
            coverageEntry(item.symbol, 'priceTargets', 'Price targets', item.priceTargets, 'high'),
            coverageEntry(item.symbol, 'peers', 'Peers', item.peers, 'optional'),
            coverageEntry(item.symbol, 'newsSentiment', 'News sentiment', item.newsSentiment, 'optional'),
            coverageEntry(item.symbol, 'companyNews', 'Company news', item.companyNews, 'optional'),
          ]),
        });
        const content = buildComparisonReport({
          generatedAt,
          range,
          universe,
          items,
          notes,
          sources: sourceMap,
          llmConclusion: llmConclusionComparison,
        });
        const summary = buildUniverseSummary(items);
        if (args.skipSave) {
          return {
            success: true,
            data: { content, universe, range, items, summary, runMetadata },
            message: `Built comparison report content for ${universe.join(', ')}`,
          };
        }
        const saved = await saveReport(content, `${universe.join('-')}-comparison-report`, undefined, {
          reportKind: 'comparison',
          summary,
          runMetadata,
        });
        return {
          success: true,
          data: { content, universe, range, ...saved, downloadUrl: buildReportDownloadUrl(saved) },
          message: `Saved comparison report to ${saved.filePath}`,
        };
      }
      case 'generate_watchlist_daily_report': {
        const range = args.range || '1y';
        const deadlineAt = options?.deadlineAt;
        const watchlist = await getDefaultWatchlist();
        if (!watchlist.items.length) {
          return { success: false, error: 'The watchlist is empty. Add companies before requesting a daily report.' };
        }
        const updateContext = await prepareReportUpdateContext(args, {
          kind: 'watchlist-daily',
          query: String(args.updateQuery || watchlist.name),
          symbols: watchlist.items.map((item) => item.symbol),
        });
        const coreOnly = !shouldFetchExtendedReportData(watchlist.items.length);

        const companyResults = await mapWithConcurrency(
          watchlist.items,
          DATA_FETCH_CONCURRENCY,
          async (item) => {
            const result = await executeTool(
              'generate_stock_report',
              { symbol: item.symbol, range, skipSave: true, includeRawData: true, skipLLM: true, coreOnly, forceCriticalData: true, trustedTicker: true },
              stockService,
              options
            );
            return { item, result };
          },
          () => !isDeadlineNear(deadlineAt),
          1
        );

        const successfulItems: Array<{ symbol: string; companyName: string; stock: any }> = [];
        const failures = new Map<string, string>();
        const attemptedSymbols = new Set<string>();

        for (const entry of companyResults) {
          attemptedSymbols.add(entry.item.symbol);
          const rawData = entry.result.data?.rawData;
          if (entry.result.success && rawData) {
            successfulItems.push({
              symbol: entry.result.data?.symbol || entry.item.symbol,
              companyName: entry.item.companyName,
              stock: rawData,
            });
          } else {
            failures.set(entry.item.symbol, entry.result.error || entry.result.message || 'Unavailable');
          }
        }
        for (const item of watchlist.items) {
          if (!attemptedSymbols.has(item.symbol)) {
            failures.set(item.symbol, 'Runtime budget skipped before this item could be fetched');
          }
        }

        // Retry failed items sequentially without adding a fixed sleep; provider
        // throttles/cooldowns already decide when another upstream call is allowed.
        if (failures.size > 0 && successfulItems.length > 0 && !isDeadlineNear(deadlineAt, 45000)) {
          console.info(`[watchlist] Retrying ${failures.size} failed items sequentially: ${Array.from(failures.keys()).join(', ')}`);
          const retryItems = watchlist.items.filter((item) => failures.has(item.symbol));
          const retryResults = await mapWithConcurrency(
            retryItems,
            1, // Sequential retries to avoid triggering rate limits again
            async (item) => {
              const result = await executeTool(
                'generate_stock_report',
                { symbol: item.symbol, range, skipSave: true, includeRawData: true, skipLLM: true, coreOnly, forceCriticalData: true, trustedTicker: true },
                stockService,
                options
              );
              return { item, result };
            },
            () => !isDeadlineNear(deadlineAt)
          );
          const retryFailures: string[] = [];
          for (const entry of retryResults) {
            const rawData = entry.result.data?.rawData;
            if (entry.result.success && rawData) {
              successfulItems.push({
                symbol: entry.result.data?.symbol || entry.item.symbol,
                companyName: entry.item.companyName,
                stock: rawData,
              });
              failures.delete(entry.item.symbol);
            } else {
              const reason = entry.result.error || entry.result.message || "Unavailable";
              failures.set(entry.item.symbol, reason);
              retryFailures.push(`${entry.item.symbol}: ${reason}`);
            }
          }
          if (retryFailures.length > 0) {
            console.warn(`[watchlist] ${retryFailures.length} items still failed after retry: ${retryFailures.join('; ')}`);
          }
        }

        if (successfulItems.length === 0) {
          return { success: false, error: 'Could not build any company sections for the watchlist daily report.' };
        }

        if (options?.llmFill && successfulItems.length > 0 && hasReportLLMBudget(deadlineAt)) {
          try {
            const moatPrompt = buildBatchMoatAnalysisPrompt(
              successfulItems.map((item) => ({
                symbol: item.symbol,
                overview: item.stock.companyOverview,
                basicFinancials: item.stock.basicFinancials,
              }))
            );
            const raw = await withReportTaskTimeout(options.llmFill(moatPrompt), 'llm', deadlineAt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === "object") {
              for (const sym of Object.keys(parsed)) {
                const entry = parseMoatEntry(parsed[sym]);
                if (!entry) continue;
                const target = successfulItems.find((item) => item.symbol === cleanTicker(sym));
                if (target) target.stock.moatAnalysis = entry;
              }
            }
          } catch {
            // Proceed without moat analysis if the batch call fails
          }
        }

        // LLM position rationale — clear 1-2 sentence "Why" for the guidance table
        if (options?.llmFill && successfulItems.length > 0 && hasReportLLMBudget(deadlineAt)) {
          try {
            const rationalePrompt = buildBatchPositionRationalePrompt(
              successfulItems.map((item) => {
                const ds = item.stock.decisionSnapshot;
                return {
                  symbol: item.symbol,
                  name: item.stock.companyOverview?.name || item.companyName,
                  action: ds?.action ?? 'Wait',
                  confidence: ds?.confidence ?? 'Medium',
                  overallScore: ds?.overallScore ?? null,
                  qualityScore: ds?.qualityScore ?? null,
                  valuationScore: ds?.valuationScore ?? null,
                  technicalScore: ds?.technicalScore ?? null,
                  analystConsensusScore: ds?.analystConsensusScore ?? null,
                  insiderScore: ds?.insiderScore ?? null,
                  whyNow: ds?.whyNow ?? [],
                  whyNot: ds?.whyNot ?? [],
                  missingInputs: ds?.missingInputs ?? [],
                  overview: item.stock.companyOverview,
                  basicFinancials: item.stock.basicFinancials,
                  priceTargets: item.stock.priceTargets,
                  analystRatings: item.stock.analystRatings,
                  price: item.stock.price,
                };
              })
            );
            const raw = await withReportTaskTimeout(options.llmFill(rationalePrompt), 'llm', deadlineAt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              for (const sym of Object.keys(parsed)) {
                const rationale = parsePositionRationaleEntry(parsed[sym]);
                if (!rationale) continue;
                const target = successfulItems.find((item) => item.symbol === cleanTicker(sym));
                if (target?.stock.decisionSnapshot) {
                  target.stock.decisionSnapshot = { ...target.stock.decisionSnapshot, summary: rationale };
                }
              }
            }
          } catch {
            // Proceed without LLM rationale — structured summary is the fallback
          }
        }

        const reportData = {
          generatedAt: new Date().toISOString(),
          watchlistName: watchlist.name,
          totalItems: watchlist.items.length,
          skippedItems: Array.from(failures.entries()).map(([symbol, reason]) => ({ symbol, reason })),
          items: successfulItems.map((item) => ({
            symbol: item.symbol,
            companyName: item.companyName,
            stock: item.stock,
          })),
        };
        if (isDeadlineNear(deadlineAt) && failures.size === 0 && successfulItems.length < watchlist.items.length) {
          reportData.skippedItems.push({ symbol: 'Runtime budget', reason: 'Vercel runtime budget reached; later watchlist items or optional enrichment may have been skipped.' });
        }
        const reportBody = buildWatchlistDailyReport(reportData);
        const updateSection = updateContext.notes.length
          ? `## Report Update\n${updateContext.notes.map((note) => `- ${note}`).join('\n')}`
          : '';
        const content = updateSection
          ? reportBody.replace('## Full Company Research', `${updateSection}\n\n## Full Company Research`)
          : reportBody;
        const summary = buildWatchlistSummary(reportData.items);
        const generatedAt = reportData.generatedAt;
        const runMetadata = buildReportRunMetadata({
          kind: 'watchlist-daily',
          query: String(args.updateQuery || watchlist.name),
          symbols: watchlist.items.map((item) => item.symbol),
          range,
          generatedAt,
          updatedFrom: updateContext.previous,
          notes: updateContext.notes,
          coverage: [
            ...successfulItems.flatMap((item) => [
              coverageEntry(item.symbol, 'price', 'Price', item.stock.price, 'critical'),
              coverageEntry(item.symbol, 'overview', 'Company overview', item.stock.companyOverview, 'critical'),
              coverageEntry(item.symbol, 'basicFinancials', 'Basic financials', item.stock.basicFinancials, 'critical'),
              coverageEntry(item.symbol, `priceHistory:${range}`, 'Price history', item.stock.priceHistory, 'critical'),
              coverageEntry(item.symbol, 'incomeStatement', 'Income statement', item.stock.incomeStatement, 'high'),
              coverageEntry(item.symbol, 'balanceSheet', 'Balance sheet', item.stock.balanceSheet, 'high'),
              coverageEntry(item.symbol, 'cashFlow', 'Cash flow', item.stock.cashFlow, 'high'),
              coverageEntry(item.symbol, 'analystRatings', 'Analyst ratings', item.stock.analystRatings, 'high'),
              coverageEntry(item.symbol, 'priceTargets', 'Price targets', item.stock.priceTargets, 'high'),
              coverageEntry(item.symbol, 'newsSentiment', 'News sentiment', item.stock.newsSentiment, 'optional'),
              coverageEntry(item.symbol, 'companyNews', 'Company news', item.stock.companyNews, 'optional'),
            ]),
            ...Array.from(failures.keys()).map((symbol) => coverageEntry(symbol, 'companySection', 'Company section', undefined, 'critical')),
          ],
        });

        if (args.skipSave) {
          return {
            success: true,
            data: { content, watchlist, range, summary, runMetadata },
            message: `Built daily watchlist report for ${watchlist.name}`
          };
        }

        const saved = await saveReport(content, `${watchlist.slug}-daily-report`, undefined, {
          reportKind: 'watchlist-daily',
          summary,
          runMetadata,
        });
        return {
          success: true,
          data: { content, watchlist, range, ...saved, downloadUrl: buildReportDownloadUrl(saved) },
          message: `Saved daily watchlist report to ${saved.filePath}`
        };
      }
      case 'generate_research_report': {
        const sector = String(args.sector || '').trim();
        if (!sector) {
          return { success: false, error: 'A sector or theme query is required.' };
        }
        const deadlineAt = options?.deadlineAt;
        const startTime = Date.now();
        const timeNotes: string[] = [];
        const timeBudgetExceeded = () => Date.now() - startTime > DEEP_RESEARCH_MAX_MS || isDeadlineNear(deadlineAt);
        const noteTimeBudget = () => {
          if (timeNotes.length === 0) {
            timeNotes.push('Time budget reached; remaining research steps truncated to fit runtime limits.');
          }
        };
        const requestedFinalCount = Math.min(NUM_COMPANIES, Math.max(3, Number(args.count) || NUM_COMPANIES));
        const finalCount = budgetedCompanyLimit(requestedFinalCount, deadlineAt);
        if (finalCount < requestedFinalCount) {
          timeNotes.push(`Vercel budget prioritized ${finalCount} companies from the requested ${requestedFinalCount} so the report could be saved before timeout.`);
        }
        // Fetch roughly 2x candidates only when there is enough time to refine them.
        const initialCount = hasReportWorkBudget(deadlineAt, 'optional', requestedFinalCount)
          ? Math.min(NUM_COMPANIES * 2, finalCount * 2)
          : finalCount;
        const range = args.range || '1y';
        const resolverSector = normalizeThematicResearchQuery(sector);

        const explicitCompanies = parseExplicitComparisonCompanies(sector);
        if (explicitCompanies.length >= 2) {
          const comparisonResult = await executeTool(
            'generate_comparison_report',
            { companies: explicitCompanies, range, skipSave: true },
            stockService,
            options
          );
          if (!comparisonResult.success || !comparisonResult.data?.content) {
            return comparisonResult.success
              ? { success: false, error: 'Deep comparison report could not be constructed.' }
              : comparisonResult;
          }
          const generatedAt = new Date().toISOString();
          const comparisonUniverse = Array.isArray(comparisonResult.data?.universe)
            ? (comparisonResult.data.universe as string[])
            : explicitCompanies;
          const content = buildDeepComparisonReport({
            query: sector,
            symbols: comparisonUniverse,
            generatedAt,
            baseContent: String(comparisonResult.data.content),
            items: Array.isArray(comparisonResult.data?.items) ? comparisonResult.data.items : undefined,
          });
          const summary = typeof comparisonResult.data?.summary === 'string'
            ? comparisonResult.data.summary
            : 'Deep comparison report built from the latest multi-company research set.';
          const safeTitle = sector.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          const saved = await saveReport(content, `${safeTitle}-research-report`, undefined, {
            reportKind: 'research',
            summary,
          });
          return {
            success: true,
            data: { content, ...saved, downloadUrl: buildReportDownloadUrl(saved) },
            message: `Saved research comparison report for "${sector}" to ${saved.filePath}`,
          };
        }

        const companyProbe = !timeBudgetExceeded() && shouldTrySingleCompanyDeepResearch(sector)
          ? await resolveSymbolFromQuery(stockService, sector)
          : { ok: false as const };
        if (companyProbe.ok && companyProbe.symbol) {
          const stockResult = await executeTool(
            'generate_stock_report',
            { symbol: sector, range: args.range || "5y", skipSave: true },
            stockService,
            options
          );
          if (!stockResult.success || !stockResult.data?.content || !stockResult.data?.symbol) {
            return stockResult.success
              ? { success: false, error: 'Deep company report could not be constructed.' }
              : stockResult;
          }
          const generatedAt = new Date().toISOString();
          const content = buildDeepStockReport({
            query: sector,
            symbol: String(stockResult.data.symbol),
            generatedAt,
            baseContent: String(stockResult.data.content),
          });
          const summary = typeof stockResult.data?.decisionSnapshot?.summary === 'string'
            ? stockResult.data.decisionSnapshot.summary
            : typeof stockResult.data?.summary === 'string'
              ? stockResult.data.summary
              : 'Deep company report built from the latest single-stock research set.';
          const safeTitle = sector.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          const saved = await saveReport(content, `${safeTitle}-research-report`, undefined, {
            reportKind: 'research',
            summary,
          });
          return {
            success: true,
            data: { content, ...saved, downloadUrl: buildReportDownloadUrl(saved) },
            message: `Saved research company report for "${sector}" to ${saved.filePath}`,
          };
        }

        // ── Phase 1: LLM identifies initial broad candidate list (with fallback) ──
        const initialCandidates = await resolveSectorTickers(
          resolverSector,
          initialCount,
          hasReportLLMBudget(deadlineAt) ? options?.llmFill : undefined,
          stockService
        );

        if (initialCandidates.length === 0) {
          const reason = `Could not identify verified listed companies for "${sector}" using the configured resolver and market-data providers.`;
          const content = buildUnavailableResearchContent(sector, reason);
          const safeTitle = sector.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'research';
          const saved = await saveReport(content, `${safeTitle}-research-report`, undefined, {
            reportKind: 'research',
            summary: 'No verified company universe was available; wait for verified inputs.',
          });
          return {
            success: true,
            data: { content, ...saved, downloadUrl: buildReportDownloadUrl(saved) },
            message: `Saved unavailable-data research report for "${sector}" to ${saved.filePath}`,
          };
        }

        // Vercel/local priority: lock a saveable universe and fetch market data
        // before any optional ecosystem/refinement LLM work.
        const universe = initialCandidates.slice(0, finalCount);
        const updateContext = await prepareReportUpdateContext(args, {
          kind: 'research',
          query: String(args.updateQuery || sector),
          symbols: universe,
        });
        let dependencyAnalysis: string | undefined;
        let ecosystemDiagram: string | undefined;
        let refinementNotes: string | undefined;
        let companySnapshots: Record<string, string> | undefined;

        // ── Phase 2: Fetch full comparison data for the locked universe ──────────
        const notes: string[] = [
          `Universe refined through research analysis (${DEEP_RESEARCH_DEPTH} pass${DEEP_RESEARCH_DEPTH > 1 ? 'es' : ''}) for: "${sector}"`,
          `Initial candidates: ${initialCandidates.join(', ')}`,
          `Refined universe: ${universe.join(', ')}`,
          ...updateContext.notes,
          ...timeNotes,
        ];
        if (resolverSector !== sector) {
          notes.push(`Resolved search theme: "${resolverSector}".`);
        }
        const sourceMap: Record<string, Record<string, string>> = {};
        const watchlist = await getDefaultWatchlist().catch(() => null);
        const portfolioProfile = watchlist?.profile;
        const fetchExtendedData = shouldFetchExtendedReportData(universe.length);
        if (!fetchExtendedData) {
          notes.push('Large-report Vercel mode: prioritized core decision inputs and cached optional sections to stay within free-tier limits.');
        }
        const minimumCoreSymbols = new Set(universe.slice(0, Math.min(2, universe.length)));
        let rateLimitHit = false;
        const isRateLimit = (message: string) => isRateLimitError(message);
        const safeFetch = async <T>(
          symbol: string,
          cache: SymbolCache,
          label: string,
          key: string,
          request: () => Promise<T>,
          allowRequest = true,
          allowNearDeadline = false,
          priority: ReportWorkPriority = 'critical'
        ) => {
          const cachedValue = getCachedValue(cache, key);
          if (cachedValue !== null) {
            if (cachedValue && typeof cachedValue === 'object') {
              const sourceValue = '__source' in cachedValue
                ? String((cachedValue as any).__source)
                : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
            }
            return cachedValue as T;
          }
          if (rateLimitHit || !allowRequest) return undefined as T;
          if (allowNearDeadline) {
            pushDeadlineNote(notes, deadlineAt);
          } else if (pushDeadlineNote(notes, deadlineAt)) {
            return undefined as T;
          }
          try {
            const result = await withReportTaskTimeout(request(), priority, deadlineAt);
            if (result && typeof result === 'object') {
              const sourceValue = '__source' in result ? String((result as any).__source) : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
              setCachedValue(cache, key, result, { provider: sourceValue });
            } else {
              setCachedValue(cache, key, result);
            }
            return result;
          } catch (error: any) {
            const message = error?.message || 'Unavailable';
            if (isRateLimit(message)) {
              rateLimitHit = true;
              const providerLabel = detectRateLimitProvider(message);
              notes.push(`${providerLabel} rate limit reached; remaining sections skipped.`);
              return cachedValue !== null ? (cachedValue as T) : (undefined as T);
            }
            if (!isSuppressedProviderError(message)) {
              notes.push(`${label}: ${message}`);
            }
            if (cachedValue && typeof cachedValue === 'object') {
              const sourceValue = '__source' in cachedValue
                ? String((cachedValue as any).__source)
                : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
            }
            return cachedValue !== null ? (cachedValue as T) : (undefined as T);
          }
        };
        const buildBasicFinancialsFallbackDeep = (overview: any) => {
          if (!overview) return undefined;
          const revenue = Number(overview.revenueTTM);
          const grossProfit = Number(overview.grossProfitTTM);
          const grossMarginTTM =
            Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(grossProfit)
              ? grossProfit / revenue
              : null;
          return {
            symbol: overview.symbol,
            metric: {
              peBasicExclExtraTTM: overview.peRatio,
              epsTTM: overview.eps,
              revenueGrowthTTM: overview.quarterlyRevenueGrowth,
              epsGrowthTTM: overview.quarterlyEarningsGrowth,
              grossMarginTTM,
              operatingMarginTTM: overview.operatingMargin,
              roeTTM: overview.returnOnEquity,
              revenuePerShareTTM: overview.revenuePerShare,
            },
            series: {},
          };
        };

        type RawDeepSectorItem = {
          symbol: string;
          cache: SymbolCache;
          price: any;
          overview: any;
          basicFinancials: any;
          priceHistory: any;
          incomeStatement: any;
          balanceSheet: any;
          cashFlow: any;
          analystRatings: any;
          insiderTrading: any;
          priceTargets: any;
          peers: any;
          newsSentiment: any;
          companyNews: any;
          secFinancialFacts: any;
        };
        const rawItems = await mapWithConcurrency<string, RawDeepSectorItem>(
          universe,
          DATA_FETCH_CONCURRENCY,
          async (symbol) => {
            const forceCoreFetch = minimumCoreSymbols.has(symbol);
            if (timeBudgetExceeded() && !forceCoreFetch) {
              noteTimeBudget();
              return {
                symbol,
                cache: {},
                price: undefined,
                overview: undefined,
                basicFinancials: undefined,
                priceHistory: undefined,
                incomeStatement: undefined,
                balanceSheet: undefined,
                cashFlow: undefined,
                analystRatings: undefined,
                insiderTrading: undefined,
                priceTargets: undefined,
                peers: undefined,
                newsSentiment: undefined,
                companyNews: undefined,
                secFinancialFacts: undefined,
              };
            }
            const cache = await loadSymbolCache(symbol);
            const companyCount = universe.length;
            const allowCritical = forceCoreFetch || hasReportWorkBudget(deadlineAt, 'critical', companyCount);
            const price = await safeFetch(symbol, cache, 'Price', 'price', () => stockService.getStockPrice(symbol), allowCritical, forceCoreFetch, 'critical');
            const overview = await safeFetch(symbol, cache, 'Company overview', 'overview', () => stockService.getCompanyOverview(symbol), allowCritical, forceCoreFetch, 'critical');
            const basicFinancials = await safeFetch(symbol, cache, 'Basic financials', 'basicFinancials', () => stockService.getBasicFinancials(symbol), allowCritical, forceCoreFetch, 'critical');
            const priceHistory = await safeFetch(symbol, cache, 'Price history', `priceHistory:${range}`, () => stockService.getPriceHistory(symbol, range), allowCritical, forceCoreFetch, 'critical');
            const incomeStatement = await safeFetch(symbol, cache, 'Income statement', 'incomeStatement', () => stockService.getIncomeStatement(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'high', companyCount), false, 'high');
            const balanceSheet = await safeFetch(symbol, cache, 'Balance sheet', 'balanceSheet', () => stockService.getBalanceSheet(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'high', companyCount), false, 'high');
            const cashFlow = await safeFetch(symbol, cache, 'Cash flow', 'cashFlow', () => stockService.getCashFlow(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'high', companyCount), false, 'high');
            const analystRatings = await safeFetch(symbol, cache, 'Analyst ratings', 'analystRatings', () => stockService.getAnalystRatings(symbol), hasReportWorkBudget(deadlineAt, 'high', companyCount), false, 'high');
            const insiderTrading = await safeFetch(symbol, cache, 'Insider trading', 'insiderTrading', () => stockService.getInsiderTrading(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'optional', companyCount), false, 'optional');
            const priceTargets = await safeFetch(symbol, cache, 'Price targets', 'priceTargets', () => stockService.getPriceTargets(symbol), hasReportWorkBudget(deadlineAt, 'high', companyCount), false, 'high');
            const peers = await safeFetch(symbol, cache, 'Peers', 'peers', () => stockService.getPeers(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'optional', companyCount), false, 'optional');
            const newsSentiment = await safeFetch(symbol, cache, 'News sentiment', 'newsSentiment', () => stockService.getNewsSentiment(symbol), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'optional', companyCount), false, 'optional');
            const companyNews = await safeFetch(symbol, cache, 'Company news', 'companyNews', () => stockService.getCompanyNews(symbol, 14), fetchExtendedData && hasReportWorkBudget(deadlineAt, 'optional', companyCount), false, 'optional');
            const shouldUseSecFallback = shouldFetchSecFinancialFallback({ basicFinancials, incomeStatement, balanceSheet, cashFlow });
            const secFinancialFacts = shouldUseSecFallback
              ? await safeFetch(
                  symbol,
                  cache,
                  'SEC companyfacts',
                  'secFinancialFacts',
                  () => new SecCompanyFactsService().getNormalizedFinancialFacts(symbol),
                  forceCoreFetch || hasReportWorkBudget(deadlineAt, 'high', companyCount),
                  forceCoreFetch,
                  'high'
                )
              : undefined;
            return {
              symbol,
              cache,
              price,
              overview,
              basicFinancials,
              priceHistory,
              incomeStatement,
              balanceSheet,
              cashFlow,
              analystRatings,
              insiderTrading,
              priceTargets,
              peers,
              newsSentiment,
              companyNews,
              secFinancialFacts,
            };
          },
          () => !timeBudgetExceeded(),
          Math.min(2, universe.length)
        );

        const items: any[] = [];
        for (const item of rawItems) {
          const { symbol } = item;
          const { overview, notes: overviewNotes } = sanitizeMarketScaledOverview(item.overview, item.price, item.priceHistory);
          notes.push(...overviewNotes.map((note) => `${symbol}: ${note}`));
          const secFallbacks = buildSecFinancialFallbacks(symbol, item.secFinancialFacts, item.price);
          const overviewFinancials = overview ? buildBasicFinancialsFallbackDeep(overview) : undefined;
          const basicFinancials = fillMissingFields(fillMissingFields(item.basicFinancials, overviewFinancials), secFallbacks.basicFinancials);
          const incomeStatement = hasStatementReports(item.incomeStatement) ? item.incomeStatement : secFallbacks.incomeStatement;
          const balanceSheet = hasStatementReports(item.balanceSheet) ? item.balanceSheet : secFallbacks.balanceSheet;
          const cashFlow = hasStatementReports(item.cashFlow) ? item.cashFlow : secFallbacks.cashFlow;
          const watchlistItem = watchlist?.items.find((entry) => entry.symbol === symbol.toUpperCase());
          const previousDecision = await getLatestDecision(symbol).catch(() => null);
          const trustSummary = buildTrustSummaryFromCache(item.cache, [
            { key: 'price', label: 'Price', data: item.price },
            { key: 'overview', label: 'Company overview', data: item.overview },
            { key: 'basicFinancials', label: 'Basic financials', data: item.basicFinancials },
            { key: `priceHistory:${range}`, label: 'Price history', data: item.priceHistory },
            { key: 'incomeStatement', label: 'Income statement', data: item.incomeStatement },
            { key: 'balanceSheet', label: 'Balance sheet', data: item.balanceSheet },
            { key: 'cashFlow', label: 'Cash flow', data: item.cashFlow },
            { key: 'analystRatings', label: 'Analyst ratings', data: item.analystRatings },
            { key: 'insiderTrading', label: 'Insider trading', data: item.insiderTrading },
            { key: 'priceTargets', label: 'Price targets', data: item.priceTargets },
            { key: 'peers', label: 'Peers', data: item.peers },
            { key: 'newsSentiment', label: 'News sentiment', data: item.newsSentiment },
            { key: 'companyNews', label: 'Company news', data: item.companyNews },
            { key: 'secFinancialFacts', label: 'SEC companyfacts', data: item.secFinancialFacts },
          ]);
          const decisionSnapshot = buildDecisionSnapshot({
            symbol,
            price: item.price,
            priceHistory: item.priceHistory,
            companyOverview: overview,
            basicFinancials,
            incomeStatement,
            balanceSheet,
            cashFlow,
            analystRatings: item.analystRatings,
            priceTargets: item.priceTargets,
            insiderTrading: item.insiderTrading,
            newsSentiment: item.newsSentiment,
            companyNews: item.companyNews,
            trust: trustSummary,
            position: watchlistItem,
            portfolioProfile,
            previousDecision,
          });
          items.push({
            symbol,
            price: item.price,
            overview,
            basicFinancials,
            priceHistory: item.priceHistory,
            incomeStatement,
            balanceSheet,
            cashFlow,
            analystRatings: item.analystRatings,
            insiderTrading: item.insiderTrading,
            priceTargets: item.priceTargets,
            peers: item.peers,
            newsSentiment: item.newsSentiment,
            companyNews: item.companyNews,
            dataTrust: trustSummary,
            decisionSnapshot,
          });
          await saveSymbolCache(symbol, item.cache);
        }

        if (items.length === 0) {
          return { success: false, error: 'Could not collect enough data before the runtime deadline to build a research report.' };
        }

        // Optional ecosystem analysis. This runs only after a data-backed report
        // body is already possible; Vercel may stop after zero or one pass, while
        // local runs can deepen it via DEEP_RESEARCH_DEPTH.
        if (options?.llmFill && items.length > 0) {
          const ecosystemData = items.map((item) => ({
            symbol: item.symbol,
            overview: item.overview,
            news: item.newsSentiment,
            peers: item.peers,
          }));
          let previousPass: DeepSectorPassContext | undefined;
          for (let passIndex = 0; passIndex < DEEP_RESEARCH_DEPTH; passIndex++) {
            if (!hasReportLLMBudget(deadlineAt) || !hasReportWorkBudget(deadlineAt, 'optional', items.length)) break;
            try {
              const depPrompt = buildDeepSectorDependencyPrompt(resolverSector, items.length, ecosystemData, previousPass);
              const raw = await withReportTaskTimeout(options.llmFill(depPrompt), 'llm', deadlineAt);
              const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
              const parsed = JSON.parse(cleaned);
              if (!parsed || typeof parsed !== 'object') break;
              if (typeof parsed.dependencyAnalysis === 'string') {
                dependencyAnalysis = parsed.dependencyAnalysis;
              }
              if (typeof parsed.ecosystemDiagram === 'string') {
                ecosystemDiagram = parsed.ecosystemDiagram;
              }
              if (typeof parsed.refinementNotes === 'string') {
                refinementNotes = parsed.refinementNotes;
              }
              if (parsed.companySnapshots && typeof parsed.companySnapshots === 'object' && !Array.isArray(parsed.companySnapshots)) {
                companySnapshots = {};
                for (const [k, v] of Object.entries(parsed.companySnapshots)) {
                  if (typeof v === 'string') companySnapshots[k.replace(/[^A-Z0-9.]/gi, '').toUpperCase()] = v;
                }
              }
              previousPass = {
                dependencyAnalysis,
                ecosystemDiagram,
                refinementNotes,
                companySnapshots,
                universe,
                passIndex,
              };
            } catch {
              // Optional ecosystem analysis failed or hit a model limit; keep the data-backed report.
              break;
            }
          }
        }

        // LLM batch moat analysis for the refined research universe (single call)
        if (options?.llmFill && items.length > 0 && hasReportLLMBudget(deadlineAt)) {
          try {
            const moatPrompt = buildBatchMoatAnalysisPrompt(
              items.map((item) => ({ symbol: item.symbol, overview: item.overview, basicFinancials: item.basicFinancials }))
            );
            const raw = await withReportTaskTimeout(options.llmFill(moatPrompt), 'llm', deadlineAt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              for (const sym of Object.keys(parsed)) {
                const entry = parseMoatEntry(parsed[sym]);
                if (entry) {
                  const ticker = cleanTicker(sym);
                  const target = items.find((it) => it.symbol === ticker);
                  if (target) target.moatAnalysis = entry;
                }
              }
            }
          } catch {
            // LLM unavailable or invalid JSON — proceed without moat analysis
          }
        }

        // LLM position rationale — clear 1-2 sentence "Why" for the guidance table
        if (options?.llmFill && items.length > 0 && hasReportLLMBudget(deadlineAt)) {
          try {
            const rationalePrompt = buildBatchPositionRationalePrompt(
              items.map((item) => {
                const ds = item.decisionSnapshot;
                return {
                  symbol: item.symbol,
                  name: item.overview?.name || item.symbol,
                  action: ds?.action ?? 'Wait',
                  confidence: ds?.confidence ?? 'Medium',
                  overallScore: ds?.overallScore ?? null,
                  qualityScore: ds?.qualityScore ?? null,
                  valuationScore: ds?.valuationScore ?? null,
                  technicalScore: ds?.technicalScore ?? null,
                  analystConsensusScore: ds?.analystConsensusScore ?? null,
                  insiderScore: ds?.insiderScore ?? null,
                  whyNow: ds?.whyNow ?? [],
                  whyNot: ds?.whyNot ?? [],
                  missingInputs: ds?.missingInputs ?? [],
                  overview: item.overview,
                  basicFinancials: item.basicFinancials,
                  priceTargets: item.priceTargets,
                  analystRatings: item.analystRatings,
                  price: item.price,
                };
              })
            );
            const raw = await withReportTaskTimeout(options.llmFill(rationalePrompt), 'llm', deadlineAt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              for (const sym of Object.keys(parsed)) {
                const rationale = parsePositionRationaleEntry(parsed[sym]);
                if (!rationale) continue;
                const ticker = cleanTicker(sym);
                const target = items.find((it) => it.symbol === ticker);
                if (target?.decisionSnapshot) {
                  target.decisionSnapshot = { ...target.decisionSnapshot, summary: rationale };
                }
              }
            }
          } catch {
            // Proceed without LLM rationale — structured summary is the fallback
          }
        }

        // LLM investment conclusion — rich narrative, best-effort
        let llmConclusionDeep: string | undefined;
        if (options?.llmFill && items.length > 0 && hasReportLLMBudget(deadlineAt)) {
          try {
            const conclusionPrompt = buildComparisonConclusionPrompt(
              items,
              'research',
              sector,
              items.map((item) => ({
                symbol: item.symbol,
                score: getComparisonPromptScore(item),
              }))
            );
            llmConclusionDeep = (await withReportTaskTimeout(options.llmFill(conclusionPrompt), 'llm', deadlineAt)).trim();
          } catch {
            // LLM unavailable — use structured fallback
          }
        }

        const generatedAt = new Date().toISOString();
        const runMetadata = buildReportRunMetadata({
          kind: 'research',
          query: String(args.updateQuery || sector),
          symbols: universe,
          range,
          generatedAt,
          updatedFrom: updateContext.previous,
          notes,
          coverage: items.flatMap((item) => [
            coverageEntry(item.symbol, 'price', 'Price', item.price, 'critical'),
            coverageEntry(item.symbol, 'overview', 'Company overview', item.overview, 'critical'),
            coverageEntry(item.symbol, 'basicFinancials', 'Basic financials', item.basicFinancials, 'critical'),
            coverageEntry(item.symbol, `priceHistory:${range}`, 'Price history', item.priceHistory, 'critical'),
            coverageEntry(item.symbol, 'incomeStatement', 'Income statement', item.incomeStatement, 'high'),
            coverageEntry(item.symbol, 'balanceSheet', 'Balance sheet', item.balanceSheet, 'high'),
            coverageEntry(item.symbol, 'cashFlow', 'Cash flow', item.cashFlow, 'high'),
            coverageEntry(item.symbol, 'analystRatings', 'Analyst ratings', item.analystRatings, 'high'),
            coverageEntry(item.symbol, 'insiderTrading', 'Insider trading', item.insiderTrading, 'optional'),
            coverageEntry(item.symbol, 'priceTargets', 'Price targets', item.priceTargets, 'high'),
            coverageEntry(item.symbol, 'peers', 'Peers', item.peers, 'optional'),
            coverageEntry(item.symbol, 'newsSentiment', 'News sentiment', item.newsSentiment, 'optional'),
            coverageEntry(item.symbol, 'companyNews', 'Company news', item.companyNews, 'optional'),
          ]),
        });
        const content = buildDeepSectorReport({
          sectorQuery: sector,
          selectedBy: 'llm',
          generatedAt,
          range,
          universe,
          items,
          notes,
          sources: sourceMap,
          initialCandidates,
          dependencyAnalysis,
          ecosystemDiagram,
          refinementNotes,
          companySnapshots,
          llmConclusion: llmConclusionDeep,
        });
        const summary = buildUniverseSummary(items);
        const safeTitle = sector.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const saved = await saveReport(content, `${safeTitle}-research-report`, undefined, {
          reportKind: 'research',
          summary,
          runMetadata,
        });
        return {
          success: true,
          data: { content, ...saved, downloadUrl: buildReportDownloadUrl(saved) },
          message: `Saved research report for "${sector}" to ${saved.filePath}`,
        };
      }
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
