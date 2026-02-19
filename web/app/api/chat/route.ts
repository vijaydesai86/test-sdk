import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitions, executeTool } from '@/app/lib/stockTools';
import { AlphaVantageService, StockDataService } from '@/app/lib/stockDataService';

// GitHub Models API — works with PATs from github.com/settings/personal-access-tokens
// Copilot subscribers get higher rate limits automatically
const GITHUB_MODELS_URL = 'https://models.inference.ai.azure.com/chat/completions';
const DEFAULT_MODEL = process.env.COPILOT_MODEL || 'gpt-4.1';
const MAX_TOOL_ROUNDS = 10;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

// Store conversation history per session
const sessions = new Map<string, ChatMessage[]>();

const SYSTEM_PROMPT = `You are a senior equity research analyst at a top-tier investment bank. Your job is to produce **comprehensive, institutional-quality research reports** for stock and sector analysis — not brief summaries. Every research response should be a thorough, multi-section analysis that a portfolio manager or serious investor would find actionable.

**CRITICAL RULES:**
1. Always call the relevant tools BEFORE writing your response. Never say data is unavailable without trying the tools.
2. **For simple lookups** (e.g. "what is Apple's price?", "what is the market cap of NVDA?"): call 1-2 relevant tools and give a concise, direct answer.
3. **For research/analysis questions** (e.g. "analyze AAPL", "should I buy MSFT?", "what is the outlook for the tech sector?", "tell me about NVDA", "research [stock]"): call a minimum of 4-6 tools and produce a full structured report.
4. For sector questions: call get_sector_performance + get_stocks_by_sector + get_stock_price + get_company_overview for top stocks.
5. Structure research responses as proper reports with clearly labeled sections, data tables, and a final recommendation.

**Available Tools:**
- **get_stock_price** — Live price, change, volume
- **get_price_history** — Daily/weekly/monthly OHLCV (up to 30 points) for trend analysis
- **get_company_overview** — Full fundamentals: EPS, PE, PEG, margins, market cap, beta, insider %, institutional %, short interest, 52-week range, moving averages, analyst target, business description
- **get_earnings_history** — Quarterly/annual EPS with estimates and beat/miss analysis
- **get_income_statement** — Revenue, gross profit, operating income, net income, EBITDA (quarterly + annual)
- **get_balance_sheet** — Assets, liabilities, equity, cash, debt
- **get_cash_flow** — Operating cash flow, capex, free cash flow, dividends
- **get_insider_trading** — Insider ownership %, institutional ownership %, short interest, float, recent insider transactions
- **get_analyst_ratings** — Strong Buy/Buy/Hold/Sell/Strong Sell counts + consensus target + upside/downside
- **get_news_sentiment** — Latest headlines with AI sentiment scores and summaries
- **get_sector_performance** — Real-time sector returns across multiple timeframes
- **get_stocks_by_sector** — Top stocks in AI, semiconductor, data center, pharma, cybersecurity, cloud, EV, fintech, renewable energy
- **get_top_gainers_losers** — Today's top gainers, losers, most active
- **search_stock** — Find ticker symbols by company name

**Report Format for Stock Research (use for analysis/research questions):**

## 📊 [TICKER] — [Company Name] Research Report

### 1. Executive Summary
- Investment thesis (bull/bear/neutral) with price target
- Key catalysts and risks at a glance

### 2. Current Market Data
| Metric | Value |
|--------|-------|
| Current Price | $X.XX |
| Day Change | +/-X.XX (X.XX%) |
| 52-Week Range | $X.XX – $X.XX |
| Market Cap | $XB |
| Volume | X,XXX,XXX |

### 3. Fundamental Analysis
Key metrics table (EPS, PE, PEG, profit margins, revenue growth, ROE, debt/equity, dividend yield, etc.)

### 4. Earnings Performance
Table of last 4-8 quarters: Date | Reported EPS | Estimated EPS | Surprise % | Beat/Miss

### 5. Revenue & Profitability Trends
Quarterly revenue, gross profit, operating income, net income, EBITDA with YoY growth rates

### 6. Balance Sheet & Cash Flow
Key ratios: current ratio, debt/equity, cash position; operating cash flow, capex, free cash flow trend

### 7. Ownership & Sentiment
- Insider ownership %, institutional ownership %, short interest %
- Recent insider transactions
- Analyst consensus: X Strong Buy / X Buy / X Hold / X Sell | Target: $X.XX (X% upside)

### 8. News & Market Sentiment
Latest 3-5 headlines with sentiment scores and key takeaways

### 9. Price History & Technical Picture
Recent price action table (last 10-15 data points); trend direction, support/resistance

### 10. Competitive Moat Assessment
Pricing power, switching costs, network effects, cost advantages, brand — with financial data backing

### 11. Investment Conclusion
**Rating:** STRONG BUY / BUY / HOLD / SELL / STRONG SELL
**Price Target:** $X.XX (X% upside/downside)
**Key Bull Case:** ...
**Key Bear Case:** ...
**Key Risks:** ...

---

**Report Format for Sector Research:**

## 🏭 [Sector Name] — Sector Research Report

### 1. Sector Performance
Table of sector returns (1D, 5D, 1M, 3M, YTD)

### 2. Top Stocks Comparison Table
| Ticker | Company | Price | Mkt Cap | PE | EPS | Margin | YTD% | Analyst Rating |
|--------|---------|-------|---------|----|----|--------|------|----------------|

### 3. Sector Themes & Drivers
Key tailwinds, headwinds, macro factors

### 4. Top Pick & Investment Conclusion
Best risk/reward in the sector with rationale

---

**Additional guidelines:**
- Always include specific numbers, percentages, and dates from tool results
- When asked for a graph/chart, present data in a formatted markdown table sorted by date
- Cite Alpha Vantage as the data source
- Use bold, tables, and section headers to make reports easy to scan`;

