/* eslint-disable @typescript-eslint/no-explicit-any */
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
  /** LLM-generated competitive moat assessment */
  moatAnalysis?: MoatAnalysis;
}

export interface ComparisonReportItem {
  symbol: string;
  price?: any;
  overview?: any;
  basicFinancials?: any;
  priceTargets?: any;
  priceHistory?: { prices?: PricePoint[] };
  incomeStatement?: any;
  balanceSheet?: any;
  cashFlow?: any;
  analystRatings?: any;
  /** LLM-generated competitive moat assessment */
  moatAnalysis?: MoatAnalysis;
}

export interface ComparisonReportData {
  generatedAt: string;
  range: string;
  universe: string[];
  items: ComparisonReportItem[];
  notes?: string[];
  sources?: Record<string, Record<string, string>>;
}

export interface SectorReportData extends ComparisonReportData {
  /** The original sector/theme query, e.g. "AI data center" */
  sectorQuery: string;
  /** How the universe was selected */
  selectedBy?: 'llm' | 'manual';
}

export interface DeepSectorReportData extends SectorReportData {
  /** The broad initial candidate list before refinement */
  initialCandidates?: string[];
  /** LLM-generated narrative covering supply chain, customer, market and news dependencies */
  dependencyAnalysis?: string;
  /** Mermaid diagram source for the sector ecosystem map */
  ecosystemDiagram?: string;
  /** LLM rationale for which companies were kept / excluded in the refinement step */
  refinementNotes?: string;
  /** Per-company 1-2 sentence investment thesis for each company in the final refined list */
  companySnapshots?: Record<string, string>;
}

/**
 * LLM-generated competitive moat assessment for a single company.
 * The moat framework follows Warren Buffett's five economic-moat sources.
 */
export interface MoatAnalysis {
  /** Primary moat category, e.g. "Network Effects", "Cost Advantage", "Switching Costs",
   *  "Intangible Assets", "Efficient Scale", "Mixed", or "None" */
  moatType: string;
  /** Overall moat width: "Wide" (durable 10+ yr advantage), "Narrow" (3-10 yr), or "None" */
  moatStrength: string;
  /** Composite moat score 0-100. 0-30 = none, 31-60 = narrow, 61-100 = wide */
  moatScore: number;
  /** Specific, concrete barriers, e.g. "Apple ecosystem lock-in", "AWS scale economics" */
  barriers: string[];
  /** 2-4 sentence descriptive narrative explaining moat sources and their sustainability */
  narrative: string;
  /** 1-2 sentences: what this company excels at and who/what it is best for */
  bestFor: string;
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
    year: '2-digit',
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
        name: 'Closing Price (Daily)',
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
        name: 'Reported EPS (Quarter)',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: filtered.values,
      },
    ],
  });
}

