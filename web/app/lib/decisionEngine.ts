/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Multi-factor equity decision engine.
 *
 * Design based on research synthesis of:
 * - Seeking Alpha Quant Ratings (5-pillar model: profitability, growth, value, momentum, revisions)
 * - Piotroski F-Score (9-signal financial quality framework)
 * - Academic insider-trading research (Seyhun, 2iq Research) — market-cap normalized, cluster-weighted
 * - S&P Global / Refinitiv consensus studies — analyst consensus as confirmatory signal
 *
 * Architecture:
 * 1. Each PILLAR computes a 0–100 score AND a human-readable detail string showing the real data.
 * 2. Pillars are combined via explicit weighted average (weights documented).
 * 3. The summary shows every pillar's score + data so the user sees exactly HOW the decision was made.
 * 4. Missing data reduces CONFIDENCE only, never the score itself.
 */
import type {
  ActionLabel,
  ConfidenceLabel,
  DataTrustSummary,
  DecisionAction,
  DecisionSnapshot,
  PortfolioProfile,
  WatchlistPositionMeta,
} from './investmentTypes';
import type { DecisionJournalRecord } from './investmentTypes';

type DecisionInput = {
  symbol: string;
  price?: any;
  priceHistory?: { prices?: Array<{ date: string; close: string | number }> };
  companyOverview?: any;
  basicFinancials?: any;
  incomeStatement?: any;
  balanceSheet?: any;
  cashFlow?: any;
  analystRatings?: any;
  priceTargets?: any;
  insiderTrading?: any;
  newsSentiment?: any;
  companyNews?: { articles?: any[] };
  trust?: DataTrustSummary;
  position?: Partial<WatchlistPositionMeta>;
  portfolioProfile?: PortfolioProfile;
  previousDecision?: DecisionJournalRecord | null;
};

// ─── Utility helpers ────────────────────────────────────────────────────────

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePercent(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return Math.abs(parsed) <= 2 ? parsed * 100 : parsed;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
}

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// ─── Pillar result type ─────────────────────────────────────────────────────
type PillarResult = {
  score: number;       // 0–100
  detail: string;      // human-readable: "72 — 56% gross margin, 30% op margin, 35% ROE"
  metrics: string[];   // individual metric citations for whyNow/whyNot
};

// ─── PILLAR 1: Profitability & Quality (weight 25%) ─────────────────────────
// Inspired by Piotroski + Seeking Alpha profitability pillar.
// Scores each metric on 0–100, averages available ones.
function scoreProfitability(input: DecisionInput): PillarResult | null {
  const grossMargin = normalizePercent(input.basicFinancials?.metric?.grossMarginTTM ?? input.companyOverview?.profitMargin);
  const operatingMargin = normalizePercent(input.basicFinancials?.metric?.operatingMarginTTM ?? input.companyOverview?.operatingMargin);
  const roe = normalizePercent(input.basicFinancials?.metric?.roeTTM ?? input.companyOverview?.returnOnEquity);
  const roa = normalizePercent(input.basicFinancials?.metric?.roaTTM ?? input.companyOverview?.returnOnAssets);
  const netMargin = normalizePercent(input.basicFinancials?.metric?.netProfitMarginTTM ?? input.companyOverview?.profitMargin);

  // Score each metric: higher margin / return = higher score
  // Gross margin: 0% → 0, 60%+ → 100 (linear)
  // Operating margin: -10% → 0, 35%+ → 100
  // ROE: 0% → 0, 30%+ → 100
  // ROA: 0% → 0, 15%+ → 100
  const components: Array<{ score: number; label: string }> = [];
  if (grossMargin !== null) {
    components.push({ score: clamp((grossMargin / 60) * 100), label: `${grossMargin.toFixed(0)}% gross margin` });
  }
  if (operatingMargin !== null) {
    components.push({ score: clamp(((operatingMargin + 10) / 45) * 100), label: `${operatingMargin.toFixed(0)}% op margin` });
  }
  if (roe !== null) {
    components.push({ score: clamp((roe / 30) * 100), label: `${roe.toFixed(0)}% ROE` });
  }
  if (roa !== null) {
    components.push({ score: clamp((roa / 15) * 100), label: `${roa.toFixed(0)}% ROA` });
  }
  if (netMargin !== null && grossMargin === null) {
    // Only use net margin if gross margin isn't available (avoid double-counting)
    components.push({ score: clamp((netMargin / 25) * 100), label: `${netMargin.toFixed(0)}% net margin` });
  }

  if (components.length === 0) return null;
  const score = components.reduce((s, c) => s + c.score, 0) / components.length;
  const detail = `${score.toFixed(0)} — ${components.map(c => c.label).join(', ')}`;
  return { score, detail, metrics: components.map(c => c.label) };
}

