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

  private async makeRequest(params: Record<string, string>): Promise<any> {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          ...params,
          apikey: this.apiKey,
        },
        timeout: 10000,
      });
      return response.data;
    } catch (error: any) {
      console.error('API request failed:', error.message);
      throw new Error(`Failed to fetch data: ${error.message}`);
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
      currentPrice: data['50DayMovingAverage'] || 'N/A',
      upside: data.AnalystTargetPrice && data['50DayMovingAverage']
        ? `${(((Number(data.AnalystTargetPrice) / Number(data['50DayMovingAverage'])) - 1) * 100).toFixed(1)}%`
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
 * Curated sector/theme stock lists
 */
function getStocksBySectorData(sector: string): any {
  const sectorLower = sector.toLowerCase();

  const sectorMap: Record<string, { name: string; stocks: { symbol: string; name: string; description: string }[] }> = {
    ai: {
      name: 'Artificial Intelligence',
      stocks: [
        { symbol: 'NVDA', name: 'NVIDIA Corp', description: 'AI GPU leader, dominant in training and inference chips' },
        { symbol: 'MSFT', name: 'Microsoft Corp', description: 'Azure AI, Copilot, OpenAI partnership' },
        { symbol: 'GOOGL', name: 'Alphabet Inc', description: 'Google AI, DeepMind, Gemini models' },
        { symbol: 'META', name: 'Meta Platforms', description: 'LLaMA open-source AI models, AI-powered ads' },
        { symbol: 'AMZN', name: 'Amazon.com', description: 'AWS AI services, Bedrock, Alexa AI' },
        { symbol: 'PLTR', name: 'Palantir Technologies', description: 'AI-powered data analytics for government and enterprise' },
        { symbol: 'CRM', name: 'Salesforce', description: 'Einstein AI, Agentforce AI platform' },
        { symbol: 'IBM', name: 'IBM', description: 'Watson AI, enterprise AI solutions' },
        { symbol: 'SNOW', name: 'Snowflake', description: 'AI-powered data cloud platform' },
        { symbol: 'AI', name: 'C3.ai', description: 'Enterprise AI software platform' },
        { symbol: 'PATH', name: 'UiPath', description: 'AI-powered robotic process automation' },
        { symbol: 'UPST', name: 'Upstart Holdings', description: 'AI lending platform' },
      ],
    },
    semiconductor: {
      name: 'Semiconductors',
      stocks: [
        { symbol: 'NVDA', name: 'NVIDIA Corp', description: 'GPU leader for AI, gaming, data centers' },
        { symbol: 'AMD', name: 'Advanced Micro Devices', description: 'CPUs and GPUs for data centers and gaming' },
        { symbol: 'INTC', name: 'Intel Corp', description: 'CPU manufacturer, foundry services' },
        { symbol: 'TSM', name: 'Taiwan Semiconductor', description: 'World\'s largest chip foundry' },
        { symbol: 'AVGO', name: 'Broadcom Inc', description: 'Networking, broadband, and enterprise chips' },
        { symbol: 'QCOM', name: 'Qualcomm', description: 'Mobile SoCs, 5G modems, automotive chips' },
        { symbol: 'TXN', name: 'Texas Instruments', description: 'Analog and embedded semiconductors' },
        { symbol: 'MU', name: 'Micron Technology', description: 'DRAM and NAND memory chips' },
        { symbol: 'MRVL', name: 'Marvell Technology', description: 'Data infrastructure semiconductors' },
        { symbol: 'ASML', name: 'ASML Holding', description: 'EUV lithography machines for chip manufacturing' },
        { symbol: 'LRCX', name: 'Lam Research', description: 'Semiconductor manufacturing equipment' },
        { symbol: 'AMAT', name: 'Applied Materials', description: 'Semiconductor equipment and services' },
        { symbol: 'ARM', name: 'Arm Holdings', description: 'Chip architecture and IP licensing' },
      ],
    },
    'data center': {
      name: 'Data Centers',
      stocks: [
        { symbol: 'EQIX', name: 'Equinix', description: 'Largest data center REIT globally' },
        { symbol: 'DLR', name: 'Digital Realty', description: 'Data center REIT with global presence' },
        { symbol: 'AMT', name: 'American Tower', description: 'Infrastructure REIT including data centers' },
        { symbol: 'NVDA', name: 'NVIDIA Corp', description: 'AI GPU infrastructure for data centers' },
        { symbol: 'AMZN', name: 'Amazon (AWS)', description: 'Largest cloud infrastructure provider' },
        { symbol: 'MSFT', name: 'Microsoft (Azure)', description: 'Second-largest cloud provider' },
        { symbol: 'GOOGL', name: 'Alphabet (GCP)', description: 'Third-largest cloud provider' },
        { symbol: 'VRT', name: 'Vertiv Holdings', description: 'Data center power and cooling infrastructure' },
        { symbol: 'DELL', name: 'Dell Technologies', description: 'Servers and storage for data centers' },
        { symbol: 'HPE', name: 'Hewlett Packard Enterprise', description: 'Enterprise servers and networking' },
      ],
    },
    'ai data center': {
      name: 'AI Data Center Infrastructure',
      stocks: [
        { symbol: 'NVDA', name: 'NVIDIA Corp', description: 'AI GPU leader, Blackwell and Hopper platforms' },
        { symbol: 'EQIX', name: 'Equinix', description: 'Data center REIT expanding AI capacity' },
        { symbol: 'VRT', name: 'Vertiv Holdings', description: 'Power and cooling for AI data centers' },
        { symbol: 'DELL', name: 'Dell Technologies', description: 'AI-optimized servers (PowerEdge)' },
        { symbol: 'SMCI', name: 'Super Micro Computer', description: 'AI server platforms and GPU racks' },
        { symbol: 'ANET', name: 'Arista Networks', description: 'High-speed networking for AI clusters' },
        { symbol: 'DLR', name: 'Digital Realty', description: 'AI-ready data center facilities' },
        { symbol: 'ETN', name: 'Eaton Corp', description: 'Power management for data centers' },
        { symbol: 'FLNC', name: 'Fluence Energy', description: 'Energy storage for data centers' },
      ],
    },
    pharma: {
      name: 'Pharmaceuticals & Biotech',
      stocks: [
        { symbol: 'LLY', name: 'Eli Lilly', description: 'Diabetes (Mounjaro), obesity drugs, Alzheimer\'s' },
        { symbol: 'JNJ', name: 'Johnson & Johnson', description: 'Diversified pharma, medical devices' },
        { symbol: 'UNH', name: 'UnitedHealth Group', description: 'Health insurance and Optum services' },
        { symbol: 'ABBV', name: 'AbbVie', description: 'Immunology (Humira/Skyrizi), oncology' },
        { symbol: 'MRK', name: 'Merck & Co', description: 'Oncology (Keytruda), vaccines' },
        { symbol: 'PFE', name: 'Pfizer', description: 'Vaccines, oncology, rare disease' },
        { symbol: 'NVO', name: 'Novo Nordisk', description: 'Diabetes and obesity treatments (Ozempic, Wegovy)' },
        { symbol: 'TMO', name: 'Thermo Fisher Scientific', description: 'Life sciences tools and diagnostics' },
        { symbol: 'AMGN', name: 'Amgen', description: 'Biotechnology, biosimilars' },
        { symbol: 'GILD', name: 'Gilead Sciences', description: 'Antiviral treatments, oncology' },
        { symbol: 'BMY', name: 'Bristol-Myers Squibb', description: 'Oncology, cardiovascular, immunology' },
        { symbol: 'REGN', name: 'Regeneron Pharmaceuticals', description: 'Antibody therapies, eye care' },
      ],
    },
    cybersecurity: {
      name: 'Cybersecurity',
      stocks: [
        { symbol: 'CRWD', name: 'CrowdStrike', description: 'Endpoint security, cloud security platform' },
        { symbol: 'PANW', name: 'Palo Alto Networks', description: 'Network security, cloud security' },
        { symbol: 'FTNT', name: 'Fortinet', description: 'Network security appliances and services' },
        { symbol: 'ZS', name: 'Zscaler', description: 'Cloud-based zero trust security' },
        { symbol: 'S', name: 'SentinelOne', description: 'AI-powered autonomous cybersecurity' },
        { symbol: 'OKTA', name: 'Okta', description: 'Identity and access management' },
        { symbol: 'NET', name: 'Cloudflare', description: 'Web security and CDN services' },
        { symbol: 'CYBR', name: 'CyberArk Software', description: 'Privileged access management' },
      ],
    },
    cloud: {
      name: 'Cloud Computing',
      stocks: [
        { symbol: 'AMZN', name: 'Amazon (AWS)', description: 'Market-leading cloud infrastructure' },
        { symbol: 'MSFT', name: 'Microsoft (Azure)', description: 'Enterprise cloud, AI cloud services' },
        { symbol: 'GOOGL', name: 'Alphabet (GCP)', description: 'Cloud platform, BigQuery, Vertex AI' },
        { symbol: 'CRM', name: 'Salesforce', description: 'Cloud-based CRM platform' },
        { symbol: 'NOW', name: 'ServiceNow', description: 'Cloud-based IT service management' },
        { symbol: 'SNOW', name: 'Snowflake', description: 'Cloud data warehousing platform' },
        { symbol: 'WDAY', name: 'Workday', description: 'Cloud-based HR and finance software' },
        { symbol: 'DDOG', name: 'Datadog', description: 'Cloud monitoring and analytics' },
        { symbol: 'MDB', name: 'MongoDB', description: 'Cloud database platform' },
        { symbol: 'NET', name: 'Cloudflare', description: 'Edge cloud platform and CDN' },
      ],
    },
    ev: {
      name: 'Electric Vehicles',
      stocks: [
        { symbol: 'TSLA', name: 'Tesla', description: 'EV leader, energy storage, autonomous driving' },
        { symbol: 'RIVN', name: 'Rivian Automotive', description: 'Electric trucks and SUVs' },
        { symbol: 'LCID', name: 'Lucid Group', description: 'Luxury electric sedans and SUVs' },
        { symbol: 'NIO', name: 'NIO Inc', description: 'Chinese premium EVs with battery swap' },
        { symbol: 'LI', name: 'Li Auto', description: 'Chinese extended-range EVs' },
        { symbol: 'F', name: 'Ford Motor', description: 'F-150 Lightning, Mustang Mach-E' },
        { symbol: 'GM', name: 'General Motors', description: 'Ultium platform, GMC Hummer EV' },
        { symbol: 'XPEV', name: 'XPeng', description: 'Chinese smart EVs' },
      ],
    },
    fintech: {
      name: 'Financial Technology',
      stocks: [
        { symbol: 'V', name: 'Visa', description: 'Global payments network' },
        { symbol: 'MA', name: 'Mastercard', description: 'Global payments technology' },
        { symbol: 'PYPL', name: 'PayPal', description: 'Digital payments and commerce platform' },
        { symbol: 'SQ', name: 'Block (Square)', description: 'Commerce ecosystem, Cash App, Bitcoin' },
        { symbol: 'AFRM', name: 'Affirm Holdings', description: 'Buy-now-pay-later platform' },
        { symbol: 'SOFI', name: 'SoFi Technologies', description: 'Digital banking and fintech platform' },
        { symbol: 'COIN', name: 'Coinbase', description: 'Cryptocurrency exchange platform' },
        { symbol: 'FIS', name: 'Fidelity National Info', description: 'Financial services technology' },
      ],
    },
    renewable: {
      name: 'Renewable Energy',
      stocks: [
        { symbol: 'ENPH', name: 'Enphase Energy', description: 'Solar microinverters and energy management' },
        { symbol: 'SEDG', name: 'SolarEdge Technologies', description: 'Solar power optimization' },
        { symbol: 'FSLR', name: 'First Solar', description: 'Thin-film solar modules manufacturer' },
        { symbol: 'NEE', name: 'NextEra Energy', description: 'Largest renewable energy generator' },
        { symbol: 'PLUG', name: 'Plug Power', description: 'Hydrogen fuel cell solutions' },
        { symbol: 'BE', name: 'Bloom Energy', description: 'Solid-oxide fuel cells for clean energy' },
        { symbol: 'RUN', name: 'Sunrun', description: 'Residential solar and battery storage' },
        { symbol: 'DQ', name: 'Daqo New Energy', description: 'Polysilicon for solar panels' },
      ],
    },
  };

  // Match sector from the map using flexible matching
  let matchedSector = null;
  for (const [key, value] of Object.entries(sectorMap)) {
    if (sectorLower.includes(key) || key.includes(sectorLower)) {
      matchedSector = value;
      break;
    }
  }

  if (matchedSector) {
    return {
      sector: matchedSector.name,
      stockCount: matchedSector.stocks.length,
      stocks: matchedSector.stocks,
    };
  }

  // Return available sectors if no match
  return {
    sector: sector,
    message: `No curated list found for "${sector}". Available sectors/themes: ${Object.entries(sectorMap).map(([k, v]) => `${k} (${v.name})`).join(', ')}`,
    availableSectors: Object.keys(sectorMap),
  };
}


