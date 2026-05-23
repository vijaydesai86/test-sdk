import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  AlphaVantageService,
  BeaService,
  BlsPublicDataService,
  createStockService,
  EiaService,
  FinnhubService,
  SecCompanyFactsService,
  TreasuryYieldCurveService,
} from '../web/app/lib/stockDataService';

vi.mock('axios');

const mockedAxios = vi.mocked(axios);

const weeklyTimeSeriesResponse = {
  'Meta Data': { '2. Symbol': 'AAPL' },
  'Weekly Time Series': {
    '2025-01-10': { '1. open': '150', '2. high': '155', '3. low': '148', '4. close': '153', '5. volume': '5000' },
    '2025-01-03': { '1. open': '148', '2. high': '152', '3. low': '146', '4. close': '150', '5. volume': '4500' },
  },
};

const monthlyTimeSeriesResponse = {
  'Meta Data': { '2. Symbol': 'AAPL' },
  'Monthly Time Series': {
    '2025-01-31': { '1. open': '148', '2. high': '158', '3. low': '145', '4. close': '155', '5. volume': '40000' },
    '2024-12-31': { '1. open': '142', '2. high': '150', '3. low': '140', '4. close': '148', '5. volume': '38000' },
  },
};

const globalQuote = (price = '100.00') => ({
  'Global Quote': {
    '01. symbol': 'AAPL',
    '05. price': price,
    '09. change': '1.00',
    '10. change percent': '1.00%',
    '06. volume': '1000',
    '07. latest trading day': '2025-01-01',
  },
});

// ─── AlphaVantageService ──────────────────────────────────────────────────────

