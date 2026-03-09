"""
Vercel Python Serverless Function — yfinance proxy for the Stock Research Assistant.

Deployed automatically by Vercel alongside the Next.js app.
Accessible at:  https://<your-app>.vercel.app/api/yf

No separate server required. Set YFINANCE_PROXY_URL=/api/yf in Vercel env vars.

Route dispatching:
  The TypeScript YFinanceService passes the endpoint name via the _path query parameter,
  e.g. GET /api/yf?_path=price&symbol=AAPL  (no URL rewrite rules required).
  This handler reads _path to dispatch to the correct yfinance call.

Note: Yahoo Finance may rate-limit detailed endpoints (quoteSummary) from
Vercel cloud IPs. Price and price-history (chart-based) always work.
Unavailable endpoints return {"error":"..."} and are silently suppressed
by the TypeScript safeFetch layer via the "Unavailable via YFinance" prefix.
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import math
import yfinance as yf

PERIOD_MAP = {
    '1w': ('7d', '1d'),
    '1m': ('1mo', '1d'),
    '3m': ('3mo', '1d'),
    '6m': ('6mo', '1d'),
    '1y': ('1y', '1wk'),
    '3y': ('3y', '1wk'),
    '5y': ('5y', '1wk'),
    'max': ('max', '1mo'),
    'all': ('max', '1mo'),
    'weekly': ('1y', '1wk'),
    'monthly': ('1y', '1mo'),
    'daily': ('1y', '1d'),
}


def _safe(fn):
    """Run fn(), return None on error — used for optional yfinance fields."""
    try:
        return fn()
    except Exception:
        return None


def _safe_float(v):
    """Convert v to float, returning None for NaN/Inf/None/errors."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


def _safe_int(v):
    """Convert v to int, returning None for NaN/Inf/None/errors."""
    if v is None:
        return None
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return int(f)
    except (TypeError, ValueError):
        return None


def _health(_p):
    return {'ok': True}