function buildPeChart(prices: PricePoint[] = [], earnings: EarningsPoint[] = []): string {
  if (prices.length === 0 || earnings.length < 4) return '';
  const sortedPrices = [...prices]
    .map((point) => ({
      date: point.date,
      value: toNumber(point.close),
    }))
    .filter((point): point is { date: string; value: number } => point.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sortedPrices.length === 0) return '';

  const sortedEarnings = [...earnings]
    .map((point) => ({
      date: point.fiscalQuarter,
      value: toNumber(point.reportedEPS),
    }))
    .filter((point): point is { date: string; value: number } => point.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sortedEarnings.length < 4) return '';

  const findClosestPrice = (date: string): number | null => {
    const target = new Date(date).getTime();
    if (Number.isNaN(target)) return null;
    let closest: { diff: number; value: number } | null = null;
    for (const point of sortedPrices) {
      const time = new Date(point.date).getTime();
      if (Number.isNaN(time)) continue;
      const diff = Math.abs(time - target);
      if (!closest || diff < closest.diff) {
        closest = { diff, value: point.value };
      }
    }
    return closest?.value ?? null;
  };

  const pePoints: Array<{ date: string; value: number }> = [];
  for (let index = 3; index < sortedEarnings.length; index += 1) {
    const window = sortedEarnings.slice(index - 3, index + 1);
    const ttmEps = window.reduce((sum, point) => sum + point.value, 0);
    if (ttmEps <= 0) continue;
    const price = findClosestPrice(sortedEarnings[index].date);
    if (price === null) continue;
    pePoints.push({
      date: sortedEarnings[index].date,
      value: price / ttmEps,
    });
  }
  if (pePoints.length === 0) return '';

  const series = downsample(pePoints, 16);
  const labels = series.map((point) => formatDateLabel(point.date));
  const values = series.map((point) => formatChartNumber(point.value));
  const filtered = filterSeries(labels, values);
  if (filtered.labels.length === 0) return '';

  return buildChartBlock({
    title: { text: 'P/E Trend (TTM)', left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: filtered.labels },
    yAxis: { type: 'value', scale: true, name: 'P/E' },
    series: [
      {
        name: 'P/E',
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

function buildComparisonPerformanceChart(items: ComparisonReportItem[], title: string): string {
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

function formatSignedPercentValue(value: unknown, decimals = 2, options?: { alreadyPercent?: boolean }): string {
  const num = options?.alreadyPercent ? toNumber(value) : normalizePercent(value);
  if (num === null) return 'N/A';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(decimals)}%`;
}

function formatPrice(value: unknown, decimals = 2): string {
  const num = toNumber(value);
  if (num === null) return 'N/A';
  return `$${num.toFixed(decimals)}`;
}

function formatCurrency(value: unknown): string {
  const formatted = formatMarketCap(value);
  if (formatted === 'N/A') return 'N/A';
  return `$${formatted}`;
}

function formatCompactNumber(value: unknown): string {
  const num = toNumber(value);
  if (num === null) return 'N/A';
  if (Math.abs(num) >= 1e9) {
    return `${trimTrailingZeros((num / 1e9).toFixed(2))}B`;
  }
  if (Math.abs(num) >= 1e6) {
    return `${trimTrailingZeros((num / 1e6).toFixed(2))}M`;
  }
  return new Intl.NumberFormat('en-US').format(Math.round(num));
}

function getMetricValue(metrics: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(metrics?.[key]);
    if (value !== null) return value;
  }
  return null;
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
    axisLabel: { color: '#475569', fontSize: 11, ...(axis.axisLabel || {}) },
    splitLine: {
      ...(axis.splitLine || {}),
      lineStyle: { color: '#e2e8f0', ...(axis.splitLine?.lineStyle || {}) },
    },
  };
}

function applyChartTheme(option: Record<string, any>): Record<string, any> {
  const base = {
    backgroundColor: '#ffffff',
    color: ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7'],
    textStyle: {
      fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, sans-serif',
      color: '#0f172a',
    },
    title: {
      left: 'center',
      top: 8,
      textStyle: { color: '#0f172a', fontSize: 14, fontWeight: 600 },
    },
    tooltip: {
      backgroundColor: '#0f172a',
      borderColor: '#1e293b',
      textStyle: { color: '#f8fafc' },
    },
    legend: { textStyle: { color: '#475569' } },
  };

  const themed = { ...base, ...option };
  const mergedTitle = option.title
    ? {
        ...base.title,
        ...option.title,
        show: false,
        textStyle: { ...base.title.textStyle, ...(option.title.textStyle || {}) },
      }
    : { ...base.title, show: false };

  return {
    ...themed,
    title: mergedTitle,
    grid: {
      left: 50,
      right: 24,
      top: 40,
      bottom: 50,
      containLabel: true,
      ...(option.grid || {}),
    },
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
      axisName: { color: '#334155', fontSize: 12 },
      splitLine: { lineStyle: { color: '#cbd5f5' } },
      axisLine: { lineStyle: { color: '#cbd5f5' } },
      splitArea: { areaStyle: { color: ['#f8fafc', '#eef2ff'] } },
    },
    series: [
      {
        name: 'Scorecard',
        type: 'radar',
        data: [{ value: values, name: 'Scorecard' }],
        areaStyle: { opacity: 0.2 },
        lineStyle: { width: 2 },
        symbolSize: 6,
      },
    ],
  });
}

function computePriceChange(prices: PricePoint[] = []): number | null {
  if (prices.length < 2) return null;
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const first = toNumber(sorted[0].close);
  const last = toNumber(sorted[sorted.length - 1].close);
  if (!first || !last) return null;
  return ((last - first) / first) * 100;
}

function buildValuationGrowthScatter(items: ComparisonReportItem[]): string {
  const points = items
    .map((item) => {
      const overview = item.overview || {};
      const growth = getStockRevenueGrowth({
        symbol: item.symbol,
        generatedAt: '',
        price: {},
        companyOverview: overview,
        basicFinancials: item.basicFinancials,
      } as StockReportData);
      const pe = toNumber(overview.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM);
      const marketCap = toNumber(overview.marketCapitalization);
      if (growth === null || pe === null || !Number.isFinite(pe)) return null;
      return {
        name: item.symbol,
        value: [Number(growth.toFixed(1)), Number(pe.toFixed(1))],
        marketCap: marketCap ?? 0,
      };
    })
    .filter((point): point is { name: string; value: [number, number]; marketCap: number } => point !== null);

  if (points.length === 0) return '';

  const maxCap = Math.max(...points.map((point) => point.marketCap || 0), 1);
  return buildChartBlock({
    tooltip: { trigger: 'item' },
    xAxis: { type: 'value', name: 'Revenue Growth (TTM %)' },
    yAxis: { type: 'value', name: 'P/E (TTM)' },
    series: [
      {
        type: 'scatter',
        data: points.map((point) => ({
          name: point.name,
          value: point.value,
          symbolSize: 12 + Math.sqrt(point.marketCap / maxCap) * 18,
          label: { show: true, formatter: '{b}', position: 'right' },
        })),
      },
    ],
  });
}

function buildMarginComparisonChart(items: ComparisonReportItem[]): string {
  const rows = items.map((item) => {
    const gross = normalizePercent(item.basicFinancials?.metric?.grossMarginTTM ?? item.overview?.profitMargin);
    const operating = normalizePercent(item.basicFinancials?.metric?.operatingMarginTTM ?? item.overview?.operatingMargin);
    return {
      symbol: item.symbol,
      gross: gross === null ? 0 : Number(gross.toFixed(1)),
      operating: operating === null ? 0 : Number(operating.toFixed(1)),
    };
  });
  if (rows.length === 0) return '';

  return buildChartBlock({
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    xAxis: { type: 'category', data: rows.map((row) => row.symbol) },
    yAxis: { type: 'value', name: 'Margin %' },
    series: [
      { name: 'Gross Margin', type: 'bar', data: rows.map((row) => row.gross) },
      { name: 'Operating Margin', type: 'bar', data: rows.map((row) => row.operating) },
    ],
  });
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

/**
 * Maps moat strength to a traffic-light emoji for visual reports.
 * "Wide" → 🟢  "Narrow" → 🟡  anything else → 🔴
 */
function moatStrengthEmoji(strength: string): string {
  if (strength === 'Wide') return '🟢';
  if (strength === 'Narrow') return '🟡';
  return '🔴';
}

/**
 * Renders an ECharts horizontal bar chart showing the three moat sub-component
 * scores alongside the overall LLM moat score.
 */
function buildMoatScoreChart(moatAnalysis: MoatAnalysis, scorecardMoatDetails: ReturnType<typeof computeScorecard>['moatDetails']): string {
  const score = Math.min(100, Math.max(0, Math.round(moatAnalysis.moatScore)));
  const { marginStability, pricingPower, analystConviction } = scorecardMoatDetails;

  const rows: Array<{ name: string; value: number }> = [
    { name: 'Overall Moat Score (LLM)', value: score },
  ];
  if (marginStability !== null) rows.push({ name: 'Margin Stability', value: Math.round(marginStability) });
  if (pricingPower !== null) rows.push({ name: 'Pricing Power', value: Math.round(pricingPower) });
  if (analystConviction !== null) rows.push({ name: 'Analyst Conviction', value: Math.round(analystConviction) });

  const colors: Record<string, string> = {
    'Overall Moat Score (LLM)': score >= 61 ? '#22c55e' : score >= 31 ? '#f59e0b' : '#ef4444',
    'Margin Stability': '#6366f1',
    'Pricing Power': '#14b8a6',
    'Analyst Conviction': '#0ea5e9',
  };

  return buildChartBlock({
    title: { text: 'Competitive Moat Score', left: 'center' },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: '{b}: {c}/100',
    },
    grid: { left: 160, right: 60, top: 40, bottom: 20 },
    xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}' } },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.name),
      inverse: true,
    },
    series: [{
      name: 'Score',
      type: 'bar',
      data: rows.map((r) => ({
        value: r.value,
        itemStyle: { color: colors[r.name] || '#6366f1' },
      })),
      barMaxWidth: 28,
      label: { show: true, position: 'right', formatter: '{c}/100' },
    }],
  });
}

/**
 * Renders a grouped bar chart comparing moat scores across companies in a
 * comparison/sector/deep-sector report.
 */
function buildMoatComparisonChart(items: ComparisonReportItem[]): string {
  const validItems = items.filter((item) => item.moatAnalysis);
  if (validItems.length === 0) return '';

  const symbols = validItems.map((item) => `${item.symbol} ${moatStrengthEmoji(item.moatAnalysis!.moatStrength)}`);
  const scores = validItems.map((item) => Math.round(item.moatAnalysis!.moatScore));

  return buildChartBlock({
    title: { text: 'Moat Score Comparison', left: 'center' },
    tooltip: { trigger: 'axis', formatter: '{b}: {c}/100' },
    grid: { left: 40, right: 20, top: 50, bottom: 60 },
    xAxis: {
      type: 'category',
      data: symbols,
      axisLabel: { rotate: symbols.length > 5 ? 30 : 0 },
    },
    yAxis: { type: 'value', min: 0, max: 100, name: 'Moat Score' },
    series: [{
      name: 'Moat Score',
      type: 'bar',
      data: scores.map((s) => ({
        value: s,
        itemStyle: { color: s >= 61 ? '#22c55e' : s >= 31 ? '#f59e0b' : '#ef4444' },
      })),
      barMaxWidth: 40,
      label: { show: true, position: 'top', formatter: '{c}' },
    }],
  });
}

/**
 * Renders the dedicated "🏰 Competitive Moat" section for a single-stock report.
 */
function buildStockMoatSection(moatAnalysis: MoatAnalysis, scorecardMoatDetails: ReturnType<typeof computeScorecard>['moatDetails']): string {
  const strengthEmoji = moatStrengthEmoji(moatAnalysis.moatStrength);
  const chart = buildMoatScoreChart(moatAnalysis, scorecardMoatDetails);

  const metaTable = buildTable(
    ['Attribute', 'Assessment'],
    [
      ['**Moat Type**', moatAnalysis.moatType],
      ['**Moat Strength**', `${strengthEmoji} ${moatAnalysis.moatStrength}`],
      ['**Moat Score**', `${Math.round(moatAnalysis.moatScore)}/100`],
    ],
    ['left', 'left']
  );

  const barrierLines = moatAnalysis.barriers.length
    ? moatAnalysis.barriers.map((b) => `- ${b}`).join('\n')
    : '_No specific barriers identified._';

  const parts: string[] = [
    '## 🏰 Competitive Moat',
    metaTable,
    ...(chart ? [chart] : []),
    '### 🔐 Moat Barriers',
    barrierLines,
    '### 📝 Moat Analysis',
    moatAnalysis.narrative,
    '### 🎯 Best For',
    moatAnalysis.bestFor,
  ];

  return parts.join('\n\n');
}

/**
 * Builds the moat comparison table and chart section for multi-company reports.
 */
function buildComparisonMoatSection(items: ComparisonReportItem[]): string {
  const itemsWithMoat = items.filter((item) => item.moatAnalysis);
  if (itemsWithMoat.length === 0) return '';

  const moatRows = itemsWithMoat.map((item) => {
    const moat = item.moatAnalysis!;
    const topBarriers = moat.barriers.slice(0, 3).join('; ') || 'N/A';
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      moat.moatType,
      `${moatStrengthEmoji(moat.moatStrength)} ${moat.moatStrength}`,
      `${Math.round(moat.moatScore)}/100`,
      topBarriers,
    ];
  });

  const moatTable = buildTable(
    ['Company', 'Moat Type', 'Strength', 'Score', 'Key Barriers'],
    moatRows,
    ['left', 'left', 'left', 'right', 'left']
  );

  const chart = buildMoatComparisonChart(itemsWithMoat);

  // Moat leaders
  const sorted = [...itemsWithMoat].sort((a, b) => (b.moatAnalysis!.moatScore ?? 0) - (a.moatAnalysis!.moatScore ?? 0));
  const leader = sorted[0];
  const wideMoat = itemsWithMoat.filter((item) => item.moatAnalysis!.moatStrength === 'Wide');

  const leaderLines: string[] = [];
  if (leader) {
    leaderLines.push(`- **Strongest moat:** ${leader.overview?.name || leader.symbol} (${leader.symbol}) — ${leader.moatAnalysis!.moatType}, score ${Math.round(leader.moatAnalysis!.moatScore)}/100`);
  }
  if (wideMoat.length > 0) {
    leaderLines.push(`- **Wide-moat companies:** ${wideMoat.map((item) => `${item.symbol}`).join(', ')}`);
  }

  // "Best For" table
  const bestForRows = itemsWithMoat.map((item) => [
    `**${item.symbol}**`,
    item.moatAnalysis!.bestFor,
  ]);
  const bestForTable = buildTable(
    ['Company', 'Best For'],
    bestForRows,
    ['left', 'left']
  );

  return [
    '## 🏰 Moat Analysis',
    moatTable,
    ...(chart ? [chart] : []),
    '### 🏆 Moat Leaders',
    ...(leaderLines.length ? leaderLines : ['_Insufficient data for moat comparison._']),
    '### 🎯 What Each Company Does Best',
    bestForTable,
  ].join('\n\n');
}

export function buildStockReport(data: StockReportData): string {
  const priceChart = buildPriceChart(data.priceHistory?.prices || []);
  const epsChart = buildEpsChart(data.earningsHistory?.quarterlyEarnings || []);
  const peChart = buildPeChart(data.priceHistory?.prices || [], data.earningsHistory?.quarterlyEarnings || []);
  const revenueChart = buildRevenueChart(data.incomeStatement);
  const marginChart = buildMarginChart(data.incomeStatement);
  const targetChart = buildTargetDistribution(data.priceTargets);
  const headline = `# ${data.symbol} Comprehensive Equity Research Report`;
  const scorecard = computeScorecard(data);
  const overview = data.companyOverview || {};
  const price = toNumber(data.price?.price);
  const changePercent = data.price?.changePercent;
  const changePercentValue = typeof changePercent === 'string'
    ? Number(changePercent.replace('%', ''))
    : changePercent;
  const changePercentIsPercent = typeof changePercent === 'string' && changePercent.includes('%');
  const priceLine = price === null
    ? 'N/A'
    : `${formatPrice(price)} (${formatSignedPercentValue(changePercentValue, 2, { alreadyPercent: changePercentIsPercent })})`;

  const snapshotLines = [
    `- Price: ${priceLine} (day change)`,
    `- Market Cap: ${formatCurrency(overview.marketCapitalization)}`,
    `- Sector: ${overview.sector || 'Unavailable'}`,
    `- Industry: ${overview.industry || 'Unavailable'}`,
  ].filter((line) => !line.endsWith('Unavailable') && !line.includes('(Unavailable)'));

  const description = overview.description ? summarizeDescription(overview.description) : null;
  const businessLines = [
    overview.name ? `- Company: ${overview.name} (${data.symbol})` : `- Company: ${data.symbol}`,
    description ? `- Description: ${description}` : null,
    overview.sector ? `- Sector: ${overview.sector}` : null,
    overview.industry ? `- Industry: ${overview.industry}` : null,
    overview.marketCapitalization ? `- Market Cap: ${formatCurrency(overview.marketCapitalization)}` : null,
    overview.revenueTTM ? `- Revenue (TTM): ${formatCurrency(overview.revenueTTM)}` : null,
    overview.grossProfitTTM ? `- Gross Profit (TTM): ${formatCurrency(overview.grossProfitTTM)}` : null,
    overview.sharesOutstanding ? `- Shares Outstanding: ${formatCompactNumber(overview.sharesOutstanding)}` : null,
    overview.dividendYield ? `- Dividend Yield: ${formatPercent(overview.dividendYield)}` : null,
  ].filter(Boolean) as string[];

  const peers = (data.peers?.peers || [])
    .filter((peer: string) => peer && peer.toUpperCase() !== data.symbol.toUpperCase())
    .slice(0, 10);
  const competitiveLines = [
    overview.industry ? `- Industry Focus: ${overview.industry}` : null,
    overview.sector ? `- Sector: ${overview.sector}` : null,
    peers.length ? `- Peer Set: ${peers.join(', ')}` : '- Peer Set: Unavailable (data gap or rate limit)',
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
        ]],
        ['left', 'right', 'right', 'right', 'right']
      )
    : '_Income statement data unavailable (provider or rate limit)._';

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
        ]],
        ['left', 'right', 'right', 'right', 'right', 'right']
      )
    : '_Balance sheet data unavailable (provider or rate limit)._';

  const cashReport = getLatestReport(data.cashFlow);
  const cashTable = cashReport
    ? buildTable(
        ['Period', 'Operating Cash Flow', 'Capex', 'Free Cash Flow'],
        [[
          formatPeriodLabel(cashReport),
          formatCurrency(cashReport.operatingCashflow),
          formatCurrency(cashReport.capitalExpenditures),
          formatCurrency(cashReport.freeCashFlow),
        ]],
        ['left', 'right', 'right', 'right']
      )
    : '_Cash flow data unavailable (provider or rate limit)._';

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
      ['Price / Sales', priceToSales === null ? 'N/A' : priceToSales.toFixed(2)],
      ['Price / Book', priceToBook === null ? 'N/A' : priceToBook.toFixed(2)],
      ['Market Cap / Revenue', marketCapToRevenue === null ? 'N/A' : marketCapToRevenue.toFixed(2)],
    ],
    ['left', 'right']
  );
  const weekHigh = toNumber(overview['52WeekHigh']);
  const weekLow = toNumber(overview['52WeekLow']);
  const fromHigh = price && weekHigh ? ((price - weekHigh) / weekHigh) * 100 : null;
  const fromLow = price && weekLow ? ((price - weekLow) / weekLow) * 100 : null;
  const kpiTable = buildTable(
    ['KPI', 'Value'],
    [
      ['Price', `${formatPrice(price)} (${formatSignedPercentValue(changePercentValue, 2, { alreadyPercent: changePercentIsPercent })})`],
      ['Market Cap', formatCurrency(overview.marketCapitalization)],
      ['52W Range', `${formatCurrency(weekLow)} - ${formatCurrency(weekHigh)}`],
      ['Revenue (TTM)', formatCurrency(overview.revenueTTM)],
      ['Gross Margin (TTM)', formatPercent(grossMargin)],
      ['Operating Margin (TTM)', formatPercent(operatingMargin)],
      ['ROE (TTM)', formatPercent(data.basicFinancials?.metric?.roeTTM)],
    ],
    ['left', 'right']
  );

  const ownershipLines = [
    overview.percentInstitutions ? `- Institutional Ownership: ${formatPercent(overview.percentInstitutions)}` : null,
    overview.percentInsiders ? `- Insider Ownership: ${formatPercent(overview.percentInsiders)}` : null,
    overview.sharesFloat ? `- Shares Float: ${formatCompactNumber(overview.sharesFloat)}` : null,
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
  if (data.moatAnalysis && data.moatAnalysis.moatScore >= 61) bullSignals.push(`${data.moatAnalysis.moatStrength} competitive moat (${data.moatAnalysis.moatType})`);
  else if (data.moatAnalysis && data.moatAnalysis.moatScore >= 31) bullSignals.push(`Narrow moat detected (${data.moatAnalysis.moatType})`);

  const watchSignals: string[] = [];
  if (trend50 !== null && trend50 < 0) watchSignals.push('Price below 50D moving average');
  if (trend200 !== null && trend200 < 0) watchSignals.push('Price below 200D moving average');
  if (beta !== null && beta > 1.2) watchSignals.push('Volatility above market average');
  if (netDebt !== null && netDebt > 0) watchSignals.push('Net debt position');

  const bearSignals = riskLines.map((line) => line.replace(/^-\s*/, ''));
  const highlightsLines = [
    `- **Bull Case:** ${bullSignals.length ? bullSignals.join('; ') : 'Signals limited by available data.'}`,
    `- **Bear Case:** ${bearSignals.length ? bearSignals.join('; ') : 'No major red flags surfaced from available data.'}`,
    `- **What to watch:** ${watchSignals.length ? watchSignals.join('; ') : 'Monitor upcoming earnings and guidance.'}`,
  ];

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
    sections.push('- Date axis: Month/Year');
    if (priceChart) sections.push(priceChart);
    if (epsChart) sections.push(epsChart);
    if (peChart) sections.push(peChart);
  }

  if (revenueChart || marginChart) {
    sections.push('## 📊 Revenue & Margin Trends');
    if (revenueChart) sections.push(revenueChart);
    if (marginChart) sections.push(marginChart);
  }

  const financialLines = [
    `- P/E: ${peRatio === null ? 'Unavailable' : peRatio.toFixed(1)}`,
    `- PEG: ${pegRatio === null ? 'Unavailable' : pegRatio.toFixed(2)}`,
    `- Gross Margin (TTM): ${formatPercent(grossMargin)}`,
    `- Operating Margin (TTM): ${formatPercent(operatingMargin)}`,
    `- ROE (TTM): ${formatPercent(data.basicFinancials?.metric?.roeTTM)}`,
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

  // Moat section — placed after the financial charts and data so existing sections stay in their original positions
  if (data.moatAnalysis) {
    sections.push(buildStockMoatSection(data.moatAnalysis, scorecard.moatDetails));
  }

  sections.push('## 🚀 Growth Drivers', '- Period: trailing twelve months unless noted', ...(growthLines.length ? growthLines : ['- Growth drivers unavailable']));
  sections.push('## ⚠️ Risks & Headwinds', ...(riskLines.length ? riskLines : ['- No major risk flags surfaced from available data']));
  sections.push('## 🧭 Investment Highlights', ...highlightsLines);

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

  sections.push('## 🧑‍💼 Ownership & Sentiment', ...(ownershipLines.length ? ownershipLines : ['- Ownership data unavailable']));
  sections.push('## 🗓️ Guidance & Catalysts', ...(catalystLines.length ? catalystLines : ['- Guidance data unavailable']));

  if (scorecard.composite !== null) {
    const scorecardRadar = buildScorecardRadar(scorecard);
    sections.push(
      '## ✅ Scorecard',
      ...(scorecardRadar ? [scorecardRadar] : []),
      '- Radar chart shows normalized component scores (0-100).',
      `- Growth: ${scorecard.components.growth?.toFixed(1) ?? 'Unavailable'} (avg of revenue/EPS growth %)`,
      `- Profitability: ${scorecard.components.profitability?.toFixed(1) ?? 'Unavailable'} (avg of gross/operating margin, ROE)`,
      `- Valuation: ${scorecard.components.valuation?.toFixed(1) ?? 'Unavailable'} (100 - PE/50*100)`,
      `- Momentum: ${scorecard.components.momentum?.toFixed(1) ?? 'Unavailable'}`,
      `- Moat: ${scorecard.components.moat?.toFixed(1) ?? 'Unavailable'} (data-derived: avg of margin stability, pricing power, analyst conviction)${data.moatAnalysis ? ` | LLM Moat Score: ${Math.round(data.moatAnalysis.moatScore)}/100 (${data.moatAnalysis.moatStrength})` : ''}`,
      `- Composite Score: ${scorecard.composite?.toFixed(1) ?? 'Unavailable'}`,
    );
  }

  sections.push(buildStockConclusion(data, scorecard));

  return sections.filter(Boolean).join('\n\n');
}