// ─── PILLAR 2: Growth (weight 15%) ──────────────────────────────────────────
// Revenue growth + EPS growth. Forward-looking.
function scoreGrowth(input: DecisionInput): PillarResult | null {
  const revenueGrowth = normalizePercent(input.basicFinancials?.metric?.revenueGrowthTTM ?? input.companyOverview?.quarterlyRevenueGrowth);
  const epsGrowth = normalizePercent(input.basicFinancials?.metric?.epsGrowthTTM ?? input.basicFinancials?.metric?.epsGrowth5Y ?? input.companyOverview?.quarterlyEarningsGrowth);

  // Revenue growth: -20% → 0, +30%+ → 100 (center at 50 = ~5% growth)
  // EPS growth: same scale
  const components: Array<{ score: number; label: string }> = [];
  if (revenueGrowth !== null) {
    components.push({ score: clamp(((revenueGrowth + 20) / 50) * 100), label: `${fmtPct(revenueGrowth)} rev growth` });
  }
  if (epsGrowth !== null) {
    components.push({ score: clamp(((epsGrowth + 20) / 50) * 100), label: `${fmtPct(epsGrowth)} EPS growth` });
  }

  if (components.length === 0) return null;
  const score = components.reduce((s, c) => s + c.score, 0) / components.length;
  const detail = `${score.toFixed(0)} — ${components.map(c => c.label).join(', ')}`;
  return { score, detail, metrics: components.map(c => c.label) };
}

// ─── PILLAR 3: Valuation (weight 20%) ───────────────────────────────────────
// P/E relative scoring + analyst target upside.
function scoreValuation(input: DecisionInput, price: number | null): PillarResult | null {
  const pe = toNumber(input.companyOverview?.peRatio ?? input.basicFinancials?.metric?.peBasicExclExtraTTM);
  const forwardPE = toNumber(input.companyOverview?.forwardPE ?? input.basicFinancials?.metric?.peNormalizedAnnual);
  const targetMean = toNumber(
    input.priceTargets?.targetMean
    ?? (input.analystRatings?.analystTargetPrice !== 'N/A' ? input.analystRatings?.analystTargetPrice : null)
    ?? input.companyOverview?.analystTargetPrice
  );
  const targetUpside = price !== null && targetMean !== null && price !== 0
    ? ((targetMean - price) / price) * 100
    : null;

  // P/E: lower = better value. P/E 5 → 100, P/E 25 → ~64, P/E 60+ → 0
  // Linear scale centered around market average (~20-25 P/E = fair value)
  // Target upside: -20% → 0, 0% → 40, +20% → 80, +40%+ → 100
  const components: Array<{ score: number; label: string }> = [];
  const activePE = forwardPE ?? pe;
  if (activePE !== null && activePE > 0) {
    const peScore = clamp(100 - ((activePE - 5) / 55) * 100);
    const peLabel = forwardPE !== null ? `fwd P/E ${forwardPE.toFixed(1)}` : `P/E ${pe!.toFixed(1)}`;
    components.push({ score: peScore, label: peLabel });
  }
  if (targetUpside !== null) {
    const upsideScore = clamp(40 + targetUpside * 2);
    components.push({ score: upsideScore, label: `${targetUpside.toFixed(1)}% target upside` });
  }

  if (components.length === 0) return null;
  const score = components.reduce((s, c) => s + c.score, 0) / components.length;
  const detail = `${score.toFixed(0)} — ${components.map(c => c.label).join(', ')}`;
  return { score, detail, metrics: components.map(c => c.label) };
}

