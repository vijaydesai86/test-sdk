/* eslint-disable @typescript-eslint/no-explicit-any */

export type DcfConfidence = 'High' | 'Medium' | 'Low';

export type DcfValuationResult = {
  currentPrice: number | null;
  intrinsicValuePerShare: number | null;
  marginOfSafetyPercent: number | null;
  verdict: string;
  confidence: DcfConfidence;
  assumptions: {
    baseFCF: number | null;
    fcfBasis: 'annual' | 'ttm-from-quarterly' | 'unavailable';
    fcfBasisLabel: string;
    growthRate: number | null;
    wacc: number | null;
    riskFreeRate: number | null;
    riskFreeRateSource: string | null;
    terminalGrowthRate: number;
    projectionYears: number;
    beta: number | null;
  };
  notes: string[];
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || /^n\/a$/i.test(trimmed) || trimmed === '-' || trimmed === '—') return null;
    const cleaned = trimmed
      .replace(/[$£€,]/g, '')
      .replace(/%$/g, '')
      .replace(/^\((.+)\)$/, '-$1');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRate(value: unknown): number | null {
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    const parsed = toNumber(value);
    return parsed === null ? null : parsed / 100;
  }
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return Math.abs(parsed) > 1 && Math.abs(parsed) <= 100 ? parsed / 100 : parsed;
}

export function deriveFreeCashFlow(report: any): number | null {
  const direct = toNumber(report?.freeCashFlow ?? report?.freeCashFlowTTM);
  if (direct !== null) return direct;
  const operating = toNumber(
    report?.operatingCashflow
      ?? report?.operatingCashFlow
      ?? report?.totalCashFromOperatingActivities
      ?? report?.netCashProvidedByOperatingActivities
      ?? report?.netCashProvidedByUsedInOperatingActivities
      ?? report?.netCashProvidedByUsedInOperatingActivitiesContinuingOperations
      ?? report?.cashFlowFromOperatingActivities
  );
  const capex = toNumber(
    report?.capitalExpenditures
      ?? report?.capitalExpenditure
      ?? report?.capitalExpendituresTTM
      ?? report?.paymentsToAcquirePropertyPlantAndEquipment
      ?? report?.paymentsForPropertyPlantAndEquipment
  );
  if (operating === null || capex === null) return null;
  return operating - Math.abs(capex);
}

function newestReport(statement: any): any | null {
  const quarterlyReports = Array.isArray(statement?.quarterlyReports) ? statement.quarterlyReports : [];
  const annualReports = Array.isArray(statement?.annualReports) ? statement.annualReports : [];
  return quarterlyReports[0] ?? annualReports[0] ?? null;
}

function resolveNetDebt(overview: any, balanceSheet: any): { netDebt: number; note: string | null } {
  const report = newestReport(balanceSheet);
  const cash = toNumber(
    report?.cashAndEquivalents
      ?? report?.cashAndCashEquivalents
      ?? report?.cashAndCashEquivalentsAtCarryingValue
      ?? report?.cashAndShortTermInvestments
      ?? report?.cashCashEquivalentsAndShortTermInvestments
      ?? overview?.cashAndEquivalents
      ?? overview?.cashAndCashEquivalents
      ?? overview?.cashAndShortTermInvestments
  );
  const totalDebt = toNumber(
    report?.totalDebt
      ?? report?.shortLongTermDebtTotal
      ?? report?.shortLongTermDebt
      ?? overview?.totalDebt
      ?? overview?.shortLongTermDebtTotal
  );
  const longTermDebt = toNumber(
    report?.longTermDebt
      ?? report?.longTermDebtNoncurrent
      ?? report?.longTermDebtAndFinanceLeaseObligations
      ?? overview?.longTermDebt
      ?? overview?.longTermDebtNoncurrent
  );
  const shortTermDebt = toNumber(
    report?.shortTermDebt
      ?? report?.currentDebt
      ?? report?.currentDebtAndCapitalLeaseObligation
      ?? overview?.shortTermDebt
      ?? overview?.currentDebt
  );
  const debt = totalDebt ?? (
    longTermDebt !== null || shortTermDebt !== null
      ? (longTermDebt ?? 0) + (shortTermDebt ?? 0)
      : null
  );

  if (debt === null && cash === null) {
    return { netDebt: 0, note: 'DCF net debt adjustment skipped: balance-sheet cash and debt were unavailable.' };
  }
  return { netDebt: (debt ?? 0) - (cash ?? 0), note: null };
}