export async function saveReport(content: string, title: string, directory = DEFAULT_REPORTS_DIR) {
  const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${safeTitle || 'report'}-${timestamp}.md`;

  // Persist to Supabase first (independent of filesystem)
  let supabaseId: string | undefined;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const { getSupabaseClient } = await import('./supabaseClient');
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client
          .from('saved_reports')
          .insert({ filename, title: safeTitle || title, content })
          .select('id')
          .single();
        if (error) {
          // Surface actionable message so it's visible in Vercel logs
          if (error.message.includes('schema cache') || error.message.includes('does not exist')) {
            console.error(
              '[saveReport] Supabase table missing — run the setup SQL at ' +
              'https://supabase.com/dashboard/project/bnhnlyiuwlebgmjerueb/sql/new\n' +
              'SQL: create table if not exists public.saved_reports (id uuid primary key default gen_random_uuid(), filename text not null, title text, content text not null, created_at timestamptz not null default now());'
            );
          } else {
            console.error('[saveReport] Supabase insert error:', error.message);
          }
        } else if (data?.id) {
          supabaseId = data.id as string;
        }
      }
    } catch (err) {
      console.error('[saveReport] Supabase unexpected error:', err);
    }
  }

  // Also write to local filesystem (best-effort; /tmp/reports on Vercel)
  let filePath = path.join(directory, filename);
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  } catch {
    filePath = path.join('/tmp', filename);
    try {
      await fs.writeFile(filePath, content, 'utf8');
    } catch {
      // Filesystem not available — Supabase is the source of truth
    }
  }

  return { filePath, filename, supabaseId };
}

export function buildComparisonReport(data: ComparisonReportData): string {
  const header = `# Company Comparison Report`;
  const notes = data.notes?.length ? data.notes.map((note) => `- ${note}`).join('\n') : '';
  const sources = data.sources || {};
  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
  const sourceLegend = provider === 'hybrid'
    ? '_Legend: Alpha Vantage is primary; Finnhub fills gaps._'
    : provider === 'finnhub'
      ? '_Legend: Finnhub provider._'
      : '_Legend: Alpha Vantage provider._';
  const items = data.items;

  const sourceRows = Object.entries(sources).map(([symbol, map]) => {
    const lookup = items.find((item) => item.symbol === symbol);
    const name = lookup?.overview?.name || symbol;
    const pick = (key: string) => map[key] || 'N/A';
    return [
      `${name} (${symbol})`,
      pick('Price'),
      pick('Company overview'),
      pick('Price history'),
      pick('Income statement'),
      pick('Balance sheet'),
      pick('Cash flow'),
      pick('Analyst ratings'),
      pick('Price targets'),
    ];
  });
  const sourceTable = sourceRows.length
    ? buildTable(
        ['Company', 'Price', 'Overview', 'Price History', 'Income', 'Balance', 'Cash Flow', 'Analyst', 'Targets'],
        sourceRows,
        ['left', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center']
      )
    : '';

  const snapshotRows = items.map((item) => {
    const overview = item.overview || {};
    const price = toNumber(item.price?.price);
    const changePercent = item.price?.changePercent;
    const changeValue = typeof changePercent === 'string'
      ? Number(changePercent.replace('%', ''))
      : changePercent;
    const changeIsPercent = typeof changePercent === 'string' && changePercent.includes('%');
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      formatPrice(price),
      formatSignedPercentValue(changeValue, 2, { alreadyPercent: changeIsPercent }),
      formatCurrency(overview.marketCapitalization),
      overview.sector || 'N/A',
      overview.industry || 'N/A',
      `${formatCurrency(overview['52WeekLow'])} - ${formatCurrency(overview['52WeekHigh'])}`,
    ];
  });

  const snapshotTable = buildTable(
    ['Company', 'Price', 'Day Change', 'Market Cap', 'Sector', 'Industry', '52W Range'],
    snapshotRows,
    ['left', 'right', 'right', 'right', 'left', 'left', 'right']
  );

  const scaleRows = items.map((item) => {
    const overview = item.overview || {};
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      formatCurrency(overview.revenueTTM),
      formatPercent(item.basicFinancials?.metric?.grossMarginTTM ?? overview.profitMargin),
      formatPercent(item.basicFinancials?.metric?.operatingMarginTTM ?? overview.operatingMargin),
      formatPercent(item.basicFinancials?.metric?.roeTTM ?? overview.returnOnEquity),
    ];
  });
  const scaleTable = buildTable(
    ['Company', 'Revenue (TTM)', 'Gross Margin', 'Operating Margin', 'ROE'],
    scaleRows,
    ['left', 'right', 'right', 'right', 'right']
  );

  const growthRows = items.map((item) => {
    const revenueGrowth = getStockRevenueGrowth({
      symbol: item.symbol,
      generatedAt: '',
      price: {},
      companyOverview: item.overview,
      basicFinancials: item.basicFinancials,
    } as StockReportData);
    const epsGrowth = getStockEpsGrowth({
      symbol: item.symbol,
      generatedAt: '',
      price: {},
      companyOverview: item.overview,
      basicFinancials: item.basicFinancials,
    } as StockReportData);
    const priceChange = computePriceChange(item.priceHistory?.prices || []);
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      formatPercent(revenueGrowth),
      formatPercent(epsGrowth),
      priceChange === null ? 'N/A' : formatSignedPercentValue(priceChange, 1, { alreadyPercent: true }),
    ];
  });
  const growthTable = buildTable(
    ['Company', 'Revenue Growth (TTM)', 'EPS Growth (TTM)', `${data.range} Price Change`],
    growthRows,
    ['left', 'right', 'right', 'right']
  );

  const valuationRows = items.map((item) => {
    const overview = item.overview || {};
    const price = toNumber(item.price?.price);
    const bookValue = toNumber(overview.bookValue);
    const revenuePerShare = toNumber(overview.revenuePerShare);
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      toNumber(overview.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM)?.toFixed(1) ?? 'N/A',
      toNumber(overview.forwardPE)?.toFixed(1) ?? 'N/A',
      toNumber(overview.pegRatio)?.toFixed(2) ?? 'N/A',
      price && revenuePerShare ? (price / revenuePerShare).toFixed(2) : 'N/A',
      price && bookValue ? (price / bookValue).toFixed(2) : 'N/A',
    ];
  });
  const valuationTable = buildTable(
    ['Company', 'P/E', 'Forward P/E', 'PEG', 'Price/Sales', 'Price/Book'],
    valuationRows,
    ['left', 'right', 'right', 'right', 'right', 'right']
  );

  const balanceRows = items.map((item) => {
    const balance = getLatestReport(item.balanceSheet);
    const cashFlow = getLatestReport(item.cashFlow);
    const cash = toNumber(balance?.cashAndEquivalents);
    const debt = toNumber(balance?.longTermDebt);
    const netDebt = cash !== null && debt !== null ? debt - cash : null;
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      formatCurrency(cash),
      formatCurrency(debt),
      netDebt === null ? 'N/A' : formatCurrency(netDebt),
      formatCurrency(cashFlow?.freeCashFlow),
    ];
  });
  const balanceTable = buildTable(
    ['Company', 'Cash', 'Total Debt', 'Net Debt', 'Free Cash Flow'],
    balanceRows,
    ['left', 'right', 'right', 'right', 'right']
  );

  const coverageRows = items.map((item) => {
    const overview = item.overview || {};
    const revenueGrowth = getStockRevenueGrowth({
      symbol: item.symbol,
      generatedAt: '',
      price: {},
      companyOverview: item.overview,
      basicFinancials: item.basicFinancials,
    } as StockReportData);
    const pe = toNumber(overview.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM);
    const marketCap = toNumber(overview.marketCapitalization);
    const hasPriceHistory = (item.priceHistory?.prices || []).length > 1;
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      hasPriceHistory ? '✅' : '—',
      revenueGrowth === null ? '—' : '✅',
      pe === null ? '—' : '✅',
      marketCap === null ? '—' : '✅',
    ];
  });
  const coverageTable = buildTable(
    ['Company', 'Price History', 'Revenue Growth', 'P/E', 'Market Cap'],
    coverageRows,
    ['left', 'center', 'center', 'center', 'center']
  );

  const analystRows = items.map((item) => {
    const price = toNumber(item.price?.price);
    const target = toNumber(item.priceTargets?.targetMean || item.analystRatings?.analystTargetPrice);
    const upside = price && target ? ((target - price) / price) * 100 : null;
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      target === null ? 'N/A' : target.toFixed(2),
      upside === null ? 'N/A' : `${upside.toFixed(1)}%`,
      formatRatingSummary(item),
    ];
  });
  const analystTable = buildTable(
    ['Company', 'Target Mean', 'Upside', 'Ratings'],
    analystRows,
    ['left', 'right', 'right', 'left']
  );

  const upsideLeaders = analystRows
    .map((row, index) => ({
      symbol: items[index].symbol,
      upside: Number(String(row[2]).replace('%', '')),
      name: row[0],
    }))
    .filter((row) => Number.isFinite(row.upside));
  const topUpside = upsideLeaders.sort((a, b) => b.upside - a.upside)[0];

  const ratingLeaders = items
    .map((item) => {
      const ratings = item.analystRatings || item.overview || {};
      const strongBuy = toNumber(ratings.strongBuy ?? ratings.analystRatingStrongBuy);
      const buy = toNumber(ratings.buy ?? ratings.analystRatingBuy);
      const hold = toNumber(ratings.hold ?? ratings.analystRatingHold);
      const sell = toNumber(ratings.sell ?? ratings.analystRatingSell);
      const strongSell = toNumber(ratings.strongSell ?? ratings.analystRatingStrongSell);
      const total = [strongBuy, buy, hold, sell, strongSell]
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + (value as number), 0);
      const score = total ? ((strongBuy || 0) + (buy || 0)) / total : null;
      return { symbol: item.symbol, name: item.overview?.name || item.symbol, score };
    })
    .filter((row) => row.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topRating = ratingLeaders[0];

  const scored = items.map((item) => {
    const scoreData: StockReportData = {
      symbol: item.symbol,
      generatedAt: data.generatedAt,
      price: item.price || {},
      priceHistory: item.priceHistory,
      companyOverview: item.overview,
      basicFinancials: item.basicFinancials,
      earningsHistory: undefined,
      incomeStatement: item.incomeStatement,
      balanceSheet: item.balanceSheet,
      cashFlow: item.cashFlow,
      analystRatings: item.analystRatings,
      analystRecommendations: undefined,
      priceTargets: item.priceTargets,
      peers: undefined,
      newsSentiment: undefined,
      companyNews: undefined,
    };
    const scorecard = computeScorecard(scoreData);
    return { item, score: scorecard.composite };
  });

  const validScores = scored.filter((row) => row.score !== null) as Array<{ item: ComparisonReportItem; score: number }>;
  const totalScore = validScores.reduce((sum, row) => sum + (row.score ?? 0), 0);
  const weights = scored.map((row) => {
    if (!validScores.length || totalScore === 0) {
      return 100 / scored.length;
    }
    if (row.score === null) return null;
    return (row.score / totalScore) * 100;
  });

  const revenueLeaders = [...scored].sort((a, b) => {
    const aGrowth = getStockRevenueGrowth({
      symbol: a.item.symbol,
      generatedAt: '',
      price: {},
      companyOverview: a.item.overview,
      basicFinancials: a.item.basicFinancials,
    } as StockReportData) ?? -Infinity;
    const bGrowth = getStockRevenueGrowth({
      symbol: b.item.symbol,
      generatedAt: '',
      price: {},
      companyOverview: b.item.overview,
      basicFinancials: b.item.basicFinancials,
    } as StockReportData) ?? -Infinity;
    return bGrowth - aGrowth;
  });
  const topGrowth = revenueLeaders[0]?.item.symbol;

  const marginLeaders = [...scored].sort((a, b) => {
    const aMargin = normalizePercent(a.item.basicFinancials?.metric?.operatingMarginTTM ?? a.item.overview?.operatingMargin) ?? -Infinity;
    const bMargin = normalizePercent(b.item.basicFinancials?.metric?.operatingMarginTTM ?? b.item.overview?.operatingMargin) ?? -Infinity;
    return bMargin - aMargin;
  });
  const topMargin = marginLeaders[0]?.item.symbol;

  const allocationRows = scored.map((row, index) => {
    const moatScore = row.item.moatAnalysis?.moatScore ?? null;
    const reasons = [
      row.item.symbol === topGrowth ? 'Top revenue growth' : null,
      row.item.symbol === topMargin ? 'Best operating margin' : null,
      row.score !== null && row.score > 60 ? 'Strong composite score' : null,
      moatScore !== null && moatScore >= 61 ? `Wide moat (${row.item.moatAnalysis!.moatType})` : null,
    ].filter(Boolean);
    return [
      `${row.item.overview?.name || row.item.symbol} (${row.item.symbol})`,
      row.score === null ? 'N/A' : row.score.toFixed(1),
      weights[index] === null ? 'N/A' : `${weights[index]!.toFixed(1)}%`,
      weights[index] === null ? 'Insufficient data' : (reasons.length ? reasons.join('; ') : 'Balanced exposure'),
    ];
  });
  const allocationTable = buildTable(
    ['Company', 'Composite Score', 'Indicative Weight', 'Rationale'],
    allocationRows,
    ['left', 'right', 'right', 'left']
  );

  const moatSection = buildComparisonMoatSection(items);
  const performanceChart = buildComparisonPerformanceChart(
    items.map((item) => ({ symbol: item.symbol, priceHistory: item.priceHistory } as ComparisonReportItem)),
    `Price Performance (${data.range}, Indexed)`
  );
  const scatterChart = buildValuationGrowthScatter(items);
  const marginChart = buildMarginComparisonChart(items);

  const debugMode = process.env.DEBUG === 'true';
  const sections = [
    header,
    `Generated: ${data.generatedAt}`,
    `Universe: ${data.universe.join(', ')}`,
    notes ? `## ⚠️ Data Gaps\n${notes}` : null,
    debugMode && sourceTable ? '## 🧾 Data Sources' : null,
    debugMode && sourceTable ? `${sourceLegend}\n\n${sourceTable}` : null,
    '## 📊 Snapshot',
    snapshotTable,
    '## 🧾 Scale & Profitability',
    scaleTable,
    '## 🚀 Growth & Momentum',
    growthTable,
    '## 🧮 Valuation',
    valuationTable,
    '## 🏦 Balance Sheet & Cash',
    balanceTable,
    '## 🧠 Analyst View',
    analystTable,
    '## ⭐ Analyst Picks',
    `- Highest target upside: ${topUpside ? `${topUpside.name} (${topUpside.upside.toFixed(1)}%)` : 'N/A'}`,
    `- Strongest consensus: ${topRating ? `${topRating.name} (${(topRating.score! * 100).toFixed(0)}% buy/strong buy)` : 'N/A'}`,
    moatSection || null,
    debugMode ? '## 🧩 Data Coverage (Chart Inputs)' : null,
    debugMode ? coverageTable : null,
    '## 📈 Price Performance (Indexed)',
    performanceChart || '_Price performance data unavailable._',
    '## 📊 Valuation vs Growth',
    scatterChart || '_Valuation/growth data unavailable._',
    '## 📊 Margin Comparison',
    marginChart || '_Margin comparison data unavailable._',
    '## 🧭 Indicative Allocation (Not Investment Advice)',
    allocationTable,
    validScores.length < scored.length
      ? '_Some companies lack composite scores; weights are normalized across available scores._'
      : '_Indicative allocation is derived from normalized composite scores. It is not investment advice._',
  ].filter(Boolean) as string[];

  return sections.join('\n\n');
}