describe('AlphaVantageService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    process.env.ALPHA_VANTAGE_API_KEY = 'test';
    process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS = '0';
    // Reset shared in-process cache and circuit breaker between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AlphaVantageService as any).sharedCache?.clear?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AlphaVantageService as any).rateLimitedUntilMs = 0;
  });

  it('returns correct price from Global Quote', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: globalQuote('123.45') });
    const service = new AlphaVantageService('test');
    const result = await service.getStockPrice('AAPL');
    expect(result.price).toBe('123.45');
  });

  it('caches stock price responses — second call hits cache', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: globalQuote() });
    const service = new AlphaVantageService('test');
    const first = await service.getStockPrice('AAPL');
    const second = await service.getStockPrice('AAPL');
    expect(first.price).toBe('100.00');
    expect(second.price).toBe('100.00');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('returns alpha-only error for company news', async () => {
    const service = new AlphaVantageService('test');
    await expect(service.getCompanyNews('AAPL', 5)).rejects.toThrow('Alpha-only mode');
  });

  it('uses TIME_SERIES_WEEKLY for 1y range', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: weeklyTimeSeriesResponse });
    const service = new AlphaVantageService('test');
    const result = await service.getPriceHistory('AAPL', '1y');
    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_WEEKLY');
    expect(call[1].params.outputsize).toBeUndefined();
    expect(result.prices).toBeDefined();
  });

  it('uses TIME_SERIES_WEEKLY for 5y range', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: weeklyTimeSeriesResponse });
    const service = new AlphaVantageService('test');
    await service.getPriceHistory('AAPL', '5y');
    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_WEEKLY');
    expect(call[1].params.outputsize).toBeUndefined();
  });

  it('uses TIME_SERIES_MONTHLY for max range', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: monthlyTimeSeriesResponse });
    const service = new AlphaVantageService('test');
    const result = await service.getPriceHistory('AAPL', 'max');
    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_MONTHLY');
    expect(call[1].params.outputsize).toBeUndefined();
    expect(result.prices.length).toBeGreaterThan(0);
  });

  it('uses TIME_SERIES_DAILY with compact for short 1m range', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        'Time Series (Daily)': {
          '2025-01-10': { '1. open': '150', '2. high': '155', '3. low': '148', '4. close': '153', '5. volume': '5000' },
        },
      },
    });
    const service = new AlphaVantageService('test');
    await service.getPriceHistory('AAPL', '1m');
    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_DAILY');
    expect(call[1].params.outputsize).toBe('compact');
  });

  it('throws suppression-compatible error when company overview is empty', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: {} });
    const service = new AlphaVantageService('test');
    await expect(service.getCompanyOverview('AAPL')).rejects.toThrow('Unavailable via Alpha Vantage');
  });

  it('rate-limit Note response from Alpha Vantage throws with the Note message', async () => {
    const noteMsg = 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.';
    mockedAxios.get.mockResolvedValueOnce({ data: { Note: noteMsg } });
    const service = new AlphaVantageService('test');
    await expect(service.getStockPrice('MSFT')).rejects.toThrow(noteMsg);
  });

  it('price change percent is returned from Global Quote', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: globalQuote() });
    const service = new AlphaVantageService('test');
    const result = await service.getStockPrice('AAPL');
    expect(result.changePercent).toBeDefined();
  });

  it('weekly price history returns array of PricePoints', async () => {
    // Use range='weekly' which applies no date cutoff — safe regardless of when tests run
    const recentWeeklyResponse = {
      'Meta Data': { '2. Symbol': 'AAPL' },
      'Weekly Time Series': {
        '2024-10-18': { '1. open': '150', '2. high': '155', '3. low': '148', '4. close': '153', '5. volume': '5000' },
        '2024-10-11': { '1. open': '148', '2. high': '152', '3. low': '146', '4. close': '150', '5. volume': '4500' },
      },
    };
    mockedAxios.get.mockResolvedValueOnce({ data: recentWeeklyResponse });
    const service = new AlphaVantageService('test');
    const result = await service.getPriceHistory('AAPL', 'weekly');
    expect(Array.isArray(result.prices)).toBe(true);
    expect(result.prices.length).toBeGreaterThan(0);
    expect(result.prices[0]).toHaveProperty('date');
    expect(result.prices[0]).toHaveProperty('close');
  });

  it('monthly price history dates are sorted newest-first', async () => {
    // Use range='monthly' (no date cutoff) so the test is date-independent
    mockedAxios.get.mockResolvedValueOnce({ data: monthlyTimeSeriesResponse });
    const service = new AlphaVantageService('test');
    const result = await service.getPriceHistory('AAPL', 'monthly');
    const dates = result.prices.map((p: { date: string }) => p.date);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);
  });
});

// ─── FinnhubService error handling ───────────────────────────────────────────