function collectFreeCashFlows(reports: any[]): number[] {
  return reports
    .map((report) => deriveFreeCashFlow(report))
    .filter((value): value is number => value !== null && Number.isFinite(value));
}

function resolveDcfBaseFreeCashFlow(cashFlow: any): {
  baseFCF: number | null;
  trendFCFs: number[];
  basis: DcfValuationResult['assumptions']['fcfBasis'];
  basisLabel: string;
  confidence: DcfConfidence;
  notes: string[];
} {
  const annualReports = Array.isArray(cashFlow?.annualReports) ? cashFlow.annualReports : [];
  const quarterlyReports = Array.isArray(cashFlow?.quarterlyReports) ? cashFlow.quarterlyReports : [];
  const annualFCFs = collectFreeCashFlows(annualReports.slice(0, 5));
  if (annualFCFs.length > 0) {
    return {
      baseFCF: annualFCFs[0],
      trendFCFs: annualFCFs,
      basis: 'annual',
      basisLabel: 'Latest annual FCF',
      confidence: annualFCFs.length >= 3 ? 'High' : 'Medium',
      notes: annualFCFs.length >= 3 ? [] : ['DCF confidence limited: fewer than three annual FCF periods were available.'],
    };
  }

  const quarterlyFCFs = collectFreeCashFlows(quarterlyReports.slice(0, 4));
  if (quarterlyFCFs.length >= 4) {
    return {
      baseFCF: quarterlyFCFs.reduce((sum, value) => sum + value, 0),
      trendFCFs: [],
      basis: 'ttm-from-quarterly',
      basisLabel: 'Trailing 4-quarter FCF',
      confidence: 'Medium',
      notes: ['DCF uses trailing 4-quarter FCF because annual cash-flow data was unavailable.'],
    };
  }
  if (quarterlyFCFs.length > 0) {
    return {
      baseFCF: null,
      trendFCFs: [],
      basis: 'unavailable',
      basisLabel: 'Unavailable',
      confidence: 'Low',
      notes: ['DCF unavailable: fewer than four quarterly FCF periods were available and no annual cash-flow data was available.'],
    };
  }

  return {
    baseFCF: null,
    trendFCFs: [],
    basis: 'unavailable',
    basisLabel: 'Unavailable',
    confidence: 'Low',
    notes: ['DCF unavailable: no usable free-cash-flow data was available.'],
  };
}