/**
 * Builds a sector / thematic analysis report.
 *
 * The universe of companies was identified by the LLM based on the sector query.
 * All comparison data (financials, price history, analyst ratings, etc.) is pulled
 * from market-data APIs exactly as in `buildComparisonReport` — the only
 * difference is the sector-specific header that explains how the universe was
 * chosen.
 */
export function buildSectorReport(data: SectorReportData): string {
  const selectionNote =
    data.selectedBy === 'llm'
      ? `The following ${data.universe.length} companies were identified by AI as top players in the **"${data.sectorQuery}"** space.`
      : `The following ${data.universe.length} companies were selected for the **"${data.sectorQuery}"** sector analysis.`;

  const sectorHeader = [
    `# Sector / Thematic Analysis: ${data.sectorQuery}`,
    `Generated: ${data.generatedAt}`,
    '## 🔍 Universe Selection',
    selectionNote,
    `**Companies:** ${data.universe.join(', ')}`,
  ].join('\n\n');

  // Re-use the full comparison report body (strip its own header/generated line
  // so they are not duplicated).
  const comparisonBody = buildComparisonReport(data)
    .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\nUniverse:[^\n]*\n\n/, '')
    .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\n/, '')
    .replace(/^# Company Comparison Report\n\n/, '')
    .trimStart();

  return `${sectorHeader}\n\n${comparisonBody}`;
}