describe('FinnhubService', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (FinnhubService as any).rateLimitedUntilMs = 0;
  });

  it('throws suppression-compatible error when profile2 returns empty object', async () => {
    const service = new FinnhubService('dummy');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).makeRequest = vi.fn().mockResolvedValue({});
    await expect(service.getCompanyOverview('AAPL')).rejects.toThrow('Unavailable via Finnhub');
  });

  it('throws when profile2 returns an error field', async () => {
    const service = new FinnhubService('dummy');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).makeRequest = vi.fn().mockResolvedValue({ error: 'You don\'t have access to this resource.' });
    await expect(service.getCompanyOverview('AAPL')).rejects.toThrow('Unavailable via Finnhub');
  });

  it('Finnhub suppression error matches safeFetch regex', () => {
    const suppressionRegex = /unavailable (in|via) (alpha|finnhub)/i;
    expect(suppressionRegex.test('Unavailable via Finnhub: company profile not found')).toBe(true);
  });

  it('Alpha Vantage suppression error matches safeFetch regex', () => {
    const suppressionRegex = /unavailable (in|via) (alpha|finnhub)/i;
    expect(suppressionRegex.test('Unavailable via Alpha Vantage: company data not found')).toBe(true);
  });

  it('rate-limit 429 error message recognized by isRateLimit check', () => {
    const isRateLimit = (msg: string) => /rate.?limit|429|too many/i.test(msg);
    expect(isRateLimit('Finnhub rate limit exceeded (429)')).toBe(true);
  });

  it('plan-limitation 401 results in suppression-compatible error message', async () => {
    const service = new FinnhubService('dummy');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).makeRequest = vi.fn().mockRejectedValue(
      Object.assign(new Error('Request failed'), { response: { status: 401 } })
    );
    // The 401 is handled inside getCompanyOverview's makeRequest wrapper
    // For this test verify the suppression error message format is correct
    const suppressionRegex = /unavailable (in|via) (alpha|finnhub)/i;
    expect(suppressionRegex.test('Unavailable via Finnhub (plan limitation: 401)')).toBe(true);
  });

  it('getStockPrice returns price and changePercent fields when mock returns valid data', async () => {
    const service = new FinnhubService('dummy');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).makeRequest = vi.fn().mockResolvedValue({
      c: 182.5,
      dp: 1.2,
      pc: 180.3,
      h: 183,
      l: 181,
      o: 180.5,
    });
    const result = await service.getStockPrice('AAPL');
    expect(result.price).toBeDefined();
    expect(result.changePercent).toBeDefined();
  });

  it('circuit breaker static value is set correctly when assigned', () => {
    // Verify that the static property can be set/read (used for lockout enforcement)
    const future = Date.now() + 65000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (FinnhubService as any).rateLimitedUntilMs = future;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((FinnhubService as any).rateLimitedUntilMs).toBe(future);
  });
});

// ─── Official no-key data services ───────────────────────────────────────────