// ─── PILLAR 4: Momentum (weight 15%) ────────────────────────────────────────
// Price return over observation period.
function scoreMomentum(input: DecisionInput): PillarResult | null {
  const prices = input.priceHistory?.prices;
  if (!prices || prices.length < 2) return null;
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const first = toNumber(sorted[0].close);
  const last = toNumber(sorted[sorted.length - 1].close);
  if (first === null || last === null || first === 0) return null;

  const returnPct = ((last - first) / first) * 100;
  // Map: -30% → 0, 0% → 50, +30% → 100
  const score = clamp(50 + (returnPct / 30) * 50);
  const trendLabel = returnPct >= 5 ? 'uptrend' : returnPct <= -5 ? 'downtrend' : 'flat';
  const detail = `${score.toFixed(0)} — ${fmtPct(returnPct)} price change (${trendLabel})`;
  return { score, detail, metrics: [`${fmtPct(returnPct)} price change`] };
}

// ─── PILLAR 5: Analyst Consensus (weight 15%) ───────────────────────────────
// Weighted sentiment from strongBuy/buy/hold/sell/strongSell counts.
// Research: analyst consensus aggregation reduces noise; upgrades/downgrades are predictive.
// Data sources: Finnhub analystRatings.strongBuy, AV companyOverview.analystRatingStrongBuy,
// FMP analystRecommendations — we check all paths.
function scoreAnalystConsensus(input: DecisionInput): PillarResult | null {
  const ratings = input.analystRatings;
  const overview = input.companyOverview;

  // Try multiple field-name conventions across providers
  const sb = toNumber(ratings?.strongBuy) ?? toNumber(overview?.analystRatingStrongBuy);
  const b = toNumber(ratings?.buy) ?? toNumber(overview?.analystRatingBuy);
  const h = toNumber(ratings?.hold) ?? toNumber(overview?.analystRatingHold);
  const s = toNumber(ratings?.sell) ?? toNumber(overview?.analystRatingSell);
  const ss = toNumber(ratings?.strongSell) ?? toNumber(overview?.analystRatingStrongSell);
  const counts = [sb, b, h, s, ss].filter(v => v !== null) as number[];
  const total = counts.reduce((a, c) => a + c, 0);
  if (total === 0) return null;

  // Weighted average: strongBuy=2, buy=1, hold=0, sell=-1, strongSell=-2
  // Range: -2 (all strong sell) to +2 (all strong buy)
  const weighted = ((sb ?? 0) * 2 + (b ?? 0) * 1 + (h ?? 0) * 0 + (s ?? 0) * -1 + (ss ?? 0) * -2) / total;
  // Map -2..+2 → 0..100
  const score = clamp((weighted + 2) * 25);

  const buyTotal = (sb ?? 0) + (b ?? 0);
  const sellTotal = (s ?? 0) + (ss ?? 0);
  const holdTotal = h ?? 0;
  const label = `${buyTotal} buy, ${holdTotal} hold, ${sellTotal} sell (${total} analysts)`;
  const detail = `${score.toFixed(0)} — ${label}`;
  return { score, detail, metrics: [label] };
}