/**
 * Builds a deep sector research report.
 *
 * Extends the sector report with three additional sections produced during the
 * AI-driven ecosystem analysis phase:
 *   1. Research methodology overview (initial candidates → refinement → comparison)
 *   2. Sector ecosystem & dependency analysis (supply chain, customers, macro factors)
 *   3. Company selection rationale (why specific companies were kept or excluded)
 *   4. Mermaid dependency map diagram
 *
 * The financial comparison tables and charts are identical to the regular sector
 * report — the extra depth comes from the pre-report analysis phase.
 */
export function buildDeepSectorReport(data: DeepSectorReportData): string {
  const initialCount = data.initialCandidates?.length ?? 0;
  const refinedCount = data.universe.length;

  const candidateLine = initialCount > 0
    ? `**Initial candidates screened:** ${data.initialCandidates!.join(', ')}`
    : '';
  const refinedLine = initialCount > refinedCount
    ? `**Refined to ${refinedCount} companies:** ${data.universe.join(', ')}`
    : `**Final universe (${refinedCount} companies):** ${data.universe.join(', ')}`;

  const methodologySteps = [
    `1. **Candidate Identification** — AI identified ${initialCount > 0 ? `${initialCount} initial` : 'a set of'} companies in the **"${data.sectorQuery}"** space`,
    `2. **Ecosystem Analysis** — Supply chain, customer, market, and news dependencies were mapped across all candidates`,
    `3. **Refinement** — The list was refined to ${refinedCount} companies best suited for deep financial comparison`,
    `4. **Comparison** — Full financial comparison built for the refined universe`,
  ].join('\n');

  const header = [
    `# Deep Sector Research: ${data.sectorQuery}`,
    `Generated: ${data.generatedAt}`,
    `## 🔬 Research Methodology`,
    methodologySteps,
    candidateLine,
    refinedLine,
  ].filter(Boolean).join('\n\n');

  // ── Sector Ecosystem & Dependencies ─────────────────────────────────────
  // The dependencyAnalysis string is expected to use structured ### subsection
  // headers generated by the LLM prompt (Supply Chain, Customer Exposure, etc.).
  // We add a brief context line before the structured content.
  const dependencySection = data.dependencyAnalysis
    ? (
        `## 🕸️ Sector Ecosystem & Dependencies\n\n` +
        `> _AI-generated analysis of inter-company relationships, market drivers, and competitive dynamics._\n\n` +
        data.dependencyAnalysis
      )
    : '';

  const diagramSection = data.ecosystemDiagram
    ? `## 🗺️ Sector Dependency Map\n\n\`\`\`mermaid\n${data.ecosystemDiagram}\n\`\`\``
    : '';

  // ── Company Selection Rationale ──────────────────────────────────────────
  // Parse the ✅ / ❌ per-company lines produced by the LLM and render them as
  // a markdown table for a cleaner, scannable layout.
  const refinementSection = data.refinementNotes
    ? `## 🎯 Company Selection Rationale\n\n${formatRationaleAsTable(data.refinementNotes)}`
    : '';

  // ── Selected Companies at a Glance ───────────────────────────────────────
  // Render per-company investment snapshots as a table so readers can quickly
  // grasp why each company made the final list.
  const snapshotsSection = buildCompanySnapshotsSection(data.universe, data.companySnapshots);

  // Re-use comparison report body — strip the comparison header so it is not duplicated.
  const comparisonBody = buildComparisonReport(data)
    .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\nUniverse:[^\n]*\n\n/, '')
    .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\n/, '')
    .replace(/^# Company Comparison Report\n\n/, '')
    .trimStart();

  return [header, dependencySection, diagramSection, refinementSection, snapshotsSection, comparisonBody]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Parses per-company ✅/❌ rationale lines and renders them as a markdown table.
 * Falls back to the raw text if the format does not match the expected pattern.
 *
 * Expected input line format (one per company):
 *   ✅ TICKER (Company Name) — reason
 *   ❌ TICKER (Company Name) — reason
 */
function formatRationaleAsTable(notes: string): string {
  const lines = notes.split('\n').map(l => l.trim()).filter(Boolean);
  // Match: ✅ or ❌, then ticker (optionally followed by name in parens), then — or - separator, then reason
  const rowPattern = /^([✅❌])\s+([A-Z0-9.]+)(?:\s+\([^)]*\))?\s*[—-]\s*(.+)$/u;
  const rows: Array<{ status: string; ticker: string; reason: string }> = [];

  for (const line of lines) {
    const m = line.match(rowPattern);
    if (m) {
      rows.push({ status: m[1], ticker: m[2], reason: m[3].trim() });
    }
  }

  if (rows.length === 0) {
    // No parseable rows — return raw text unchanged
    return notes;
  }

  const tableHeader = '| Status | Company | Rationale |\n|:------:|---------|-----------|';
  const tableRows = rows.map(r => `| ${r.status} | **${r.ticker}** | ${r.reason} |`).join('\n');
  return `${tableHeader}\n${tableRows}`;
}

