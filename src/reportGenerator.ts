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

const DEFAULT_REPORTS_DIR = process.env.REPORTS_DIR || 'reports';

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
  const series = downsample([...prices].slice(0, 30).reverse(), 12);
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
  const series = downsample([...earnings].slice(0, 16).reverse(), 12);
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
  };

  const weights: Record<string, number> = {
    growth: 0.25,
    profitability: 0.2,
    valuation: 0.2,
    momentum: 0.15,
    moat: 0.2,
  };

  const available = Object.entries(components)
    .filter(([, value]) => value !== null)
    .map(([key]) => key);

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

  const sections = [
    headline,
    `Generated: ${data.generatedAt}`,
    '## 📊 Snapshot',
    `- Price: ${data.price?.price || 'N/A'} (${data.price?.changePercent || 'N/A'})`,
    `- Market Cap: ${data.companyOverview?.marketCapitalization || 'N/A'}`,
    `- Sector: ${data.companyOverview?.sector || 'N/A'}`,
    `- Industry: ${data.companyOverview?.industry || 'N/A'}`,
    '## 📈 Price & EPS Trends',
    priceChart || '_Price history unavailable_',
    epsChart || '_EPS history unavailable_',
    '## 📊 Revenue & Margin Trends',
    revenueChart || '_Revenue trend unavailable_',
    marginChart || '_Margin trend unavailable_',
    '## 💰 Financials',
    `- P/E: ${data.companyOverview?.peRatio || data.basicFinancials?.metric?.peBasicExclExtraTTM || 'N/A'}`,
    `- PEG: ${data.companyOverview?.pegRatio || 'N/A'}`,
    `- Gross Margin: ${data.basicFinancials?.metric?.grossMarginTTM || 'N/A'}`,
    `- Operating Margin: ${data.basicFinancials?.metric?.operatingMarginTTM || 'N/A'}`,
    `- ROE: ${data.basicFinancials?.metric?.roeTTM || 'N/A'}`,
    '## 🧠 Analyst View',
    `- Target Mean: ${data.priceTargets?.targetMean || data.analystRatings?.analystTargetPrice || 'N/A'}`,
    `- Ratings: Strong Buy ${data.analystRatings?.strongBuy || 'N/A'} / Buy ${data.analystRatings?.buy || 'N/A'} / Hold ${data.analystRatings?.hold || 'N/A'}`,
    targetChart || '_Analyst target distribution unavailable_',
    '## ✅ Scorecard',
    `- Growth: ${scorecard.components.growth?.toFixed(1) ?? 'N/A'} (avg of revenue/EPS growth %)`,
    `- Profitability: ${scorecard.components.profitability?.toFixed(1) ?? 'N/A'} (avg of gross/operating margin, ROE)`,
    `- Valuation: ${scorecard.components.valuation?.toFixed(1) ?? 'N/A'} (100 - PE/50*100)`,
    `- Momentum: ${scorecard.components.momentum?.toFixed(1) ?? 'N/A'} (50 + price % change)`,
    `- Moat: ${scorecard.components.moat?.toFixed(1) ?? 'N/A'} (avg of margin stability, pricing power, analyst conviction)`,
    `- Moat • Margin Stability: ${scorecard.moatDetails.marginStability?.toFixed(1) ?? 'N/A'}`,
    `- Moat • Pricing Power: ${scorecard.moatDetails.pricingPower?.toFixed(1) ?? 'N/A'}`,
    `- Moat • Analyst Conviction: ${scorecard.moatDetails.analystConviction?.toFixed(1) ?? 'N/A'}`,
    `- Composite Score: ${scorecard.composite?.toFixed(1) ?? 'N/A'}`,
    '## 🔍 News & Sentiment',
    `- Sentiment: ${data.newsSentiment?.sentiment?.sentiment || data.newsSentiment?.sentiment?.buzz || 'N/A'}`,
    `- Recent Headlines: ${(data.companyNews?.articles || []).slice(0, 5).map((a) => a.headline || a.title).filter(Boolean).join('; ') || 'N/A'}`,
    '## ✅ Notes',
    'This report is generated from real-time data sources (Alpha Vantage, Finnhub, FMP, NewsAPI).',
  ];

  return sections.filter(Boolean).join('\n\n');
}

export function buildSectorReport(data: SectorReportData): string {
  const header = `# Sector/Thematic Report: ${data.query}`;
  const table = buildPeerTable(data.items);
  const notes = data.notes?.length ? data.notes.map((n) => `- ${n}`).join('\n') : 'N/A';

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
    return { symbol: item.symbol, score: scorecard.composite };
  });

  const scoreTable = scored
    .filter((row) => row.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((row) => `| ${row.symbol} | ${row.score?.toFixed(1)} |`);

  const scoreSection = scoreTable.length
    ? ['| Symbol | Composite Score |', '|---|---:|', ...scoreTable].join('\n')
    : '_Score data unavailable_';

  const marketCapSeries = data.items
    .map((item) => ({
      symbol: item.symbol,
      value: toNumber(item.overview?.marketCapitalization),
    }))
    .filter((item) => item.value !== null)
    .map((item) => ({ symbol: item.symbol, value: item.value as number }));

  const peSeries = data.items
    .map((item) => ({
      symbol: item.symbol,
      value: toNumber(item.overview?.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM),
    }))
    .filter((item) => item.value !== null)
    .map((item) => ({ symbol: item.symbol, value: item.value as number }));

  const priceSeries = data.items
    .map((item) => ({
      symbol: item.symbol,
      value: toNumber(item.price?.price),
    }))
    .filter((item) => item.value !== null)
    .map((item) => ({ symbol: item.symbol, value: item.value as number }));

  const marketCapChart = buildBarChart('Market Cap', 'Market Cap', marketCapSeries);
  const peChart = buildBarChart('P/E Ratio', 'P/E', peSeries);
  const priceChart = buildBarChart('Price', 'Price', priceSeries);
  const targetSeries = data.items
    .map((item) => ({
      symbol: item.symbol,
      value: toNumber(item.priceTargets?.targetMean || item.analystRatings?.analystTargetPrice),
    }))
    .filter((item) => item.value !== null)
    .map((item) => ({ symbol: item.symbol, value: item.value as number }));
  const targetChart = buildBarChart('Analyst Target Mean', 'Price', targetSeries);

  return [
    header,
    `Generated: ${data.generatedAt}`,
    `Universe: ${data.universe.join(', ') || 'N/A'}`,
    '## 📊 Charts',
    marketCapChart || '_Market cap chart unavailable_',
    peChart || '_P/E chart unavailable_',
    priceChart || '_Price chart unavailable_',
    targetChart || '_Analyst target chart unavailable_',
    '## ✅ Score Ranking',
    scoreSection,
    '## 📊 Comparison Table',
    table || '_No data available_',
    '## 🔍 Notes',
    notes,
  ].join('\n\n');
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
