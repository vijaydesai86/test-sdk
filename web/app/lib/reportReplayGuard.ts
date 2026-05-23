import { inferReportFallback } from './reportIntent';

const REPORT_TOOL_NAMES = new Set([
  'generate_stock_report',
  'generate_comparison_report',
  'generate_research_report',
  'generate_watchlist_daily_report',
]);

const COMPLETED_REPORT_PREFIX = 'Completed previous report request; do not rerun';

export type ReplayGuardMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
};

export type ReplayGuardToolCall = {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
};

export type ReportToolPlan = {
  toolCalls: ReplayGuardToolCall[];
  skippedReportToolCallIds: Set<string>;
  allowedReportToolName?: string;
};

export function isReportToolName(toolName: string): boolean {
  return REPORT_TOOL_NAMES.has(toolName);
}

export function isReportGeneratingRequest(content: string | null | undefined): boolean {
  return Boolean(content && inferReportFallback(content));
}

export function formatCompletedReportRequest(content: string): string {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  return `${COMPLETED_REPORT_PREFIX}: ${cleaned}`;
}

export function neutralizeHistoricalReportRequests<T extends ReplayGuardMessage>(messages: T[]): T[] {
  return messages.map((message) => {
    if (message.role !== 'user' || !isReportGeneratingRequest(message.content)) {
      return message;
    }
    return {
      ...message,
      role: 'assistant',
      content: formatCompletedReportRequest(message.content || ''),
    };
  });
}

export function formatRecentRequestForMemory(content: string): string {
  return isReportGeneratingRequest(content)
    ? formatCompletedReportRequest(content)
    : `Recent user request: ${content}`;
}

export function planReportToolExecution(
  toolCalls: ReplayGuardToolCall[],
  currentUserMessage: string,
  options: { resolvedSymbol?: string; reportAlreadySaved?: boolean } = {}
): ReportToolPlan {
  const reportCalls = toolCalls.filter((toolCall) => isReportToolName(toolCall.function.name));
  if (reportCalls.length === 0) {
    return { toolCalls, skippedReportToolCallIds: new Set() };
  }

  if (options.reportAlreadySaved) {
    return {
      toolCalls,
      skippedReportToolCallIds: new Set(reportCalls.map((toolCall) => toolCall.id)),
    };
  }

  if (reportCalls.length === 1) {
    return {
      toolCalls,
      skippedReportToolCallIds: new Set(),
      allowedReportToolName: reportCalls[0].function.name,
    };
  }

  const currentIntent = inferReportFallback(currentUserMessage, options.resolvedSymbol);
  const preferredReportCall = currentIntent
    ? reportCalls.find((toolCall) => toolCall.function.name === currentIntent.toolName)
    : undefined;
  const allowedReportCall = preferredReportCall || reportCalls[0];
  const skippedReportToolCallIds = new Set(
    reportCalls
      .filter((toolCall) => toolCall.id !== allowedReportCall.id)
      .map((toolCall) => toolCall.id)
  );

  return {
    toolCalls,
    skippedReportToolCallIds,
    allowedReportToolName: allowedReportCall.function.name,
  };
}
