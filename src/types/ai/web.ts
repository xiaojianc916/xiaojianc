export const AI_WEB_SEARCH_INTENTS = [
  'official-docs',
  'api-reference',
  'error-debug',
  'best-practice',
  'release-notes',
  'general',
] as const;

export const AI_WEB_SEARCH_RECENCIES = ['any', 'day', 'week', 'month', 'year'] as const;

export const AI_WEB_SOURCE_TYPES = [
  'official',
  'docs',
  'github',
  'blog',
  'forum',
  'unknown',
] as const;

export type TAiWebSearchIntent = (typeof AI_WEB_SEARCH_INTENTS)[number];
export type TAiWebSearchRecency = (typeof AI_WEB_SEARCH_RECENCIES)[number];
export type TAiWebSourceType = (typeof AI_WEB_SOURCE_TYPES)[number];

export interface IAiWebSearchInput {
  query: string;
  intent: TAiWebSearchIntent;
  maxResults: number;
  recency?: TAiWebSearchRecency;
}

export interface IAiWebSearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceType: TAiWebSourceType;
  fetchedAt: string;
}

export interface IAiWebSearchPayload {
  results: IAiWebSearchResult[];
}

export interface IAiWebFetchInput {
  url: string;
  reason: string;
  maxBytes: number;
}

export interface IAiWebFetchResult {
  url: string;
  title: string;
  textRef: string;
  excerpt: string;
  bytes: number;
  fetchedAt: string;
  truncated: boolean;
}

export interface IAiWebFetchPayload {
  source: IAiWebFetchResult;
}

export const AI_WEB_ACTIVITY_STATES = [
  'searching',
  'fetching',
  'summarizing',
  'failed',
  'done',
] as const;

export const AI_WEB_SOURCE_ENTRY_STATUSES = [
  'search-result',
  'fetching',
  'fetched',
  'failed',
] as const;

export type TAiWebActivityState = (typeof AI_WEB_ACTIVITY_STATES)[number];
export type TAiWebSourceEntryStatus = (typeof AI_WEB_SOURCE_ENTRY_STATUSES)[number];

export interface IAiWebActivity {
  id: string;
  state: TAiWebActivityState;
  label: string;
  queryPreview?: string;
  stepId?: string;
}

export interface IAiWebSourceEntry {
  id: string;
  query: string;
  stepId?: string;
  stepTitle?: string;
  result: IAiWebSearchResult;
  status: TAiWebSourceEntryStatus;
  fetchedSource?: IAiWebFetchResult;
  errorMessage?: string;
}