// ─── PILLAR 6: Insider Activity (weight 5%) ─────────────────────────────────
// Research: insider buying clusters are predictive, especially in smaller companies.
// ALL normalization is by market cap — no fixed dollar thresholds.
// Without market cap, this pillar returns null (we can't evaluate significance).
function scoreInsiderActivity(input: DecisionInput): PillarResult | null {
  const txns = input.insiderTrading?.recentTransactions;
  if (!Array.isArray(txns) || txns.length === 0) return null;
  const marketCap = toNumber(input.companyOverview?.marketCapitalization ?? input.companyOverview?.MarketCapitalization);
  // Without market cap we cannot normalize — return null rather than guess
  if (marketCap === null || marketCap <= 0) return null;

  let netBuyValue = 0;
  let buyCount = 0;
  let sellCount = 0;
  for (const t of txns) {
    const val = toNumber(t.totalValue);
    if (val === null || val === 0) continue;
    if (t.transactionType === 'Purchase') {
      netBuyValue += val;
      buyCount++;
    } else if (t.transactionType === 'Sale') {
      netBuyValue -= val;
      sellCount++;
    }
  }
  if (buyCount === 0 && sellCount === 0) return null;

  // Normalize: net buying as basis points of market cap
  // Academic research: 1bp (0.01%) of net insider buying is a meaningful signal
  const bps = (netBuyValue / marketCap) * 10000;
  // Map: -10bps → 0, 0bps → 50, +10bps → 100
  const score = clamp(50 + bps * 5);

  const direction = netBuyValue >= 0 ? 'net buying' : 'net selling';
  const pctOfMktCap = (Math.abs(netBuyValue) / marketCap) * 100;
  const label = `insider ${direction} ${fmtMoney(Math.abs(netBuyValue))} (${pctOfMktCap.toFixed(4)}% of mkt cap, ${buyCount} buys, ${sellCount} sells)`;
  const detail = `${score.toFixed(0)} — ${label}`;
  return { score, detail, metrics: [label] };
}

// ─── PILLAR 7: Financial Health (weight 5%) ─────────────────────────────────
// Inspired by Piotroski leverage/liquidity signals.
// Uses balance sheet data: debt-to-equity, positive operating cash flow.
function scoreFinancialHealth(input: DecisionInput): PillarResult | null {
  const bs = input.balanceSheet;
  const cf = input.cashFlow;
  const overview = input.companyOverview;
  const bfMetric = input.basicFinancials?.metric;

  const components: Array<{ score: number; label: string }> = [];

  // Debt-to-equity: from Finnhub metric or computed from balance sheet
  const debtToEquity = toNumber(bfMetric?.totalDebtToEquityQuarterly ?? bfMetric?.longTermDebtToEquityQuarterly);
  if (debtToEquity !== null) {
    // D/E 0 → 100, D/E 1.0 → 50, D/E 3+ → 0
    const deScore = clamp(100 - (debtToEquity / 3) * 100);
    components.push({ score: deScore, label: `${debtToEquity.toFixed(2)}x debt/equity` });
  } else {
    // Try computing from balance sheet reports
    const reports = Array.isArray(bs?.annualReports) ? bs.annualReports : Array.isArray(bs?.quarterlyReports) ? bs.quarterlyReports : [];
    const latest = reports[0];
    if (latest) {
      const totalDebt = toNumber(latest.longTermDebt) ?? toNumber(latest.totalLiabilities);
      const equity = toNumber(latest.totalShareholderEquity);
      if (totalDebt !== null && equity !== null && equity > 0) {
        const ratio = totalDebt / equity;
        const deScore = clamp(100 - (ratio / 3) * 100);
        components.push({ score: deScore, label: `${ratio.toFixed(2)}x debt/equity` });
      }
    }
  }

  // Current ratio from Finnhub metric
  const currentRatio = toNumber(bfMetric?.currentRatioQuarterly);
  if (currentRatio !== null) {
    // CR 0.5 → 10, 1.5 → 75, 3+ → 100
    const crScore = clamp((currentRatio / 3) * 100);
    components.push({ score: crScore, label: `${currentRatio.toFixed(1)}x current ratio` });
  }

  // Positive operating cash flow (Piotroski signal)
  const cfReports = Array.isArray(cf?.annualReports) ? cf.annualReports : Array.isArray(cf?.quarterlyReports) ? cf.quarterlyReports : [];
  const latestCF = cfReports[0];
  const ocf = toNumber(latestCF?.operatingCashflow);
  if (ocf !== null) {
    components.push({ score: ocf > 0 ? 75 : 20, label: `${ocf > 0 ? 'positive' : 'negative'} operating cash flow (${fmtMoney(ocf)})` });
  }

  // Free cash flow yield (if we have FCF and market cap)
  const fcf = toNumber(latestCF?.freeCashFlow);
  const mktCap = toNumber(overview?.marketCapitalization ?? overview?.MarketCapitalization);
  if (fcf !== null && mktCap !== null && mktCap > 0) {
    const fcfYield = (fcf / mktCap) * 100;
    // Yield: -5% → 0, 0% → 30, 5% → 80, 10%+ → 100
    const fcfScore = clamp(30 + fcfYield * 10);
    components.push({ score: fcfScore, label: `${fcfYield.toFixed(1)}% FCF yield` });
  }

  if (components.length === 0) return null;
  const score = components.reduce((s, c) => s + c.score, 0) / components.length;
  const detail = `${score.toFixed(0)} — ${components.map(c => c.label).join(', ')}`;
  return { score, detail, metrics: components.map(c => c.label) };
}