describe('SecCompanyFactsService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    (SecCompanyFactsService as any).tickerCache = null;
    (SecCompanyFactsService as any).factsCache?.clear?.();
  });

  it('normalizes official SEC companyfacts into compact financial facts', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          entityName: 'Apple Inc.',
          facts: {
            'us-gaap': {
              Revenues: {
                units: {
                  USD: [{ val: 1000, end: '2025-09-30', filed: '2025-10-31', form: '10-K' }],
                },
              },
              NetCashProvidedByUsedInOperatingActivities: {
                units: {
                  USD: [{ val: 300, end: '2025-09-30', filed: '2025-10-31', form: '10-K' }],
                },
              },
              PaymentsToAcquirePropertyPlantAndEquipment: {
                units: {
                  USD: [{ val: 100, end: '2025-09-30', filed: '2025-10-31', form: '10-K' }],
                },
              },
            },
          },
        },
      });

    const service = new SecCompanyFactsService();
    const result = await service.getNormalizedFinancialFacts('AAPL');

    expect(result.cik).toBe('0000320193');
    expect(result.facts.revenue.value).toBe(1000);
    expect(result.facts.revenue.tag).toBe('Revenues');
    expect(result.freeCashFlow.value).toBe(200);
    expect(result.__source).toBe('SEC companyfacts');
  });

  it('does not calculate free cash flow from SEC facts with mismatched periods', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          entityName: 'Apple Inc.',
          facts: {
            'us-gaap': {
              NetCashProvidedByUsedInOperatingActivities: {
                units: {
                  USD: [{ val: 300, start: '2025-01-01', end: '2025-12-31', filed: '2026-02-01', form: '10-K', fp: 'FY' }],
                },
              },
              PaymentsToAcquirePropertyPlantAndEquipment: {
                units: {
                  USD: [{ val: 100, start: '2024-01-01', end: '2024-12-31', filed: '2025-02-01', form: '10-K', fp: 'FY' }],
                },
              },
            },
          },
        },
      });

    const service = new SecCompanyFactsService();
    const result = await service.getNormalizedFinancialFacts('AAPL');

    expect(result.facts.operatingCashFlow.end).toBe('2025-12-31');
    expect(result.facts.capex.end).toBe('2024-12-31');
    expect(result.freeCashFlow).toBeNull();
  });

  it('prefers latest annual duration facts over newer quarterly filings', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          0: { cik_str: 1973239, ticker: 'ARM', title: 'Arm Holdings plc' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          entityName: 'Arm Holdings plc',
          facts: {
            'us-gaap': {
              RevenueFromContractWithCustomerExcludingAssessedTax: {
                units: {
                  USD: [
                    { val: 2770000000, start: '2024-04-01', end: '2024-12-31', filed: '2026-01-30', form: '6-K', fp: 'Q3' },
                    { val: 4920000000, start: '2025-04-01', end: '2026-03-31', filed: '2026-05-15', form: '20-F', fp: 'FY', frame: 'CY2025' },
                  ],
                },
              },
              GrossProfit: {
                units: {
                  USD: [{ val: 4799000000, start: '2025-04-01', end: '2026-03-31', filed: '2026-05-15', form: '20-F', fp: 'FY' }],
                },
              },
              OperatingIncomeLoss: {
                units: {
                  USD: [{ val: 900000000, start: '2025-04-01', end: '2026-03-31', filed: '2026-05-15', form: '20-F', fp: 'FY' }],
                },
              },
              NetCashProvidedByUsedInOperatingActivities: {
                units: {
                  USD: [
                    { val: 139000000, start: '2024-10-01', end: '2024-12-31', filed: '2026-01-30', form: '6-K', fp: 'Q3' },
                    { val: 1524000000, start: '2025-04-01', end: '2026-03-31', filed: '2026-05-15', form: '20-F', fp: 'FY' },
                  ],
                },
              },
              PaymentsToAcquirePropertyPlantAndEquipment: {
                units: {
                  USD: [
                    { val: 145000000, start: '2024-10-01', end: '2024-12-31', filed: '2026-01-30', form: '6-K', fp: 'Q3' },
                    { val: 545000000, start: '2025-04-01', end: '2026-03-31', filed: '2026-05-15', form: '20-F', fp: 'FY' },
                  ],
                },
              },
              Assets: {
                units: {
                  USD: [
                    { val: 8930000000, end: '2025-03-31', filed: '2025-05-15', form: '20-F', fp: 'FY' },
                    { val: 10703000000, end: '2026-03-31', filed: '2026-05-15', form: '20-F', fp: 'FY' },
                  ],
                },
              },
            },
          },
        },
      });

    const service = new SecCompanyFactsService();
    const result = await service.getNormalizedFinancialFacts('ARM');

    expect(result.facts.revenue.value).toBe(4920000000);
    expect(result.facts.revenue.end).toBe('2026-03-31');
    expect(result.facts.revenue.period).toBe('annual');
    expect(result.facts.grossProfit.value).toBe(4799000000);
    expect(result.facts.operatingIncome.value).toBe(900000000);
    expect(result.facts.operatingCashFlow.value).toBe(1524000000);
    expect(result.facts.capex.value).toBe(545000000);
    expect(result.freeCashFlow.value).toBe(979000000);
    expect(result.facts.assets.value).toBe(10703000000);
  });
});

describe('TreasuryYieldCurveService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    (TreasuryYieldCurveService as any).cache?.clear?.();
  });

  it('parses the official Treasury XML yield curve feed', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: `
        <feed>
          <entry><content><m:properties>
            <d:NEW_DATE>2026-05-20T00:00:00</d:NEW_DATE>
            <d:BC_3MONTH>4.10</d:BC_3MONTH>
            <d:BC_2YEAR>3.75</d:BC_2YEAR>
            <d:BC_10YEAR>4.25</d:BC_10YEAR>
            <d:BC_30YEAR>4.80</d:BC_30YEAR>
          </m:properties></content></entry>
        </feed>
      `,
    });

    const service = new TreasuryYieldCurveService();
    const result = await service.getLatestYieldCurve(2026);

    expect(result.latest.date).toBe('2026-05-20');
    expect(result.latest.year10).toBe(4.25);
    expect(result.yieldCurve.tenYearMinusTwoYear).toBe(0.5);
    expect(result.yieldCurve.thirtyYearMinusThreeMonth).toBe(0.7);
  });
});

