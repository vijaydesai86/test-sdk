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
  companyNews?: { articles?: any[] };
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
  companyNews?: { articles?: any[] };
}

export interface PeerReportData {
  symbol: string;
  generatedAt: string;
  range: string;
  universe: string[];
  items: PeerReportItem[];
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

function formatPercent(value: unknown, decimals = 1): string {
  const num = normalizePercent(value);
  if (num === null) return 'N/A';
  return `${num.toFixed(decimals)}%`;
}

function formatCurrency(value: unknown): string {
  const formatted = formatMarketCap(value);
  if (formatted === 'N/A') return 'N/A';
  return `$${formatted}`;
}

function summarizeDescription(description: string, maxSentences = 2): string {
  const sentences = description.split('. ').filter(Boolean);
  if (sentences.length <= maxSentences) return description.trim();
  const snippet = sentences.slice(0, maxSentences).join('. ');
  return snippet.endsWith('.') ? snippet : `${snippet}.`;
}

function extractThemes(text?: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const themes = [
    { label: 'AI / ML', pattern: /(ai|artificial intelligence|machine learning)/ },
    { label: 'Data Center', pattern: /(data center|datacenter|hyperscale)/ },
    { label: 'Mobile & Consumer', pattern: /(mobile|smartphone|consumer|handset)/ },
    { label: 'Automotive', pattern: /(automotive|vehicle|car|autonomous)/ },
    { label: 'IoT / Edge', pattern: /(iot|edge|embedded)/ },
    { label: 'Cloud & SaaS', pattern: /(cloud|saas|subscription|platform)/ },
    { label: 'Licensing / IP', pattern: /(licensing|royalty|ip core)/ },
    { label: 'Security', pattern: /(security|trust|secure)/ },
  ];
  return themes.filter((theme) => theme.pattern.test(lower)).map((theme) => theme.label);
}

function getLatestReport(reportSet?: any): any | null {
  const reports = reportSet?.quarterlyReports || reportSet?.annualReports || [];
  if (!Array.isArray(reports) || reports.length === 0) return null;
  return reports[0];
}

function formatPeriodLabel(report: any): string {
  return report?.fiscalQuarter || report?.fiscalYear || report?.fiscalDateEnding || 'N/A';
}

function buildTable(headers: string[], rows: string[][], alignments?: Array<'left' | 'center' | 'right'>): string {
  const headerRow = `| ${headers.join(' | ')} |`;
  const safeAlignments = alignments && alignments.length === headers.length
    ? alignments
    : headers.map(() => 'left');
  const dividerRow = `| ${safeAlignments.map((alignment) => {
    if (alignment === 'right') return '---:';
    if (alignment === 'center') return ':---:';
    return '---';
  }).join(' | ')} |`;
  return [headerRow, dividerRow, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function applyAxisTheme(axis: any): any {
  if (!axis) return axis;
  return {
    ...axis,
    axisLine: {
      ...(axis.axisLine || {}),
      lineStyle: { color: '#94a3b8', ...(axis.axisLine?.lineStyle || {}) },
    },
    axisTick: {
      ...(axis.axisTick || {}),
      lineStyle: { color: '#94a3b8', ...(axis.axisTick?.lineStyle || {}) },
    },
    axisLabel: { color: '#475569', ...(axis.axisLabel || {}) },
    splitLine: {
      ...(axis.splitLine || {}),
      lineStyle: { color: '#e2e8f0', ...(axis.splitLine?.lineStyle || {}) },
    },
  };
}

function applyChartTheme(option: Record<string, any>): Record<string, any> {
  const base = {
    color: ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7'],
    textStyle: {
      fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, sans-serif',
      color: '#0f172a',
    },
    tooltip: {
      backgroundColor: '#0f172a',
      borderColor: '#1e293b',
      textStyle: { color: '#f8fafc' },
    },
    legend: { textStyle: { color: '#475569' } },
  };

  const themed = { ...base, ...option };

  return {
    ...themed,
    grid: { containLabel: true, ...(option.grid || {}) },
    tooltip: { ...base.tooltip, ...(option.tooltip || {}) },
    legend: { ...base.legend, ...(option.legend || {}) },
    xAxis: Array.isArray(option.xAxis)
      ? option.xAxis.map((axis: any) => applyAxisTheme(axis))
      : applyAxisTheme(option.xAxis),
    yAxis: Array.isArray(option.yAxis)
      ? option.yAxis.map((axis: any) => applyAxisTheme(axis))
      : applyAxisTheme(option.yAxis),
  };
}

function getStockRevenueGrowth(data: StockReportData): number | null {
  const metric = getMetricValue(data.basicFinancials?.metric, [
    'revenueGrowthTTM',
    'revenueGrowthAnnual',
    'revenueGrowth5Y',
  ]);
  return normalizePercent(metric ?? data.companyOverview?.quarterlyRevenueGrowth);
}

function getStockEpsGrowth(data: StockReportData): number | null {
  const metric = getMetricValue(data.basicFinancials?.metric, ['epsGrowthTTM', 'epsGrowthAnnual']);
  return normalizePercent(metric ?? data.companyOverview?.quarterlyEarningsGrowth);
}

function getTargetUpsideStock(data: StockReportData): number | null {
  const price = toNumber(data.price?.price);
  const target = toNumber(data.priceTargets?.targetMean || data.analystRatings?.analystTargetPrice);
  if (!price || !target) return null;
  return ((target - price) / price) * 100;
}

function buildScorecardRadar(scorecard: ReturnType<typeof computeScorecard>): string {
  const entries = [
    { label: 'Growth', value: scorecard.components.growth },
    { label: 'Profitability', value: scorecard.components.profitability },
    { label: 'Valuation', value: scorecard.components.valuation },
    { label: 'Momentum', value: scorecard.components.momentum },
    { label: 'Moat', value: scorecard.components.moat },
  ].filter((entry) => entry.value !== null);

  if (entries.length === 0) return '';

  const indicators = entries.map((entry) => ({ name: entry.label, max: 100 }));
  const values = entries.map((entry) => Number((entry.value as number).toFixed(1)));

  return buildChartBlock({
    title: { text: 'Scorecard Radar', left: 'center' },
    tooltip: { trigger: 'item' },
    radar: {
      indicator: indicators,
      radius: '65%',
      splitNumber: 4,
    },
    series: [
      {
        name: 'Scorecard',
        type: 'radar',
        data: [{ value: values, name: 'Scorecard' }],
        areaStyle: { opacity: 0.2 },
      },
    ],
  });
}

function getMetricValue(metrics: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(metrics?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function formatRatingSummary(item: SectorReportItem | PeerReportItem | StockReportData): string {
  const ratings = (item as any).analystRatings || (item as any).companyOverview || (item as any).overview;
  const strongBuy = toNumber(ratings?.strongBuy ?? ratings?.analystRatingStrongBuy);
  const buy = toNumber(ratings?.buy ?? ratings?.analystRatingBuy);
  const hold = toNumber(ratings?.hold ?? ratings?.analystRatingHold);
  const sell = toNumber(ratings?.sell ?? ratings?.analystRatingSell);
  const strongSell = toNumber(ratings?.strongSell ?? ratings?.analystRatingStrongSell);

  if ([strongBuy, buy, hold, sell, strongSell].every((value) => value === null)) {
    return 'N/A';
  }

  return `SB ${strongBuy ?? 0} / B ${buy ?? 0} / H ${hold ?? 0} / S ${sell ?? 0} / SS ${strongSell ?? 0}`;
}

function deriveLayer(item: SectorReportItem): string {
  const text = [
    item.overview?.industry,
    item.overview?.sector,
    item.overview?.description,
    item.overview?.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(semiconductor|gpu|accelerator|chip|processor|foundry)/.test(text)) {
    return 'Compute & Accelerators';
  }
  if (/(network|infiniband|ethernet|switch|optical)/.test(text)) {
    return 'Networking & Interconnect';
  }
  if (/(data center|colocation|reit|power|cooling|infrastructure)/.test(text)) {
    return 'Data Center Infrastructure';
  }
  if (/(storage|memory|flash|ssd)/.test(text)) {
    return 'Storage & Memory';
  }
  if (/(cloud|platform|software|ai|analytics|ml|inference)/.test(text)) {
    return 'Platforms & Software';
  }
  return 'Other / Diversified';
}

function getEpsValue(item: SectorReportItem | PeerReportItem): number | null {
  return getMetricValue(item.basicFinancials?.metric, ['epsTTM', 'epsNormalizedAnnual'])
    ?? toNumber(item.overview?.eps);
}

function getRevenueGrowth(item: SectorReportItem | PeerReportItem): number | null {
  const metric = getMetricValue(item.basicFinancials?.metric, [
    'revenueGrowthTTM',
    'revenueGrowthAnnual',
    'revenueGrowth5Y',
  ]);
  return normalizePercent(metric ?? item.overview?.quarterlyRevenueGrowth);
}

function getEpsGrowth(item: SectorReportItem | PeerReportItem): number | null {
  const metric = getMetricValue(item.basicFinancials?.metric, ['epsGrowthTTM', 'epsGrowthAnnual']);
  return normalizePercent(metric ?? item.overview?.quarterlyEarningsGrowth);
}

function getGrossMargin(item: SectorReportItem | PeerReportItem): number | null {
  const metric = getMetricValue(item.basicFinancials?.metric, ['grossMarginTTM', 'grossMarginAnnual']);
  return normalizePercent(metric ?? item.overview?.profitMargin);
}

function getOperatingMargin(item: SectorReportItem | PeerReportItem): number | null {
  const metric = getMetricValue(item.basicFinancials?.metric, ['operatingMarginTTM', 'operatingMarginAnnual']);
  return normalizePercent(metric ?? item.overview?.operatingMargin);
}

function getTargetUpside(item: SectorReportItem | PeerReportItem): number | null {
  const price = toNumber(item.price?.price);
  const target = toNumber(item.priceTargets?.targetMean || (item as any).analystRatings?.analystTargetPrice);
  if (!price || !target) return null;
  return ((target - price) / price) * 100;
}

function getMovingAverage(item: SectorReportItem | PeerReportItem): number | null {
  return toNumber(item.overview?.['50DayMovingAverage'] ?? (item as any).analystRatings?.movingAverage50Day);
}

function formatPriceTrend(item: SectorReportItem | PeerReportItem): string {
  const price = toNumber(item.price?.price);
  const average = getMovingAverage(item);
  if (!price || !average) return 'N/A';
  const diff = ((price - average) / average) * 100;
  const direction = diff >= 0 ? 'above' : 'below';
  return `${diff.toFixed(1)}% ${direction} 50D MA`;
}

function getHeadline(article: any): string | null {
  if (!article) return null;
  return article.headline || article.title || null;
}

function buildNewsHighlights(items: Array<SectorReportItem | PeerReportItem>, limit = 2): string {
  const rows = items
    .map((item) => {
      const headlines = (item.companyNews?.articles || [])
        .map(getHeadline)
        .filter(Boolean)
        .slice(0, limit) as string[];
      if (headlines.length === 0) return null;
      return `- ${item.symbol}: ${headlines.join('; ')}`;
    })
    .filter((row): row is string => row !== null);

  return rows.length ? rows.join('\n') : 'N/A';
}

function buildKeyTakeaways(items: SectorReportItem[], scored: { item: SectorReportItem; score: number | null }[]): string {
  if (items.length === 0) return 'N/A';
  const byMarketCap = [...items].sort((a, b) => (toNumber(b.overview?.marketCapitalization) || 0) - (toNumber(a.overview?.marketCapitalization) || 0));
  const byRevenueGrowth = [...items].sort((a, b) => (getRevenueGrowth(b) || 0) - (getRevenueGrowth(a) || 0));
  const byEpsGrowth = [...items].sort((a, b) => (getEpsGrowth(b) || 0) - (getEpsGrowth(a) || 0));
  const byMargin = [...items].sort((a, b) => (getGrossMargin(b) || 0) - (getGrossMargin(a) || 0));
  const byUpside = [...items].sort((a, b) => (getTargetUpside(b) || 0) - (getTargetUpside(a) || 0));
  const topScore = [...scored]
    .filter((row) => row.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

  const takeaways = [
    byMarketCap[0] ? `Largest market cap: ${byMarketCap[0].symbol} (${formatMarketCap(byMarketCap[0].overview?.marketCapitalization)})` : null,
    byRevenueGrowth[0] && getRevenueGrowth(byRevenueGrowth[0]) !== null
      ? `Fastest revenue growth: ${byRevenueGrowth[0].symbol} (${formatPercent(getRevenueGrowth(byRevenueGrowth[0]))})`
      : null,
    byEpsGrowth[0] && getEpsGrowth(byEpsGrowth[0]) !== null
      ? `Fastest EPS growth: ${byEpsGrowth[0].symbol} (${formatPercent(getEpsGrowth(byEpsGrowth[0]))})`
      : null,
    byMargin[0] && getGrossMargin(byMargin[0]) !== null
      ? `Highest gross margin: ${byMargin[0].symbol} (${formatPercent(getGrossMargin(byMargin[0]))})`
      : null,
    byUpside[0] && getTargetUpside(byUpside[0]) !== null
      ? `Largest target upside: ${byUpside[0].symbol} (${getTargetUpside(byUpside[0])?.toFixed(1)}%)`
      : null,
    topScore ? `Top composite score: ${topScore.item.symbol} (${topScore.score?.toFixed(1)})` : null,
  ].filter(Boolean) as string[];

  return takeaways.length ? takeaways.map((line) => `- ${line}`).join('\n') : 'N/A';
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

function buildSectorMetricsTable(items: SectorReportItem[], layers: Map<string, string>): string {
  if (items.length === 0) return '';
  const header = '| Symbol | Company | Layer | Price | Market Cap | EPS (TTM) | Rev Growth | EPS Growth | Gross Margin |';
  const divider = '|---|---|---|---:|---:|---:|---:|---:|---:|';
  const rows = items.map((item) => {
    const price = formatNumber(item.price?.price, 2);
    const marketCap = formatMarketCap(item.overview?.marketCapitalization);
    const eps = getEpsValue(item);
    const revenueGrowth = getRevenueGrowth(item);
    const epsGrowth = getEpsGrowth(item);
    const grossMargin = getGrossMargin(item);
    return [
      item.symbol,
      item.overview?.name || 'N/A',
      layers.get(item.symbol) || 'Other / Diversified',
      price,
      marketCap,
      eps === null ? 'N/A' : eps.toFixed(2),
      revenueGrowth === null ? 'N/A' : `${revenueGrowth.toFixed(1)}%`,
      epsGrowth === null ? 'N/A' : `${epsGrowth.toFixed(1)}%`,
      grossMargin === null ? 'N/A' : `${grossMargin.toFixed(1)}%`,
    ].join(' | ');
  });

  return [header, divider, ...rows.map((row) => `| ${row} |`)].join('\n');
}

function buildSectorSentimentTable(items: SectorReportItem[]): string {
  if (items.length === 0) return '';
  const header = '| Symbol | Analyst Ratings | Target Mean | Target Upside | P/E | Operating Margin | Price vs 50D |';
  const divider = '|---|---|---:|---:|---:|---:|---|';
  const rows = items.map((item) => {
    const ratings = formatRatingSummary(item);
    const target = formatNumber(item.priceTargets?.targetMean || item.analystRatings?.analystTargetPrice, 2);
    const upside = getTargetUpside(item);
    const pe = toNumber(item.overview?.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM);
    const operatingMargin = getOperatingMargin(item);
    const trend = formatPriceTrend(item);
    return [
      item.symbol,
      ratings,
      target,
      upside === null ? 'N/A' : `${upside.toFixed(1)}%`,
      pe === null ? 'N/A' : pe.toFixed(1),
      operatingMargin === null ? 'N/A' : `${operatingMargin.toFixed(1)}%`,
      trend,
    ].join(' | ');
  });

  return [header, divider, ...rows.map((row) => `| ${row} |`)].join('\n');
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
  return ['```chart', JSON.stringify(applyChartTheme(option), null, 2), '```'].join('\n');
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
  const overview = data.companyOverview || {};
  const price = toNumber(data.price?.price);
  const snapshotLines = [
    `- Price: ${data.price?.price || 'Unavailable'} (${data.price?.changePercent || 'Unavailable'})`,
    `- Market Cap: ${formatMarketCap(overview.marketCapitalization)}`,
    `- Sector: ${overview.sector || 'Unavailable'}`,
    `- Industry: ${overview.industry || 'Unavailable'}`,
  ].filter((line) => !line.endsWith('Unavailable') && !line.endsWith('N/A') && !line.includes('(Unavailable)'));

  const description = overview.description ? summarizeDescription(overview.description) : null;
  const businessLines = [
    overview.name ? `- Company: ${overview.name} (${data.symbol})` : `- Company: ${data.symbol}`,
    description ? `- Description: ${description}` : null,
    overview.sector ? `- Sector: ${overview.sector}` : null,
    overview.industry ? `- Industry: ${overview.industry}` : null,
    overview.marketCapitalization ? `- Market Cap: ${formatCurrency(overview.marketCapitalization)}` : null,
    overview.revenueTTM ? `- Revenue (TTM): ${formatCurrency(overview.revenueTTM)}` : null,
    overview.grossProfitTTM ? `- Gross Profit (TTM): ${formatCurrency(overview.grossProfitTTM)}` : null,
    overview.sharesOutstanding ? `- Shares Outstanding: ${formatNumber(overview.sharesOutstanding, 0)}` : null,
    overview.dividendYield ? `- Dividend Yield: ${formatPercent(overview.dividendYield)}` : null,
  ].filter(Boolean) as string[];

  const peers = (data.peers?.peers || [])
    .filter((peer: string) => peer && peer.toUpperCase() !== data.symbol.toUpperCase())
    .slice(0, 10);
  const competitiveLines = [
    overview.industry ? `- Industry Focus: ${overview.industry}` : null,
    overview.sector ? `- Sector: ${overview.sector}` : null,
    peers.length ? `- Peer Set: ${peers.join(', ')}` : '- Peer Set: Unavailable',
  ].filter(Boolean) as string[];

  const revenueGrowth = getStockRevenueGrowth(data);
  const epsGrowth = getStockEpsGrowth(data);
  const grossMargin = normalizePercent(data.basicFinancials?.metric?.grossMarginTTM ?? overview.profitMargin);
  const operatingMargin = normalizePercent(data.basicFinancials?.metric?.operatingMarginTTM ?? overview.operatingMargin);
  const targetUpside = getTargetUpsideStock(data);
  const moving50 = toNumber(overview['50DayMovingAverage'] ?? data.analystRatings?.movingAverage50Day);
  const moving200 = toNumber(overview['200DayMovingAverage']);
  const trend50 = price && moving50 ? ((price - moving50) / moving50) * 100 : null;
  const trend200 = price && moving200 ? ((price - moving200) / moving200) * 100 : null;
  const themes = extractThemes([overview.description, overview.industry, overview.sector].filter(Boolean).join(' '));
  const growthLines = [
    revenueGrowth !== null ? `- Revenue growth (TTM): ${formatPercent(revenueGrowth)}` : null,
    epsGrowth !== null ? `- EPS growth (TTM): ${formatPercent(epsGrowth)}` : null,
    grossMargin !== null ? `- Gross margin: ${formatPercent(grossMargin)}` : null,
    operatingMargin !== null ? `- Operating margin: ${formatPercent(operatingMargin)}` : null,
    trend50 !== null ? `- Price vs 50D MA: ${trend50.toFixed(1)}%` : null,
    trend200 !== null ? `- Price vs 200D MA: ${trend200.toFixed(1)}%` : null,
    targetUpside !== null ? `- Analyst target upside: ${targetUpside.toFixed(1)}%` : null,
    themes.length ? `- Theme exposure: ${themes.join(', ')}` : null,
  ].filter(Boolean) as string[];

  const riskLines: string[] = [];
  const peRatio = toNumber(overview.peRatio ?? data.basicFinancials?.metric?.peBasicExclExtraTTM);
  if (peRatio !== null && peRatio > 40) {
    riskLines.push(`- Elevated valuation (P/E ${peRatio.toFixed(1)})`);
  }
  if (revenueGrowth !== null && revenueGrowth < 0) {
    riskLines.push(`- Negative revenue growth (TTM ${formatPercent(revenueGrowth)})`);
  }
  if (epsGrowth !== null && epsGrowth < 0) {
    riskLines.push(`- Negative EPS growth (TTM ${formatPercent(epsGrowth)})`);
  }
  if (operatingMargin !== null && operatingMargin < 10) {
    riskLines.push(`- Thin operating margin (${formatPercent(operatingMargin)})`);
  }
  const beta = toNumber(overview.beta);
  if (beta !== null && beta > 1.5) {
    riskLines.push(`- Higher volatility (beta ${beta.toFixed(2)})`);
  }
  const shortFloat = normalizePercent(overview.shortPercentFloat);
  if (shortFloat !== null && shortFloat > 5) {
    riskLines.push(`- Elevated short interest (${formatPercent(shortFloat)})`);
  }
  const balanceReport = getLatestReport(data.balanceSheet);
  const cash = toNumber(balanceReport?.cashAndEquivalents);
  const longDebt = toNumber(balanceReport?.longTermDebt);
  const netDebt = cash !== null && longDebt !== null ? longDebt - cash : null;
  if (netDebt !== null && netDebt > 0) {
    riskLines.push(`- Net debt of ${formatCurrency(netDebt)}`);
  }

  const incomeReport = getLatestReport(data.incomeStatement);
  const incomeTable = incomeReport
    ? buildTable(
        ['Period', 'Revenue', 'Gross Profit', 'Operating Income', 'Net Income'],
        [[
          formatPeriodLabel(incomeReport),
          formatCurrency(incomeReport.totalRevenue),
          formatCurrency(incomeReport.grossProfit),
          formatCurrency(incomeReport.operatingIncome),
          formatCurrency(incomeReport.netIncome),
        ]]
      )
    : '_Income statement data unavailable._';

  const balanceTable = balanceReport
    ? buildTable(
        ['Period', 'Cash', 'Total Debt', 'Net Debt', 'Total Assets', 'Equity'],
        [[
          formatPeriodLabel(balanceReport),
          formatCurrency(balanceReport.cashAndEquivalents),
          formatCurrency(balanceReport.longTermDebt),
          netDebt === null ? 'N/A' : formatCurrency(netDebt),
          formatCurrency(balanceReport.totalAssets),
          formatCurrency(balanceReport.totalShareholderEquity),
        ]]
      )
    : '_Balance sheet data unavailable._';

  const cashReport = getLatestReport(data.cashFlow);
  const cashTable = cashReport
    ? buildTable(
        ['Period', 'Operating Cash Flow', 'Capex', 'Free Cash Flow'],
        [[
          formatPeriodLabel(cashReport),
          formatCurrency(cashReport.operatingCashflow),
          formatCurrency(cashReport.capitalExpenditures),
          formatCurrency(cashReport.freeCashFlow),
        ]]
      )
    : '_Cash flow data unavailable._';

  const forwardPE = toNumber(overview.forwardPE);
  const pegRatio = toNumber(overview.pegRatio);
  const bookValue = toNumber(overview.bookValue);
  const priceToBook = price !== null && bookValue ? price / bookValue : null;
  const revenuePerShare = toNumber(overview.revenuePerShare);
  const priceToSales = price !== null && revenuePerShare ? price / revenuePerShare : null;
  const marketCap = toNumber(overview.marketCapitalization);
  const revenueTTM = toNumber(overview.revenueTTM);
  const marketCapToRevenue = marketCap && revenueTTM ? marketCap / revenueTTM : null;
  const valuationTable = buildTable(
    ['Metric', 'Value'],
    [
      ['P/E (TTM)', peRatio === null ? 'N/A' : peRatio.toFixed(1)],
      ['Forward P/E', forwardPE === null ? 'N/A' : forwardPE.toFixed(1)],
      ['PEG', pegRatio === null ? 'N/A' : pegRatio.toFixed(2)],
      ['Price / Book', priceToBook === null ? 'N/A' : priceToBook.toFixed(2)],
      ['Price / Sales', priceToSales === null ? 'N/A' : priceToSales.toFixed(2)],
      ['Market Cap / Revenue', marketCapToRevenue === null ? 'N/A' : marketCapToRevenue.toFixed(2)],
    ]
  );
  const weekHigh = toNumber(overview['52WeekHigh']);
  const weekLow = toNumber(overview['52WeekLow']);
  const fromHigh = price && weekHigh ? ((price - weekHigh) / weekHigh) * 100 : null;
  const fromLow = price && weekLow ? ((price - weekLow) / weekLow) * 100 : null;
  const kpiTable = buildTable(
    ['KPI', 'Value'],
    [
      ['💵 Price', `${data.price?.price || 'N/A'} (${data.price?.changePercent || 'N/A'})`],
      ['🏷️ Market Cap', formatCurrency(overview.marketCapitalization)],
      ['📊 52W Range', `${formatCurrency(weekLow)} - ${formatCurrency(weekHigh)}`],
      ['🧾 Revenue (TTM)', formatCurrency(overview.revenueTTM)],
      ['💰 Gross Margin', formatPercent(grossMargin)],
      ['🏦 Operating Margin', formatPercent(operatingMargin)],
      ['📈 ROE', formatPercent(data.basicFinancials?.metric?.roeTTM)],
    ],
    ['left', 'right']
  );

  const ownershipLines = [
    overview.percentInstitutions ? `- Institutional Ownership: ${formatPercent(overview.percentInstitutions)}` : null,
    overview.percentInsiders ? `- Insider Ownership: ${formatPercent(overview.percentInsiders)}` : null,
    overview.sharesFloat ? `- Shares Float: ${formatNumber(overview.sharesFloat, 0)}` : null,
    overview.shortRatio ? `- Short Ratio: ${formatNumber(overview.shortRatio, 2)}` : null,
    overview.shortPercentFloat ? `- Short Interest (float): ${formatPercent(overview.shortPercentFloat)}` : null,
    `- Analyst Ratings: ${formatRatingSummary(data)}`,
  ].filter(Boolean) as string[];

  const analystTarget = toNumber(data.priceTargets?.targetMean || data.analystRatings?.analystTargetPrice);
  const targetLow = toNumber(data.priceTargets?.targetLow);
  const targetHigh = toNumber(data.priceTargets?.targetHigh);
  const targetMedian = toNumber(data.priceTargets?.targetMedian);
  const latestEarnings = data.earningsHistory?.quarterlyEarnings?.[0];
  const catalystLines = [
    analystTarget !== null ? `- Target Mean: ${analystTarget.toFixed(2)}` : null,
    targetLow !== null ? `- Target Low: ${targetLow.toFixed(2)}` : null,
    targetMedian !== null ? `- Target Median: ${targetMedian.toFixed(2)}` : null,
    targetHigh !== null ? `- Target High: ${targetHigh.toFixed(2)}` : null,
    targetUpside !== null ? `- Implied Upside: ${targetUpside.toFixed(1)}%` : null,
    overview.exDividendDate ? `- Ex-Dividend Date: ${overview.exDividendDate}` : null,
    overview.dividendDate ? `- Dividend Pay Date: ${overview.dividendDate}` : null,
    latestEarnings
      ? `- Latest EPS (${formatDateLabel(latestEarnings.fiscalQuarter)}): ${latestEarnings.reportedEPS}`
      : null,
  ].filter(Boolean) as string[];
  const headlines = (data.companyNews?.articles || [])
    .map((a) => a.headline || a.title)
    .filter(Boolean);
  if (headlines.length) {
    catalystLines.push(`- Recent Headlines: ${headlines.slice(0, 5).join('; ')}`);
  }
  const sentiment = data.newsSentiment?.sentiment?.sentiment || data.newsSentiment?.sentiment?.buzz;
  if (sentiment) {
    ownershipLines.push(`- News Sentiment: ${sentiment}`);
  }

  const bullSignals: string[] = [];
  if (revenueGrowth !== null && revenueGrowth > 5) bullSignals.push('Sustained revenue expansion');
  if (epsGrowth !== null && epsGrowth > 5) bullSignals.push('EPS growth momentum');
  if (grossMargin !== null && grossMargin > 40) bullSignals.push('High gross margins');
  if (operatingMargin !== null && operatingMargin > 20) bullSignals.push('Strong operating leverage');
  if (targetUpside !== null && targetUpside > 10) bullSignals.push('Street targets imply upside');
  if ((scorecard.components.moat ?? 0) > 60) bullSignals.push('Moat score above 60');

  const watchSignals: string[] = [];
  if (trend50 !== null && trend50 < 0) watchSignals.push('Price below 50D moving average');
  if (trend200 !== null && trend200 < 0) watchSignals.push('Price below 200D moving average');
  if (beta !== null && beta > 1.2) watchSignals.push('Volatility above market average');
  if (netDebt !== null && netDebt > 0) watchSignals.push('Net debt position');

  const bearSignals = riskLines.map((line) => line.replace(/^-\s*/, ''));
  const highlightsBlock = [
    `> **Bull Case:** ${bullSignals.length ? bullSignals.join('; ') : 'Signals limited by available data.'}`,
    `> **Bear Case:** ${bearSignals.length ? bearSignals.join('; ') : 'No major red flags surfaced from available data.'}`,
    `> **What to watch:** ${watchSignals.length ? watchSignals.join('; ') : 'Monitor upcoming earnings and guidance.'}`,
  ].join('\n');

  const sections: string[] = [
    headline,
    `Generated: ${data.generatedAt}`,
    '## 📊 Snapshot',
    ...(snapshotLines.length ? snapshotLines : ['- Snapshot data unavailable']),
  ];

  sections.push('## 🏢 Business Overview', ...(businessLines.length ? businessLines : ['- Business overview data unavailable']));
  sections.push('## 🧩 Competitive Landscape', ...(competitiveLines.length ? competitiveLines : ['- Competitive data unavailable']));
  sections.push('## ✨ KPI Dashboard', kpiTable);

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

  sections.push(
    '## 🧾 Financial Deep Dive',
    '### Income Statement (latest)',
    incomeTable,
    '### Balance Sheet (latest)',
    balanceTable,
    '### Cash Flow (latest)',
    cashTable,
  );

  sections.push(
    '## 🧮 Valuation & Multiples',
    valuationTable,
    `- 52-Week Range: ${formatCurrency(weekLow)} - ${formatCurrency(weekHigh)}`,
    ...(fromHigh !== null ? [`- Price vs 52-Week High: ${fromHigh.toFixed(1)}%`] : []),
    ...(fromLow !== null ? [`- Price vs 52-Week Low: ${fromLow.toFixed(1)}%`] : []),
  );

  sections.push('## 🚀 Growth Drivers', ...(growthLines.length ? growthLines : ['- Growth drivers unavailable']));
  sections.push('## ⚠️ Risks & Headwinds', ...(riskLines.length ? riskLines : ['- No major risk flags surfaced from available data']));
  sections.push('## 🧭 Investment Highlights', highlightsBlock);

  const hasRatings = [data.analystRatings?.strongBuy, data.analystRatings?.buy, data.analystRatings?.hold]
    .map((value) => toNumber(value))
    .some((value) => value !== null);
  if (analystTarget !== null || hasRatings || targetChart) {
    sections.push('## 🧠 Analyst View');
    if (analystTarget !== null) {
      sections.push(`- Target Mean: ${analystTarget.toFixed(2)}`);
    }
    if (hasRatings) {
      sections.push(`- Ratings: Strong Buy ${data.analystRatings?.strongBuy || 'Unavailable'} / Buy ${data.analystRatings?.buy || 'Unavailable'} / Hold ${data.analystRatings?.hold || 'Unavailable'}`);
    }
    if (targetChart) sections.push(targetChart);
  }

  sections.push('## 🧑‍💼 Ownership & Sentiment', ...(ownershipLines.length ? ownershipLines : ['- Ownership data unavailable']));
  sections.push('## 🗓️ Guidance & Catalysts', ...(catalystLines.length ? catalystLines : ['- Guidance data unavailable']));

  if (scorecard.composite !== null) {
    const scorecardRadar = buildScorecardRadar(scorecard);
    sections.push(
      '## ✅ Scorecard',
      ...(scorecardRadar ? [scorecardRadar] : []),
      `- Growth: ${scorecard.components.growth?.toFixed(1) ?? 'Unavailable'} (avg of revenue/EPS growth %)`,
      `- Profitability: ${scorecard.components.profitability?.toFixed(1) ?? 'Unavailable'} (avg of gross/operating margin, ROE)`,
      `- Valuation: ${scorecard.components.valuation?.toFixed(1) ?? 'Unavailable'} (100 - PE/50*100)`,
      `- Momentum: ${scorecard.components.momentum?.toFixed(1) ?? 'Unavailable'} (50 + price % change)`,
      `- Moat: ${scorecard.components.moat?.toFixed(1) ?? 'Unavailable'} (avg of margin stability, pricing power, analyst conviction)`,
      `- Composite Score: ${scorecard.composite?.toFixed(1) ?? 'Unavailable'}`,
    );
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
      eps: getEpsValue(item),
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
    notes ? `## 🔍 Notes\n${notes}` : null,
    '_Not financial advice. Use this as a starting point for diligence._',
  ].filter(Boolean) as string[];

  return sections.join('\n\n');
}