// ─── Portfolio fit (not a market signal — separate modifier) ────────────────
function computePortfolioFit(input: DecisionInput): { score: number; detail: string } {
  const ownershipStatus = input.position?.ownershipStatus ?? 'watching';
  const currentWeight = input.position?.currentWeight ?? null;
  const targetWeight = input.position?.targetWeight ?? null;
  const maxWeight = input.position?.maxWeight ?? input.portfolioProfile?.maxPositionWeight ?? null;

  if (ownershipStatus === 'owned' && currentWeight !== null && maxWeight !== null && currentWeight > maxWeight) {
    return { score: 20, detail: `over max weight (${currentWeight}% vs max ${maxWeight}%)` };
  }
  if (ownershipStatus === 'owned' && currentWeight !== null && targetWeight !== null) {
    return currentWeight <= targetWeight
      ? { score: 70, detail: `below target (${currentWeight}% vs target ${targetWeight}%)` }
      : { score: 45, detail: `above target (${currentWeight}% vs target ${targetWeight}%)` };
  }
  if (ownershipStatus === 'watching') {
    return { score: 60, detail: 'watching — no active position' };
  }
  return { score: 55, detail: 'position data incomplete' };
}

// ─── Legacy helpers ─────────────────────────────────────────────────────────

function buildPortfolioImpact(args: {
  action: DecisionAction;
  position?: Partial<WatchlistPositionMeta>;
  portfolioProfile?: PortfolioProfile;
}) {
  const { action, position, portfolioProfile } = args;
  const ownership = position?.ownershipStatus || 'watching';
  const currentWeight = position?.currentWeight;
  const targetWeight = position?.targetWeight;
  const maxWeight = position?.maxWeight ?? portfolioProfile?.maxPositionWeight;
  const summaryAction = actionToSummaryLabel(action);

  if (ownership === 'owned') {
    return `Current position ${currentWeight ?? 'n/a'}% vs target ${targetWeight ?? 'n/a'}% and max ${maxWeight ?? 'n/a'}%. Recommended action: ${summaryAction}.`;
  }
  return `No active position recorded. Portfolio guardrail max size ${maxWeight ?? portfolioProfile?.maxPositionWeight ?? 'n/a'}%. Recommended action: ${summaryAction}.`;
}

