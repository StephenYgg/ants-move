export type ToutiaoSource = 'tech' | 'AI' | '光刻机' | '芯片' | '半导体';

export interface ToutiaoItem {
  abstract?: string;
  authorName?: string;
  commentCount?: number;
  id: string;
  image?: string;
  publishTime?: {
    iso: string;
    local: string;
    seconds: number;
  };
  sourceUrl?: string;
  title: string;
  url: string;
}

export interface ToutiaoListResult {
  hasMore: boolean;
  items: ToutiaoItem[];
  keyword?: string;
  meta: {
    fetchedPages: number;
    totalItems: number;
  };
  next?: {
    maxBehotTime?: number;
    offset?: number;
  };
  source: ToutiaoSource;
}

export interface ToutiaoAuthorRuntimeResult {
  authorToken: string;
  hasMore: boolean;
  items: ToutiaoItem[];
  next?: {
    maxBehotTime?: number;
    offset?: number;
  };
}

export interface ToutiaoAuthorResult extends ToutiaoAuthorRuntimeResult {
  articles?: ToutiaoArticle[];
  meta: {
    fetchedPages: number;
    totalArticles?: number;
    totalItems: number;
    withContent: boolean;
  };
  request: {
    input: string;
    url: string;
  };
}

export interface ToutiaoArticle {
  authorName?: string;
  content: {
    paragraphs: string[];
    text: string;
  };
  id: string;
  publishTimeText?: string;
  request: {
    input: string;
    url: string;
  };
  title: string;
  url: string;
}

export interface ToutiaoRuntimeListResult {
  hasMore: boolean;
  items: ToutiaoItem[];
  keyword?: string;
  next?: {
    maxBehotTime?: number;
    offset?: number;
  };
  source: ToutiaoSource;
}

export class ToutiaoCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ToutiaoCommandError';
  }
}