/**
 * Builds a "Selected Companies at a Glance" section from per-company snapshots.
 * Returns an empty string if no snapshot data is available.
 */
function buildCompanySnapshotsSection(
  universe: string[],
  snapshots?: Record<string, string>
): string {
  if (!snapshots || Object.keys(snapshots).length === 0) return '';

  // Only include companies that are in the final universe and have a snapshot
  const rows = universe
    .filter(ticker => ticker in snapshots && snapshots[ticker])
    .map(ticker => `| **${ticker}** | ${snapshots[ticker]} |`);

  if (rows.length === 0) return '';

  const tableHeader = '| Company | Investment Thesis |\n|---------|-------------------|';
  return `## 📋 Selected Companies at a Glance\n\n${tableHeader}\n${rows.join('\n')}`;
}

/**
 * Derives a plain-English investment rating from a 0-100 composite score,
 * optionally adjusted by analyst consensus.
 *
 * @param compositeScore  Normalized composite score (0-100) or null if unavailable
 * @param analystBuyPct   Fraction of analyst ratings that are Buy/Strong-Buy (0-1), or null
 */
function deriveRating(
  compositeScore: number | null,
  analystBuyPct: number | null
): { label: string; emoji: string } {
  if (compositeScore === null && analystBuyPct === null) {
    return { label: 'WATCH', emoji: '👀' };
  }

  // Start from composite score; fall back to analyst consensus if score unavailable
  let base = compositeScore ?? (analystBuyPct !== null ? analystBuyPct * 100 : 50);

  // Blend analyst consensus: shift base ±10 points toward analyst view
  if (analystBuyPct !== null && compositeScore !== null) {
    const analystSignal = (analystBuyPct - 0.5) * 20; // [-10, +10]
    base = base + analystSignal * 0.3;
  }

  if (base >= 65) return { label: 'BUY', emoji: '✅' };
  if (base >= 45) return { label: 'HOLD', emoji: '⚖️' };
  if (base >= 30) return { label: 'WATCH', emoji: '👀' };
  return { label: 'SELL / AVOID', emoji: '🔴' };
}