function actionToLegacyLabel(action: DecisionAction): ActionLabel {
  if (action === 'Initiate' || action === 'Add') return 'Buy';
  if (action === 'Trim') return 'Watch';
  if (action === 'Exit') return 'Sell';
  return action === 'Hold' ? 'Hold' : 'Watch';
}

function actionToSummaryLabel(action: DecisionAction): string {
  if (action === 'Initiate') return 'Start a position';
  if (action === 'Add') return 'Add to the position';
  if (action === 'Hold') return 'Keep holding';
  if (action === 'Trim') return 'Trim the position';
  if (action === 'Exit') return 'Exit the position';
  return 'Wait for a better setup';
}

// ─── MAIN: Build the decision snapshot ──────────────────────────────────────

/**
 * Pillar weights (must sum to 100):
 *
 * | Pillar              | Weight | Rationale                                               |
 * |---------------------|--------|---------------------------------------------------------|
 * | Profitability       |   25%  | Strongest predictor of long-term returns (Piotroski, SA) |
 * | Growth              |   15%  | Revenue/EPS trajectory; forward-looking                 |
 * | Valuation           |   20%  | Price vs fair value; avoids overpaying                  |
 * | Momentum            |   15%  | Price trend confirmation (Fama-French, SA)              |
 * | Analyst Consensus   |   15%  | Aggregate Wall Street view; confirmatory                |
 * | Insider Activity    |    5%  | Confirmatory signal; market-cap normalized (Seyhun)     |
 * | Financial Health    |    5%  | Leverage & liquidity guard (Piotroski)                  |
 */
const PILLAR_WEIGHTS = {
  profitability: 25,
  growth: 15,
  valuation: 20,
  momentum: 15,
  analystConsensus: 15,
  insiderActivity: 5,
  financialHealth: 5,
} as const;

