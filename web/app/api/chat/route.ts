import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitions, executeTool } from '@/app/lib/stockTools';
import { AlphaVantageService, MockStockDataService, StockDataService } from '@/app/lib/stockDataService';

// GitHub Models API — works with PATs from github.com/settings/personal-access-tokens
// Copilot subscribers get higher rate limits automatically
const GITHUB_MODELS_URL = 'https://models.inference.ai.azure.com/chat/completions';
const DEFAULT_MODEL = process.env.COPILOT_MODEL || 'gpt-4.1';
const MAX_TOOL_ROUNDS = 5;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

// Store conversation history per session
const sessions = new Map<string, ChatMessage[]>();

const SYSTEM_PROMPT = `You are a helpful stock information assistant. You can look up current stock prices, price history, company fundamentals (EPS, PE ratio, market cap, etc.), insider trading data, analyst ratings, and search for stock symbols. Use the available tools to fetch real-time data when answering questions about stocks.`;

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