/**
 * Builds the Investment Conclusion section for a single-stock report.
 * All inputs are derived from real API data already present in the report —
 * no training-data values are injected.
 */
function buildStockConclusion(data: StockReportData, scorecard: ReturnType<typeof computeScorecard>): string {
  const overview = data.companyOverview || {};
  const symbol = data.symbol;
  const name = overview.name || symbol;

  // Analyst buy fraction from real data
  const strongBuy = toNumber(data.analystRatings?.strongBuy);
  const buy = toNumber(data.analystRatings?.buy);
  const hold = toNumber(data.analystRatings?.hold);
  const sell = toNumber(data.analystRatings?.sell);
  const strongSell = toNumber(data.analystRatings?.strongSell);
  const totalAnalyst = [strongBuy, buy, hold, sell, strongSell].reduce<number>((s, v) => s + (v ?? 0), 0);
  const analystBuyPct = totalAnalyst > 0 && strongBuy !== null && buy !== null
    ? ((strongBuy + buy) / totalAnalyst)
    : null;

  const rating = deriveRating(scorecard.composite, analystBuyPct);

  // Target upside
  const price = toNumber(data.price?.price);
  const targetMean = toNumber(data.priceTargets?.targetMean ?? overview.analystTargetPrice);
  const upside = price && targetMean ? ((targetMean - price) / price) * 100 : null;

  // Key bullish evidence (derived from real API values)
  const bullish: string[] = [];
  const bearish: string[] = [];

  const composite = scorecard.composite;
  if (composite !== null) {
    if (composite >= 60) bullish.push(`Strong composite score (${composite.toFixed(1)}/100)`);
    else if (composite < 40) bearish.push(`Below-average composite score (${composite.toFixed(1)}/100)`);
  }

  if (upside !== null) {
    if (upside > 10) bullish.push(`Analyst consensus implies ${upside.toFixed(1)}% upside to mean target`);
    else if (upside < -10) bearish.push(`Price exceeds analyst mean target by ${Math.abs(upside).toFixed(1)}%`);
  }

  const moat = data.moatAnalysis;
  if (moat) {
    if (moat.moatScore >= 61) bullish.push(`Wide competitive moat: ${moat.moatType} (score ${moat.moatScore}/100)`);
    else if (moat.moatScore < 31) bearish.push(`No significant competitive moat identified (score ${moat.moatScore}/100)`);
  }

  const revenueGrowth = getStockRevenueGrowth(data);
  if (revenueGrowth !== null) {
    if (revenueGrowth > 10) bullish.push(`Revenue growing at ${revenueGrowth.toFixed(1)}% TTM`);
    else if (revenueGrowth < 0) bearish.push(`Revenue declining ${Math.abs(revenueGrowth).toFixed(1)}% TTM`);
  }

  const opMargin = normalizePercent(data.basicFinancials?.metric?.operatingMarginTTM ?? overview.operatingMargin);
  if (opMargin !== null) {
    if (opMargin > 20) bullish.push(`High operating margin (${opMargin.toFixed(1)}%)`);
    else if (opMargin < 0) bearish.push(`Negative operating margin (${opMargin.toFixed(1)}%)`);
  }

  // Suggested portfolio role
  let portfolioRole = 'General equity exposure';
  const moatScore = moat?.moatScore ?? 0;
  if (composite !== null && composite >= 65 && moatScore >= 61) {
    portfolioRole = 'Core holding — quality compounder with durable advantage';
  } else if (composite !== null && composite >= 65) {
    portfolioRole = 'Growth tilt — strong fundamentals, monitor valuation';
  } else if (composite !== null && composite >= 45 && moatScore >= 31) {
    portfolioRole = 'Hold — stable business, revisit on any meaningful pullback';
  } else if (composite !== null && composite < 40) {
    portfolioRole = 'Speculative / avoid — fundamentals under pressure';
  }

  const bullLines = bullish.length
    ? `**Bullish Signals:**\n${bullish.map((b) => `- ${b}`).join('\n')}`
    : '';
  const bearLines = bearish.length
    ? `**Bearish Signals / Risks:**\n${bearish.map((b) => `- ${b}`).join('\n')}`
    : '';

  return [
    '## 🎯 Investment Conclusion',
    `> _All values are sourced from live market-data APIs. This section summarises what the data shows — it is not financial advice._`,
    `**${name} (${symbol}) — ${rating.emoji} ${rating.label}**`,
    `- Suggested Portfolio Role: ${portfolioRole}`,
    upside !== null ? `- Analyst Mean Target Upside: ${upside.toFixed(1)}%` : null,
    bullLines || null,
    bearLines || null,
    '_This conclusion is derived entirely from real API data. Always conduct your own due diligence before investing._',
  ].filter(Boolean).join('\n\n');
}