export function buildDecisionSnapshot(input: DecisionInput): DecisionSnapshot {
  const price = toNumber(input.price?.price);

  // ── Compute every pillar ──
  const profitability = scoreProfitability(input);
  const growth = scoreGrowth(input);
  const valuation = scoreValuation(input, price);
  const momentum = scoreMomentum(input);
  const analystConsensus = scoreAnalystConsensus(input);
  const insiderActivity = scoreInsiderActivity(input);
  const financialHealth = scoreFinancialHealth(input);
  const portfolioFit = computePortfolioFit(input);

  // ── Weighted overall score ──
  // Only pillars that returned non-null contribute. Weight is redistributed proportionally.
  const pillars: Array<{ name: string; result: PillarResult | null; weight: number }> = [
    { name: 'Profitability', result: profitability, weight: PILLAR_WEIGHTS.profitability },
    { name: 'Growth', result: growth, weight: PILLAR_WEIGHTS.growth },
    { name: 'Valuation', result: valuation, weight: PILLAR_WEIGHTS.valuation },
    { name: 'Momentum', result: momentum, weight: PILLAR_WEIGHTS.momentum },
    { name: 'Analysts', result: analystConsensus, weight: PILLAR_WEIGHTS.analystConsensus },
    { name: 'Insiders', result: insiderActivity, weight: PILLAR_WEIGHTS.insiderActivity },
    { name: 'Fin. Health', result: financialHealth, weight: PILLAR_WEIGHTS.financialHealth },
  ];

  const activePillars = pillars.filter(p => p.result !== null);
  const totalWeight = activePillars.reduce((s, p) => s + p.weight, 0);
  const overallScore = totalWeight > 0
    ? activePillars.reduce((s, p) => s + p.result!.score * p.weight, 0) / totalWeight
    : null;

  // Legacy sub-scores (for backward compatibility with report generators)
  const qualityScore = profitability?.score ?? null;
  const valuationScore = valuation?.score ?? null;
  const technicalScore = momentum?.score ?? null;

  // ── Freshness & trust ──
  const trust = input.trust;
  const freshness = trust?.criticalFresh
    ? 'fresh'
    : trust?.staleLabels.length
      ? 'stale'
      : 'aging';
  const staleCritical = freshness === 'stale';

  // ── Missing data (affects confidence only) ──
  const missingInputs: string[] = [];
  if (price === null) missingInputs.push('current price');
  if (!profitability) missingInputs.push('profitability metrics');
  if (!growth) missingInputs.push('growth metrics');
  if (!valuation) missingInputs.push('valuation data');
  if (!momentum) missingInputs.push('price history');
  if (!analystConsensus) missingInputs.push('analyst ratings');
  if (!input.trust?.entries.length) missingInputs.push('freshness metadata');

  // ── Determine action ──
  const ownershipStatus = input.position?.ownershipStatus ?? 'watching';
  const currentWeight = input.position?.currentWeight ?? null;
  const targetWeight = input.position?.targetWeight ?? null;
  const maxWeight = input.position?.maxWeight ?? input.portfolioProfile?.maxPositionWeight ?? null;
  const desiredEntryMin = input.position?.desiredEntryMin ?? null;
  const desiredEntryMax = input.position?.desiredEntryMax ?? null;
  const trimAbove = input.position?.trimAbove ?? null;

  let action: DecisionAction = 'Wait';
  if (!staleCritical && overallScore !== null) {
    if (ownershipStatus === 'owned') {
      if (currentWeight !== null && maxWeight !== null && currentWeight > maxWeight && overallScore < 60) {
        action = overallScore < 35 ? 'Exit' : 'Trim';
      } else if (overallScore >= 65 && (targetWeight === null || currentWeight === null || currentWeight < targetWeight)) {
        action = 'Add';
      } else if (overallScore >= 45) {
        action = 'Hold';
      } else if (overallScore < 30) {
        action = 'Trim';
      } else {
        action = 'Wait';
      }
    } else if (overallScore >= 65) {
      action = 'Initiate';
    } else if (overallScore >= 45) {
      action = 'Wait';
    } else {
      action = 'Wait';
    }
  }
  if (staleCritical) action = 'Wait';

  // ── Confidence (separate from score — based on data completeness & freshness) ──
  const pillarCoverage = activePillars.length / pillars.length; // 0..1
  const freshnessModifier = staleCritical ? 0.3 : freshness === 'aging' ? 0.7 : 1.0;
  const confidenceScore = (pillarCoverage * 0.6 + freshnessModifier * 0.4) * 100;
  const confidence: ConfidenceLabel = confidenceScore >= 72 ? 'High' : confidenceScore >= 50 ? 'Medium' : 'Low';

  // ── whyNow / whyNot (built from pillar metrics) ──
  const whyNow: string[] = [];
  const whyNot: string[] = [];

  // Strong/weak pillar contributions
  for (const p of activePillars) {
    if (p.result!.score >= 65) {
      whyNow.push(`${p.name} ${p.result!.detail}.`);
    } else if (p.result!.score < 35) {
      whyNot.push(`${p.name} ${p.result!.detail}.`);
    }
  }

  // Portfolio-specific signals
  if (desiredEntryMin !== null && desiredEntryMax !== null && price !== null) {
    if (price >= desiredEntryMin && price <= desiredEntryMax) {
      whyNow.push(`Price inside preferred entry range $${desiredEntryMin}–${desiredEntryMax}.`);
    } else {
      whyNot.push(`Price outside preferred entry range $${desiredEntryMin}–${desiredEntryMax}.`);
    }
  }
  if (staleCritical) {
    whyNot.push(`Critical data is stale: ${(trust?.staleLabels || []).join(', ')}.`);
  }
  if (ownershipStatus === 'owned' && currentWeight !== null && maxWeight !== null && currentWeight > maxWeight) {
    whyNot.push(`Position ${currentWeight}% exceeds max-weight guardrail ${maxWeight}%.`);
  }

  // ── Build transparent summary: action + score + every pillar's score + data ──
  const pillarSummaryParts = activePillars.map(p =>
    `${p.name} ${p.result!.score.toFixed(0)}/100`
  );
  const pillarLine = pillarSummaryParts.length ? ` [${pillarSummaryParts.join(' · ')}]` : '';
  const scoreTag = overallScore !== null ? ` Score ${overallScore.toFixed(0)}/100.` : '';

  // Lead with the most impactful signal
  const topPro = whyNow[0] || null;
  const topCon = whyNot[0] || null;
  let leadReason = '';
  if (topPro && topCon) {
    leadReason = ` ${topPro} ${topCon}`;
  } else if (topPro) {
    leadReason = ` ${topPro}`;
  } else if (topCon) {
    leadReason = ` ${topCon}`;
  } else if (activePillars.length === 0) {
    leadReason = ' Insufficient data to form a view.';
  }
  const summary = `${actionToSummaryLabel(action)}.${scoreTag}${leadReason}${pillarLine}`.trim();

  // ── Changed (vs previous decision) ──
  const changed: string[] = [];
  const previousAction = input.previousDecision?.action;
  const previousPrice = input.previousDecision?.price ?? null;
  const previousScore = input.previousDecision?.score ?? null;
  if (previousAction && previousAction !== action) {
    changed.push(`Action changed from ${previousAction} to ${action}.`);
  }
  if (previousPrice !== null && price !== null) {
    const delta = price - previousPrice;
    if (Math.abs(delta) > 0.01) {
      const pct = previousPrice !== 0 ? (delta / previousPrice) * 100 : 0;
      changed.push(`Price moved ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% since the last saved review.`);
    }
  }
  if (previousScore !== null && overallScore !== null) {
    const delta = overallScore - previousScore;
    if (Math.abs(delta) >= 5) {
      changed.push(`Overall score changed ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} points versus the last review.`);
    }
  }
  if (changed.length === 0) {
    changed.push('No prior saved review was available to compare, or the setup has not changed materially.');
  }

  const invalidation = input.position?.invalidation
    || (ownershipStatus === 'owned'
      ? 'Reassess if fundamentals deteriorate, trust data turns stale around a catalyst, or the thesis weakens relative to better alternatives.'
      : 'Only act when the setup is both fresh and attractive relative to alternatives in the portfolio.');
  const nextTrigger = trimAbove !== null && price !== null && price > trimAbove
    ? `Price is above your trim trigger of $${trimAbove}; reassess sizing now.`
    : desiredEntryMin !== null && desiredEntryMax !== null
      ? `Revisit if price trades into $${desiredEntryMin}-${desiredEntryMax} with fresh supporting data.`
      : 'Revisit after the next material catalyst, fresh data refresh, or a meaningful move in valuation/revisions.';

  return {
    action,
    confidence,
    freshness,
    overallScore: overallScore !== null ? Number(overallScore.toFixed(1)) : null,
    qualityScore: qualityScore !== null ? Number(qualityScore.toFixed(1)) : null,
    valuationScore: valuationScore !== null ? Number(valuationScore.toFixed(1)) : null,
    technicalScore: technicalScore !== null ? Number(technicalScore.toFixed(1)) : null,
    portfolioFitScore: portfolioFit ? Number(portfolioFit.score.toFixed(1)) : null,
    analystConsensusScore: analystConsensus ? Number(analystConsensus.score.toFixed(1)) : null,
    insiderScore: insiderActivity ? Number(insiderActivity.score.toFixed(1)) : null,
    whyNow,
    whyNot,
    missingInputs,
    changed,
    summary,
    portfolioImpact: buildPortfolioImpact({ action, position: input.position, portfolioProfile: input.portfolioProfile }),
    invalidation,
    nextTrigger,
  };
}

export function decisionSnapshotToLegacyAction(snapshot: DecisionSnapshot): ActionLabel {
  return actionToLegacyLabel(snapshot.action);
}
