/* eslint-disable @typescript-eslint/no-explicit-any */
import { StockDataService } from './stockDataService';
import { buildStockReport, buildComparisonReport, buildSectorReport, buildDeepSectorReport, saveReport } from './reportGenerator';

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
 * Builds a prompt asking the LLM to map each query to its official US stock ticker.
 * Used when the market-data search API returns no candidates (e.g. 'GOOGLE' → 'GOOGL').
 */
function buildTickerResolutionPrompt(queries: string[]): string {
  const shape = Object.fromEntries(queries.map((q) => [q, 'TICKER | null']));
  return (
    `You are a financial data assistant. For each of the following company names or informal tickers, ` +
    `identify the correct official US stock exchange ticker symbol.\n\n` +
    `Inputs: ${JSON.stringify(queries)}\n\n` +
    `RULES:\n` +
    `- Return the primary US-listed ticker (e.g. "GOOGL" for Google/Alphabet, "MSFT" for Microsoft)\n` +
    `- For share-class ambiguity, prefer the more liquid class (e.g. GOOGL over GOOG)\n` +
    `- Return null for any input you cannot identify with certainty\n\n` +
    `Respond ONLY with valid JSON:\n` +
    JSON.stringify(shape, null, 2)
  );
}


function buildBasicFinancialsFallback(overview: any): any {
  if (!overview) return undefined;
  const revenue = Number(overview.revenueTTM);
  const grossProfit = Number(overview.grossProfitTTM);
  const grossMarginTTM = Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(grossProfit)
    ? grossProfit / revenue
    : Number(overview.profitMargin) || null;
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
            query: { type: 'string', description: 'Company name or ticker (e.g. "Apple" or "AAPL")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
            days: { type: 'number', description: 'Lookback window in days (optional)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_stock_report',
        description:
          'Generate and save a comprehensive stock report from pre-fetched data. ' +
          'BEFORE calling this, you MUST batch all of these data tool calls in ONE round: ' +
          'get_stock_price, get_company_overview, get_price_history (range "5y"), get_earnings_history, ' +
          'get_income_statement, get_balance_sheet, get_cash_flow, get_analyst_ratings, ' +
          'get_analyst_recommendations, get_price_targets, get_peers, get_news_sentiment, ' +
          'get_company_news, get_insider_trading. Then call this tool with all results.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Official ticker symbol (e.g. AAPL)' },
            price: { type: 'object', description: 'Result from get_stock_price' },
            companyOverview: { type: 'object', description: 'Result from get_company_overview' },
            priceHistory: { type: 'object', description: 'Result from get_price_history' },
            earningsHistory: { type: 'object', description: 'Result from get_earnings_history' },
            incomeStatement: { type: 'object', description: 'Result from get_income_statement' },
            balanceSheet: { type: 'object', description: 'Result from get_balance_sheet' },
            cashFlow: { type: 'object', description: 'Result from get_cash_flow' },
            analystRatings: { type: 'object', description: 'Result from get_analyst_ratings' },
            analystRecommendations: { type: 'object', description: 'Result from get_analyst_recommendations' },
            priceTargets: { type: 'object', description: 'Result from get_price_targets' },
            peers: { type: 'object', description: 'Result from get_peers' },
            newsSentiment: { type: 'object', description: 'Result from get_news_sentiment' },
            companyNews: { type: 'object', description: 'Result from get_company_news' },
            insiderTransactions: { type: 'object', description: 'Result from get_insider_trading' },
          },
          required: ['symbol', 'price'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_comparison_report',
        description:
          'Generate a multi-company comparison report from pre-fetched data. ' +
          'BEFORE calling this, for EACH company batch: get_stock_price, get_company_overview, ' +
          'get_price_history, get_income_statement, get_balance_sheet, get_cash_flow, ' +
          'get_analyst_ratings, get_price_targets, get_news_sentiment, get_company_news, get_insider_trading. ' +
          'Issue ALL tool calls for ALL companies in ONE round. Then call this tool.',
        parameters: {
          type: 'object',
          properties: {
            range: { type: 'string', description: 'Price history range (e.g. "1y"). Default: "1y"' },
            universe: { type: 'array', items: { type: 'string' }, description: 'Ordered list of ticker symbols' },
            items: {
              type: 'array',
              description: 'Pre-fetched data for each company, in the same order as universe',
              items: {
                type: 'object',
                properties: {
                  symbol: { type: 'string' },
                  price: { type: 'object' },
                  overview: { type: 'object' },
                  priceHistory: { type: 'object' },
                  incomeStatement: { type: 'object' },
                  balanceSheet: { type: 'object' },
                  cashFlow: { type: 'object' },
                  analystRatings: { type: 'object' },
                  priceTargets: { type: 'object' },
                  newsSentiment: { type: 'object' },
                  companyNews: { type: 'object' },
                  insiderTransactions: { type: 'object' },
                },
                required: ['symbol'],
              },
            },
            notes: { type: 'array', items: { type: 'string' }, description: 'Optional notes about data gaps' },
          },
          required: ['range', 'universe', 'items'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_sector_report',
        description:
          'Generate a sector/thematic analysis report. ' +
          'Steps you MUST follow: ' +
          '1) Identify the top companies in the sector. ' +
          '2) Batch all data tool calls for ALL companies in ONE round (same tools as generate_comparison_report). ' +
          '3) Call this tool with the assembled data.',
        parameters: {
          type: 'object',
          properties: {
            sectorQuery: { type: 'string', description: 'Sector or theme name (e.g. "AI semiconductors")' },
            range: { type: 'string', description: 'Price history range. Default: "1y"' },
            universe: { type: 'array', items: { type: 'string' }, description: 'List of ticker symbols in this sector' },
            items: {
              type: 'array',
              description: 'Pre-fetched data for each company (same format as generate_comparison_report items)',
              items: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
            },
            notes: { type: 'array', items: { type: 'string' } },
          },
          required: ['sectorQuery', 'universe', 'items'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_deep_sector_report',
        description:
          'Generate a deep sector ecosystem research report. ' +
          'You MUST orchestrate all 4 phases yourself: ' +
          'Phase 1 — identify ~2x candidate tickers for the sector. ' +
          'Phase 2 — batch fetch get_company_overview, get_news_sentiment, get_peers for ALL candidates in ONE round. ' +
          'Phase 3 — analyse supply-chain/customer/market dependencies from the fetched data; select the best final companies; write your ecosystem analysis and Mermaid diagram. ' +
          'Phase 4 — batch ALL data tool calls (same as generate_comparison_report) for the final companies in ONE round. ' +
          'Then call this tool with everything assembled.',
        parameters: {
          type: 'object',
          properties: {
            sectorQuery: { type: 'string', description: 'Sector or theme name' },
            range: { type: 'string', description: 'Price history range. Default: "1y"' },
            universe: { type: 'array', items: { type: 'string' }, description: 'Final refined ticker list' },
            items: {
              type: 'array',
              description: 'Full pre-fetched data for each final company (same format as generate_comparison_report)',
              items: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
            },
            dependencyAnalysis: { type: 'string', description: 'Your 2–3 paragraph ecosystem dependency analysis' },
            ecosystemDiagram: { type: 'string', description: 'Mermaid diagram (graph LR) of ecosystem relationships' },
            refinementNotes: { type: 'string', description: 'Rationale for company selection/exclusion' },
            scenarioSimulations: { type: 'string', description: 'Bull/bear/base scenario analysis (optional)' },
            supplierCustomerMap: { type: 'string', description: 'Critical supplier/customer mapping narrative (optional)' },
            innovationHighlights: { type: 'string', description: 'Innovation highlights table in markdown (optional)' },
            notes: { type: 'array', items: { type: 'string' } },
          },
          required: ['sectorQuery', 'universe', 'items'],
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
      case 'get_sector_performance': {
        const data = await stockService.getSectorPerformance();
        return { success: true, data, message: 'Retrieved sector performance data' };
      }
      case 'get_top_gainers_losers': {
        const data = await stockService.getTopGainersLosers();
        return { success: true, data, message: 'Retrieved top gainers, losers, and most active stocks' };
      }
      case 'generate_stock_report': {
        const symbol = String(args.symbol || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase();
        if (!symbol) return { success: false, error: 'symbol is required.' };

        const companyOverview = args.companyOverview || null;
        const basicFinancials = companyOverview ? buildBasicFinancialsFallback(companyOverview) : undefined;

        const reportBody = buildStockReport({
          symbol,
          generatedAt: new Date().toISOString(),
          price: args.price,
          priceHistory: args.priceHistory,
          companyOverview,
          basicFinancials,
          earningsHistory: args.earningsHistory,
          incomeStatement: args.incomeStatement,
          balanceSheet: args.balanceSheet,
          cashFlow: args.cashFlow,
          analystRatings: args.analystRatings,
          analystRecommendations: args.analystRecommendations,
          priceTargets: args.priceTargets,
          peers: args.peers,
          newsSentiment: args.newsSentiment,
          companyNews: args.companyNews,
          insiderTransactions: args.insiderTransactions,
        });

        const saved = await saveReport(reportBody, `${symbol}-stock-report`);
        return {
          success: true,
          data: { content: reportBody, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved stock report to ${saved.filePath}`,
        };
      }
      case 'generate_comparison_report': {
        const range = String(args.range || '1y');
        const universe: string[] = Array.isArray(args.universe) ? args.universe.map(String) : [];
        const rawItems: any[] = Array.isArray(args.items) ? args.items : [];

        if (rawItems.length < 2) {
          return { success: false, error: 'Provide at least 2 companies in the items array.' };
        }

        const items = rawItems.map((item: any) => ({
          ...item,
          basicFinancials: item.overview ? buildBasicFinancialsFallback(item.overview) : undefined,
        }));

        const content = buildComparisonReport({
          generatedAt: new Date().toISOString(),
          range,
          universe: universe.length ? universe : items.map((i: any) => i.symbol),
          items,
          notes: Array.isArray(args.notes) ? args.notes : [],
        });

        const title = (universe.length ? universe : items.map((i: any) => i.symbol)).join('-');
        const saved = await saveReport(content, `${title}-comparison-report`);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved comparison report to ${saved.filePath}`,
        };
      }
      case 'generate_sector_report': {
        const sectorQuery = String(args.sectorQuery || args.sector || '').trim();
        if (!sectorQuery) return { success: false, error: 'sectorQuery is required.' };

        const range = String(args.range || '1y');
        const universe: string[] = Array.isArray(args.universe) ? args.universe.map(String) : [];
        const rawItems: any[] = Array.isArray(args.items) ? args.items : [];

        if (rawItems.length < 1) {
          return { success: false, error: 'items array is required. Fetch data for each company first, then call this tool.' };
        }

        const items = rawItems.map((item: any) => ({
          ...item,
          basicFinancials: item.overview ? buildBasicFinancialsFallback(item.overview) : undefined,
        }));

        const content = buildSectorReport({
          sectorQuery,
          selectedBy: 'llm',
          generatedAt: new Date().toISOString(),
          range,
          universe: universe.length ? universe : items.map((i: any) => i.symbol),
          items,
          notes: Array.isArray(args.notes) ? args.notes : [],
        });

        const saved = await saveReport(content, `${sectorQuery.replace(/\s+/g, '-')}-sector-report`);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved sector report to ${saved.filePath}`,
        };
      }
      case 'generate_deep_sector_report': {
        const sectorQuery = String(args.sectorQuery || args.sector || '').trim();
        if (!sectorQuery) return { success: false, error: 'sectorQuery is required.' };

        const range = String(args.range || '1y');
        const universe: string[] = Array.isArray(args.universe) ? args.universe.map(String) : [];
        const rawItems: any[] = Array.isArray(args.items) ? args.items : [];

        if (rawItems.length < 1) {
          return { success: false, error: 'items array is required. Complete all 4 phases first, then call this tool.' };
        }

        const items = rawItems.map((item: any) => ({
          ...item,
          basicFinancials: item.overview ? buildBasicFinancialsFallback(item.overview) : undefined,
        }));

        const content = buildDeepSectorReport({
          sectorQuery,
          selectedBy: 'llm',
          generatedAt: new Date().toISOString(),
          range,
          universe: universe.length ? universe : items.map((i: any) => i.symbol),
          items,
          notes: Array.isArray(args.notes) ? args.notes : [],
          dependencyAnalysis: args.dependencyAnalysis,
          ecosystemDiagram: args.ecosystemDiagram,
          refinementNotes: args.refinementNotes,
          scenarioSimulations: args.scenarioSimulations,
          supplierCustomerMap: args.supplierCustomerMap,
          innovationHighlights: args.innovationHighlights,
        });

        const safe = sectorQuery.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        const saved = await saveReport(content, `${safe}-deep-sector-report`);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved deep sector report to ${saved.filePath}`,
        };
      }
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
