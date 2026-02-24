import { promises as fs } from 'fs';
import path from 'path';

type PricePoint = { date: string; close: string | number };
type EarningsPoint = { fiscalQuarter: string; reportedEPS: string | number };

export interface StockReportData {
  symbol: string;
  generatedAt: string;
  price: any;
  priceHistory?: { prices?: PricePoint[] };
  companyOverview?: any;
  basicFinancials?: any;
  earningsHistory?: { quarterlyEarnings?: EarningsPoint[] };
  incomeStatement?: any;
  balanceSheet?: any;
  cashFlow?: any;
  analystRatings?: any;
  analystRecommendations?: any;
  priceTargets?: any;
  peers?: any;
  newsSentiment?: any;
  companyNews?: { articles?: any[] };
}

export interface SectorReportItem {
  symbol: string;
  price?: any;
  overview?: any;
  basicFinancials?: any;
  analystRatings?: any;
  priceTargets?: any;
  newsSentiment?: any;
}

export interface SectorReportData {
  query: string;
  generatedAt: string;
  universe: string[];
  items: SectorReportItem[];
  notes?: string[];
}

export interface PeerReportItem {
  symbol: string;
  price?: any;
  overview?: any;
  basicFinancials?: any;
  priceTargets?: any;
  priceHistory?: { prices?: PricePoint[] };
}

export interface PeerReportData {
  symbol: string;
  generatedAt: string;
  range: string;
  universe: string[];
  items: PeerReportItem[];
  notes?: string[];
}

const DEFAULT_REPORTS_DIR =
  process.env.REPORTS_DIR || (process.env.VERCEL ? '/tmp/reports' : 'reports');

function formatDateLabel(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date.slice(0, 10);
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
  }).format(parsed);
}

function downsample<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) return items;
  const result: T[] = [];
  const step = (items.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    result.push(items[Math.round(i * step)]);
  }
  return result;
}

function formatChartNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) >= 1000) {
    return Number(value.toFixed(0));
  }
  return Number(value.toFixed(2));
}

function buildPriceChart(prices: PricePoint[] = []): string {
  if (prices.length === 0) return '';
  const series = downsample([...prices].reverse(), 60);
  const labels = series.map((p) => formatDateLabel(p.date));
  const values = series.map((p) => formatChartNumber(Number(p.close)));
  const filtered = filterSeries(labels, values);
  if (filtered.labels.length === 0) return '';

  return buildChartBlock({
    title: { text: 'Price History', left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: filtered.labels },
    yAxis: { type: 'value', scale: true },
    series: [
      {
        name: 'Close',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        areaStyle: { opacity: 0.2 },
        data: filtered.values,
      },
    ],
  });
}

function buildEpsChart(earnings: EarningsPoint[] = []): string {
  if (earnings.length === 0) return '';
  const series = downsample([...earnings].reverse(), 20);
  const labels = series.map((e) => formatDateLabel(e.fiscalQuarter));
  const values = series.map((e) => formatChartNumber(Number(e.reportedEPS)));
  const filtered = filterSeries(labels, values);
  if (filtered.labels.length === 0) return '';

  return buildChartBlock({
    title: { text: 'Quarterly EPS', left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: filtered.labels },
    yAxis: { type: 'value', scale: true },
    series: [
      {
        name: 'EPS',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: filtered.values,
      },
    ],
  });
}

function buildRevenueChart(incomeStatement?: any): string {
  const reports = incomeStatement?.quarterlyReports || incomeStatement?.annualReports || [];
  if (!Array.isArray(reports) || reports.length === 0) return '';
  const series = downsample(reports.slice(0, 12).reverse(), 8);
  const labels = series.map((r: any) => formatDateLabel(r.fiscalQuarter || r.fiscalYear || r.fiscalDateEnding || ''));
  const values = series.map((r: any) => formatChartNumber(Number(r.totalRevenue)));
  const filtered = filterSeries(labels, values);

  if (filtered.values.length === 0) return '';

  return buildChartBlock({
    title: { text: 'Revenue Trend', left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: filtered.labels },
    yAxis: { type: 'value', scale: true },
    series: [
      {
        name: 'Revenue',
        type: 'bar',
        data: filtered.values,
        barMaxWidth: 32,
      },
    ],
  });
}

