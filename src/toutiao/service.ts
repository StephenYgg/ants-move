import type { ToutiaoRuntime } from './runtime.js';
import {
  ToutiaoCommandError,
  type ToutiaoArticle,
  type ToutiaoAuthorResult,
  type ToutiaoListResult,
  type ToutiaoSource
} from './types.js';

const SUPPORTED_SOURCES = new Set<ToutiaoSource>([
  'tech',
  'AI',
  '光刻机',
  '芯片',
  '半导体'
]);
const MAX_AUTHOR_CONTENT_ARTICLES = 100;
const MAX_AUTHOR_CONTENT_RETAINED_BYTES = 10 * 1024 * 1024;

export class ToutiaoService {
  constructor(private readonly dependencies: { runtime: ToutiaoRuntime }) {}

  async article(input: string): Promise<ToutiaoArticle> {
    const url = buildToutiaoArticleUrl(input);
    return this.dependencies.runtime.withSession(async (session) =>
      session.fetchArticle({ input, url })
    );
  }

  async author(input: string, options: {
    pages?: number;
    withContent?: boolean;
  } = {}): Promise<ToutiaoAuthorResult> {
    const authorToken = buildToutiaoAuthorToken(input);
    const pages = normalizePages(options.pages);
    const url = buildToutiaoAuthorUrl(authorToken);
    const withContent = options.withContent ?? false;

    return this.dependencies.runtime.withSession(async (session) => {
      const runtimeResult = await session.fetchAuthorArticles({
        authorToken,
        pages,
        url
      });
      const result: ToutiaoAuthorResult = {
        ...runtimeResult,
        meta: {
          fetchedPages: pages,
          totalItems: runtimeResult.items.length,
          withContent
        },
        request: {
          input,
          url
        }
      };

      if (!withContent) {
        return result;
      }

      if (runtimeResult.items.length > MAX_AUTHOR_CONTENT_ARTICLES) {
        throw new ToutiaoCommandError(
          'TOUTIAO_RESOURCE_LIMIT',
          'Toutiao author content collection supports at most 100 articles per invocation.',
          2,
          {
            totalItems: runtimeResult.items.length
          }
        );
      }

      const articles: ToutiaoArticle[] = [];
      let retainedBytes = 0;
      for (const item of runtimeResult.items) {
        const article = await session.fetchArticle({
          input: item.id,
          url: buildToutiaoArticleUrl(item.url || item.id)
        });
        const nextRetainedBytes = retainedBytes
          + Buffer.byteLength(JSON.stringify(article), 'utf8');
        if (nextRetainedBytes > MAX_AUTHOR_CONTENT_RETAINED_BYTES) {
          throw new ToutiaoCommandError(
            'TOUTIAO_RESOURCE_LIMIT',
            'Toutiao author content exceeded the configured size limit.',
            2,
            {
              maxRetainedBytes: MAX_AUTHOR_CONTENT_RETAINED_BYTES,
              retainedBytes: nextRetainedBytes
            }
          );
        }
        retainedBytes = nextRetainedBytes;
        articles.push(article);
      }

      result.articles = articles;
      result.meta.totalArticles = articles.length;
      return result;
    });
  }

  async list(options: {
    pages?: number;
    source: string;
  }): Promise<ToutiaoListResult> {
    const source = parseSource(options.source);
    const pages = normalizePages(options.pages);

    return this.dependencies.runtime.withSession(async (session) => {
      const runtimeResult = source === 'tech'
        ? await session.fetchTechnologyChannel({ pages })
        : await session.fetchKeywordInformation({
            keyword: source,
            pages,
            source
          });

      return {
        ...runtimeResult,
        meta: {
          fetchedPages: pages,
          totalItems: runtimeResult.items.length
        }
      };
    });
  }
}

export function buildToutiaoAuthorToken(input: string): string {
  const trimmed = input.trim();

  if (/^[A-Za-z0-9._-]+$/.test(trimmed) && trimmed.length >= 12) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const token = /\/c\/user\/token\/([^/?#]+)/.exec(url.pathname)?.[1];

    if (token && isToutiaoHost(url.hostname)) {
      return decodeURIComponent(token);
    }
  } catch {
    // Fall through to the explicit command error below.
  }

  throw new ToutiaoCommandError(
    'TOUTIAO_INVALID_AUTHOR',
    'Toutiao author must be a user token or a /c/user/token/<token>/ homepage URL.',
    2,
    {
      input
    }
  );
}

export function buildToutiaoAuthorUrl(authorToken: string): string {
  return `https://www.toutiao.com/c/user/token/${encodeURIComponent(authorToken)}/`;
}

export function buildToutiaoArticleUrl(input: string): string {
  const trimmed = input.trim();

  if (/^\d+$/.test(trimmed)) {
    return `https://www.toutiao.com/article/${trimmed}/`;
  }

  try {
    const url = new URL(trimmed);
    const id = /(?:article|group)\/(\d+)/.exec(url.pathname)?.[1]
      ?? /^\/a(\d+)/.exec(url.pathname)?.[1];

    if (id && isToutiaoHost(url.hostname)) {
      return `https://www.toutiao.com/article/${id}/`;
    }

    const nextUrl = url.searchParams.get('url');
    if (nextUrl) {
      return buildToutiaoArticleUrl(nextUrl);
    }
  } catch {
    // Fall through to the explicit command error below.
  }

  throw new ToutiaoCommandError(
    'TOUTIAO_INVALID_ARTICLE',
    'Toutiao article must be a numeric id or a toutiao article/group URL.',
    2,
    {
      input
    }
  );
}

function isToutiaoHost(hostname: string): boolean {
  return hostname === 'www.toutiao.com' || hostname === 'toutiao.com';
}

function parseSource(source: string): ToutiaoSource {
  if (SUPPORTED_SOURCES.has(source as ToutiaoSource)) {
    return source as ToutiaoSource;
  }

  throw new ToutiaoCommandError(
    'TOUTIAO_INVALID_SOURCE',
    'Toutiao list only supports tech, AI, 光刻机, 芯片, and 半导体.',
    2,
    {
      source,
      supportedSources: [...SUPPORTED_SOURCES]
    }
  );
}

function normalizePages(pages: number | undefined): number {
  const value = pages ?? 1;

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new ToutiaoCommandError(
      'TOUTIAO_INVALID_PAGES',
      'Toutiao list pages must be an integer between 1 and 5.',
      2,
      {
        pages: value
      }
    );
  }

  return value;
}
