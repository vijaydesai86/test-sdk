"""
Vercel Python Serverless Function — yfinance proxy for the Stock Research Assistant.

Deployed automatically by Vercel alongside the Next.js app.
Accessible at:  https://<your-app>.vercel.app/api/yf/<endpoint>

No separate server required. Set YFINANCE_PROXY_URL=/api/yf in Vercel env vars.

Route matching:
  vercel.json rewrites  /api/yf/:endpoint?<qs>  →  /api/yf?_path=:endpoint&<qs>
  This handler reads _path to dispatch to the correct yfinance call.

Note: Yahoo Finance may rate-limit detailed endpoints (quoteSummary) from
Vercel cloud IPs. Price and price-history (chart-based) always work.
Unavailable endpoints return {"error":"..."} and are silently suppressed
by the TypeScript safeFetch layer via the "Unavailable via YFinance" prefix.
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
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


def _health(_p):
    return {'ok': True}


def _price(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    fi = t.fast_info
    raw_price = getattr(fi, 'last_price', None)
    raw_prev = getattr(fi, 'previous_close', None)
    try:
        price_val = float(raw_price) if raw_price is not None else None
        prev = float(raw_prev) if raw_prev is not None else None
    except (TypeError, ValueError):
        price_val, prev = None, None
    change = round(price_val - prev, 4) if price_val is not None and prev is not None else None
    change_pct = f"{round(change / prev * 100, 2)}%" if change is not None and prev else 'N/A'
    return {
        'symbol': symbol,
        'price': str(price_val) if price_val is not None else None,
        'change': str(change) if change is not None else None,
        'changePercent': change_pct,
        'high': str(getattr(fi, 'day_high', None)),
        'low': str(getattr(fi, 'day_low', None)),
        'open': str(getattr(fi, 'open', None)),
        'previousClose': str(prev) if prev is not None else None,
    }


def _price_history(p):
    symbol = p.get('symbol', '').upper()
    range_val = p.get('range', '1y').lower()
    period, interval = PERIOD_MAP.get(range_val, ('1y', '1wk'))
    t = yf.Ticker(symbol)
    hist = t.history(period=period, interval=interval)
    prices = [
        {
            'date': str(idx.date()),
            'open': float(row['Open']) if row['Open'] is not None else None,
            'high': float(row['High']) if row['High'] is not None else None,
            'low': float(row['Low']) if row['Low'] is not None else None,
            'close': float(row['Close']) if row['Close'] is not None else None,
            'volume': int(row['Volume']) if row['Volume'] is not None else None,
        }
        for idx, row in hist.iterrows()
    ]
    return {'symbol': symbol, 'prices': prices}


def _overview(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    i = t.info
    if not i or not (i.get('longName') or i.get('shortName')):
        raise ValueError(f'No overview data for {symbol}')
    return {
        'symbol': symbol,
        'name': i.get('longName') or i.get('shortName'),
        'description': i.get('longBusinessSummary'),
        'sector': i.get('sector'),
        'industry': i.get('industry'),
        'country': i.get('country'),
        'exchange': i.get('exchange'),
        'marketCap': i.get('marketCap'),
        'peRatio': i.get('trailingPE'),
        'forwardPE': i.get('forwardPE'),
        'pbRatio': i.get('priceToBook'),
        'dividendYield': i.get('dividendYield'),
        'eps': i.get('trailingEps'),
        'beta': i.get('beta'),
        'website': i.get('website'),
        'employees': i.get('fullTimeEmployees'),
    }


def _financials(p):
    symbol = p.get('symbol', '').upper()
    t = yf.Ticker(symbol)
    i = t.info
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
    i = t.info
    return {
        'symbol': symbol,
        'targetLow': i.get('targetLowPrice'),
        'targetHigh': i.get('targetHighPrice'),
        'targetMean': i.get('targetMeanPrice'),
        'targetMedian': i.get('targetMedianPrice'),
        'recommendationMean': i.get('recommendationMean'),
        'recommendationKey': i.get('recommendationKey'),
        'numberOfAnalysts': i.get('numberOfAnalystOpinions'),
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
    i = t.info
    return {
        'symbol': symbol,
        'targetLow': i.get('targetLowPrice'),
        'targetHigh': i.get('targetHighPrice'),
        'targetMean': i.get('targetMeanPrice'),
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
            self._json(500, {'error': str(e)})

    def _json(self, status: int, data: dict):
        body = json.dumps(data, default=str).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # suppress default access log noise
        pass
