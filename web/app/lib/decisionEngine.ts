/* eslint-disable @typescript-eslint/no-explicit-any */
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
  newsSentiment?: any;
  companyNews?: { articles?: any[] };
  trust?: DataTrustSummary;
  position?: Partial<WatchlistPositionMeta>;
  portfolioProfile?: PortfolioProfile;
  previousDecision?: DecisionJournalRecord | null;
};

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

function average(values: Array<number | null>): number | null {
  const filtered = values.filter((value) => value !== null) as number[];
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function computeMomentum(prices?: Array<{ date: string; close: string | number }>): number | null {
  if (!prices || prices.length < 2) return null;
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const first = toNumber(sorted[0].close);
  const last = toNumber(sorted[sorted.length - 1].close);
  if (first === null || last === null || first === 0) return null;
  return clamp(50 + ((last - first) / first) * 100);
}

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

function describeTechnicalSupport(args: {
  technicalScore: number | null;
  momentum: number | null;
  targetUpside: number | null;
  supportive: boolean;
}): string | null {
  const { technicalScore, momentum, targetUpside, supportive } = args;
  if (technicalScore === null) return null;

  const scoreLabel = `(${technicalScore.toFixed(0)}/100).`;
  if (momentum !== null && targetUpside !== null) {
    return supportive
      ? `Momentum and target upside are supportive ${scoreLabel}`
      : `Momentum and target upside are not supportive ${scoreLabel}`;
  }
  if (momentum !== null) {
    return supportive
      ? `Price momentum is supportive ${scoreLabel}`
      : `Price momentum is not supportive ${scoreLabel}`;
  }
  if (targetUpside !== null) {
    return supportive
      ? `Analyst target upside is supportive ${scoreLabel}`
      : `Analyst target upside is not supportive ${scoreLabel}`;
  }
  return null;
}

export function buildDecisionSnapshot(input: DecisionInput): DecisionSnapshot {
  const price = toNumber(input.price?.price);
  const targetMean = toNumber(
    input.priceTargets?.targetMean
    ?? (input.analystRatings?.analystTargetPrice !== 'N/A' ? input.analystRatings?.analystTargetPrice : null)
    ?? input.companyOverview?.analystTargetPrice
  );
  const targetUpside = price !== null && targetMean !== null && price !== 0
    ? ((targetMean - price) / price) * 100
    : null;

  const grossMargin = normalizePercent(input.basicFinancials?.metric?.grossMarginTTM ?? input.companyOverview?.profitMargin);
  const operatingMargin = normalizePercent(input.basicFinancials?.metric?.operatingMarginTTM ?? input.companyOverview?.operatingMargin);
  const roe = normalizePercent(input.basicFinancials?.metric?.roeTTM ?? input.companyOverview?.returnOnEquity);
  const revenueGrowth = normalizePercent(input.basicFinancials?.metric?.revenueGrowthTTM ?? input.companyOverview?.quarterlyRevenueGrowth);
  const epsGrowth = normalizePercent(input.basicFinancials?.metric?.epsGrowthTTM ?? input.basicFinancials?.metric?.epsGrowth5Y ?? input.companyOverview?.quarterlyEarningsGrowth);
  const pe = toNumber(input.companyOverview?.peRatio ?? input.basicFinancials?.metric?.peBasicExclExtraTTM);
  const momentum = computeMomentum(input.priceHistory?.prices);

  const qualityScore = average([
    grossMargin !== null ? clamp(grossMargin) : null,
    operatingMargin !== null ? clamp(operatingMargin) : null,
    roe !== null ? clamp(roe) : null,
    revenueGrowth !== null ? clamp(50 + revenueGrowth) : null,
    epsGrowth !== null ? clamp(50 + epsGrowth) : null,
  ]);
  const valuationScore = average([
    pe !== null && pe > 0 ? clamp(100 - (pe / 45) * 100) : null,
    targetUpside !== null ? clamp(50 + targetUpside * 1.5) : null,
  ]);
  const technicalScore = average([
    momentum,
    targetUpside !== null ? clamp(50 + targetUpside) : null,
  ]);

  const currentWeight = input.position?.currentWeight ?? null;
  const targetWeight = input.position?.targetWeight ?? null;
  const maxWeight = input.position?.maxWeight ?? input.portfolioProfile?.maxPositionWeight ?? null;
  const ownershipStatus = input.position?.ownershipStatus ?? 'watching';
  const desiredEntryMin = input.position?.desiredEntryMin ?? null;
  const desiredEntryMax = input.position?.desiredEntryMax ?? null;
  const trimAbove = input.position?.trimAbove ?? null;

  let portfolioFitScore: number | null = 55;
  if (ownershipStatus === 'owned' && currentWeight !== null && maxWeight !== null && currentWeight > maxWeight) {
    portfolioFitScore = 20;
  } else if (ownershipStatus === 'owned' && currentWeight !== null && targetWeight !== null) {
    portfolioFitScore = currentWeight <= targetWeight ? 70 : 45;
  } else if (ownershipStatus === 'watching') {
    portfolioFitScore = 60;
  }

  const trust = input.trust;
  const freshness = trust?.criticalFresh
    ? 'fresh'
    : trust?.staleLabels.length
      ? 'stale'
      : 'aging';
  const staleCritical = freshness === 'stale';

  const missingInputs: string[] = [];
  if (price === null) missingInputs.push('current price');
  if (revenueGrowth === null) missingInputs.push('revenue growth');
  if (operatingMargin === null) missingInputs.push('operating margin');
  if (targetUpside === null) missingInputs.push('price target');
  if (!input.companyNews?.articles?.length) missingInputs.push('recent company news');
  if (!input.trust?.entries.length) missingInputs.push('freshness metadata');

  const overallScore = average([
    qualityScore,
    valuationScore,
    technicalScore,
    portfolioFitScore,
    staleCritical ? 15 : freshness === 'aging' ? 45 : 75,
  ]);

  const whyNow: string[] = [];
  const whyNot: string[] = [];

  // ── whyNow: highlight the best available real metrics ──
  // Use actual metric values to build stock-specific rationale, not just abstract scores.
  // This ensures every stock reads differently based on its real data.
  {
    const strengths: string[] = [];
    if (grossMargin !== null && grossMargin >= 40) strengths.push(`${grossMargin.toFixed(0)}% gross margin`);
    if (operatingMargin !== null && operatingMargin >= 15) strengths.push(`${operatingMargin.toFixed(0)}% op margin`);
    if (roe !== null && roe >= 15) strengths.push(`${roe.toFixed(0)}% ROE`);
    if (revenueGrowth !== null && revenueGrowth > 5) strengths.push(`${revenueGrowth > 0 ? '+' : ''}${revenueGrowth.toFixed(0)}% rev growth`);
    if (epsGrowth !== null && epsGrowth > 5) strengths.push(`${epsGrowth > 0 ? '+' : ''}${epsGrowth.toFixed(0)}% EPS growth`);
    if (strengths.length >= 3) {
      whyNow.push(`Strong fundamentals (${strengths.join(', ')}).`);
    } else if (strengths.length >= 1) {
      whyNow.push(`Solid on ${strengths.join(', ')}.`);
    }
  }

  if (valuationScore !== null && valuationScore >= 58) {
    const parts: string[] = [];
    if (targetUpside !== null) parts.push(`${targetUpside.toFixed(1)}% target upside`);
    if (pe !== null && pe > 0) parts.push(`P/E ${pe.toFixed(1)}`);
    const detail = parts.length ? `: ${parts.join(', ')}` : '';
    whyNow.push(`Supportive valuation${detail}.`);
  } else if (pe !== null && pe > 0 && pe < 20 && valuationScore === null) {
    // Even without a full valuation score, a low P/E is noteworthy
    whyNow.push(`Low P/E of ${pe.toFixed(1)} suggests value.`);
  }

  const supportiveTechnicalReason = describeTechnicalSupport({
    technicalScore,
    momentum,
    targetUpside,
    supportive: true,
  });
  if (technicalScore !== null && technicalScore >= 58 && supportiveTechnicalReason) whyNow.push(supportiveTechnicalReason);
  if (desiredEntryMin !== null && desiredEntryMax !== null && price !== null) {
    if (price >= desiredEntryMin && price <= desiredEntryMax) {
      whyNow.push(`Price is inside your preferred entry range of $${desiredEntryMin}–${desiredEntryMax}.`);
    } else {
      whyNot.push(`Price is outside your preferred entry range of $${desiredEntryMin}–${desiredEntryMax}.`);
    }
  }

  // ── whyNot: concrete metric-level concerns ──
  // These are real investment concerns, NOT data-gap complaints.
  if (staleCritical) whyNot.push(`Critical data is stale for: ${(trust?.staleLabels || []).join(', ')}.`);
  {
    const weaknesses: string[] = [];
    if (operatingMargin !== null && operatingMargin < 5) weaknesses.push(`${operatingMargin.toFixed(0)}% op margin`);
    if (roe !== null && roe < 8) weaknesses.push(`${roe.toFixed(0)}% ROE`);
    if (revenueGrowth !== null && revenueGrowth < -5) weaknesses.push(`${revenueGrowth.toFixed(0)}% rev growth`);
    if (grossMargin !== null && grossMargin < 25) weaknesses.push(`${grossMargin.toFixed(0)}% gross margin`);
    if (weaknesses.length) {
      whyNot.push(`Weak fundamentals (${weaknesses.join(', ')}).`);
    }
  }
  if (valuationScore !== null && valuationScore < 45) {
    const concerns: string[] = [];
    if (pe !== null && pe > 35) concerns.push(`P/E ${pe.toFixed(1)}`);
    if (targetUpside !== null && targetUpside < 5) concerns.push(`only ${targetUpside.toFixed(1)}% target upside`);
    const detail = concerns.length ? ` (${concerns.join(', ')})` : '';
    whyNot.push(`Stretched valuation${detail}.`);
  }
  const unsupportiveTechnicalReason = describeTechnicalSupport({
    technicalScore,
    momentum,
    targetUpside,
    supportive: false,
  });
  if (technicalScore !== null && technicalScore < 40 && unsupportiveTechnicalReason) whyNot.push(unsupportiveTechnicalReason);
  if (ownershipStatus === 'owned' && currentWeight !== null && maxWeight !== null && currentWeight > maxWeight) {
    whyNot.push(`Position size ${currentWeight}% is already above your max-weight guardrail of ${maxWeight}%.`);
  }

  // Missing data only affects confidence (already computed above), NOT whyNot.
  // This keeps the rationale focused on the investment case.

  let action: DecisionAction = 'Wait';
  if (!staleCritical && overallScore !== null) {
    if (ownershipStatus === 'owned') {
      if (currentWeight !== null && maxWeight !== null && currentWeight > maxWeight && overallScore < 60) {
        action = overallScore < 35 ? 'Exit' : 'Trim';
      } else if (overallScore >= 68 && (targetWeight === null || currentWeight === null || currentWeight < targetWeight)) {
        action = 'Add';
      } else if (overallScore >= 48) {
        action = 'Hold';
      } else if (overallScore < 32) {
        action = 'Trim';
      } else {
        action = 'Wait';
      }
    } else if (overallScore >= 68) {
      action = 'Initiate';
    } else if (overallScore >= 48) {
      action = 'Wait';
    } else {
      action = 'Wait';
    }
  }

  if (staleCritical) {
    action = 'Wait';
  }

  const confidenceScore = average([
    overallScore,
    staleCritical ? 20 : freshness === 'aging' ? 55 : 85,
    clamp(100 - missingInputs.length * 12),
  ]) ?? 35;
  const confidence: ConfidenceLabel = confidenceScore >= 75 ? 'High' : confidenceScore >= 55 ? 'Medium' : 'Low';

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

  // Build a concise summary: top reason for + top reason against, with scores.
  // Kept short so it fits in table cells and card layouts without horizontal overflow.
  const topPro = whyNow[0] || null;
  const topCon = whyNot[0] || null;
  const reasonParts: string[] = [];
  if (topPro) reasonParts.push(topPro);
  if (topCon) reasonParts.push(topCon);
  // When neither whyNow nor whyNot has entries, build a mini fact-set from available data
  if (!reasonParts.length) {
    const facts: string[] = [];
    if (pe !== null) facts.push(`P/E ${pe.toFixed(1)}`);
    if (grossMargin !== null) facts.push(`gross margin ${grossMargin.toFixed(0)}%`);
    if (roe !== null) facts.push(`ROE ${roe.toFixed(0)}%`);
    if (momentum !== null) {
      const momReturn = (momentum - 50);
      facts.push(`trend ${momReturn >= 0 ? '+' : ''}${momReturn.toFixed(0)}%`);
    }
    if (facts.length) {
      reasonParts.push(`Mixed signals (${facts.join(', ')}).`);
    }
  }
  const reasonText = reasonParts.length
    ? reasonParts.join(' ')
    : 'Insufficient data to form a view.';
  const scoreTag = overallScore !== null ? ` Score ${overallScore.toFixed(0)}/100.` : '';
  const summary = `${actionToSummaryLabel(action)}.${scoreTag} ${reasonText}`.trim();

  return {
    action,
    confidence,
    freshness,
    overallScore: overallScore !== null ? Number(overallScore.toFixed(1)) : null,
    qualityScore: qualityScore !== null ? Number(qualityScore.toFixed(1)) : null,
    valuationScore: valuationScore !== null ? Number(valuationScore.toFixed(1)) : null,
    technicalScore: technicalScore !== null ? Number(technicalScore.toFixed(1)) : null,
    portfolioFitScore: portfolioFitScore !== null ? Number(portfolioFitScore.toFixed(1)) : null,
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
