import axios from 'axios';

export interface StockDataService {
  getStockPrice(symbol: string): Promise<any>;
  getPriceHistory(symbol: string, range?: string): Promise<any>;
  getCompanyOverview(symbol: string): Promise<any>;
  getInsiderTrading(symbol: string): Promise<any>;
  getAnalystRatings(symbol: string): Promise<any>;
  searchStock(query: string): Promise<any>;
  getEarningsHistory(symbol: string): Promise<any>;
  getIncomeStatement(symbol: string): Promise<any>;
  getBalanceSheet(symbol: string): Promise<any>;
  getCashFlow(symbol: string): Promise<any>;
  getSectorPerformance(): Promise<any>;
  getStocksBySector(sector: string): Promise<any>;
  getTopGainersLosers(): Promise<any>;
  getNewsSentiment(symbol: string): Promise<any>;
}

/**
 * Stock data service using Alpha Vantage API (free tier)
 * Note: Alpha Vantage free tier has a limit of 5 API calls per minute
 */
export class AlphaVantageService implements StockDataService {
  private apiKey: string;
  private baseUrl = 'https://www.alphavantage.co/query';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ALPHA_VANTAGE_API_KEY || 'demo';
  }

  // Delay between Alpha Vantage rate-limit retries (12s, 24s)
  private static readonly RATE_LIMIT_RETRY_BASE_MS = 12000;

  private async makeRequest(params: Record<string, string>): Promise<any> {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await axios.get(this.baseUrl, {
          params: {
            ...params,
            apikey: this.apiKey,
          },
          timeout: 15000,
        });
        const data = response.data;
        // Alpha Vantage signals rate limit via body message, not HTTP status
        const rateLimitMsg: string = data['Note'] || data['Information'] || '';
        if (rateLimitMsg && (rateLimitMsg.includes('rate limit') || rateLimitMsg.includes('API call frequency') || rateLimitMsg.includes('Thank you'))) {
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, (attempt + 1) * AlphaVantageService.RATE_LIMIT_RETRY_BASE_MS));
            continue;
          }
          throw new Error(`Alpha Vantage rate limit reached. Data unavailable. Consider upgrading to a premium API key at alphavantage.co.`);
        }
        return data;
      } catch (error: any) {
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        console.error('API request failed:', error.message);
        throw new Error(`Failed to fetch data: ${error.message}`);
      }
    }
  }

  async getStockPrice(symbol: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'GLOBAL_QUOTE',
      symbol: symbol.toUpperCase(),
    });

    if (data['Global Quote']) {
      const quote = data['Global Quote'];
      return {
        symbol: quote['01. symbol'],
        price: quote['05. price'],
        change: quote['09. change'],
        changePercent: quote['10. change percent'],
        volume: quote['06. volume'],
        latestTradingDay: quote['07. latest trading day'],
      };
    }
    throw new Error('Unable to fetch stock price');
  }

  async getPriceHistory(symbol: string, range: string = 'daily'): Promise<any> {
    let functionName = 'TIME_SERIES_DAILY';
    if (range === 'weekly') functionName = 'TIME_SERIES_WEEKLY';
    if (range === 'monthly') functionName = 'TIME_SERIES_MONTHLY';

    const data = await this.makeRequest({
      function: functionName,
      symbol: symbol.toUpperCase(),
    });

    // Parse the time series data
    const timeSeriesKey = Object.keys(data).find(key => key.includes('Time Series'));
    if (timeSeriesKey) {
      const timeSeries = data[timeSeriesKey];
      const prices = Object.entries(timeSeries).slice(0, 30).map(([date, values]: [string, any]) => ({
        date,
        open: values['1. open'],
        high: values['2. high'],
        low: values['3. low'],
        close: values['4. close'],
        volume: values['5. volume'],
      }));
      return {
        symbol: symbol.toUpperCase(),
        prices,
      };
    }
    throw new Error('Unable to fetch price history');
  }

  async getCompanyOverview(symbol: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'OVERVIEW',
      symbol: symbol.toUpperCase(),
    });

    if (data.Symbol) {
      return {
        symbol: data.Symbol,
        name: data.Name,
        description: data.Description,
        sector: data.Sector,
        industry: data.Industry,
        marketCapitalization: data.MarketCapitalization,
        eps: data.EPS,
        peRatio: data.PERatio,
        forwardPE: data.ForwardPE,
        pegRatio: data.PEGRatio,
        bookValue: data.BookValue,
        dividendPerShare: data.DividendPerShare,
        dividendYield: data.DividendYield,
        revenueTTM: data.RevenueTTM,
        grossProfitTTM: data.GrossProfitTTM,
        '52WeekHigh': data['52WeekHigh'],
        '52WeekLow': data['52WeekLow'],
        '50DayMovingAverage': data['50DayMovingAverage'],
        '200DayMovingAverage': data['200DayMovingAverage'],
        beta: data.Beta,
        profitMargin: data.ProfitMargin,
        operatingMargin: data.OperatingMarginTTM,
        returnOnAssets: data.ReturnOnAssetsTTM,
        returnOnEquity: data.ReturnOnEquityTTM,
        revenuePerShare: data.RevenuePerShareTTM,
        quarterlyEarningsGrowth: data.QuarterlyEarningsGrowthYOY,
        quarterlyRevenueGrowth: data.QuarterlyRevenueGrowthYOY,
        sharesOutstanding: data.SharesOutstanding,
        sharesFloat: data.SharesFloat,
        percentInsiders: data.PercentInsiders,
        percentInstitutions: data.PercentInstitutions,
        shortRatio: data.ShortRatio,
        shortPercentFloat: data.ShortPercentFloat,
        shortPercentOutstanding: data.ShortPercentOutstanding,
        analystTargetPrice: data.AnalystTargetPrice,
        analystRatingStrongBuy: data.AnalystRatingStrongBuy,
        analystRatingBuy: data.AnalystRatingBuy,
        analystRatingHold: data.AnalystRatingHold,
        analystRatingSell: data.AnalystRatingSell,
        analystRatingStrongSell: data.AnalystRatingStrongSell,
        exDividendDate: data.ExDividendDate,
        dividendDate: data.DividendDate,
      };
    }
    throw new Error('Unable to fetch company overview');
  }

  async getInsiderTrading(symbol: string): Promise<any> {
    // Get insider ownership data from company overview (always available)
    const overviewData = await this.makeRequest({
      function: 'OVERVIEW',
      symbol: symbol.toUpperCase(),
    });

    const result: any = {
      symbol: symbol.toUpperCase(),
      insiderOwnership: overviewData.PercentInsiders ? `${overviewData.PercentInsiders}%` : 'N/A',
      institutionalOwnership: overviewData.PercentInstitutions ? `${overviewData.PercentInstitutions}%` : 'N/A',
      sharesOutstanding: overviewData.SharesOutstanding || 'N/A',
      sharesFloat: overviewData.SharesFloat || 'N/A',
      shortRatio: overviewData.ShortRatio || 'N/A',
      shortPercentFloat: overviewData.ShortPercentFloat ? `${overviewData.ShortPercentFloat}%` : 'N/A',
      shortPercentOutstanding: overviewData.ShortPercentOutstanding ? `${overviewData.ShortPercentOutstanding}%` : 'N/A',
    };

    // Also attempt to fetch insider transactions from the premium endpoint
    try {
      const txnData = await this.makeRequest({
        function: 'INSIDER_TRANSACTIONS',
        symbol: symbol.toUpperCase(),
      });
      if (txnData.data && Array.isArray(txnData.data) && txnData.data.length > 0) {
        result.recentTransactions = txnData.data.slice(0, 15).map((t: any) => ({
          transactionDate: t.transaction_date,
          insider: t.executive,
          title: t.executive_title,
          transactionType: t.acquisition_or_disposal === 'A' ? 'Purchase' : 'Sale',
          shares: t.shares,
          sharePrice: t.share_price,
          totalValue: t.shares && t.share_price ? (Number(t.shares) * Number(t.share_price)).toFixed(0) : 'N/A',
        }));
      }
    } catch {
      // Premium endpoint unavailable — ownership data above is still returned
    }

    return result;
  }

  async getAnalystRatings(symbol: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'OVERVIEW',
      symbol: symbol.toUpperCase(),
    });

    return {
      symbol: symbol.toUpperCase(),
      analystTargetPrice: data.AnalystTargetPrice || 'N/A',
      strongBuy: data.AnalystRatingStrongBuy || 'N/A',
      buy: data.AnalystRatingBuy || 'N/A',
      hold: data.AnalystRatingHold || 'N/A',
      sell: data.AnalystRatingSell || 'N/A',
      strongSell: data.AnalystRatingStrongSell || 'N/A',
      movingAverage50Day: data['50DayMovingAverage'] || 'N/A',
      upside: data.AnalystTargetPrice && data['50DayMovingAverage']
        ? `${(((Number(data.AnalystTargetPrice) / Number(data['50DayMovingAverage'])) - 1) * 100).toFixed(1)}% (vs 50-day MA)`
        : 'N/A',
    };
  }

  async searchStock(query: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'SYMBOL_SEARCH',
      keywords: query,
    });

    if (data.bestMatches) {
      const matches = data.bestMatches.slice(0, 5).map((match: any) => ({
        symbol: match['1. symbol'],
        name: match['2. name'],
        type: match['3. type'],
        region: match['4. region'],
        currency: match['8. currency'],
      }));
      return { results: matches };
    }
    throw new Error('Unable to search stocks');
  }

  async getEarningsHistory(symbol: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'EARNINGS',
      symbol: symbol.toUpperCase(),
    });

    if (data.quarterlyEarnings) {
      return {
        symbol: symbol.toUpperCase(),
        annualEarnings: (data.annualEarnings || []).slice(0, 10).map((e: any) => ({
          fiscalYear: e.fiscalDateEnding,
          reportedEPS: e.reportedEPS,
        })),
        quarterlyEarnings: data.quarterlyEarnings.slice(0, 12).map((e: any) => ({
          fiscalQuarter: e.fiscalDateEnding,
          reportedEPS: e.reportedEPS,
          estimatedEPS: e.estimatedEPS,
          surprise: e.surprise,
          surprisePercentage: e.surprisePercentage,
        })),
      };
    }
    throw new Error('Unable to fetch earnings history');
  }

  async getIncomeStatement(symbol: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'INCOME_STATEMENT',
      symbol: symbol.toUpperCase(),
    });

    if (data.quarterlyReports) {
      return {
        symbol: symbol.toUpperCase(),
        annualReports: (data.annualReports || []).slice(0, 5).map((r: any) => ({
          fiscalYear: r.fiscalDateEnding,
          totalRevenue: r.totalRevenue,
          grossProfit: r.grossProfit,
          operatingIncome: r.operatingIncome,
          netIncome: r.netIncome,
          ebitda: r.ebitda,
        })),
        quarterlyReports: data.quarterlyReports.slice(0, 8).map((r: any) => ({
          fiscalQuarter: r.fiscalDateEnding,
          totalRevenue: r.totalRevenue,
          grossProfit: r.grossProfit,
          operatingIncome: r.operatingIncome,
          netIncome: r.netIncome,
          ebitda: r.ebitda,
        })),
      };
    }
    throw new Error('Unable to fetch income statement');
  }

  async getBalanceSheet(symbol: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'BALANCE_SHEET',
      symbol: symbol.toUpperCase(),
    });

    if (data.quarterlyReports) {
      return {
        symbol: symbol.toUpperCase(),
        quarterlyReports: data.quarterlyReports.slice(0, 4).map((r: any) => ({
          fiscalQuarter: r.fiscalDateEnding,
          totalAssets: r.totalAssets,
          totalLiabilities: r.totalLiabilities,
          totalShareholderEquity: r.totalShareholderEquity,
          cashAndEquivalents: r.cashAndCashEquivalentsAtCarryingValue,
          longTermDebt: r.longTermDebt,
        })),
      };
    }
    throw new Error('Unable to fetch balance sheet');
  }

  async getCashFlow(symbol: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'CASH_FLOW',
      symbol: symbol.toUpperCase(),
    });

    if (data.quarterlyReports) {
      return {
        symbol: symbol.toUpperCase(),
        quarterlyReports: data.quarterlyReports.slice(0, 4).map((r: any) => ({
          fiscalQuarter: r.fiscalDateEnding,
          operatingCashflow: r.operatingCashflow,
          capitalExpenditures: r.capitalExpenditures,
          freeCashFlow: r.operatingCashflow && r.capitalExpenditures
            ? (Number(r.operatingCashflow) - Math.abs(Number(r.capitalExpenditures))).toString()
            : 'N/A',
          dividendPayout: r.dividendPayout,
        })),
      };
    }
    throw new Error('Unable to fetch cash flow data');
  }

  async getSectorPerformance(): Promise<any> {
    const data = await this.makeRequest({
      function: 'SECTOR',
    });

    return {
      realTimePerformance: data['Rank A: Real-Time Performance'] || {},
      oneDayPerformance: data['Rank B: 1 Day Performance'] || {},
      fiveDayPerformance: data['Rank C: 5 Day Performance'] || {},
      oneMonthPerformance: data['Rank D: 1 Month Performance'] || {},
      threeMonthPerformance: data['Rank E: 3 Month Performance'] || {},
      yearToDatePerformance: data['Rank F: Year-to-Date (YTD) Performance'] || {},
      oneYearPerformance: data['Rank G: 1 Year Performance'] || {},
    };
  }

  async getStocksBySector(sector: string): Promise<any> {
    return getStocksBySectorData(sector);
  }

  async getTopGainersLosers(): Promise<any> {
    const data = await this.makeRequest({
      function: 'TOP_GAINERS_LOSERS',
    });

    return {
      topGainers: (data.top_gainers || []).slice(0, 10).map((s: any) => ({
        ticker: s.ticker,
        price: s.price,
        changeAmount: s.change_amount,
        changePercentage: s.change_percentage,
        volume: s.volume,
      })),
      topLosers: (data.top_losers || []).slice(0, 10).map((s: any) => ({
        ticker: s.ticker,
        price: s.price,
        changeAmount: s.change_amount,
        changePercentage: s.change_percentage,
        volume: s.volume,
      })),
      mostActive: (data.most_actively_traded || []).slice(0, 10).map((s: any) => ({
        ticker: s.ticker,
        price: s.price,
        changeAmount: s.change_amount,
        changePercentage: s.change_percentage,
        volume: s.volume,
      })),
    };
  }

  async getNewsSentiment(symbol: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'NEWS_SENTIMENT',
      tickers: symbol.toUpperCase(),
      limit: '10',
    });

    if (data.feed) {
      return {
        symbol: symbol.toUpperCase(),
        sentimentScoreDefinition: 'Bearish: x <= -0.35, Somewhat-Bearish: -0.35 < x <= -0.15, Neutral: -0.15 < x < 0.15, Somewhat-Bullish: 0.15 <= x < 0.35, Bullish: x >= 0.35',
        articles: data.feed.slice(0, 10).map((article: any) => {
          const tickerSentiment = (article.ticker_sentiment || []).find(
            (t: any) => t.ticker === symbol.toUpperCase()
          );
          return {
            title: article.title,
            source: article.source,
            publishedAt: article.time_published,
            summary: article.summary,
            overallSentimentScore: article.overall_sentiment_score,
            overallSentimentLabel: article.overall_sentiment_label,
            tickerSentimentScore: tickerSentiment?.ticker_sentiment_score || 'N/A',
            tickerSentimentLabel: tickerSentiment?.ticker_sentiment_label || 'N/A',
            tickerRelevanceScore: tickerSentiment?.relevance_score || 'N/A',
            url: article.url,
          };
        }),
      };
    }
    throw new Error('Unable to fetch news sentiment');
  }
}