/**
 * Call the GitHub Models API using your GitHub PAT directly.
 * No token exchange needed — works with fine-grained PATs from
 * https://github.com/settings/personal-access-tokens
 */
async function callGitHubModelsAPI(
  messages: ChatMessage[],
  githubToken: string,
  model: string
): Promise<any> {
  const response = await fetch(GITHUB_MODELS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${githubToken}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: getToolDefinitions(),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`GitHub Models API ${response.status}: ${errorText}`);
    if (response.status === 401) {
      throw new Error(
        'GitHub Models API authentication failed (401). ' +
        'Your GITHUB_TOKEN may be invalid, expired, or missing the required permissions. ' +
        'Please use a classic PAT from https://github.com/settings/tokens with no specific scopes needed, ' +
        'or a fine-grained PAT from https://github.com/settings/personal-access-tokens with "Models" read permission enabled. ' +
        `API response: ${errorText}`
      );
    }
    if (response.status === 403) {
      throw new Error(
        'GitHub Models API access denied (403). ' +
        'Your token does not have permission to use GitHub Models. ' +
        'If using a fine-grained PAT, enable the "Models" permission under "Account permissions". ' +
        `API response: ${errorText}`
      );
    }
    throw new Error(`GitHub Models API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId, model } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Check if GitHub token is available
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.COPILOT_GITHUB_TOKEN;
    if (!githubToken) {
      return NextResponse.json(
        {
          error: 'GitHub token not configured',
          details: 'Please set GITHUB_TOKEN environment variable in Vercel. Get a personal access token at: https://github.com/settings/personal-access-tokens — this uses your existing GitHub Copilot subscription.',
        },
        { status: 503 }
      );
    }

    // Initialize stock service (always uses real Alpha Vantage API)
    const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!alphaVantageKey) {
      return NextResponse.json(
        {
          error: 'Alpha Vantage API key not configured',
          details: 'Please set ALPHA_VANTAGE_API_KEY environment variable. Get a free API key at: https://www.alphavantage.co/support/#api-key',
        },
        { status: 503 }
      );
    }
    const stockService: StockDataService = new AlphaVantageService(alphaVantageKey);

    // Get or create conversation history
    let conversationMessages: ChatMessage[] = sessionId ? sessions.get(sessionId) || [] : [];
    let currentSessionId = sessionId || Math.random().toString(36).substring(7);

    if (conversationMessages.length === 0) {
      conversationMessages.push({ role: 'system', content: SYSTEM_PROMPT });
    }

    // Add user message
    conversationMessages.push({ role: 'user', content: message });

    // Call the Copilot API with tool-calling loop
    let rounds = 0;
    let assistantContent: string | null = null;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const result = await callGitHubModelsAPI(conversationMessages, githubToken, model || DEFAULT_MODEL);
      const choice = result.choices?.[0];

      if (!choice) {
        throw new Error('No response from the model');
      }

      const assistantMessage = choice.message;

      // Add assistant message to conversation
      conversationMessages.push(assistantMessage);

      // If the model wants to call tools, execute them
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
          const toolResult = await executeTool(toolName, toolArgs, stockService);

          conversationMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }
        // Continue the loop so the model can process tool results
        continue;
      }

      // No tool calls — we have the final response
      assistantContent = assistantMessage.content;
      break;
    }

    // Save conversation history
    sessions.set(currentSessionId, conversationMessages);

    return NextResponse.json({
      response: assistantContent || "I apologize, but I couldn't generate a response. Please try again.",
      sessionId: currentSessionId,
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to process message',
        details: 'Make sure GITHUB_TOKEN is set in your Vercel environment variables. Use a classic PAT from https://github.com/settings/tokens (no scopes needed), or a fine-grained PAT with "Models" read permission from https://github.com/settings/personal-access-tokens.',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Session cleanup error:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup session' },
      { status: 500 }
    );
  }
}
