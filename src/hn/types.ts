export type HackerNewsStorySource = 'top' | 'new' | 'best';
export type HackerNewsSearchSort = 'relevance' | 'date';

export interface HackerNewsItem {
  author?: string;
  commentCount?: number;
  id: number;
  score?: number;
  text?: string;
  time?: {
    iso: string;
    seconds: number;
  };
  title: string;
  type: 'story';
  url: string;
}

export interface HackerNewsStoriesRuntimeResult {
  items: HackerNewsItem[];
  source: HackerNewsStorySource;
}

export interface HackerNewsStoriesResult extends HackerNewsStoriesRuntimeResult {
  meta: {
    limit: number;
    totalItems: number;
  };
}

export interface HackerNewsSearchRuntimeResult {
  items: HackerNewsItem[];
  query: string;
}

export interface HackerNewsSearchResult extends HackerNewsSearchRuntimeResult {
  meta: {
    limit: number;
    sort: HackerNewsSearchSort;
    totalItems: number;
  };
}

export class HackerNewsCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HackerNewsCommandError';
  }
}
