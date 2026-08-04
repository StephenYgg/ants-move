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

/** Publish strategy. Default is always draft; live publish requires explicit opt-in. */
export type ToutiaoPublishStrategy = 'draft' | 'publish';

export type ToutiaoPublishContentType = 'article' | 'micro';

export interface ToutiaoAuthAccount {
  mediaId?: string;
  name?: string;
}

export interface ToutiaoAuthStatusResult {
  account?: ToutiaoAuthAccount;
  loggedIn: boolean;
  statePath: string;
}

export interface ToutiaoPublishResult {
  account?: ToutiaoAuthAccount;
  draftId?: string;
  editUrl?: string;
  itemId?: string;
  status: 'draft_saved' | 'published' | 'dry_run';
  strategy: ToutiaoPublishStrategy;
  title?: string;
  type: ToutiaoPublishContentType;
  url?: string;
}

export interface ToutiaoArticlePublishInput {
  /** Body images embedded between paragraphs (≥3 required). */
  bodyImagePaths: string[];
  category?: string;
  claim?: string;
  content: string;
  coverPath?: string;
  /** Additional cover images (with coverPath) for 三图 mode. */
  coverPaths?: string[];
  dryRun: boolean;
  /** Enable 头条首发 (requires ≥100 content chars). */
  firstPublish?: boolean;
  headed: boolean;
  keywords: string[];
  /**
   * Optional 添加位置 / city name. Best-effort UI fill; never fails publish.
   * 添加至合集 is not supported (account-specific multi-step picker).
   */
  location?: string;
  statePath: string;
  strategy: ToutiaoPublishStrategy;
  title: string;
}

export interface ToutiaoMicroPublishInput {
  claim?: string;
  content: string;
  dryRun: boolean;
  /** Enable 头条首发 (requires ≥100 content chars). */
  firstPublish?: boolean;
  headed: boolean;
  imagePaths: string[];
  /**
   * Optional 添加位置 / city name. Best-effort UI fill; never fails publish.
   */
  location?: string;
  statePath: string;
  strategy: ToutiaoPublishStrategy;
  topic?: string;
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