export function computeDcfValuation(args: {
  overview?: any;
  balanceSheet?: any;
  cashFlow?: any;
  currentPrice?: number | null;
  riskFreeRate?: number | null;
  riskFreeRateSource?: string;
}): DcfValuationResult {
  const currentPrice = args.currentPrice ?? null;
  const sharesOutstanding = toNumber(args.overview?.sharesOutstanding);
  const beta = toNumber(args.overview?.beta);
  const base = resolveDcfBaseFreeCashFlow(args.cashFlow);
  const riskFreeRate = args.riskFreeRate !== null && args.riskFreeRate !== undefined && Number.isFinite(args.riskFreeRate)
    ? args.riskFreeRate
    : null;
  const riskFreeRateSource = riskFreeRate !== null ? (args.riskFreeRateSource || 'Provided risk-free rate') : null;
  const equityRiskPremium = 0.05;
  const effectiveBeta = beta !== null && Number.isFinite(beta) && beta > 0 ? beta : null;
  const wacc = riskFreeRate !== null && effectiveBeta !== null ? riskFreeRate + effectiveBeta * equityRiskPremium : null;
  const terminalGrowth = 0.025;

  const assumptions = {
    baseFCF: base.baseFCF,
    fcfBasis: base.basis,
    fcfBasisLabel: base.basisLabel,
    growthRate: null,
    wacc: wacc !== null ? Number((wacc * 100).toFixed(1)) : null,
    riskFreeRate: riskFreeRate !== null ? Number((riskFreeRate * 100).toFixed(2)) : null,
    riskFreeRateSource,
    terminalGrowthRate: Number((terminalGrowth * 100).toFixed(1)),
    projectionYears: 10,
    beta: effectiveBeta,
  };

  const missingRequiredNotes = [
    ...base.notes,
    !sharesOutstanding || sharesOutstanding <= 0 ? 'DCF unavailable: shares outstanding was unavailable.' : null,
    effectiveBeta === null ? 'DCF unavailable: beta was unavailable.' : null,
    riskFreeRate === null ? 'DCF unavailable: official risk-free rate was unavailable.' : null,
  ].filter(Boolean) as string[];

  if (!sharesOutstanding || sharesOutstanding <= 0 || base.baseFCF === null || effectiveBeta === null || riskFreeRate === null || wacc === null) {
    return {
      currentPrice,
      intrinsicValuePerShare: null,
      marginOfSafetyPercent: null,
      verdict: 'Insufficient data for DCF calculation',
      confidence: 'Low',
      assumptions,
      notes: missingRequiredNotes,
    };
  }
  if (base.baseFCF <= 0) {
    return {
      currentPrice,
      intrinsicValuePerShare: null,
      marginOfSafetyPercent: null,
      verdict: 'DCF not reliable with non-positive free cash flow',
      confidence: 'Low',
      assumptions,
      notes: [...base.notes, 'DCF suppressed: base free cash flow is not positive.'],
    };
  }

  let growthRate: number | null = null;
  const revenueGrowth = toRate(args.overview?.quarterlyRevenueGrowth);
  if (base.trendFCFs.length >= 2 && base.trendFCFs[base.trendFCFs.length - 1] > 0) {
    const cagr = Math.pow(base.trendFCFs[0] / base.trendFCFs[base.trendFCFs.length - 1], 1 / (base.trendFCFs.length - 1)) - 1;
    if (Number.isFinite(cagr) && cagr > -0.5 && cagr < 1.0) {
      growthRate = Math.min(cagr, 0.25);
    }
  } else if (revenueGrowth !== null && Number.isFinite(revenueGrowth)) {
    growthRate = Math.min(Math.max(revenueGrowth, -0.1), 0.25);
  }
  if (growthRate === null) {
    return {
      currentPrice,
      intrinsicValuePerShare: null,
      marginOfSafetyPercent: null,
      verdict: 'Insufficient data for DCF calculation',
      confidence: 'Low',
      assumptions,
      notes: [...base.notes, 'DCF unavailable: no real FCF trend or provider revenue-growth input was available.'],
    };
  }
  assumptions.growthRate = Number((growthRate * 100).toFixed(1));

  let totalPV = 0;
  let projectedFCF = base.baseFCF;
  for (let year = 1; year <= 10; year++) {
    const effectiveGrowth = year <= 5
      ? growthRate
      : growthRate * (1 - (year - 5) / 5) + terminalGrowth * ((year - 5) / 5);
    projectedFCF *= (1 + effectiveGrowth);
    totalPV += projectedFCF / Math.pow(1 + wacc, year);
  }

  const terminalFCF = projectedFCF * (1 + terminalGrowth);
  const terminalValue = terminalFCF / (wacc - terminalGrowth);
  const terminalPV = terminalValue / Math.pow(1 + wacc, 10);
  const enterpriseValue = totalPV + terminalPV;
  const netDebt = resolveNetDebt(args.overview, args.balanceSheet);
  const equityValue = enterpriseValue - (Number.isFinite(netDebt.netDebt) ? netDebt.netDebt : 0);
  const intrinsicValue = equityValue / sharesOutstanding;
  const marginOfSafety = currentPrice && currentPrice > 0 && Number.isFinite(intrinsicValue)
    ? ((intrinsicValue - currentPrice) / currentPrice) * 100
    : null;

  let verdict = 'Unavailable';
  if (marginOfSafety !== null && Number.isFinite(marginOfSafety)) {
    if (marginOfSafety > 30) verdict = 'Significantly Undervalued (30%+ margin of safety)';
    else if (marginOfSafety > 15) verdict = 'Moderately Undervalued (15-30% margin of safety)';
    else if (marginOfSafety > 0) verdict = 'Slightly Undervalued (0-15% margin of safety)';
    else if (marginOfSafety > -15) verdict = 'Fairly Valued (within 15% of current price)';
    else if (marginOfSafety > -30) verdict = 'Moderately Overvalued (15-30% above intrinsic value)';
    else verdict = 'Significantly Overvalued (30%+ above intrinsic value)';
  }

  return {
    currentPrice,
    intrinsicValuePerShare: Number.isFinite(intrinsicValue) ? Number(intrinsicValue.toFixed(2)) : null,
    marginOfSafetyPercent: marginOfSafety !== null && Number.isFinite(marginOfSafety) ? Number(marginOfSafety.toFixed(1)) : null,
    verdict,
    confidence: base.confidence,
    assumptions,
    notes: [...base.notes, netDebt.note].filter(Boolean) as string[],
  };
}
