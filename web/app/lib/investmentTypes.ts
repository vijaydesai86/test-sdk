export type ActionLabel = 'Buy' | 'Hold' | 'Watch' | 'Sell';
export type DecisionAction = 'Initiate' | 'Add' | 'Hold' | 'Trim' | 'Exit' | 'Wait';
export type ConfidenceLabel = 'High' | 'Medium' | 'Low';
export type RiskTolerance = 'low' | 'medium' | 'high';
export type HoldingHorizon = 'weeks' | 'months' | 'years';
export type OwnershipStatus = 'watching' | 'owned' | 'exited';
export type ConvictionLabel = 'low' | 'medium' | 'high';
export type FreshnessClass = 'fresh' | 'aging' | 'stale';

export interface DataTrustEntry {
  key: string;
  label: string;
  provider: string;
  fetchedAt: string;
  asOf?: string | null;
  freshness: FreshnessClass;
  ageMinutes: number;
  ttlMinutes: number;
  notes?: string[];
}

export interface DataTrustSummary {
  entries: DataTrustEntry[];
  criticalFresh: boolean;
  staleLabels: string[];
}

export interface PortfolioProfile {
  riskTolerance: RiskTolerance;
  holdingHorizon: HoldingHorizon;
  maxPositionWeight: number | null;
  targetCashPct: number | null;
  concentrationLimit: number | null;
  strategyNotes: string;
  updatedAt?: string;
}

export interface WatchlistPositionMeta {
  ownershipStatus: OwnershipStatus;
  currentWeight: number | null;
  targetWeight: number | null;
  maxWeight: number | null;
  costBasis: number | null;
  conviction: ConvictionLabel;
  thesis: string;
  desiredEntryMin: number | null;
  desiredEntryMax: number | null;
  trimAbove: number | null;
  invalidation: string;
  reviewDate: string | null;
  lastReviewedAt: string | null;
  notes: string;
}

export interface DecisionSnapshot {
  action: DecisionAction;
  confidence: ConfidenceLabel;
  freshness: FreshnessClass;
  overallScore: number | null;
  qualityScore: number | null;
  valuationScore: number | null;
  technicalScore: number | null;
  portfolioFitScore: number | null;
  whyNow: string[];
  whyNot: string[];
  missingInputs: string[];
  changed: string[];
  summary: string;
  portfolioImpact: string;
  invalidation: string;
  nextTrigger: string;
}

export interface CompanyThesisRecord {
  symbol: string;
  thesis: string;
  conviction: ConvictionLabel;
  invalidation: string;
  lastAction: DecisionAction;
  updatedAt: string;
  summary?: string;
}

export interface DecisionJournalRecord {
  id: string;
  sessionId?: string;
  symbol?: string;
  action: DecisionAction;
  confidence: ConfidenceLabel;
  summary: string;
  score: number | null;
  price: number | null;
  createdAt: string;
}

export interface ResearchSessionRecord {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchMessageRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  createdAt: string;
}

export interface ResearchMemoryContext {
  summary: string;
  theses: CompanyThesisRecord[];
  recentDecisions: DecisionJournalRecord[];
}