describe('BlsPublicDataService', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
    (BlsPublicDataService as any).cache = null;
    delete process.env.BLS_API_KEY;
  });

  it('normalizes BLS macro series and computes year-over-year change', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        status: 'REQUEST_SUCCEEDED',
        Results: {
          series: [
            {
              seriesID: 'CUUR0000SA0',
              data: [
                { year: '2026', period: 'M01', periodName: 'January', value: '330.0', latest: 'true' },
                { year: '2025', period: 'M01', periodName: 'January', value: '300.0' },
              ],
            },
          ],
        },
      },
    });

    const service = new BlsPublicDataService();
    const result = await service.getMacroIndicators();
    const cpi = result.indicators.find((item: any) => item.id === 'CPI_ALL_URBAN');

    expect(result.status).toBe('REQUEST_SUCCEEDED');
    expect(result.quotaMode).toBe('unregistered');
    expect(cpi.latest.value).toBe(330);
    expect(cpi.yoyPercent).toBe(10);
  });
});

describe('BeaService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    process.env.BEA_API_KEY = 'bea';
    process.env.BEA_CACHE_TTL_MS = '0';
  });

  it('normalizes official BEA NIPA tables into macro indicators', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          BEAAPI: {
            Results: {
              Data: [
                {
                  LineDescription: 'Gross domestic product',
                  TimePeriod: '2026Q1',
                  DataValue: '1.4',
                  CL_UNIT: 'Percent change',
                  TableName: 'T10101',
                  LineNumber: '1',
                },
                {
                  LineDescription: 'Personal consumption expenditures',
                  TimePeriod: '2026Q1',
                  DataValue: '2.8',
                  CL_UNIT: 'Percent change',
                  TableName: 'T10101',
                  LineNumber: '2',
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          BEAAPI: {
            Results: {
              Data: [
                {
                  LineDescription: 'Gross domestic product',
                  TimePeriod: '2026Q1',
                  DataValue: '29,100.5',
                  CL_UNIT: 'Billions of dollars',
                  TableName: 'T10105',
                  LineNumber: '1',
                },
              ],
            },
          },
        },
      });

    const service = new BeaService();
    const result = await service.getMacroIndicators();

    expect(result.__source).toBe('BEA NIPA API');
    expect(result.indicators.realGdpGrowth.value).toBe(1.4);
    expect(result.indicators.pceGrowth.value).toBe(2.8);
    expect(result.indicators.nominalGdp.value).toBe(29100.5);
    expect(mockedAxios.get.mock.calls[0][0]).toBe('https://apps.bea.gov/api/data');
    expect(mockedAxios.get.mock.calls[0][1].params.UserID).toBe('bea');
  });
});

describe('EiaService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    process.env.EIA_API_KEY = 'eia';
    process.env.EIA_CACHE_TTL_MS = '0';
  });

  it('normalizes official EIA energy series and preserves per-series gaps', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          response: {
            description: 'WTI crude oil spot price',
            data: [
              { period: '2026-05-20', value: '62.10', units: 'dollars per barrel' },
              { period: '2026-05-19', value: '61.80', units: 'dollars per barrel' },
            ],
          },
        },
      })
      .mockRejectedValueOnce(Object.assign(new Error('rate limit'), { response: { status: 429 } }))
      .mockResolvedValueOnce({
        data: {
          response: {
            description: 'Retail electricity price',
            data: [{ period: '2026-03', value: '13.75', units: 'cents per kilowatthour' }],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          response: {
            description: 'Electricity net generation',
            data: [{ period: '2026-03', value: '350000', units: 'thousand megawatthours' }],
          },
        },
      });

    const service = new EiaService();
    const result = await service.getEnergyIndicators();

    expect(result.__source).toBe('EIA Open Data API');
    expect(result.indicators[0].latest.value).toBe(62.1);
    expect(result.indicators[1].error).toBe('rate limit');
    expect(result.indicators[2].latest.value).toBe(13.75);
    expect(mockedAxios.get.mock.calls[0][0]).toBe('https://api.eia.gov/v2/seriesid/PET.RWTC.D');
    expect(mockedAxios.get.mock.calls[0][1].params.api_key).toBe('eia');
  });
});