def _price(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    # Use chart API (t.history) — works reliably from Vercel/cloud IPs.
    # fast_info / quoteSummary may be blocked by Yahoo Finance on cloud IPs.
    hist = t.history(period='5d', interval='1d')
    if hist.empty:
        raise ValueError(f'No price data available for {symbol}')
    last = hist.iloc[-1]
    prev = hist.iloc[-2] if len(hist) >= 2 else last
    price = _safe_float(last['Close'])
    prev_close = _safe_float(prev['Close'])
    if price is None:
        raise ValueError(f'No price data available for {symbol}')
    change = round(price - prev_close, 4) if prev_close is not None else None
    change_pct = f"{round(change / prev_close * 100, 2)}%" if change is not None and prev_close else 'N/A'
    return {
        'symbol': symbol,
        'price': str(price),
        'change': str(change) if change is not None else None,
        'changePercent': change_pct,
        'latestTradingDay': str(hist.index[-1].date()),
    }


def _price_history(p):
    symbol = p.get('symbol', '').upper()
    range_val = p.get('range', '1y').lower()
    period, interval = PERIOD_MAP.get(range_val, ('1y', '1wk'))
    t = yf.Ticker(symbol)
    hist = t.history(period=period, interval=interval)
    if hist.empty:
        return {'symbol': symbol, 'prices': []}
    # _safe_float / _safe_int convert pandas NaN → None (null in JSON).
    # The plain `is not None` check does NOT catch pandas NaN, so float/int
    # conversions would either raise ValueError or produce invalid JSON (NaN).
    prices = [
        {
            'date': str(idx.date()),
            'open': _safe_float(row['Open']),
            'high': _safe_float(row['High']),
            'low': _safe_float(row['Low']),
            'close': _safe_float(row['Close']),
            'volume': _safe_int(row['Volume']),
        }
        for idx, row in hist.iterrows()
    ]
    return {'symbol': symbol, 'prices': prices}


def _overview(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)

    # Try t.info first — provides full financial data but quoteSummary is
    # blocked by Yahoo Finance on some cloud IPs (Vercel, AWS, GCP, etc.).
    i = {}
    try:
        info = t.info
        if info and (info.get('longName') or info.get('shortName')):
            i = info
    except Exception:
        pass

    # When t.info is unavailable, fall back to t.fast_info for basic metrics.
    # fast_info uses a lightweight quote endpoint that works from cloud IPs.
    fi = None
    if not i:
        try:
            fi = t.fast_info
        except Exception:
            pass

    if not i and fi is None:
        raise ValueError(f'Unavailable via YFinance: company data not accessible for {symbol}')

    # Safely read a fast_info attribute (handles camelCase/snake_case naming variations
    # across yfinance versions, and catches any property-access exceptions).
    def fi_get(*attrs):
        for attr in attrs:
            v = _safe(lambda a=attr: getattr(fi, a))
            if v is not None:
                return v
        return None

    return {
        'symbol': symbol,
        'name': i.get('longName') or i.get('shortName') or symbol,
        'description': i.get('longBusinessSummary'),
        'sector': i.get('sector'),
        'industry': i.get('industry'),
        'country': i.get('country'),
        'exchange': i.get('exchange') or (fi_get('exchange') if fi else None),
        # Match AlphaVantage field names used by reportGenerator.ts / stockTools.ts
        'marketCapitalization': i.get('marketCap') or (fi_get('marketCap', 'market_cap') if fi else None),
        'revenueTTM': i.get('totalRevenue'),
        'grossProfitTTM': i.get('grossProfits'),
        'eps': i.get('trailingEps'),
        'peRatio': i.get('trailingPE'),
        'forwardPE': i.get('forwardPE'),
        'pegRatio': i.get('pegRatio'),
        'bookValue': i.get('bookValue'),
        'dividendPerShare': i.get('dividendRate'),
        'dividendYield': i.get('dividendYield'),
        '52WeekHigh': i.get('fiftyTwoWeekHigh') or (fi_get('yearHigh', 'year_high') if fi else None),
        '52WeekLow': i.get('fiftyTwoWeekLow') or (fi_get('yearLow', 'year_low') if fi else None),
        '50DayMovingAverage': i.get('fiftyDayAverage') or (fi_get('fiftyDayAverage', 'fifty_day_average') if fi else None),
        '200DayMovingAverage': i.get('twoHundredDayAverage') or (fi_get('twoHundredDayAverage', 'two_hundred_day_average') if fi else None),
        'beta': i.get('beta'),
        'profitMargin': i.get('profitMargins'),
        'operatingMargin': i.get('operatingMargins'),
        'returnOnAssets': i.get('returnOnAssets'),
        'returnOnEquity': i.get('returnOnEquity'),
        'revenuePerShare': i.get('revenuePerShare'),
        'quarterlyRevenueGrowth': i.get('revenueGrowth'),
        'quarterlyEarningsGrowth': i.get('earningsQuarterlyGrowth'),
        'sharesOutstanding': i.get('sharesOutstanding') or (fi_get('shares') if fi else None),
        'sharesFloat': i.get('floatShares'),
        'percentInsiders': i.get('heldPercentInsiders'),
        'percentInstitutions': i.get('heldPercentInstitutions'),
        'shortRatio': i.get('shortRatio'),
        'shortPercentFloat': i.get('shortPercentOfFloat'),
        'analystTargetPrice': i.get('targetMeanPrice'),
        'website': i.get('website'),
        'employees': i.get('fullTimeEmployees'),
        'exDividendDate': i.get('exDividendDate'),
    }


def _financials(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    i = _safe(lambda: t.info) or {}
    return {
        'symbol': symbol,
        'revenueGrowth': i.get('revenueGrowth'),
        'grossMargins': i.get('grossMargins'),
        'operatingMargins': i.get('operatingMargins'),
        'profitMargins': i.get('profitMargins'),
        'returnOnEquity': i.get('returnOnEquity'),
        'returnOnAssets': i.get('returnOnAssets'),
        'debtToEquity': i.get('debtToEquity'),
        'currentRatio': i.get('currentRatio'),
        'quickRatio': i.get('quickRatio'),
    }


def _insider(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    df = _safe(lambda: t.insider_transactions)
    if df is None or df.empty:
        return {'symbol': symbol, 'transactions': []}
    return {'symbol': symbol, 'transactions': json.loads(df.head(20).to_json(orient='records', date_format='iso'))}


def _analyst_ratings(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    i = _safe(lambda: t.info) or {}
    # Return field names matching AlphaVantageService.getAnalystRatings() output.
    return {
        'symbol': symbol,
        'analystTargetPrice': i.get('targetMeanPrice'),
        'targetLow': i.get('targetLowPrice'),
        'targetHigh': i.get('targetHighPrice'),
        'targetMedian': i.get('targetMedianPrice'),
        'recommendationMean': i.get('recommendationMean'),
        'recommendationKey': i.get('recommendationKey'),
        'numberOfAnalysts': i.get('numberOfAnalystOpinions'),
        # Alpha Vantage-style consensus counts — Yahoo Finance does not provide
        # the individual strongBuy/buy/hold/sell/strongSell breakdown via info,
        # so these are not available. reportGenerator.ts handles None gracefully.
        'strongBuy': None,
        'buy': None,
        'hold': None,
        'sell': None,
        'strongSell': None,
    }


def _analyst_recommendations(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    df = _safe(lambda: t.recommendations)
    if df is None or df.empty:
        return {'symbol': symbol, 'recommendations': []}
    return {'symbol': symbol, 'recommendations': json.loads(df.head(20).to_json(orient='records', date_format='iso'))}


def _price_targets(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    i = _safe(lambda: t.info) or {}
    # Match FinnhubService.getPriceTargets() field names (targetMean is the key field used by reports)
    return {
        'symbol': symbol,
        'targetMean': i.get('targetMeanPrice'),
        'targetHigh': i.get('targetHighPrice'),
        'targetLow': i.get('targetLowPrice'),
        'targetMedian': i.get('targetMedianPrice'),
    }


def _peers(p):
    symbol = p.get('symbol', '').upper()
    return {'symbol': symbol, 'peers': []}


def _search(p):
    query = p.get('query', '')
    results = _safe(lambda: yf.Search(query).quotes) or []
    return {'results': results[:10]}


def _earnings(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    df = _safe(lambda: t.quarterly_earnings)
    if df is None or df.empty:
        return {'symbol': symbol, 'earnings': []}
    return {'symbol': symbol, 'earnings': json.loads(df.reset_index().to_json(orient='records', date_format='iso'))}


def _income(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    df = _safe(lambda: t.quarterly_income_stmt)
    if df is None or df.empty:
        return {'symbol': symbol, 'incomeStatement': []}
    return {'symbol': symbol, 'incomeStatement': json.loads(df.T.reset_index().to_json(orient='records', date_format='iso'))}


def _balance_sheet(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    df = _safe(lambda: t.quarterly_balance_sheet)
    if df is None or df.empty:
        return {'symbol': symbol, 'balanceSheet': []}
    return {'symbol': symbol, 'balanceSheet': json.loads(df.T.reset_index().to_json(orient='records', date_format='iso'))}


def _cash_flow(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    df = _safe(lambda: t.quarterly_cashflow)
    if df is None or df.empty:
        return {'symbol': symbol, 'cashFlow': []}
    return {'symbol': symbol, 'cashFlow': json.loads(df.T.reset_index().to_json(orient='records', date_format='iso'))}


def _news_sentiment(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    news = _safe(lambda: t.news) or []
    return {'symbol': symbol, 'articles': news[:10]}


def _company_news(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    news = _safe(lambda: t.news) or []
    return {'symbol': symbol, 'articles': news[:20]}


def _search_news(p):
    query = p.get('query', '')
    results = _safe(lambda: yf.Search(query).news) or []
    return {'articles': results[:20]}


ROUTES = {
    'health': _health,
    'price': _price,
    'price-history': _price_history,
    'overview': _overview,
    'financials': _financials,
    'insider': _insider,
    'analyst-ratings': _analyst_ratings,
    'analyst-recommendations': _analyst_recommendations,
    'price-targets': _price_targets,
    'peers': _peers,
    'search': _search,
    'earnings': _earnings,
    'income': _income,
    'balance-sheet': _balance_sheet,
    'cash-flow': _cash_flow,
    'news-sentiment': _news_sentiment,
    'company-news': _company_news,
    'search-news': _search_news,
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        endpoint = params.get('_path', '').strip('/')

        fn = ROUTES.get(endpoint)
        if fn is None:
            self._json(404, {'error': f'Unknown endpoint: {endpoint}'})
            return
        try:
            result = fn(params)
            self._json(200, result)
        except Exception as e:
            # Print to stdout so errors appear in Vercel function logs.
            print(f'[yf] ERROR endpoint={endpoint} symbol={params.get("symbol", "?")} error={e}')
            self._json(500, {'error': str(e)})

    def _json(self, status: int, data: dict):
        try:
            # allow_nan=False ensures NaN/Inf raise ValueError rather than
            # silently producing invalid JSON tokens (NaN) that break JS parsing.
            body = json.dumps(data, default=str, allow_nan=False).encode('utf-8')
        except (ValueError, TypeError) as json_err:
            print(f'[yf] JSON serialization error: {json_err}')
            body = json.dumps({'error': f'JSON serialization error: {json_err}'}).encode('utf-8')
            status = 500
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # suppress default access log noise
        pass