function buildMarginChart(incomeStatement?: any): string {
  const reports = incomeStatement?.quarterlyReports || incomeStatement?.annualReports || [];
  if (!Array.isArray(reports) || reports.length === 0) return '';
  const series = downsample(reports.slice(0, 12).reverse(), 8);
  const labels = series.map((r: any) => formatDateLabel(r.fiscalQuarter || r.fiscalYear || r.fiscalDateEnding || ''));
  const grossMargins = series.map((r: any) => {
    const revenue = Number(r.totalRevenue);
    const gross = Number(r.grossProfit);
    if (!revenue || Number.isNaN(revenue) || Number.isNaN(gross)) return 0;
    return formatChartNumber((gross / revenue) * 100);
  });
  const operatingMargins = series.map((r: any) => {
    const revenue = Number(r.totalRevenue);
    const operating = Number(r.operatingIncome);
    if (!revenue || Number.isNaN(revenue) || Number.isNaN(operating)) return 0;
    return formatChartNumber((operating / revenue) * 100);
  });
  const grossFiltered = filterSeries(labels, grossMargins);
  const operatingFiltered = filterSeries(labels, operatingMargins);
  if (grossFiltered.labels.length === 0 && operatingFiltered.labels.length === 0) return '';

  return buildChartBlock({
    title: { text: 'Margin Trends', left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    series: [
      {
        name: 'Gross Margin',
        type: 'line',
        smooth: true,
        data: grossMargins,
      },
      {
        name: 'Operating Margin',
        type: 'line',
        smooth: true,
        data: operatingMargins,
      },
    ],
    legend: { bottom: 0 },
  });
}

function buildPeerTable(items: SectorReportItem[]): string {
  if (items.length === 0) return '';
  const header = '| Symbol | Price | Market Cap | P/E | Analyst Target |';
  const divider = '|---|---:|---:|---:|---:|';
  const rows = items.map((item) => {
    const price = item.price?.price || 'N/A';
    const marketCap = item.overview?.marketCapitalization || 'N/A';
    const pe = item.overview?.peRatio || item.basicFinancials?.metric?.peBasicExclExtraTTM || 'N/A';
    const target = item.priceTargets?.targetMean || item.analystRatings?.analystTargetPrice || 'N/A';
    return `| ${item.symbol} | ${price} | ${marketCap} | ${pe} | ${target} |`;
  });
  return [header, divider, ...rows].join('\n');
}

function buildTargetDistribution(priceTargets?: any): string {
  if (!priceTargets) return '';
  const low = toNumber(priceTargets.targetLow);
  const mean = toNumber(priceTargets.targetMean);
  const median = toNumber(priceTargets.targetMedian);
  const high = toNumber(priceTargets.targetHigh);
  const points = [
    { symbol: 'Low', value: low },
    { symbol: 'Mean', value: mean },
    { symbol: 'Median', value: median },
    { symbol: 'High', value: high },
  ].filter((item) => item.value !== null) as { symbol: string; value: number }[];

  return buildBarChart('Analyst Target Distribution', 'Price', points);
}

function buildBarChart(title: string, label: string, items: { symbol: string; value: number }[]): string {
  if (items.length === 0) return '';
  const labels = items.map((item) => item.symbol);
  const values = items.map((item) => formatChartNumber(item.value));
  const filtered = filterSeries(labels, values);
  if (filtered.labels.length === 0) return '';

  return buildChartBlock({
    title: { text: title, left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: filtered.labels },
    yAxis: { type: 'value', scale: true, name: label },
    series: [
      {
        name: label,
        type: 'bar',
        data: filtered.values,
        barMaxWidth: 32,
      },
    ],
  });
}

function buildPerformanceChart(items: PeerReportItem[], title: string): string {
  const series = items
    .map((item) => {
      const prices = item.priceHistory?.prices || [];
      if (prices.length < 2) return null;
      const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
      const base = toNumber(sorted[0].close);
      if (!base) return null;
      const sampled = downsample(sorted, 60);
      return {
        name: item.symbol,
        data: sampled.map((point) => {
          const value = toNumber(point.close);
          if (!value) return null;
          return [formatDateLabel(point.date), Number(((value / base) * 100).toFixed(2))];
        }).filter((row): row is [string, number] => row !== null),
      };
    })
    .filter((row): row is { name: string; data: [string, number][] } => row !== null && row.data.length > 0);

  if (series.length === 0) return '';

  return buildChartBlock({
    title: { text: title, left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category' },
    yAxis: { type: 'value', name: 'Index (Base=100)' },
    legend: { bottom: 0 },
    series: series.map((row) => ({
      name: row.name,
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: row.data,
    })),
  });
}

function buildChartBlock(option: Record<string, any>): string {
  return ['```chart', JSON.stringify(option, null, 2), '```'].join('\n');
}

function filterSeries(labels: string[], values: number[]) {
  return labels.reduce<{ labels: string[]; values: number[] }>((acc, label, index) => {
    const value = values[index];
    if (!Number.isFinite(value)) return acc;
    acc.labels.push(label);
    acc.values.push(value);
    return acc;
  }, { labels: [], values: [] });
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return num;
}

function normalizePercent(value: unknown): number | null {
  const num = toNumber(value);
  if (num === null) return null;
  if (num <= 1 && num >= -1) return num * 100;
  return num;
}

function formatNumber(value: unknown, decimals = 2): string {
  const num = toNumber(value);
  if (num === null) return 'N/A';
  return num.toFixed(decimals);
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatMarketCap(value: unknown): string {
  const num = toNumber(value);
  if (num === null) return 'N/A';
  if (num >= 1e9) {
    return `${trimTrailingZeros((num / 1e9).toFixed(2))}B`;
  }
  if (num >= 1e6) {
    return `${trimTrailingZeros((num / 1e6).toFixed(2))}M`;
  }
  return trimTrailingZeros(num.toFixed(0));
}

function formatRatingSummary(item: any): string {
  const ratings = item.analystRatings || item.overview || {};
  const strongBuy = toNumber(ratings.strongBuy ?? ratings.analystRatingStrongBuy);
  const buy = toNumber(ratings.buy ?? ratings.analystRatingBuy);
  const hold = toNumber(ratings.hold ?? ratings.analystRatingHold);
  const sell = toNumber(ratings.sell ?? ratings.analystRatingSell);
  const strongSell = toNumber(ratings.strongSell ?? ratings.analystRatingStrongSell);

  if ([strongBuy, buy, hold, sell, strongSell].every((value) => value === null)) {
    return 'N/A';
  }

  return `SB ${strongBuy ?? 0} / B ${buy ?? 0} / H ${hold ?? 0} / S ${sell ?? 0} / SS ${strongSell ?? 0}`;
}

function getEpsValue(item: any): number | null {
  return toNumber(item.basicFinancials?.metric?.epsTTM ?? item.overview?.eps);
}

function getTargetUpside(item: any): number | null {
  const price = toNumber(item.price?.price);
  const target = toNumber(item.priceTargets?.targetMean || item.analystRatings?.analystTargetPrice);
  if (!price || !target) return null;
  return ((target - price) / price) * 100;
}

function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function average(values: Array<number | null>): number | null {
  const filtered = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (filtered.length === 0) return null;
  const sum = filtered.reduce((acc, val) => acc + val, 0);
  return sum / filtered.length;
}

function computeMomentum(prices?: PricePoint[]): number | null {
  if (!prices || prices.length < 2) return null;
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const first = toNumber(sorted[0].close);
  const last = toNumber(sorted[sorted.length - 1].close);
  if (!first || !last) return null;
  const pct = ((last - first) / first) * 100;
  return clampScore(50 + pct);
}

function computeMarginStability(incomeStatement?: any): number | null {
  const reports = incomeStatement?.quarterlyReports || incomeStatement?.annualReports || [];
  if (!Array.isArray(reports) || reports.length < 3) return null;

  const margins = reports
    .slice(0, 8)
    .map((r: any) => {
      const revenue = Number(r.totalRevenue);
      const gross = Number(r.grossProfit);
      const operating = Number(r.operatingIncome);
      if (!revenue || Number.isNaN(revenue)) return null;
      return {
        gross: (gross / revenue) * 100,
        operating: (operating / revenue) * 100,
      };
    })
    .filter((m: any) => m && !Number.isNaN(m.gross) && !Number.isNaN(m.operating));

  if (margins.length < 3) return null;

  const mean = (values: number[]) => values.reduce((acc, v) => acc + v, 0) / values.length;
  const stddev = (values: number[]) => {
    const avg = mean(values);
    const variance = values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length;
    return Math.sqrt(variance);
  };

  const grossStd = stddev(margins.map((m: any) => m.gross));
  const operatingStd = stddev(margins.map((m: any) => m.operating));
  const stabilityPenalty = (grossStd + operatingStd) / 2;
  return clampScore(100 - stabilityPenalty * 10);
}

function computePricingPower(data: StockReportData): number | null {
  const grossMargin = normalizePercent(data.basicFinancials?.metric?.grossMarginTTM);
  const roe = normalizePercent(data.basicFinancials?.metric?.roeTTM);
  const avg = average([grossMargin, roe]);
  return avg === null ? null : clampScore(avg);
}

function computeAnalystConviction(data: StockReportData): number | null {
  const strongBuy = toNumber(data.analystRatings?.strongBuy);
  const buy = toNumber(data.analystRatings?.buy);
  const hold = toNumber(data.analystRatings?.hold);
  const sell = toNumber(data.analystRatings?.sell);
  const strongSell = toNumber(data.analystRatings?.strongSell);
  const total = [strongBuy, buy, hold, sell, strongSell]
    .filter((v) => v !== null)
    .reduce((acc, v) => acc + (v as number), 0);
  const strongBuyPct = total ? ((strongBuy || 0) / total) * 100 : null;

  const price = toNumber(data.price?.price);
  const targetMean = toNumber(data.priceTargets?.targetMean || data.analystRatings?.analystTargetPrice);
  const upsidePct = price && targetMean ? ((targetMean - price) / price) * 100 : null;
  const upsideScore = upsidePct === null ? null : clampScore(50 + upsidePct);

  return average([strongBuyPct, upsideScore]);
}

function computeScorecard(data: StockReportData) {
  const moatDetails = {
    marginStability: computeMarginStability(data.incomeStatement),
    pricingPower: computePricingPower(data),
    analystConviction: computeAnalystConviction(data),
  };
  const moat = average([
    moatDetails.marginStability,
    moatDetails.pricingPower,
    moatDetails.analystConviction,
  ]);

  const grossMargin = normalizePercent(data.basicFinancials?.metric?.grossMarginTTM);
  const operatingMargin = normalizePercent(data.basicFinancials?.metric?.operatingMarginTTM);
  const roe = normalizePercent(data.basicFinancials?.metric?.roeTTM);
  const profitability = average([grossMargin, operatingMargin, roe]);

  const revenueGrowth = normalizePercent(
    data.basicFinancials?.metric?.revenueGrowth5Y || data.basicFinancials?.metric?.revenueGrowthTTM
  );
  const epsGrowth = normalizePercent(data.basicFinancials?.metric?.epsGrowth5Y);
  const growth = average([revenueGrowth, epsGrowth]);

  const pe = toNumber(data.companyOverview?.peRatio ?? data.basicFinancials?.metric?.peBasicExclExtraTTM);
  const valuation = pe && pe > 0 ? clampScore(100 - (pe / 50) * 100) : null;

  const momentum = computeMomentum(data.priceHistory?.prices);

  const components = {
    growth,
    profitability,
    valuation,
    momentum,
    moat,
  } satisfies Record<'growth' | 'profitability' | 'valuation' | 'momentum' | 'moat', number | null>;

  const weights: Record<keyof typeof components, number> = {
    growth: 0.25,
    profitability: 0.2,
    valuation: 0.2,
    momentum: 0.15,
    moat: 0.2,
  };

  const available = (Object.keys(components) as Array<keyof typeof components>).filter(
    (key) => components[key] !== null
  );

  const totalWeight = available.reduce((sum, key) => sum + weights[key], 0);
  const composite = available.reduce((sum, key) => sum + (components[key] as number) * (weights[key] / totalWeight), 0);

  return {
    components,
    composite: available.length ? clampScore(composite) : null,
    moatDetails,
  };
}

export function buildStockReport(data: StockReportData): string {
  const priceChart = buildPriceChart(data.priceHistory?.prices || []);
  const epsChart = buildEpsChart(data.earningsHistory?.quarterlyEarnings || []);
  const revenueChart = buildRevenueChart(data.incomeStatement);
  const marginChart = buildMarginChart(data.incomeStatement);
  const targetChart = buildTargetDistribution(data.priceTargets);
  const headline = `# ${data.symbol} Comprehensive Equity Research Report`;
  const scorecard = computeScorecard(data);

  const snapshotLines = [
    `- Price: ${data.price?.price || 'Unavailable'} (${data.price?.changePercent || 'Unavailable'})`,
    `- Market Cap: ${data.companyOverview?.marketCapitalization || 'Unavailable'}`,
    `- Sector: ${data.companyOverview?.sector || 'Unavailable'}`,
    `- Industry: ${data.companyOverview?.industry || 'Unavailable'}`,
  ].filter((line) => !line.endsWith('Unavailable') && !line.includes('(Unavailable)'));

  const sections: string[] = [
    headline,
    `Generated: ${data.generatedAt}`,
    '## 📊 Snapshot',
    ...(snapshotLines.length ? snapshotLines : ['- Snapshot data unavailable']),
  ];

  if (priceChart || epsChart) {
    sections.push('## 📈 Price & EPS Trends');
    if (priceChart) sections.push(priceChart);
    if (epsChart) sections.push(epsChart);
  }

  if (revenueChart || marginChart) {
    sections.push('## 📊 Revenue & Margin Trends');
    if (revenueChart) sections.push(revenueChart);
    if (marginChart) sections.push(marginChart);
  }

  const financialLines = [
    `- P/E: ${data.companyOverview?.peRatio || data.basicFinancials?.metric?.peBasicExclExtraTTM || 'Unavailable'}`,
    `- PEG: ${data.companyOverview?.pegRatio || 'Unavailable'}`,
    `- Gross Margin: ${data.basicFinancials?.metric?.grossMarginTTM || 'Unavailable'}`,
    `- Operating Margin: ${data.basicFinancials?.metric?.operatingMarginTTM || 'Unavailable'}`,
    `- ROE: ${data.basicFinancials?.metric?.roeTTM || 'Unavailable'}`,
  ].filter((line) => !line.endsWith('Unavailable'));
  if (financialLines.length) {
    sections.push('## 💰 Financials', ...financialLines);
  }

  const analystTarget = toNumber(data.priceTargets?.targetMean || data.analystRatings?.analystTargetPrice);
  const hasRatings = [data.analystRatings?.strongBuy, data.analystRatings?.buy, data.analystRatings?.hold]
    .map((value) => toNumber(value))
    .some((value) => value !== null);
  if (analystTarget !== null || hasRatings || targetChart) {
    sections.push('## 🧠 Analyst View');
    if (analystTarget !== null) sections.push(`- Target Mean: ${analystTarget.toFixed(2)}`);
    if (hasRatings) {
      sections.push(`- Ratings: Strong Buy ${data.analystRatings?.strongBuy || 'Unavailable'} / Buy ${data.analystRatings?.buy || 'Unavailable'} / Hold ${data.analystRatings?.hold || 'Unavailable'}`);
    }
    if (targetChart) sections.push(targetChart);
  }

  if (scorecard.composite !== null) {
    sections.push(
      '## ✅ Scorecard',
      `- Growth: ${scorecard.components.growth?.toFixed(1) ?? 'Unavailable'} (avg of revenue/EPS growth %)`,
      `- Profitability: ${scorecard.components.profitability?.toFixed(1) ?? 'Unavailable'} (avg of gross/operating margin, ROE)`,
      `- Valuation: ${scorecard.components.valuation?.toFixed(1) ?? 'Unavailable'} (100 - PE/50*100)`,
      `- Momentum: ${scorecard.components.momentum?.toFixed(1) ?? 'Unavailable'}`,
      `- Moat: ${scorecard.components.moat?.toFixed(1) ?? 'Unavailable'} (avg of margin stability, pricing power, analyst conviction)`,
      `- Composite Score: ${scorecard.composite?.toFixed(1) ?? 'Unavailable'}`,
    );
  }

  const headlines = (data.companyNews?.articles || [])
    .map((a) => a.headline || a.title)
    .filter(Boolean);
  const sentiment = data.newsSentiment?.sentiment?.sentiment || data.newsSentiment?.sentiment?.buzz;
  if (sentiment || headlines.length) {
    sections.push('## 🔍 News & Sentiment');
    if (sentiment) sections.push(`- Sentiment: ${sentiment}`);
    if (headlines.length) sections.push(`- Recent Headlines: ${headlines.slice(0, 5).join('; ')}`);
  }

  return sections.filter(Boolean).join('\n\n');
}

export function buildSectorReport(data: SectorReportData): string {
  const header = `# Sector/Thematic Report: ${data.query}`;
  const notes = data.notes?.length ? data.notes.map((n) => `- ${n}`).join('\n') : '';
  const stopwords = new Set(['stocks', 'stock', 'sector', 'theme', 'report', 'the', 'and', 'for', 'of', 'in']);
  const terms = data.query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !stopwords.has(token));

  const scored = data.items.map((item) => {
    const scoreData: StockReportData = {
      symbol: item.symbol,
      generatedAt: data.generatedAt,
      price: item.price || {},
      priceHistory: undefined,
      companyOverview: item.overview,
      basicFinancials: item.basicFinancials,
      earningsHistory: undefined,
      incomeStatement: undefined,
      balanceSheet: undefined,
      cashFlow: undefined,
      analystRatings: item.analystRatings,
      analystRecommendations: undefined,
      priceTargets: item.priceTargets,
      peers: undefined,
      newsSentiment: item.newsSentiment,
      companyNews: undefined,
    };
    const scorecard = computeScorecard(scoreData);
    return { item, score: scorecard.composite };
  });

  const inclusionRows = data.items.map((item) => {
    const name = item.overview?.name || item.symbol;
    const text = [
      item.overview?.name,
      item.overview?.sector,
      item.overview?.industry,
      item.overview?.description,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matched = terms.filter((term) => text.includes(term));
    const reason = matched.length
      ? `Matched terms: ${Array.from(new Set(matched)).join(', ')}`
      : 'Matched via symbol search';
    return `| ${name} (${item.symbol}) | ${reason} |`;
  });
  const inclusionSection = inclusionRows.length
    ? ['| Company (Ticker) | Why Included |', '|---|---|', ...inclusionRows].join('\n')
    : '_No companies matched the query._';

  const overviewRows = data.items.map((item) => {
    const name = item.overview?.name || item.symbol;
    const description = item.overview?.description || '';
    const firstSentence = description.split('. ').shift();
    const role = firstSentence
      ? `${firstSentence}.`
      : (item.overview?.industry || item.overview?.sector || 'Overview unavailable');
    return {
      name: `${name} (${item.symbol})`,
      role,
      price: toNumber(item.price?.price),
      eps: toNumber(item.basicFinancials?.metric?.epsTTM ?? item.overview?.eps),
      pe: toNumber(item.overview?.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM),
    };
  });
  const overviewColumns = [
    { key: 'role', label: 'Role in Sector', format: (row: any) => row.role },
    {
      key: 'price',
      label: 'Price',
      format: (row: any) => (row.price === null ? null : row.price.toFixed(2)),
      optional: true,
    },
    {
      key: 'eps',
      label: 'EPS',
      format: (row: any) => (row.eps === null ? null : row.eps.toFixed(2)),
      optional: true,
    },
    {
      key: 'pe',
      label: 'P/E',
      format: (row: any) => (row.pe === null ? null : row.pe.toFixed(1)),
      optional: true,
    },
  ];
  const activeOverviewColumns = overviewColumns.filter((column: any) => {
    if (!column.optional) return true;
    return overviewRows.some((row: any) => column.format(row) !== null);
  });
  const overviewHeader = ['Company (Ticker)', ...activeOverviewColumns.map((column: any) => column.label)];
  const overviewSection = overviewRows.length
    ? [
        `| ${overviewHeader.join(' | ')} |`,
        `| ${overviewHeader.map(() => '---').join(' | ')} |`,
        ...overviewRows.map((row) => {
          const values = activeOverviewColumns.map((column: any) => column.format(row) ?? 'Unavailable');
          return `| ${[row.name, ...values].join(' | ')} |`;
        }),
      ].join('\n')
    : '_Company overview unavailable._';

  const dependencyRows = data.items.map((item) => {
    const name = item.overview?.name || item.symbol;
    const industry = item.overview?.industry;
    const sector = item.overview?.sector;
    const dependency = industry || sector
      ? `Industry: ${industry || 'Unavailable'}; Sector: ${sector || 'Unavailable'}`
      : 'Dependency data unavailable';
    return `| ${name} (${item.symbol}) | ${dependency} |`;
  });
  const dependencySection = dependencyRows.length
    ? ['| Company (Ticker) | Dependencies |', '|---|---|', ...dependencyRows].join('\n')
    : '_Dependency data unavailable._';

  const analystRows = data.items.map((item) => {
    const name = item.overview?.name || item.symbol;
    const ratings = item.analystRatings || item.overview || {};
    const counts = [
      toNumber(ratings.strongBuy ?? ratings.analystRatingStrongBuy),
      toNumber(ratings.buy ?? ratings.analystRatingBuy),
      toNumber(ratings.hold ?? ratings.analystRatingHold),
      toNumber(ratings.sell ?? ratings.analystRatingSell),
      toNumber(ratings.strongSell ?? ratings.analystRatingStrongSell),
    ];
    const hasRatings = counts.some((value) => value !== null);
    const rating = hasRatings
      ? `SB ${counts[0] ?? 0} / B ${counts[1] ?? 0} / H ${counts[2] ?? 0} / S ${counts[3] ?? 0} / SS ${counts[4] ?? 0}`
      : null;
    const target = toNumber(item.priceTargets?.targetMean || ratings.analystTargetPrice);
    const price = toNumber(item.price?.price);
    const upside = price && target ? `${(((target - price) / price) * 100).toFixed(1)}%` : null;
    return {
      name: `${name} (${item.symbol})`,
      rating,
      target,
      upside,
    };
  });
  const hasAnalystData = analystRows.some((row) => row.rating || row.target !== null);
  const analystSection = hasAnalystData
    ? [
        '| Company (Ticker) | Analyst Ratings | Target Mean | Upside |',
        '|---|---|---:|---:|',
        ...analystRows.map((row) => {
          const rating = row.rating ?? 'Unavailable';
          const target = row.target === null ? 'Unavailable' : row.target.toFixed(2);
          const upside = row.upside ?? 'Unavailable';
          return `| ${row.name} | ${rating} | ${target} | ${upside} |`;
        }),
      ].join('\n')
    : '_Analyst ratings are not provided by Alpha Vantage for this theme._';

  const scoredSorted = scored.filter((row) => row.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const scoreCount = scoredSorted.length;
  const recommendationRows = scored.map((row) => {
    const name = row.item.overview?.name || row.item.symbol;
    if (row.score === null || scoreCount === 0) {
      return `| ${name} (${row.item.symbol}) | Unavailable | Unavailable | Insufficient data |`;
    }
    const rank = scoredSorted.findIndex((sorted) => sorted.item.symbol === row.item.symbol) + 1;
    const percentile = scoreCount > 1 ? 1 - (rank - 1) / (scoreCount - 1) : 1;
    const recommendation = percentile >= 0.67
      ? 'Overweight'
      : percentile >= 0.34
        ? 'Neutral'
        : 'Underweight';
    return `| ${name} (${row.item.symbol}) | ${row.score.toFixed(1)} | ${rank} | ${recommendation} |`;
  });
  const recommendationSection = recommendationRows.length
    ? ['| Company (Ticker) | Score | Rank | Recommendation |', '|---|---:|---:|---|', ...recommendationRows].join('\n')
    : '_Recommendations unavailable._';

  const sectorCounts = data.items.reduce((acc: Record<string, number>, item) => {
    const sector = item.overview?.sector || 'Uncategorized';
    acc[sector] = (acc[sector] || 0) + 1;
    return acc;
  }, {});
  const sectorMix = Object.entries(sectorCounts)
    .map(([sector, count]) => `${sector} (${count})`)
    .join(', ');

  const sections = [
    header,
    `Generated: ${data.generatedAt}`,
    '## 🧭 Sector Summary',
    `- Query: ${data.query}`,
    `- Universe Size: ${data.universe.length}`,
    sectorMix ? `- Sector Mix: ${sectorMix}` : null,
    notes ? `- Notes:\n${notes}` : null,
    '## ✅ Companies Included',
    inclusionSection,
    '## 🧾 Company Overview',
    overviewSection,
    '## 🔗 Dependencies',
    dependencySection,
    '## 🧠 Analyst View',
    analystSection,
    '## ✅ Recommendations',
    recommendationSection,
    '_Not financial advice. Use this as a starting point for diligence._',
  ].filter(Boolean) as string[];

  return sections.join('\n\n');
}

export async function saveReport(content: string, title: string, directory = DEFAULT_REPORTS_DIR) {
  const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${safeTitle || 'report'}-${timestamp}.md`;
  const reportDir = directory;

  await fs.mkdir(reportDir, { recursive: true });
  const filePath = path.join(reportDir, filename);
  await fs.writeFile(filePath, content, 'utf8');

  return { filePath, filename };
}

export function buildPeerReport(data: PeerReportData): string {
  const header = `# Peer Comparison Report: ${data.symbol}`;
  const notes = data.notes?.length ? data.notes.map((note) => `- ${note}`).join('\n') : '';

  const scored = data.items.map((item) => {
    const scoreData: StockReportData = {
      symbol: item.symbol,
      generatedAt: data.generatedAt,
      price: item.price || {},
      priceHistory: item.priceHistory,
      companyOverview: item.overview,
      basicFinancials: item.basicFinancials,
      earningsHistory: undefined,
      incomeStatement: undefined,
      balanceSheet: undefined,
      cashFlow: undefined,
      analystRatings: undefined,
      analystRecommendations: undefined,
      priceTargets: item.priceTargets,
      peers: undefined,
      newsSentiment: undefined,
      companyNews: undefined,
    };
    const scorecard = computeScorecard(scoreData);
    return { item, score: scorecard.composite };
  });

  const inclusionRows = data.items.map((item) => {
    const name = item.overview?.name || item.symbol;
    const reason = item.symbol.toUpperCase() === data.symbol.toUpperCase()
      ? 'Base company'
      : 'Peer comparison set';
    return `| ${name} (${item.symbol}) | ${reason} |`;
  });
  const inclusionSection = inclusionRows.length
    ? ['| Company (Ticker) | Why Included |', '|---|---|', ...inclusionRows].join('\n')
    : '_Peer universe unavailable._';

  const snapshotRows = data.items.map((item) => {
    const name = item.overview?.name || item.symbol;
    return {
      name: `${name} (${item.symbol})`,
      price: toNumber(item.price?.price),
      marketCap: item.overview?.marketCapitalization ?? null,
      eps: getEpsValue(item),
      pe: toNumber(item.overview?.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM),
      target: toNumber(item.priceTargets?.targetMean ?? item.overview?.analystTargetPrice),
      upside: getTargetUpside(item),
    };
  });
  const snapshotColumns = [
    {
      key: 'price',
      label: 'Price',
      format: (row: any) => (row.price === null ? null : row.price.toFixed(2)),
      optional: true,
    },
    {
      key: 'marketCap',
      label: 'Market Cap',
      format: (row: any) => (row.marketCap === null ? null : formatMarketCap(row.marketCap)),
      optional: true,
    },
    {
      key: 'eps',
      label: 'EPS',
      format: (row: any) => (row.eps === null ? null : row.eps.toFixed(2)),
      optional: true,
    },
    {
      key: 'pe',
      label: 'P/E',
      format: (row: any) => (row.pe === null ? null : row.pe.toFixed(1)),
      optional: true,
    },
    {
      key: 'target',
      label: 'Target Mean',
      format: (row: any) => (row.target === null ? null : row.target.toFixed(2)),
      optional: true,
    },
    {
      key: 'upside',
      label: 'Upside',
      format: (row: any) => (row.upside === null ? null : `${row.upside.toFixed(1)}%`),
      optional: true,
    },
  ];
  const activeSnapshotColumns = snapshotColumns.filter((column: any) => {
    if (!column.optional) return true;
    return snapshotRows.some((row: any) => column.format(row) !== null);
  });
  const snapshotHeader = ['Company (Ticker)', ...activeSnapshotColumns.map((column: any) => column.label)];
  const snapshotSection = snapshotRows.length
    ? [
        `| ${snapshotHeader.join(' | ')} |`,
        `| ${snapshotHeader.map(() => '---').join(' | ')} |`,
        ...snapshotRows.map((row) => {
          const values = activeSnapshotColumns.map((column: any) => column.format(row) ?? 'Unavailable');
          return `| ${[row.name, ...values].join(' | ')} |`;
        }),
      ].join('\n')
    : '_Peer snapshot unavailable._';

  const roleRows = data.items.map((item) => {
    const name = item.overview?.name || item.symbol;
    const description = item.overview?.description || '';
    const firstSentence = description.split('. ').shift();
    const role = firstSentence ? `${firstSentence}.` : (item.overview?.industry || item.overview?.sector || 'Role unavailable');
    return `| ${name} (${item.symbol}) | ${role} |`;
  });
  const roleSection = roleRows.length
    ? ['| Company (Ticker) | Role in Peer Set |', '|---|---|', ...roleRows].join('\n')
    : '_Role data unavailable._';

  const analystRows = data.items.map((item) => {
    const name = item.overview?.name || item.symbol;
    const ratings = item.overview || {};
    const counts = [
      toNumber(ratings.analystRatingStrongBuy),
      toNumber(ratings.analystRatingBuy),
      toNumber(ratings.analystRatingHold),
      toNumber(ratings.analystRatingSell),
      toNumber(ratings.analystRatingStrongSell),
    ];
    const hasRatings = counts.some((value) => value !== null);
    const rating = hasRatings
      ? `SB ${counts[0] ?? 0} / B ${counts[1] ?? 0} / H ${counts[2] ?? 0} / S ${counts[3] ?? 0} / SS ${counts[4] ?? 0}`
      : null;
    const target = toNumber(item.priceTargets?.targetMean ?? item.overview?.analystTargetPrice);
    const price = toNumber(item.price?.price);
    const upside = price && target ? ((target - price) / price) * 100 : null;
    return {
      name: `${name} (${item.symbol})`,
      rating,
      target,
      upside,
    };
  });
  const hasAnalystData = analystRows.some((row) => row.rating || row.target !== null);
  const analystSection = hasAnalystData
    ? [
        '| Company (Ticker) | Analyst Ratings | Target Mean | Upside |',
        '|---|---|---:|---:|',
        ...analystRows.map((row) => {
          const rating = row.rating ?? 'Unavailable';
          const target = row.target === null ? 'Unavailable' : row.target.toFixed(2);
          const upside = row.upside === null ? 'Unavailable' : `${row.upside.toFixed(1)}%`;
          return `| ${row.name} | ${rating} | ${target} | ${upside} |`;
        }),
      ].join('\n')
    : '_Analyst ratings are not provided by Alpha Vantage for this peer set._';

  const scoredSorted = scored.filter((row) => row.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const scoreCount = scoredSorted.length;
  const recommendationRows = scored.map((row) => {
    const name = row.item.overview?.name || row.item.symbol;
    if (row.score === null || scoreCount === 0) {
      return `| ${name} (${row.item.symbol}) | Unavailable | Unavailable | Insufficient data |`;
    }
    const rank = scoredSorted.findIndex((sorted) => sorted.item.symbol === row.item.symbol) + 1;
    const percentile = scoreCount > 1 ? 1 - (rank - 1) / (scoreCount - 1) : 1;
    const recommendation = percentile >= 0.67
      ? 'Overweight'
      : percentile >= 0.34
        ? 'Neutral'
        : 'Underweight';
    return `| ${name} (${row.item.symbol}) | ${row.score.toFixed(1)} | ${rank} | ${recommendation} |`;
  });
  const recommendationSection = recommendationRows.length
    ? ['| Company (Ticker) | Score | Rank | Recommendation |', '|---|---:|---:|---|', ...recommendationRows].join('\n')
    : '_Recommendations unavailable._';

  const universeList = data.items.map((item) => `${item.overview?.name || item.symbol} (${item.symbol})`).join(', ');
  const sections = [
    header,
    `Generated: ${data.generatedAt}`,
    `Universe: ${universeList || 'Unavailable'}`,
    '## ✅ Companies Included',
    inclusionSection,
    '## 🧾 Company Snapshot',
    snapshotSection,
    '## 🧭 Role in Peer Set',
    roleSection,
    '## 🧠 Analyst View',
    analystSection,
    '## ✅ Recommendations',
    recommendationSection,
    notes ? `## 📝 Notes\n${notes}` : null,
    '_Not financial advice. Use this as a starting point for diligence._',
  ].filter(Boolean) as string[];

  return sections.join('\n\n');
}
