export interface MediaHttpRequest {
  headers: Record<string, string>;
  url: string;
}

export interface MediaPublishTime {
  iso: string;
  ms: number;
}

export interface MediaListItem {
  authorName?: string;
  categories?: string[];
  id: string;
  image?: string;
  images?: string[];
  keywords?: string[];
  publishTime?: MediaPublishTime;
  summary?: string;
  title: string;
  url: string;
}

export interface MediaListResult {
  channel: string;
  items: MediaListItem[];
  meta: {
    limit: number;
    source: string;
    totalItems: number;
  };
  request: MediaHttpRequest;
  source: string;
}

export interface MediaArticleAuthor {
  name: string;
  url?: string;
}

export interface MediaArticleImage {
  alt?: string;
  index: number;
  url: string;
}

export interface MediaArticle {
  author?: MediaArticleAuthor;
  content: {
    html?: string;
    paragraphs: string[];
    text?: string;
  };
  coverImage?: string;
  id: string;
  images: MediaArticleImage[];
  keywords?: string[];
  publishTime?: MediaPublishTime;
  request: MediaHttpRequest;
  section?: string;
  source: string;
  summary?: string;
  title: string;
  url: string;
}

export type MediaChannelMap = Record<string, string>;

export interface MediaSourceDefinition {
  /** Resolve article page URL from id, slug, or full URL. */
  buildArticleUrl: (articleRef: string) => string;
  /** Supported list channels mapped to RSS/Atom feed URLs. */
  channels: MediaChannelMap;
  command: string;
  description: string;
  /** When true, article command is not registered. */
  listOnly?: boolean;
  /**
   * Optional post-filter for list items (e.g. Bloomberg AI keyword filter).
   * Applied after RSS parse, before limit.
   */
  filterListItems?: (items: MediaListItem[], channel: string) => MediaListItem[];
  source: string;
}

export class MediaCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'MediaCommandError';
  }
}
