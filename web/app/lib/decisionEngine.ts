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

  if (ownership === 'owned') {
    return `Current position ${currentWeight ?? 'n/a'}% vs target ${targetWeight ?? 'n/a'}% and max ${maxWeight ?? 'n/a'}%. Recommended action: ${action}.`;
  }
  return `No active position recorded. Portfolio guardrail max size ${maxWeight ?? portfolioProfile?.maxPositionWeight ?? 'n/a'}%. Recommended action: ${action}.`;
}

function actionToLegacyLabel(action: DecisionAction): ActionLabel {
  if (action === 'Initiate' || action === 'Add') return 'Buy';
  if (action === 'Trim') return 'Watch';
  if (action === 'Exit') return 'Sell';
  return action === 'Hold' ? 'Hold' : 'Watch';
}

function actionToSummaryLabel(action: DecisionAction): string {
  if (action === 'Initiate') return 'Start a new position';
  if (action === 'Add') return 'Add to the position';
  if (action === 'Hold') return 'Keep holding';
  if (action === 'Trim') return 'Trim the position';
  if (action === 'Exit') return 'Exit the position';
  return 'Wait for a better setup';
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

  if (qualityScore !== null && qualityScore >= 65) whyNow.push(`Business quality scores well (${qualityScore.toFixed(0)}/100) across margin and return metrics.`);
  if (valuationScore !== null && valuationScore >= 58) whyNow.push(`Valuation/reward-to-risk is supportive (${valuationScore.toFixed(0)}/100) with ${targetUpside !== null ? `${targetUpside.toFixed(1)}% target upside` : 'reasonable upside'}.`);
  if (technicalScore !== null && technicalScore >= 58) whyNow.push(`Trend and momentum are supportive (${technicalScore.toFixed(0)}/100).`);
  if (desiredEntryMin !== null && desiredEntryMax !== null && price !== null) {
    if (price >= desiredEntryMin && price <= desiredEntryMax) {
      whyNow.push(`Price is inside your preferred entry range of $${desiredEntryMin}-${desiredEntryMax}.`);
    } else {
      whyNot.push(`Price is outside your preferred entry range of $${desiredEntryMin}-${desiredEntryMax}.`);
    }
  }

  if (staleCritical) whyNot.push(`Critical data is stale for: ${(trust?.staleLabels || []).join(', ')}.`);
  if (qualityScore !== null && qualityScore < 45) whyNot.push(`Business quality is only ${qualityScore.toFixed(0)}/100.`);
  if (valuationScore !== null && valuationScore < 45) whyNot.push(`Valuation support is weak at ${valuationScore.toFixed(0)}/100.`);
  if (technicalScore !== null && technicalScore < 40) whyNot.push(`Trend/momentum is not supportive (${technicalScore.toFixed(0)}/100).`);
  if (ownershipStatus === 'owned' && currentWeight !== null && maxWeight !== null && currentWeight > maxWeight) {
    whyNot.push(`Position size ${currentWeight}% is already above your max-weight guardrail of ${maxWeight}%.`);
  }
  if (missingInputs.length >= 3) whyNot.push(`Important inputs are missing: ${missingInputs.slice(0, 3).join(', ')}.`);

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

  const summary = `${actionToSummaryLabel(action)} with ${confidence.toLowerCase()} confidence. ${whyNow[0] || 'The setup is mixed.'} ${whyNot[0] || ''}`.trim();

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