/**
 * Curated sector/theme stock lists — 30+ sectors covering the full market
 */
function getStocksBySectorData(sector: string): any {
  const sectorLower = sector.toLowerCase();

  type SectorEntry = { name: string; aliases: string[]; stocks: { symbol: string; name: string; description: string }[] };

  const sectors: SectorEntry[] = [
    {
      name: 'Artificial Intelligence',
      aliases: ['ai', 'artificial intelligence', 'machine learning', 'generative ai', 'llm'],
      stocks: [
        { symbol: 'NVDA', name: 'NVIDIA Corp', description: 'AI GPU leader, dominant in training and inference chips' },
        { symbol: 'MSFT', name: 'Microsoft Corp', description: 'Azure AI, Copilot, OpenAI partnership' },
        { symbol: 'GOOGL', name: 'Alphabet Inc', description: 'Google AI, DeepMind, Gemini, TPU infrastructure' },
        { symbol: 'META', name: 'Meta Platforms', description: 'LLaMA open-source models, AI-powered ad targeting' },
        { symbol: 'AMZN', name: 'Amazon.com', description: 'AWS Bedrock, Trainium/Inferentia chips, Alexa AI' },
        { symbol: 'ORCL', name: 'Oracle Corp', description: 'OCI AI cloud, enterprise AI database' },
        { symbol: 'PLTR', name: 'Palantir Technologies', description: 'AIP (AI Platform) for government and enterprise' },
        { symbol: 'CRM', name: 'Salesforce', description: 'Einstein AI, Agentforce autonomous agents' },
        { symbol: 'NOW', name: 'ServiceNow', description: 'AI-powered IT automation and workflow' },
        { symbol: 'IBM', name: 'IBM Corp', description: 'Watson AI, watsonx foundation models' },
        { symbol: 'SNOW', name: 'Snowflake', description: 'Cortex AI on data cloud' },
        { symbol: 'AI', name: 'C3.ai', description: 'Enterprise AI software suite' },
        { symbol: 'PATH', name: 'UiPath', description: 'AI-powered robotic process automation' },
        { symbol: 'BBAI', name: 'BigBear.ai', description: 'AI analytics for defense and intelligence' },
        { symbol: 'SOUN', name: 'SoundHound AI', description: 'Conversational AI for automotive and enterprise' },
        { symbol: 'AMBA', name: 'Ambarella', description: 'Edge AI chips for computer vision' },
        { symbol: 'SMCI', name: 'Super Micro Computer', description: 'AI server and GPU rack systems' },
        { symbol: 'ANET', name: 'Arista Networks', description: 'AI data center networking infrastructure' },
        { symbol: 'ARM', name: 'Arm Holdings', description: 'CPU/GPU IP licensing powering AI edge devices' },
        { symbol: 'ADBE', name: 'Adobe Inc', description: 'Firefly generative AI, Creative Cloud AI tools' },
      ],
    },
    {
      name: 'AI Data Center Infrastructure',
      aliases: ['ai data center', 'ai infrastructure', 'data center ai', 'ai compute'],
      stocks: [
        { symbol: 'NVDA', name: 'NVIDIA Corp', description: 'Blackwell/Hopper GPU platforms for AI training' },
        { symbol: 'EQIX', name: 'Equinix', description: 'Largest data center REIT, AI-ready colocation' },
        { symbol: 'VRT', name: 'Vertiv Holdings', description: 'Power and liquid cooling for AI data centers' },
        { symbol: 'SMCI', name: 'Super Micro Computer', description: 'Direct liquid-cooled AI server racks' },
        { symbol: 'DELL', name: 'Dell Technologies', description: 'PowerEdge AI servers, NVIDIA partnership' },
        { symbol: 'ANET', name: 'Arista Networks', description: '400G/800G networking for AI clusters' },
        { symbol: 'DLR', name: 'Digital Realty', description: 'Hyperscale data center REIT' },
        { symbol: 'ETN', name: 'Eaton Corp', description: 'UPS and power distribution for data centers' },
        { symbol: 'AMT', name: 'American Tower', description: 'Infrastructure REIT expanding into data centers' },
        { symbol: 'GEV', name: 'GE Vernova', description: 'Power generation for data center buildout' },
        { symbol: 'PWR', name: 'Quanta Services', description: 'Data center construction and power delivery' },
        { symbol: 'IRM', name: 'Iron Mountain', description: 'Data center REIT with AI-focused expansion' },
        { symbol: 'AVGO', name: 'Broadcom Inc', description: 'Custom AI ASICs (XPU) and data center networking' },
        { symbol: 'MRVL', name: 'Marvell Technology', description: 'PAM4 optical and custom AI silicon' },
        { symbol: 'TSM', name: 'Taiwan Semiconductor', description: 'Foundry for all major AI chips (N3/N2)' },
        { symbol: 'MSFT', name: 'Microsoft (Azure)', description: 'Azure AI cloud, $80B data center capex 2025' },
        { symbol: 'AMZN', name: 'Amazon (AWS)', description: 'AWS largest AI cloud infrastructure' },
        { symbol: 'GOOGL', name: 'Alphabet (GCP)', description: 'TPU pods, Google data center AI' },
        { symbol: 'HPE', name: 'Hewlett Packard Enterprise', description: 'AI supercomputers, Cray HPC systems' },
        { symbol: 'CDNS', name: 'Cadence Design Systems', description: 'EDA software for AI chip design' },
      ],
    },
    {
      name: 'Semiconductors',
      aliases: ['semiconductor', 'semiconductors', 'chips', 'chip', 'chipmakers'],
      stocks: [
        { symbol: 'NVDA', name: 'NVIDIA Corp', description: 'GPU leader for AI, gaming, data centers' },
        { symbol: 'AMD', name: 'Advanced Micro Devices', description: 'CPUs and GPUs competing with Intel and NVIDIA' },
        { symbol: 'INTC', name: 'Intel Corp', description: 'CPU manufacturer, foundry transformation' },
        { symbol: 'TSM', name: 'Taiwan Semiconductor', description: 'World\'s largest chip foundry (N3, N2 nodes)' },
        { symbol: 'AVGO', name: 'Broadcom Inc', description: 'Networking ASICs, custom AI chips, RF semiconductors' },
        { symbol: 'QCOM', name: 'Qualcomm', description: 'Mobile SoCs, 5G modems, automotive chips' },
        { symbol: 'TXN', name: 'Texas Instruments', description: 'Analog and embedded semiconductors' },
        { symbol: 'MU', name: 'Micron Technology', description: 'HBM3, DRAM, NAND memory for AI' },
        { symbol: 'MRVL', name: 'Marvell Technology', description: 'Data center and 5G semiconductor solutions' },
        { symbol: 'ASML', name: 'ASML Holding', description: 'EUV lithography monopoly, critical for sub-7nm' },
        { symbol: 'LRCX', name: 'Lam Research', description: 'Etch and deposition equipment' },
        { symbol: 'AMAT', name: 'Applied Materials', description: 'Materials engineering for semiconductor manufacturing' },
        { symbol: 'KLAC', name: 'KLA Corp', description: 'Semiconductor process control and inspection' },
        { symbol: 'ARM', name: 'Arm Holdings', description: 'CPU/GPU architecture IP licensing' },
        { symbol: 'ON', name: 'ON Semiconductor', description: 'Power semiconductors for EVs and industrial' },
        { symbol: 'WOLF', name: 'Wolfspeed', description: 'Silicon carbide (SiC) power devices' },
        { symbol: 'MPWR', name: 'Monolithic Power Systems', description: 'Power management ICs' },
        { symbol: 'ENTG', name: 'Entegris', description: 'Semiconductor process materials' },
        { symbol: 'SWKS', name: 'Skyworks Solutions', description: 'RF semiconductors for mobile' },
        { symbol: 'NXPI', name: 'NXP Semiconductors', description: 'Automotive and IoT semiconductors' },
      ],
    },
    {
      name: 'Data Centers & Cloud Infrastructure',
      aliases: ['data center', 'data centers', 'colocation', 'colo'],
      stocks: [
        { symbol: 'EQIX', name: 'Equinix', description: 'Largest data center REIT, 250+ locations globally' },
        { symbol: 'DLR', name: 'Digital Realty', description: 'Hyperscale and enterprise data center REIT' },
        { symbol: 'IRM', name: 'Iron Mountain', description: 'Data center REIT, 100+ facilities' },
        { symbol: 'AMT', name: 'American Tower', description: 'Infrastructure REIT expanding to edge data centers' },
        { symbol: 'VRT', name: 'Vertiv Holdings', description: 'Critical digital infrastructure: power, cooling' },
        { symbol: 'NVDA', name: 'NVIDIA Corp', description: 'GPU compute backbone of all major data centers' },
        { symbol: 'AMZN', name: 'Amazon (AWS)', description: 'Largest public cloud operator' },
        { symbol: 'MSFT', name: 'Microsoft (Azure)', description: 'Second-largest cloud with AI integration' },
        { symbol: 'GOOGL', name: 'Alphabet (GCP)', description: 'Third-largest cloud, custom TPU infrastructure' },
        { symbol: 'SMCI', name: 'Super Micro Computer', description: 'GPU servers and direct liquid cooling racks' },
        { symbol: 'DELL', name: 'Dell Technologies', description: 'Enterprise servers, storage, networking' },
        { symbol: 'HPE', name: 'Hewlett Packard Enterprise', description: 'GreenLake cloud services, HPC systems' },
        { symbol: 'ANET', name: 'Arista Networks', description: 'Cloud networking switches and routers' },
        { symbol: 'ETN', name: 'Eaton Corp', description: 'Power management systems for data centers' },
        { symbol: 'GEV', name: 'GE Vernova', description: 'Gas turbines for data center power needs' },
      ],
    },
    {
      name: 'Cloud Computing & SaaS',
      aliases: ['cloud', 'saas', 'cloud computing', 'software as a service', 'cloud software'],
      stocks: [
        { symbol: 'MSFT', name: 'Microsoft (Azure)', description: 'Azure cloud, Microsoft 365, Dynamics 365' },
        { symbol: 'AMZN', name: 'Amazon (AWS)', description: 'AWS: largest public cloud with 200+ services' },
        { symbol: 'GOOGL', name: 'Alphabet (GCP)', description: 'Google Cloud Platform, BigQuery, Workspace' },
        { symbol: 'CRM', name: 'Salesforce', description: 'Cloud CRM leader, Einstein AI, Agentforce' },
        { symbol: 'NOW', name: 'ServiceNow', description: 'Enterprise workflow automation cloud' },
        { symbol: 'SNOW', name: 'Snowflake', description: 'Cloud data warehousing and AI' },
        { symbol: 'WDAY', name: 'Workday', description: 'Cloud HCM and financial management' },
        { symbol: 'DDOG', name: 'Datadog', description: 'Cloud observability and security platform' },
        { symbol: 'MDB', name: 'MongoDB', description: 'Cloud-native NoSQL database' },
        { symbol: 'NET', name: 'Cloudflare', description: 'Zero trust networking, edge cloud' },
        { symbol: 'HUBS', name: 'HubSpot', description: 'Marketing, sales, and CRM cloud platform' },
        { symbol: 'ZM', name: 'Zoom Video', description: 'Video communications and collaboration cloud' },
        { symbol: 'VEEV', name: 'Veeva Systems', description: 'Cloud software for life sciences' },
        { symbol: 'BILL', name: 'Bill Holdings', description: 'Financial operations cloud for SMBs' },
        { symbol: 'DOCN', name: 'DigitalOcean', description: 'Cloud infrastructure for developers' },
        { symbol: 'TWLO', name: 'Twilio', description: 'Cloud communications platform (CPaaS)' },
        { symbol: 'ZI', name: 'ZoomInfo Technologies', description: 'B2B data and intelligence cloud' },
        { symbol: 'GTLB', name: 'GitLab', description: 'DevSecOps platform' },
        { symbol: 'ESTC', name: 'Elastic NV', description: 'Search and observability cloud' },
        { symbol: 'CFLT', name: 'Confluent', description: 'Data streaming cloud platform' },
      ],
    },
    {
      name: 'Cybersecurity',
      aliases: ['cybersecurity', 'cyber security', 'information security', 'infosec', 'security'],
      stocks: [
        { symbol: 'CRWD', name: 'CrowdStrike', description: 'AI-native endpoint and cloud security platform' },
        { symbol: 'PANW', name: 'Palo Alto Networks', description: 'Network security, SASE, cloud security' },
        { symbol: 'FTNT', name: 'Fortinet', description: 'Network security appliances and FortiOS' },
        { symbol: 'ZS', name: 'Zscaler', description: 'Zero trust cloud security (ZIA, ZPA)' },
        { symbol: 'S', name: 'SentinelOne', description: 'AI-powered autonomous threat detection' },
        { symbol: 'OKTA', name: 'Okta', description: 'Identity and access management (IAM)' },
        { symbol: 'NET', name: 'Cloudflare', description: 'Zero trust, DDoS protection, SASE' },
        { symbol: 'CYBR', name: 'CyberArk Software', description: 'Privileged access management (PAM)' },
        { symbol: 'TMUS', name: 'T-Mobile (IoT Security)', description: 'Telecom + IoT security convergence' },
        { symbol: 'QLYS', name: 'Qualys', description: 'Cloud-based vulnerability management' },
        { symbol: 'TENB', name: 'Tenable Holdings', description: 'Exposure management and vulnerability scanning' },
        { symbol: 'RPD', name: 'Rapid7', description: 'Vulnerability and threat detection platform' },
        { symbol: 'VRNS', name: 'Varonis Systems', description: 'Data security and insider threat detection' },
        { symbol: 'SAIL', name: 'SailPoint Technologies', description: 'Identity governance and administration' },
        { symbol: 'EXFY', name: 'Expensify', description: 'Expense management security' },
        { symbol: 'AXON', name: 'Axon Enterprise', description: 'Public safety technology and digital evidence' },
      ],
    },
    {
      name: 'Banking & Financial Services',
      aliases: ['banking', 'banks', 'financial services', 'finance', 'bank'],
      stocks: [
        { symbol: 'JPM', name: 'JPMorgan Chase', description: 'Largest US bank by assets, investment banking leader' },
        { symbol: 'BAC', name: 'Bank of America', description: 'Retail, commercial, and investment banking' },
        { symbol: 'WFC', name: 'Wells Fargo', description: 'Consumer and commercial banking, mortgage' },
        { symbol: 'GS', name: 'Goldman Sachs', description: 'Global investment banking and asset management' },
        { symbol: 'MS', name: 'Morgan Stanley', description: 'Wealth management and investment banking' },
        { symbol: 'C', name: 'Citigroup', description: 'Global banking and financial services' },
        { symbol: 'USB', name: 'U.S. Bancorp', description: 'Regional banking, payments, wealth management' },
        { symbol: 'PNC', name: 'PNC Financial', description: 'Regional bank with treasury management' },
        { symbol: 'TFC', name: 'Truist Financial', description: 'Regional banking (BB&T and SunTrust merger)' },
        { symbol: 'COF', name: 'Capital One Financial', description: 'Credit cards, auto loans, online banking' },
        { symbol: 'AXP', name: 'American Express', description: 'Premium charge cards, travel rewards' },
        { symbol: 'BLK', name: 'BlackRock', description: 'World\'s largest asset manager ($10T+ AUM)' },
        { symbol: 'SCHW', name: 'Charles Schwab', description: 'Retail brokerage and banking' },
        { symbol: 'BK', name: 'Bank of New York Mellon', description: 'Custody banking and asset servicing' },
        { symbol: 'STT', name: 'State Street Corp', description: 'Institutional asset management and custody' },
        { symbol: 'RF', name: 'Regions Financial', description: 'Southeast US regional banking' },
        { symbol: 'KEY', name: 'KeyCorp', description: 'Midwest US regional banking' },
        { symbol: 'FITB', name: 'Fifth Third Bancorp', description: 'Midwest and Southeast banking' },
        { symbol: 'CFG', name: 'Citizens Financial', description: 'Northeast US regional banking' },
        { symbol: 'MTB', name: 'M&T Bank', description: 'Mid-Atlantic regional banking' },
      ],
    },
    {
      name: 'Healthcare & Medical',
      aliases: ['healthcare', 'health care', 'medical', 'hospital', 'health'],
      stocks: [
        { symbol: 'UNH', name: 'UnitedHealth Group', description: 'Largest US health insurer, Optum services' },
        { symbol: 'CVS', name: 'CVS Health', description: 'Pharmacy, health insurance, MinuteClinic' },
        { symbol: 'CI', name: 'Cigna Group', description: 'Global health insurance and Evernorth services' },
        { symbol: 'HCA', name: 'HCA Healthcare', description: 'Largest US for-profit hospital operator' },
        { symbol: 'HUM', name: 'Humana', description: 'Medicare Advantage, Medicaid health insurance' },
        { symbol: 'MCK', name: 'McKesson Corp', description: 'Drug distribution and healthcare IT' },
        { symbol: 'ABC', name: 'AmerisourceBergen', description: 'Pharmaceutical distribution' },
        { symbol: 'THC', name: 'Tenet Healthcare', description: 'US hospital and outpatient surgery centers' },
        { symbol: 'MOH', name: 'Molina Healthcare', description: 'Medicaid and Medicare managed care' },
        { symbol: 'DVA', name: 'DaVita Inc', description: 'Kidney dialysis centers nationwide' },
        { symbol: 'ISRG', name: 'Intuitive Surgical', description: 'da Vinci robotic surgery systems' },
        { symbol: 'MDT', name: 'Medtronic', description: 'Medical devices: pacemakers, insulin pumps' },
        { symbol: 'ABT', name: 'Abbott Laboratories', description: 'Diagnostics, medical devices, nutrition' },
        { symbol: 'SYK', name: 'Stryker Corp', description: 'Orthopedic implants and surgical equipment' },
        { symbol: 'BSX', name: 'Boston Scientific', description: 'Interventional medical devices' },
        { symbol: 'ELV', name: 'Elevance Health', description: 'Anthem Blue Cross, managed care' },
        { symbol: 'CNC', name: 'Centene Corp', description: 'Medicaid managed care, government programs' },
        { symbol: 'TMO', name: 'Thermo Fisher Scientific', description: 'Life sciences tools and CRO services' },
        { symbol: 'DHR', name: 'Danaher Corp', description: 'Life sciences and diagnostics instruments' },
        { symbol: 'ZBH', name: 'Zimmer Biomet', description: 'Orthopedic implants and joint reconstruction' },
      ],
    },
    {
      name: 'Pharmaceuticals & Biotech',
      aliases: ['pharma', 'pharmaceutical', 'pharmaceuticals', 'biotech', 'biotechnology', 'drug', 'biopharma'],
      stocks: [
        { symbol: 'LLY', name: 'Eli Lilly', description: 'Tirzepatide (Mounjaro/Zepbound), Alzheimer\'s (Kisunla)' },
        { symbol: 'NVO', name: 'Novo Nordisk', description: 'Ozempic/Wegovy GLP-1 leader, insulin' },
        { symbol: 'ABBV', name: 'AbbVie', description: 'Skyrizi, Rinvoq immunology; oncology pipeline' },
        { symbol: 'MRK', name: 'Merck & Co', description: 'Keytruda PD-1 leader, vaccines, Winrevair' },
        { symbol: 'JNJ', name: 'Johnson & Johnson', description: 'Innovative medicine, MedTech spinoff' },
        { symbol: 'PFE', name: 'Pfizer', description: 'Oncology, vaccines, rare disease post-COVID pivot' },
        { symbol: 'AMGN', name: 'Amgen', description: 'Repatha, Evenity, MariTide obesity pipeline' },
        { symbol: 'GILD', name: 'Gilead Sciences', description: 'HIV (Biktarvy), oncology (Trodelvy)' },
        { symbol: 'BMY', name: 'Bristol-Myers Squibb', description: 'Opdivo, Revlimid, Eliquis' },
        { symbol: 'REGN', name: 'Regeneron Pharma', description: 'Dupixent, Eylea, Libtayo' },
        { symbol: 'VRTX', name: 'Vertex Pharmaceuticals', description: 'Cystic fibrosis monopoly (Trikafta)' },
        { symbol: 'MRNA', name: 'Moderna', description: 'mRNA vaccines, cancer vaccine pipeline' },
        { symbol: 'BIIB', name: 'Biogen', description: 'Leqembi for Alzheimer\'s, MS treatments' },
        { symbol: 'ALNY', name: 'Alnylam Pharma', description: 'RNAi therapeutics platform' },
        { symbol: 'ROIVANT', name: 'Roivant Sciences', description: 'Decentralized biotech model' },
        { symbol: 'SGEN', name: 'Seagen', description: 'Antibody-drug conjugates for oncology' },
        { symbol: 'INCY', name: 'Incyte Corp', description: 'JAK inhibitors, oncology' },
        { symbol: 'EXAS', name: 'Exact Sciences', description: 'Cologuard colorectal cancer screening' },
        { symbol: 'RARE', name: 'Ultragenyx Pharma', description: 'Rare disease gene therapies' },
        { symbol: 'IONS', name: 'Ionis Pharma', description: 'Antisense oligonucleotide drug platform' },
      ],
    },
    {
      name: 'Defense & Aerospace',
      aliases: ['defense', 'aerospace', 'defence', 'military', 'defense contractor', 'weapons'],
      stocks: [
        { symbol: 'LMT', name: 'Lockheed Martin', description: 'F-35, missiles, space systems, cyber' },
        { symbol: 'RTX', name: 'RTX Corp (Raytheon)', description: 'Pratt & Whitney engines, Raytheon missiles' },
        { symbol: 'NOC', name: 'Northrop Grumman', description: 'B-21 stealth bomber, space, cyber systems' },
        { symbol: 'GD', name: 'General Dynamics', description: 'Gulfstream jets, submarines, armored vehicles' },
        { symbol: 'BA', name: 'Boeing', description: 'Defense aircraft, space, commercial jets' },
        { symbol: 'HII', name: 'Huntington Ingalls', description: 'US Navy shipbuilding monopoly' },
        { symbol: 'TDG', name: 'TransDigm Group', description: 'Aerospace components, strong pricing power' },
        { symbol: 'LDOS', name: 'Leidos Holdings', description: 'Defense IT, intelligence, health IT' },
        { symbol: 'SAIC', name: 'Science Applications International', description: 'Defense IT and government services' },
        { symbol: 'L3H', name: 'L3Harris Technologies', description: 'Communications, ISR, space systems' },
        { symbol: 'BAH', name: 'Booz Allen Hamilton', description: 'Defense consulting, AI for government' },
        { symbol: 'CACI', name: 'CACI International', description: 'Defense technology and intelligence' },
        { symbol: 'AXON', name: 'Axon Enterprise', description: 'Police technology, Taser, AI evidence platform' },
        { symbol: 'KTOS', name: 'Kratos Defense', description: 'Drones, missile systems, satellites' },
        { symbol: 'AVAV', name: 'AeroVironment', description: 'Tactical unmanned aircraft (Switchblade)' },
        { symbol: 'RKLB', name: 'Rocket Lab USA', description: 'Small launch vehicles and space systems' },
        { symbol: 'SPCE', name: 'Virgin Galactic', description: 'Suborbital spaceflight' },
        { symbol: 'ASTS', name: 'AST SpaceMobile', description: 'Space-based broadband network' },
        { symbol: 'PL', name: 'Planet Labs', description: 'Earth observation satellites' },
        { symbol: 'BWXT', name: 'BWX Technologies', description: 'Nuclear components for navy ships and reactors' },
      ],
    },
    {
      name: 'Energy — Oil & Gas',
      aliases: ['energy', 'oil', 'gas', 'oil and gas', 'oil & gas', 'fossil fuel', 'petroleum'],
      stocks: [
        { symbol: 'XOM', name: 'ExxonMobil', description: 'Largest US oil major, Permian and Guyana upstream' },
        { symbol: 'CVX', name: 'Chevron Corp', description: 'Integrated oil major, strong FCF generation' },
        { symbol: 'COP', name: 'ConocoPhillips', description: 'Pure-play E&P with low-cost portfolio' },
        { symbol: 'EOG', name: 'EOG Resources', description: 'Premium Permian and Eagle Ford producer' },
        { symbol: 'PXD', name: 'Pioneer Natural Resources', description: 'Permian Basin pure-play (acquired by XOM)' },
        { symbol: 'OXY', name: 'Occidental Petroleum', description: 'Permian E&P, carbon capture (Berkshire stake)' },
        { symbol: 'SLB', name: 'SLB (Schlumberger)', description: 'Largest oil services company globally' },
        { symbol: 'HAL', name: 'Halliburton', description: 'Oilfield services and completion tools' },
        { symbol: 'BKR', name: 'Baker Hughes', description: 'Oilfield services and industrial tech' },
        { symbol: 'MPC', name: 'Marathon Petroleum', description: 'Largest US oil refiner' },
        { symbol: 'VLO', name: 'Valero Energy', description: 'US refining and renewable diesel' },
        { symbol: 'PSX', name: 'Phillips 66', description: 'Refining, midstream, chemicals' },
        { symbol: 'KMI', name: 'Kinder Morgan', description: 'Natural gas pipeline infrastructure' },
        { symbol: 'WMB', name: 'Williams Companies', description: 'Natural gas gathering and processing' },
        { symbol: 'ET', name: 'Energy Transfer', description: 'Midstream pipelines, MLP structure' },
        { symbol: 'DVN', name: 'Devon Energy', description: 'Permian and Powder River Basin E&P' },
        { symbol: 'FANG', name: 'Diamondback Energy', description: 'Permian Basin pure-play E&P' },
        { symbol: 'MRO', name: 'Marathon Oil', description: 'US shale and international E&P' },
        { symbol: 'APA', name: 'APA Corp', description: 'US and international oil and gas E&P' },
        { symbol: 'NOV', name: 'NOV Inc', description: 'Drilling equipment manufacturer' },
      ],
    },
    {
      name: 'Renewable Energy & Clean Tech',
      aliases: ['renewable', 'renewable energy', 'clean energy', 'green energy', 'solar', 'wind', 'cleantech'],
      stocks: [
        { symbol: 'NEE', name: 'NextEra Energy', description: 'Largest US renewable energy generator (wind + solar)' },
        { symbol: 'ENPH', name: 'Enphase Energy', description: 'Solar microinverters and home energy systems' },
        { symbol: 'FSLR', name: 'First Solar', description: 'Thin-film CdTe solar modules, US manufacturer' },
        { symbol: 'SEDG', name: 'SolarEdge Technologies', description: 'String inverters and energy optimization' },
        { symbol: 'RUN', name: 'Sunrun', description: 'Residential solar installation and financing' },
        { symbol: 'ARRY', name: 'Array Technologies', description: 'Solar tracking systems' },
        { symbol: 'PLUG', name: 'Plug Power', description: 'Green hydrogen fuel cells and electrolyzers' },
        { symbol: 'BE', name: 'Bloom Energy', description: 'Solid-oxide fuel cells for clean power' },
        { symbol: 'GEV', name: 'GE Vernova', description: 'Wind turbines, grid solutions, gas power' },
        { symbol: 'CWEN', name: 'Clearway Energy', description: 'Renewable energy infrastructure REIT' },
        { symbol: 'AES', name: 'AES Corp', description: 'Global renewable energy developer' },
        { symbol: 'BEP', name: 'Brookfield Renewable', description: 'Global renewable power (hydro, wind, solar)' },
        { symbol: 'SPWR', name: 'SunPower Corp', description: 'Premium residential and commercial solar' },
        { symbol: 'NOVA', name: 'Sunnova Energy', description: 'Solar-as-a-service for homeowners' },
        { symbol: 'STEM', name: 'Stem Inc', description: 'AI-driven energy storage optimization' },
        { symbol: 'HASI', name: 'Hannon Armstrong', description: 'Climate solutions infrastructure investments' },
        { symbol: 'ORA', name: 'Ormat Technologies', description: 'Geothermal energy plants' },
        { symbol: 'AMRC', name: 'Ameresco Inc', description: 'Energy efficiency projects and renewable energy' },
      ],
    },
    {
      name: 'Electric Vehicles & Automotive',
      aliases: ['ev', 'electric vehicle', 'electric vehicles', 'automotive', 'auto', 'cars', 'automobile'],
      stocks: [
        { symbol: 'TSLA', name: 'Tesla', description: 'EV leader, FSD autonomous driving, energy storage' },
        { symbol: 'F', name: 'Ford Motor', description: 'F-150 Lightning, Mustang Mach-E, Pro vehicles' },
        { symbol: 'GM', name: 'General Motors', description: 'Ultium EV platform, GMC Hummer, Cadillac Lyriq' },
        { symbol: 'RIVN', name: 'Rivian Automotive', description: 'R1T/R1S trucks and Amazon delivery vans' },
        { symbol: 'LCID', name: 'Lucid Group', description: 'Ultra-luxury EVs, Saudi Aramco-backed' },
        { symbol: 'NIO', name: 'NIO Inc', description: 'Premium Chinese EVs with battery swap network' },
        { symbol: 'LI', name: 'Li Auto', description: 'Chinese EREV (extended range) SUVs' },
        { symbol: 'XPEV', name: 'XPeng Inc', description: 'Chinese smart EVs with ADAS/autonomous' },
        { symbol: 'TM', name: 'Toyota Motor', description: 'Hybrid leader (Prius), EV and hydrogen strategy' },
        { symbol: 'STLA', name: 'Stellantis', description: 'Jeep, Ram, Dodge, Fiat, Peugeot conglomerate' },
        { symbol: 'HMC', name: 'Honda Motor', description: 'Accord Hybrid, Prologue EV, hydrogen fuel cells' },
        { symbol: 'APTV', name: 'Aptiv', description: 'EV-focused automotive electrical systems' },
        { symbol: 'BWA', name: 'BorgWarner', description: 'EV drivetrain components and thermal systems' },
        { symbol: 'LEA', name: 'Lear Corp', description: 'Seating and electrical systems for EVs' },
        { symbol: 'ALV', name: 'Autoliv', description: 'Airbags and seatbelts, ADAS safety components' },
        { symbol: 'MGA', name: 'Magna International', description: 'Contract manufacturing, EV components' },
        { symbol: 'WOLF', name: 'Wolfspeed', description: 'Silicon carbide power devices for EVs' },
        { symbol: 'ON', name: 'ON Semiconductor', description: 'Power semiconductors for EV traction inverters' },
      ],
    },
    {
      name: 'Consumer Discretionary & Retail',
      aliases: ['retail', 'consumer discretionary', 'consumer', 'shopping', 'e-commerce', 'ecommerce'],
      stocks: [
        { symbol: 'AMZN', name: 'Amazon', description: 'Global e-commerce and AWS cloud leader' },
        { symbol: 'HD', name: 'Home Depot', description: 'Largest home improvement retailer' },
        { symbol: 'LOW', name: 'Lowe\'s Companies', description: 'Second-largest home improvement retailer' },
        { symbol: 'NKE', name: 'Nike', description: 'Global athletic footwear and apparel' },
        { symbol: 'MCD', name: 'McDonald\'s Corp', description: 'Largest fast food chain, franchise model' },
        { symbol: 'SBUX', name: 'Starbucks', description: 'Global coffeehouse chain and loyalty program' },
        { symbol: 'TJX', name: 'TJX Companies', description: 'Off-price retail (T.J.Maxx, Marshalls, HomeGoods)' },
        { symbol: 'TGT', name: 'Target Corp', description: 'Discount retailer with grocery and apparel' },
        { symbol: 'BKNG', name: 'Booking Holdings', description: 'Online travel (Booking.com, Priceline, Kayak)' },
        { symbol: 'ABNB', name: 'Airbnb', description: 'Short-term home rental marketplace' },
        { symbol: 'UBER', name: 'Uber Technologies', description: 'Ride-hailing and food delivery (Uber Eats)' },
        { symbol: 'LYFT', name: 'Lyft Inc', description: 'US ride-sharing platform' },
        { symbol: 'ROST', name: 'Ross Stores', description: 'Off-price fashion and home decor' },
        { symbol: 'LULU', name: 'Lululemon Athletica', description: 'Premium athletic apparel' },
        { symbol: 'RCL', name: 'Royal Caribbean', description: 'Cruise line operator' },
        { symbol: 'CCL', name: 'Carnival Corp', description: 'Largest cruise operator globally' },
        { symbol: 'NCLH', name: 'Norwegian Cruise Line', description: 'Luxury and premium cruise line' },
        { symbol: 'EXPE', name: 'Expedia Group', description: 'Online travel agency' },
        { symbol: 'DPZ', name: 'Domino\'s Pizza', description: 'Pizza delivery franchise model' },
        { symbol: 'YUM', name: 'Yum! Brands', description: 'KFC, Taco Bell, Pizza Hut global franchise' },
      ],
    },
    {
      name: 'Consumer Staples',
      aliases: ['consumer staples', 'staples', 'food', 'beverages', 'household', 'fmcg', 'cpg'],
      stocks: [
        { symbol: 'WMT', name: 'Walmart', description: 'Largest retailer, grocery dominant, Walmart+ membership' },
        { symbol: 'COST', name: 'Costco Wholesale', description: 'Membership warehouse model, high customer loyalty' },
        { symbol: 'PG', name: 'Procter & Gamble', description: 'Tide, Pampers, Gillette — global consumer brands' },
        { symbol: 'KO', name: 'Coca-Cola', description: 'Global beverage portfolio, distribution moat' },
        { symbol: 'PEP', name: 'PepsiCo', description: 'Beverages and Frito-Lay snacks conglomerate' },
        { symbol: 'MDLZ', name: 'Mondelez International', description: 'Oreo, Cadbury, Toblerone global snacks' },
        { symbol: 'GIS', name: 'General Mills', description: 'Cheerios, Betty Crocker, Häagen-Dazs' },
        { symbol: 'KHC', name: 'Kraft Heinz', description: 'Oscar Mayer, Heinz Ketchup, Velveeta' },
        { symbol: 'CPB', name: 'Campbell Soup', description: 'Soup, snacks, Goldfish crackers' },
        { symbol: 'SJM', name: 'J.M. Smucker', description: 'Jif peanut butter, Folgers coffee, pet food' },
        { symbol: 'MO', name: 'Altria Group', description: 'Marlboro cigarettes, high dividend yield' },
        { symbol: 'PM', name: 'Philip Morris', description: 'IQOS heated tobacco, international cigarettes' },
        { symbol: 'BTI', name: 'British American Tobacco', description: 'Vuse, Lucky Strike, international tobacco' },
        { symbol: 'CLX', name: 'Clorox Company', description: 'Clorox bleach, Burt\'s Bees, Hidden Valley' },
        { symbol: 'CHD', name: 'Church & Dwight', description: 'Arm & Hammer, OxiClean, Trojan' },
        { symbol: 'KR', name: 'Kroger Co', description: 'Largest US supermarket chain' },
        { symbol: 'SFM', name: 'Sprouts Farmers Market', description: 'Natural and organic grocery' },
        { symbol: 'EL', name: 'Estee Lauder', description: 'Premium beauty brands, MAC, Clinique' },
        { symbol: 'COTY', name: 'Coty Inc', description: 'CoverGirl, Rimmel, prestige fragrances' },
        { symbol: 'HSY', name: 'Hershey Company', description: 'Chocolate and snacks, pricing power' },
      ],
    },
    {
      name: 'Financials — Insurance',
      aliases: ['insurance', 'insurer', 'reinsurance', 'p&c insurance', 'life insurance'],
      stocks: [
        { symbol: 'BRK-B', name: 'Berkshire Hathaway', description: 'GEICO insurance, diversified conglomerate' },
        { symbol: 'PRU', name: 'Prudential Financial', description: 'Life insurance and asset management' },
        { symbol: 'MET', name: 'MetLife', description: 'Global life and annuity insurance' },
        { symbol: 'AFL', name: 'Aflac', description: 'Supplemental health insurance, Japan + US' },
        { symbol: 'ALL', name: 'Allstate Corp', description: 'Auto and home insurance' },
        { symbol: 'TRV', name: 'Travelers Companies', description: 'Commercial and personal insurance' },
        { symbol: 'PGR', name: 'Progressive Corp', description: 'Auto insurance leader, digital model' },
        { symbol: 'CB', name: 'Chubb Limited', description: 'Global P&C insurance, high-net-worth focus' },
        { symbol: 'AIG', name: 'American International Group', description: 'Global P&C and life insurance' },
        { symbol: 'HIG', name: 'Hartford Financial', description: 'Commercial insurance and group benefits' },
        { symbol: 'GL', name: 'Globe Life Inc', description: 'Life and health insurance direct-to-consumer' },
        { symbol: 'UNM', name: 'Unum Group', description: 'Employee benefits and disability insurance' },
        { symbol: 'RNR', name: 'RenaissanceRe', description: 'Reinsurance for catastrophe risk' },
        { symbol: 'EG', name: 'Everest Group', description: 'Reinsurance and specialty insurance' },
        { symbol: 'KNSL', name: 'Kinsale Capital', description: 'E&S specialty insurance, high-growth' },
      ],
    },
    {
      name: 'FinTech & Payments',
      aliases: ['fintech', 'payments', 'payment', 'digital payments', 'neobank', 'cryptocurrency', 'crypto', 'blockchain'],
      stocks: [
        { symbol: 'V', name: 'Visa', description: 'Global payments network, 4B+ cards' },
        { symbol: 'MA', name: 'Mastercard', description: 'Global payments technology, high-margin network' },
        { symbol: 'PYPL', name: 'PayPal', description: 'Digital wallets: PayPal, Venmo, Braintree' },
        { symbol: 'SQ', name: 'Block (Square)', description: 'Square POS, Cash App, Bitcoin' },
        { symbol: 'AFRM', name: 'Affirm Holdings', description: 'Buy-now-pay-later, Amazon/Shopify partner' },
        { symbol: 'SOFI', name: 'SoFi Technologies', description: 'Neobank with student loans, mortgages, investing' },
        { symbol: 'COIN', name: 'Coinbase Global', description: 'Largest US crypto exchange' },
        { symbol: 'MSTR', name: 'MicroStrategy', description: 'Bitcoin treasury company' },
        { symbol: 'HOOD', name: 'Robinhood Markets', description: 'Commission-free trading, crypto, Gold' },
        { symbol: 'NU', name: 'Nu Holdings (Nubank)', description: 'Latin American neobank leader' },
        { symbol: 'ACIW', name: 'ACI Worldwide', description: 'Real-time payment processing software' },
        { symbol: 'GPN', name: 'Global Payments', description: 'Payment technology and merchant services' },
        { symbol: 'FIS', name: 'Fidelity National Info', description: 'Banking and payment technology solutions' },
        { symbol: 'FISV', name: 'Fiserv', description: 'Point of sale and financial technology' },
        { symbol: 'WEX', name: 'WEX Inc', description: 'Fleet payments and healthcare benefits' },
        { symbol: 'NDAQ', name: 'Nasdaq Inc', description: 'Exchange operator, financial technology' },
        { symbol: 'ICE', name: 'Intercontinental Exchange', description: 'NYSE operator, mortgage technology' },
        { symbol: 'CME', name: 'CME Group', description: 'Derivatives exchange, interest rate futures' },
        { symbol: 'MARA', name: 'Marathon Digital', description: 'Bitcoin mining company' },
        { symbol: 'RIOT', name: 'Riot Platforms', description: 'Bitcoin mining and blockchain infrastructure' },
      ],
    },
    {
      name: 'Industrials & Manufacturing',
      aliases: ['industrial', 'industrials', 'manufacturing', 'machinery', 'equipment'],
      stocks: [
        { symbol: 'CAT', name: 'Caterpillar', description: 'Mining, construction, and energy equipment' },
        { symbol: 'DE', name: 'Deere & Company', description: 'Agricultural equipment, precision agriculture' },
        { symbol: 'HON', name: 'Honeywell International', description: 'Industrial automation, aerospace, buildings' },
        { symbol: 'GE', name: 'GE Aerospace', description: 'Commercial and military jet engines' },
        { symbol: 'ETN', name: 'Eaton Corp', description: 'Power management for electrical and industrial' },
        { symbol: 'EMR', name: 'Emerson Electric', description: 'Automation solutions and software' },
        { symbol: 'ITW', name: 'Illinois Tool Works', description: 'Diversified industrial manufacturing' },
        { symbol: 'PH', name: 'Parker Hannifin', description: 'Motion and control technologies' },
        { symbol: 'ROK', name: 'Rockwell Automation', description: 'Industrial automation and digital transformation' },
        { symbol: 'IR', name: 'Ingersoll Rand', description: 'Industrial machinery, compressors, HVAC' },
        { symbol: 'AME', name: 'AMETEK Inc', description: 'Electronic instruments and electromechanical devices' },
        { symbol: 'FTV', name: 'Fortive Corp', description: 'Intelligent operating, precision technology' },
        { symbol: 'XYL', name: 'Xylem Inc', description: 'Water technology and solutions' },
        { symbol: 'ROP', name: 'Roper Technologies', description: 'Diversified industrial technology' },
        { symbol: 'GNRC', name: 'Generac Holdings', description: 'Backup generators and energy storage' },
        { symbol: 'CARR', name: 'Carrier Global', description: 'HVAC and refrigeration systems' },
        { symbol: 'OTIS', name: 'Otis Worldwide', description: 'Elevators and escalators' },
        { symbol: 'TT', name: 'Trane Technologies', description: 'Climate control and HVAC systems' },
        { symbol: 'FAST', name: 'Fastenal Co', description: 'Industrial distribution and supply chain' },
        { symbol: 'GWW', name: 'W.W. Grainger', description: 'Industrial distribution and MRO supplies' },
      ],
    },
    {
      name: 'Real Estate & REITs',
      aliases: ['real estate', 'reit', 'reits', 'property', 'real estate investment trust'],
      stocks: [
        { symbol: 'PLD', name: 'Prologis', description: 'Industrial REIT, logistics warehouses globally' },
        { symbol: 'AMT', name: 'American Tower', description: 'Cell tower REIT, 200K+ global sites' },
        { symbol: 'EQIX', name: 'Equinix', description: 'Data center REIT, global colocation leader' },
        { symbol: 'DLR', name: 'Digital Realty', description: 'Data center and interconnection REIT' },
        { symbol: 'SPG', name: 'Simon Property Group', description: 'Largest mall REIT in US' },
        { symbol: 'CCI', name: 'Crown Castle', description: 'US cell tower and small cell infrastructure' },
        { symbol: 'WELL', name: 'Welltower', description: 'Senior housing and medical facilities REIT' },
        { symbol: 'PSA', name: 'Public Storage', description: 'Largest self-storage REIT' },
        { symbol: 'O', name: 'Realty Income', description: 'Monthly dividend REIT, triple-net leases' },
        { symbol: 'AVB', name: 'AvalonBay Communities', description: 'Apartment REIT in high-cost metro areas' },
        { symbol: 'EQR', name: 'Equity Residential', description: 'Urban apartment REIT' },
        { symbol: 'IRM', name: 'Iron Mountain', description: 'Data management and data center REIT' },
        { symbol: 'SBAC', name: 'SBA Communications', description: 'Cell tower REIT, Americas and Africa' },
        { symbol: 'EXR', name: 'Extra Space Storage', description: 'Self-storage REIT, largest by units' },
        { symbol: 'VICI', name: 'VICI Properties', description: 'Gaming and entertainment REIT (MGM, Caesars)' },
        { symbol: 'NNN', name: 'NNN REIT', description: 'Net-lease REIT, retail properties' },
        { symbol: 'HST', name: 'Host Hotels & Resorts', description: 'Lodging REIT' },
        { symbol: 'KIM', name: 'Kimco Realty', description: 'Open-air shopping center REIT' },
        { symbol: 'ARE', name: 'Alexandria Real Estate', description: 'Life science laboratory REIT' },
        { symbol: 'COLD', name: 'Americold Realty', description: 'Temperature-controlled warehouse REIT' },
      ],
    },
    {
      name: 'Utilities',
      aliases: ['utility', 'utilities', 'power', 'electricity', 'electric utility', 'natural gas utility'],
      stocks: [
        { symbol: 'NEE', name: 'NextEra Energy', description: 'Largest renewable and regulated utility' },
        { symbol: 'DUK', name: 'Duke Energy', description: 'Large regulated electric and gas utility' },
        { symbol: 'SO', name: 'Southern Company', description: 'Regulated utility with nuclear assets (Vogtle)' },
        { symbol: 'AEP', name: 'American Electric Power', description: 'Large US electric utility, data center demand' },
        { symbol: 'D', name: 'Dominion Energy', description: 'Virginia and Southeast electric utility' },
        { symbol: 'XEL', name: 'Xcel Energy', description: 'Renewable energy leader among regulated utilities' },
        { symbol: 'ED', name: 'Consolidated Edison', description: 'New York City electric and gas utility' },
        { symbol: 'WEC', name: 'WEC Energy', description: 'Midwest regulated electric and gas utility' },
        { symbol: 'EXC', name: 'Exelon Corp', description: 'Nuclear power and regulated utilities' },
        { symbol: 'ES', name: 'Eversource Energy', description: 'New England electric and gas utility' },
        { symbol: 'ETR', name: 'Entergy Corp', description: 'Nuclear-heavy utility in the Gulf South' },
        { symbol: 'PPL', name: 'PPL Corp', description: 'US and UK electric distribution utility' },
        { symbol: 'FE', name: 'FirstEnergy Corp', description: 'Ohio and Mid-Atlantic electric utility' },
        { symbol: 'CMS', name: 'CMS Energy', description: 'Michigan natural gas and electric utility' },
        { symbol: 'AWK', name: 'American Water Works', description: 'Largest US water and wastewater utility' },
        { symbol: 'NI', name: 'NiSource Inc', description: 'Regulated natural gas distribution utility' },
        { symbol: 'ATO', name: 'Atmos Energy', description: 'Natural gas distribution utility' },
        { symbol: 'SR', name: 'Spire Inc', description: 'Natural gas distribution in Missouri' },
        { symbol: 'NRG', name: 'NRG Energy', description: 'Competitive power generation and retail energy' },
        { symbol: 'VST', name: 'Vistra Corp', description: 'Power generation with nuclear and natural gas' },
      ],
    },
    {
      name: 'Telecommunications',
      aliases: ['telecom', 'telecommunications', 'wireless', '5g', 'mobile', 'broadband'],
      stocks: [
        { symbol: 'T', name: 'AT&T Inc', description: 'US wireless leader, fiber broadband expansion' },
        { symbol: 'VZ', name: 'Verizon Communications', description: 'US wireless and business services' },
        { symbol: 'TMUS', name: 'T-Mobile US', description: 'Fastest growing US wireless carrier' },
        { symbol: 'LUMN', name: 'Lumen Technologies', description: 'Enterprise networking and legacy telecom' },
        { symbol: 'DISH', name: 'DISH Network', description: 'Satellite TV and 5G network builder' },
        { symbol: 'IRDM', name: 'Iridium Communications', description: 'Global satellite communication network' },
        { symbol: 'VNET', name: 'VNET Group', description: 'Chinese IDC and cloud service provider' },
        { symbol: 'VOD', name: 'Vodafone Group', description: 'European and Africa mobile operator' },
        { symbol: 'ASTS', name: 'AST SpaceMobile', description: 'Space-based cellular broadband' },
        { symbol: 'RCM', name: 'R1 RCM', description: 'Healthcare telecom and revenue cycle' },
        { symbol: 'SBAC', name: 'SBA Communications', description: 'Tower infrastructure for wireless networks' },
        { symbol: 'AMT', name: 'American Tower', description: 'Global wireless tower infrastructure' },
        { symbol: 'CCI', name: 'Crown Castle', description: 'US wireless tower and small cell network' },
        { symbol: 'COMM', name: 'CommScope Holding', description: 'Network infrastructure equipment' },
        { symbol: 'CSCO', name: 'Cisco Systems', description: 'Enterprise networking and security' },
      ],
    },
    {
      name: 'Media, Entertainment & Streaming',
      aliases: ['media', 'entertainment', 'streaming', 'content', 'film', 'television', 'video', 'music'],
      stocks: [
        { symbol: 'NFLX', name: 'Netflix', description: 'Global streaming leader, 260M+ subscribers' },
        { symbol: 'DIS', name: 'Walt Disney', description: 'Disney+, ESPN+, Hulu, theme parks, studios' },
        { symbol: 'PARA', name: 'Paramount Global', description: 'Paramount+, CBS, MTV, Nickelodeon' },
        { symbol: 'WBD', name: 'Warner Bros Discovery', description: 'Max streaming, CNN, HBO, Warner Bros' },
        { symbol: 'SPOT', name: 'Spotify Technology', description: 'Global audio streaming: music and podcasts' },
        { symbol: 'TTD', name: 'The Trade Desk', description: 'Programmatic advertising platform' },
        { symbol: 'GOOGL', name: 'Alphabet (YouTube)', description: 'YouTube video platform, Google ads' },
        { symbol: 'META', name: 'Meta Platforms', description: 'Facebook, Instagram, WhatsApp, Reels' },
        { symbol: 'SNAP', name: 'Snap Inc', description: 'Snapchat social media and AR' },
        { symbol: 'PINS', name: 'Pinterest', description: 'Visual discovery and shopping platform' },
        { symbol: 'RBLX', name: 'Roblox Corp', description: 'User-generated gaming metaverse platform' },
        { symbol: 'EA', name: 'Electronic Arts', description: 'FIFA, Madden, Apex Legends game publisher' },
        { symbol: 'TTWO', name: 'Take-Two Interactive', description: 'GTA, NBA 2K, Red Dead Redemption' },
        { symbol: 'ATVI', name: 'Activision Blizzard', description: 'Call of Duty, World of Warcraft (Microsoft)' },
        { symbol: 'LGF-A', name: 'Lions Gate Entertainment', description: 'Film studio and Starz streaming' },
        { symbol: 'FOXA', name: 'Fox Corporation', description: 'Fox News, Fox Sports, Tubi streaming' },
        { symbol: 'NYT', name: 'New York Times', description: 'Digital subscriptions, Wordle, Cooking' },
        { symbol: 'IAC', name: 'IAC Inc', description: 'Digital media (Dotdash Meredith, Care.com)' },
        { symbol: 'MSGE', name: 'Madison Square Garden Entertainment', description: 'Live events and venues' },
        { symbol: 'NWSA', name: 'News Corp', description: 'Wall Street Journal, Dow Jones, HarperCollins' },
      ],
    },
    {
      name: 'Nuclear Energy',
      aliases: ['nuclear', 'nuclear energy', 'nuclear power', 'uranium', 'smr', 'small modular reactor'],
      stocks: [
        { symbol: 'CCJ', name: 'Cameco Corp', description: 'World\'s largest uranium producer' },
        { symbol: 'UEC', name: 'Uranium Energy Corp', description: 'US uranium exploration and production' },
        { symbol: 'NNE', name: 'Nano Nuclear Energy', description: 'Portable micro-nuclear reactor development' },
        { symbol: 'OKLO', name: 'Oklo Inc', description: 'Advanced fission small modular reactor' },
        { symbol: 'SMR', name: 'NuScale Power', description: 'Small modular reactor technology' },
        { symbol: 'BWXT', name: 'BWX Technologies', description: 'Nuclear fuel and components for Navy/power' },
        { symbol: 'CEG', name: 'Constellation Energy', description: 'Largest US nuclear fleet operator' },
        { symbol: 'VST', name: 'Vistra Corp', description: 'Nuclear and natural gas power generation' },
        { symbol: 'ETR', name: 'Entergy Corp', description: 'Nuclear power plants in Southeast US' },
        { symbol: 'EXC', name: 'Exelon Corp', description: 'Largest nuclear fleet in US' },
        { symbol: 'SO', name: 'Southern Company', description: 'Vogtle nuclear plant, advanced nuclear R&D' },
        { symbol: 'GEV', name: 'GE Vernova', description: 'Nuclear services, gas turbines, grid solutions' },
        { symbol: 'WWR', name: 'Westwater Resources', description: 'Uranium and graphite mining' },
        { symbol: 'DNN', name: 'Denison Mines', description: 'Uranium exploration in Saskatchewan' },
        { symbol: 'UUUU', name: 'Energy Fuels', description: 'US uranium and rare earth producer' },
      ],
    },
    {
      name: 'Quantum Computing',
      aliases: ['quantum', 'quantum computing', 'quantum computer'],
      stocks: [
        { symbol: 'IONQ', name: 'IonQ Inc', description: 'Trapped-ion quantum computers as a service' },
        { symbol: 'RGTI', name: 'Rigetti Computing', description: 'Superconducting quantum processors' },
        { symbol: 'QBTS', name: 'D-Wave Quantum', description: 'Quantum annealing computers' },
        { symbol: 'QUBT', name: 'Quantum Computing Inc', description: 'Quantum photonic computing' },
        { symbol: 'IBM', name: 'IBM Corp', description: 'IBM Quantum Network, Eagle/Osprey processors' },
        { symbol: 'GOOGL', name: 'Alphabet Inc', description: 'Willow quantum chip, Google Quantum AI' },
        { symbol: 'MSFT', name: 'Microsoft Corp', description: 'Azure Quantum, topological qubit research' },
        { symbol: 'INTC', name: 'Intel Corp', description: 'Tunnel Falls quantum chip research' },
        { symbol: 'HON', name: 'Honeywell International', description: 'Quantinuum trapped-ion quantum systems' },
        { symbol: 'NVDA', name: 'NVIDIA Corp', description: 'CUDA-Q quantum simulation platform' },
      ],
    },
    {
      name: 'Robotics & Automation',
      aliases: ['robotics', 'automation', 'robot', 'autonomous', 'industrial automation'],
      stocks: [
        { symbol: 'ISRG', name: 'Intuitive Surgical', description: 'Surgical robotics (da Vinci) market leader' },
        { symbol: 'ROK', name: 'Rockwell Automation', description: 'Industrial automation and smart manufacturing' },
        { symbol: 'ABB', name: 'ABB Ltd', description: 'Industrial robotics and automation systems' },
        { symbol: 'FANUC', name: 'FANUC Corp (ADR)', description: 'CNC systems and industrial robots' },
        { symbol: 'CGNX', name: 'Cognex Corp', description: 'Machine vision systems for factory automation' },
        { symbol: 'TECH', name: 'Bio-Techne Corp', description: 'Lab automation and protein research' },
        { symbol: 'IRBT', name: 'iRobot Corp', description: 'Consumer robots (Roomba vacuum)' },
        { symbol: 'BRKR', name: 'Bruker Corp', description: 'Scientific instruments and automation' },
        { symbol: 'TER', name: 'Teradyne', description: 'Semiconductor test equipment and collaborative robots' },
        { symbol: 'PATH', name: 'UiPath', description: 'Robotic process automation (RPA) software' },
        { symbol: 'AMZN', name: 'Amazon Robotics', description: 'Kiva warehouse robots, Astro home robot' },
        { symbol: 'TSLA', name: 'Tesla', description: 'Optimus humanoid robot, factory automation' },
        { symbol: 'HON', name: 'Honeywell', description: 'Warehouse automation and autonomous mobile robots' },
        { symbol: 'NVDA', name: 'NVIDIA', description: 'Isaac robotics simulation and Jetson edge AI' },
        { symbol: 'LFST', name: 'LifeStance Health', description: 'Mental health automation platform' },
      ],
    },
    {
      name: 'Logistics & Transportation',
      aliases: ['logistics', 'shipping', 'transport', 'transportation', 'freight', 'supply chain'],
      stocks: [
        { symbol: 'UPS', name: 'United Parcel Service', description: 'Global parcel delivery and logistics' },
        { symbol: 'FDX', name: 'FedEx Corp', description: 'Global express delivery and freight' },
        { symbol: 'CHRW', name: 'C.H. Robinson', description: 'Third-party logistics and freight brokerage' },
        { symbol: 'XPO', name: 'XPO Inc', description: 'LTL freight transportation' },
        { symbol: 'ODFL', name: 'Old Dominion Freight', description: 'Premium LTL carrier with high margins' },
        { symbol: 'SAIA', name: 'Saia Inc', description: 'Regional and interregional LTL carrier' },
        { symbol: 'JBHT', name: 'J.B. Hunt Transport', description: 'Trucking and intermodal transportation' },
        { symbol: 'LSTR', name: 'Landstar System', description: 'Asset-light trucking brokerage' },
        { symbol: 'EXPD', name: 'Expeditors International', description: 'International freight and logistics' },
        { symbol: 'ECHO', name: 'Echo Global Logistics', description: 'Tech-enabled freight brokerage' },
        { symbol: 'ZTO', name: 'ZTO Express', description: 'Chinese express delivery (Alibaba ecosystem)' },
        { symbol: 'MAERSK', name: 'A.P. Moller-Maersk', description: 'Largest container shipping company' },
        { symbol: 'DAL', name: 'Delta Air Lines', description: 'US major airline and cargo' },
        { symbol: 'UAL', name: 'United Airlines', description: 'US major airline' },
        { symbol: 'AAL', name: 'American Airlines', description: 'Largest US airline by fleet' },
        { symbol: 'LUV', name: 'Southwest Airlines', description: 'Low-cost US airline' },
        { symbol: 'UBER', name: 'Uber Freight', description: 'Digital freight brokerage platform' },
        { symbol: 'WRLD', name: 'World Acceptance Corp', description: 'Consumer finance for transport workers' },
        { symbol: 'CSX', name: 'CSX Corp', description: 'Eastern US railroad' },
        { symbol: 'UNP', name: 'Union Pacific', description: 'Western US freight railroad' },
      ],
    },
    {
      name: 'Software & Enterprise Tech',
      aliases: ['software', 'enterprise software', 'b2b software', 'tech', 'technology', 'information technology', 'it'],
      stocks: [
        { symbol: 'MSFT', name: 'Microsoft Corp', description: 'Office 365, Azure, Dynamics, GitHub, LinkedIn' },
        { symbol: 'ORCL', name: 'Oracle Corp', description: 'Database, ERP (NetSuite), OCI cloud' },
        { symbol: 'SAP', name: 'SAP SE', description: 'Enterprise ERP and business software (S/4HANA)' },
        { symbol: 'ADSK', name: 'Autodesk', description: 'CAD/CAM design software (AutoCAD, Revit)' },
        { symbol: 'INTU', name: 'Intuit Inc', description: 'TurboTax, QuickBooks, Mailchimp, Credit Karma' },
        { symbol: 'ANSS', name: 'ANSYS Inc', description: 'Engineering simulation software' },
        { symbol: 'CDNS', name: 'Cadence Design Systems', description: 'Electronic design automation (EDA) software' },
        { symbol: 'SNPS', name: 'Synopsys', description: 'EDA software and semiconductor IP' },
        { symbol: 'NOW', name: 'ServiceNow', description: 'IT service management and workflow automation' },
        { symbol: 'WDAY', name: 'Workday', description: 'Cloud HCM and enterprise financials' },
        { symbol: 'CRM', name: 'Salesforce', description: 'CRM, marketing cloud, Slack, Tableau' },
        { symbol: 'DDOG', name: 'Datadog', description: 'Observability and security monitoring' },
        { symbol: 'ZM', name: 'Zoom Video', description: 'Video conferencing and communications platform' },
        { symbol: 'PANW', name: 'Palo Alto Networks', description: 'Security software and SASE platform' },
        { symbol: 'FTNT', name: 'Fortinet', description: 'Network security OS and appliances' },
        { symbol: 'CRWD', name: 'CrowdStrike', description: 'Cloud-native endpoint security platform' },
        { symbol: 'OKTA', name: 'Okta', description: 'Identity and access management platform' },
        { symbol: 'HUBS', name: 'HubSpot', description: 'Inbound marketing and CRM platform' },
        { symbol: 'VEEV', name: 'Veeva Systems', description: 'Cloud platform for life sciences' },
        { symbol: 'ADBE', name: 'Adobe Inc', description: 'Creative Cloud, Document Cloud, Experience Cloud' },
      ],
    },
    {
      name: 'Crypto & Blockchain',
      aliases: ['crypto', 'cryptocurrency', 'bitcoin', 'ethereum', 'blockchain', 'web3', 'digital assets'],
      stocks: [
        { symbol: 'COIN', name: 'Coinbase Global', description: 'Largest US crypto exchange and custody' },
        { symbol: 'MSTR', name: 'MicroStrategy', description: 'Bitcoin treasury company (280K+ BTC held)' },
        { symbol: 'MARA', name: 'Marathon Digital', description: 'Bitcoin mining (37 EH/s capacity)' },
        { symbol: 'RIOT', name: 'Riot Platforms', description: 'Bitcoin mining in Texas (28 EH/s)' },
        { symbol: 'HUT', name: 'Hut 8 Corp', description: 'Bitcoin mining and digital infrastructure' },
        { symbol: 'CLSK', name: 'CleanSpark', description: 'Sustainable Bitcoin mining' },
        { symbol: 'CIFR', name: 'Cipher Mining', description: 'Industrial-scale Bitcoin mining' },
        { symbol: 'BTBT', name: 'Bit Digital', description: 'Bitcoin mining and cloud GPU services' },
        { symbol: 'BITO', name: 'ProShares Bitcoin ETF', description: 'Bitcoin futures ETF' },
        { symbol: 'GBTC', name: 'Grayscale Bitcoin Trust', description: 'Bitcoin spot ETF' },
        { symbol: 'IBIT', name: 'iShares Bitcoin Trust', description: 'BlackRock Bitcoin spot ETF' },
        { symbol: 'SQ', name: 'Block Inc (Square)', description: 'Bitcoin payments via Cash App' },
        { symbol: 'PYPL', name: 'PayPal', description: 'Crypto buy/sell and PayPal USD stablecoin' },
        { symbol: 'HOOD', name: 'Robinhood Markets', description: 'Commission-free crypto trading' },
        { symbol: 'CME', name: 'CME Group', description: 'Bitcoin and Ethereum futures trading' },
      ],
    },
  ];

  // Flexible matching: check aliases and partial name matches
  for (const sector of sectors) {
    for (const alias of sector.aliases) {
      if (sectorLower.includes(alias) || alias.includes(sectorLower)) {
        return {
          sector: sector.name,
          stockCount: sector.stocks.length,
          stocks: sector.stocks,
          note: `Use search_stock to find additional companies not in this list`,
        };
      }
    }
  }

  // Partial name match fallback
  for (const sector of sectors) {
    const words = sectorLower.split(/\s+/);
    for (const word of words) {
      if (word.length > 3 && sector.name.toLowerCase().includes(word)) {
        return {
          sector: sector.name,
          stockCount: sector.stocks.length,
          stocks: sector.stocks,
          note: `Matched on keyword "${word}". Use search_stock for more specific companies.`,
        };
      }
    }
  }

  // Return the full directory of available sectors with stock counts
  return {
    requestedSector: sector,
    message: `No exact match for "${sector}". The sectors below cover the full market. Use search_stock to find any specific company by name.`,
    availableSectors: sectors.map(s => ({
      key: s.aliases[0],
      name: s.name,
      stockCount: s.stocks.length,
      topStocks: s.stocks.slice(0, 5).map(st => st.symbol).join(', '),
    })),
  };
}



