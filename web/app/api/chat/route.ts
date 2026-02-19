import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitions, executeTool } from '@/app/lib/stockTools';
import { AlphaVantageService, MockStockDataService, StockDataService } from '@/app/lib/stockDataService';

// GitHub Copilot API — uses your existing Copilot subscription
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const MODEL = process.env.COPILOT_MODEL || 'gpt-4.1';
const MAX_TOOL_ROUNDS = 5;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

interface CopilotToken {
  token: string;
  expiresAt: number;
  apiUrl: string;
}

// Cache the Copilot token so we don't re-fetch on every request
let cachedCopilotToken: CopilotToken | null = null;

// Store conversation history per session
const sessions = new Map<string, ChatMessage[]>();

const SYSTEM_PROMPT = `You are a helpful stock information assistant. You can look up current stock prices, price history, company fundamentals (EPS, PE ratio, market cap, etc.), insider trading data, analyst ratings, and search for stock symbols. Use the available tools to fetch real-time data when answering questions about stocks.`;

/**
 * Exchange a GitHub PAT for a short-lived Copilot API token.
 * This is exactly what the Copilot SDK/CLI does internally.
 */
async function getCopilotToken(githubPAT: string): Promise<CopilotToken> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedCopilotToken && cachedCopilotToken.expiresAt > (Date.now() / 1000) + 60) {
    return cachedCopilotToken;
  }

  const response = await fetch(COPILOT_TOKEN_URL, {
    headers: {
      'Authorization': `token ${githubPAT}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      throw new Error('Invalid GitHub token. Please check your GITHUB_TOKEN in Vercel environment variables.');
    }
    if (response.status === 403) {
      throw new Error('Your GitHub account does not have an active Copilot subscription. Please ensure GitHub Copilot is enabled on your account.');
    }
    throw new Error(`Failed to get Copilot token (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  cachedCopilotToken = {
    token: data.token,
    expiresAt: data.expires_at,
    apiUrl: data.endpoints?.api || 'https://api.individual.githubcopilot.com',
  };

  return cachedCopilotToken;
}

/**
 * Call the GitHub Copilot chat completions API using your Copilot subscription.
 */
async function callCopilotAPI(
  messages: ChatMessage[],
  githubPAT: string
): Promise<any> {
  const copilotToken = await getCopilotToken(githubPAT);

  const response = await fetch(`${copilotToken.apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${copilotToken.token}`,
      'Editor-Version': 'vscode/1.95.0',
      'Editor-Plugin-Version': 'copilot/1.0.0',
      'Openai-Intent': 'conversation-panel',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: getToolDefinitions(),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Invalidate cached token on auth errors so next request re-fetches
    if (response.status === 401) {
      cachedCopilotToken = null;
    }
    throw new Error(`Copilot API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId } = await request.json();

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

    // Initialize stock service
    const useRealAPI = process.env.USE_REAL_API === 'true' && !!process.env.ALPHA_VANTAGE_API_KEY;
    const stockService: StockDataService = useRealAPI
      ? new AlphaVantageService(process.env.ALPHA_VANTAGE_API_KEY)
      : new MockStockDataService();

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
      const result = await callCopilotAPI(conversationMessages, githubToken);
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
        details: 'Make sure GITHUB_TOKEN is set in your Vercel environment variables and you have an active GitHub Copilot subscription. Create a token at: https://github.com/settings/personal-access-tokens',
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