/**
 * Builds the Investment Conclusion section for a multi-stock comparison report
 * (used by both buildComparisonReport and buildSectorReport).
 *
 * @param items       The comparison items with financial data
 * @param scored      Each item paired with its composite score
 * @param reportType  'comparison' | 'sector' | 'deep-sector' — adjusts the header text
 * @param sectorQuery Optional sector/theme label for sector-type reports
 */
function buildComparisonConclusion(
  items: ComparisonReportItem[],
  scored: Array<{ item: ComparisonReportItem; score: number | null }>,
  reportType: 'comparison' | 'sector' | 'deep-sector',
  sectorQuery?: string
): string {
  if (items.length === 0) return '';

  // Rank by composite score (real data only)
  const ranked = scored
    .filter((r) => r.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const top = ranked[0];
  const runnerUp = ranked[1];

  const topName = top?.item.overview?.name || top?.item.symbol || 'N/A';
  const topSymbol = top?.item.symbol || 'N/A';
  const topScore = top?.score;

  // Average composite score → sector/group outlook
  const validScores = ranked.map((r) => r.score as number);
  const avgScore = validScores.length
    ? validScores.reduce((s, v) => s + v, 0) / validScores.length
    : null;

  const outlook =
    avgScore === null ? 'Mixed'
    : avgScore >= 65 ? 'Constructive — most companies show strong fundamentals'
    : avgScore >= 45 ? 'Neutral — quality varies; selective exposure recommended'
    : 'Cautious — fundamentals broadly under pressure';

  // Moat leader
  const moatLeader = items
    .filter((it) => it.moatAnalysis && it.moatAnalysis.moatScore >= 61)
    .sort((a, b) => (b.moatAnalysis?.moatScore ?? 0) - (a.moatAnalysis?.moatScore ?? 0))[0];

  const topPickLine = top
    ? `**Top Pick: ${topName} (${topSymbol})** — Composite score ${topScore?.toFixed(1)}/100`
    : '_Insufficient data for ranking._';

  const runnerUpLine = runnerUp
    ? `- Runner-up: ${runnerUp.item.overview?.name || runnerUp.item.symbol} (${runnerUp.item.symbol}) — score ${runnerUp.score?.toFixed(1)}/100`
    : null;

  const moatLine = moatLeader
    ? `- Strongest moat: **${moatLeader.overview?.name || moatLeader.symbol} (${moatLeader.symbol})** — ${moatLeader.moatAnalysis!.moatType} (score ${moatLeader.moatAnalysis!.moatScore}/100)`
    : null;

  const outlookLabel =
    reportType === 'sector' ? `**${sectorQuery || 'Sector'} Outlook:** ${outlook}`
    : reportType === 'deep-sector' ? `**Deep Sector Outlook (${sectorQuery || 'sector'}):** ${outlook}`
    : `**Peer Group Outlook:** ${outlook}`;

  const strategyAdvice =
    topScore !== null && topScore >= 65
      ? `Focused allocation to the top-ranked name(s) is supported by the data.`
      : `A diversified basket approach reduces single-name risk given mixed signals.`;

  return [
    '## 🎯 Investment Conclusion',
    `> _All values are derived from live market-data APIs. This conclusion is not financial advice._`,
    topPickLine,
    runnerUpLine,
    moatLine,
    outlookLabel,
    `- Strategy: ${strategyAdvice}`,
    '_Always conduct your own due diligence before making investment decisions._',
  ].filter(Boolean).join('\n\n');
}
