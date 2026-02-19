import { NextRequest, NextResponse } from 'next/server';
import { CopilotClient } from '@github/copilot-sdk';
import { createStockTools } from '@/app/lib/stockTools';
import { AlphaVantageService, MockStockDataService } from '@/app/lib/stockDataService';

// Store sessions in memory (in production, use a proper session store)
const sessions = new Map<string, any>();
let copilotClient: CopilotClient | null = null;

async function getCopilotClient() {
  if (!copilotClient) {
    copilotClient = new CopilotClient();
    await copilotClient.start();
  }
  return copilotClient;
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

    // Initialize stock service
    const useRealAPI = process.env.USE_REAL_API === 'true' && process.env.ALPHA_VANTAGE_API_KEY;
    const stockService = useRealAPI
      ? new AlphaVantageService(process.env.ALPHA_VANTAGE_API_KEY)
      : new MockStockDataService();

    // Get or create session
    let session = sessionId ? sessions.get(sessionId) : null;
    
    if (!session) {
      const client = await getCopilotClient();
      session = await client.createSession({
        model: 'gpt-4o',
      });

      const stockTools = createStockTools(stockService);
      session.setTools(stockTools);

      const newSessionId = Math.random().toString(36).substring(7);
      sessions.set(newSessionId, session);

      // Store session ID in response
      session._sessionId = newSessionId;
    }

    // Send message and get response
    const response = await session.sendAndWait({
      prompt: message,
    });

    if (response && response.data && response.data.content) {
      return NextResponse.json({
        response: response.data.content,
        sessionId: session._sessionId,
      });
    } else {
      return NextResponse.json({
        response: "I apologize, but I couldn't generate a response. Please try again.",
        sessionId: session._sessionId,
      });
    }
  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to process message',
        details: 'Make sure GitHub Copilot CLI is installed and you are authenticated.'
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      await session.destroy();
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