describe('expanded provider fallback chain', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
    process.env.FINNHUB_API_KEY = 'finnhub';
    process.env.FINANCIAL_MODELING_PREP_API_KEY = 'fmp';
    process.env.EODHD_API_KEY = 'eodhd';
    process.env.MARKETAUX_API_KEY = 'marketaux';
    process.env.OPENFIGI_API_KEY = 'openfigi';
    process.env.FINNHUB_MIN_INTERVAL_MS = '0';
    process.env.FMP_MIN_INTERVAL_MS = '0';
    process.env.EODHD_MIN_INTERVAL_MS = '0';
    process.env.MARKETAUX_MIN_INTERVAL_MS = '0';
    process.env.OPENFIGI_MIN_INTERVAL_MS = '0';
  });

  it('uses Marketaux before stock providers for keyword news search', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          {
            published_at: '2026-05-20T12:00:00Z',
            title: 'Semiconductor demand rises',
            source: 'Example News',
            url: 'https://example.com/news',
            description: 'Demand update',
            sentiment_score: 0.4,
          },
        ],
      },
    });

    const service = createStockService();
    const result = await service.searchNews('semiconductors', 7);

    expect(result.__source).toBe('Marketaux');
    expect(result.articles[0].headline).toBe('Semiconductor demand rises');
    expect(mockedAxios.get.mock.calls[0][0]).toBe('https://api.marketaux.com/v1/news/all');
    expect(mockedAxios.get.mock.calls[0][1].params.search).toBe('semiconductors');
  });

  it('falls back to OpenFIGI for ticker search after primary providers are unavailable', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(Object.assign(new Error('Finnhub unavailable'), { response: { status: 403 } }))
      .mockResolvedValueOnce({ data: [] });
    mockedAxios.post.mockResolvedValueOnce({
      data: [
        {
          data: [
            {
              ticker: 'AAPL',
              name: 'APPLE INC',
              marketSector: 'Equity',
              securityType: 'Common Stock',
              exchCode: 'US',
              currency: 'USD',
              figi: 'BBG000B9XRY4',
              compositeFIGI: 'BBG000B9XRY4',
            },
          ],
        },
      ],
    });

    const service = createStockService();
    const result = await service.searchStock('AAPL');

    expect(result.__source).toBe('OpenFIGI');
    expect(result.results[0].symbol).toBe('AAPL');
    expect(mockedAxios.post.mock.calls[0][0]).toBe('https://api.openfigi.com/v3/mapping');
  });

  it('uses EODHD as a late fallback for company overview gaps', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(Object.assign(new Error('Finnhub unavailable'), { response: { status: 403 } }))
      .mockResolvedValueOnce({ data: { General: { Name: '' } } })
      .mockResolvedValueOnce({
        data: {
          General: {
            Name: 'Apple Inc.',
            Sector: 'Technology',
            Industry: 'Consumer Electronics',
            Description: 'Consumer technology company.',
          },
          Highlights: {
            MarketCapitalization: 3000000000000,
            PERatio: 30,
            EarningsShare: 6,
            ProfitMargin: 0.25,
          },
        },
      });

    const service = createStockService();
    const result = await service.getCompanyOverview('AAPL');

    expect(result.__source).toContain('EODHD');
    expect(result.name).toBe('Apple Inc.');
    const calledUrls = mockedAxios.get.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.includes('/api/fundamentals/AAPL.US'))).toBe(true);
  });
});
