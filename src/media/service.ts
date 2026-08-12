import { extractArticleFromHtml } from './extract.js';
import {
  createBrowserHeaders,
  originFromUrl,
  siteRootReferer
} from './headers.js';
import type { MediaRuntime } from './runtime.js';
import {
  findFeedEntryByUrl,
  parseRssOrAtomEntries,
  parseRssOrAtomFeed,
  type MediaFeedEntry
} from './rss.js';
import {
  MediaCommandError,
  type MediaArticle,
  type MediaHttpRequest,
  type MediaListResult,
  type MediaSourceDefinition
} from './types.js';

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const MIN_FEED_BODY_CHARS = 200;

export class MediaCollectorService {
  constructor(
    private readonly definition: MediaSourceDefinition,
    private readonly runtime: MediaRuntime
  ) {}

  async getList(options: {
    channel: string;
    limit?: number;
  }): Promise<MediaListResult> {
    const channel = normalizeChannel(options.channel, this.definition);
    const limit = normalizeLimit(options.limit);
    const feedUrl = this.definition.channels[channel]!;
    const request = buildFeedRequest(feedUrl);
    const xml = await this.runtime.fetchText(request);
    let items = parseRssOrAtomFeed(xml);

    if (this.definition.filterListItems) {
      items = this.definition.filterListItems(items, channel);
    }

    items = items.slice(0, limit);

    return {
      channel,
      items,
      meta: {
        limit,
        source: this.definition.source,
        totalItems: items.length
      },
      request,
      source: this.definition.source
    };
  }

  async getArticle(articleRef: string): Promise<MediaArticle> {
    if (this.definition.listOnly) {
      throw new MediaCommandError(
        'MEDIA_ARTICLE_UNAVAILABLE',
        `${this.definition.source} does not support full article collection.`,
        2,
        {
          source: this.definition.source
        }
      );
    }

    const ref = articleRef.trim();
    if (!ref) {
      throw new MediaCommandError(
        'MEDIA_INVALID_ARTICLE',
        'Article id or URL must not be empty.',
        2
      );
    }

    const url = this.definition.buildArticleUrl(ref);
    const request = buildArticleRequest(url);

    let htmlError: unknown;
    try {
      const html = await this.runtime.fetchText(request);
      if (looksLikeBlockedHtml(html)) {
        throw new MediaCommandError(
          'MEDIA_ARTICLE_BLOCKED',
          'Article page was blocked by bot protection or returned no usable HTML.',
          2,
          { url }
        );
      }
      return extractArticleFromHtml({
        html,
        request,
        source: this.definition.source,
        url
      });
    } catch (error) {
      htmlError = error;
    }

    const feedArticle = await this.tryArticleFromFeeds(url, request);
    if (feedArticle) {
      return feedArticle;
    }

    if (this.runtime.fetchHtmlBrowser) {
      try {
        const browserHtml = await this.runtime.fetchHtmlBrowser(request);
        if (!looksLikeBlockedHtml(browserHtml)) {
          return extractArticleFromHtml({
            html: browserHtml,
            request,
            source: this.definition.source,
            url
          });
        }
      } catch (browserError) {
        if (
          browserError instanceof MediaCommandError &&
          !(htmlError instanceof MediaCommandError)
        ) {
          throw browserError;
        }
        // Prefer the original HTML error when browser fallback also fails.
      }
    }

    if (htmlError instanceof MediaCommandError) {
      throw htmlError;
    }
    throw htmlError instanceof Error
      ? htmlError
      : new MediaCommandError(
        'MEDIA_PARSE_ERROR',
        'Article could not be collected from HTML, feeds, or browser fallback.',
        2,
        { url }
      );
  }

  private async tryArticleFromFeeds(
    articleUrl: string,
    request: MediaHttpRequest
  ): Promise<MediaArticle | null> {
    const feedUrls = [...new Set(Object.values(this.definition.channels))];
    for (const feedUrl of feedUrls) {
      try {
        const xml = await this.runtime.fetchText(buildFeedRequest(feedUrl));
        const entries = parseRssOrAtomEntries(xml);
        const entry = findFeedEntryByUrl(entries, articleUrl);
        if (!entry) {
          continue;
        }
        const article = articleFromFeedEntry(
          entry,
          request,
          this.definition.source,
          articleUrl
        );
        if (article) {
          return article;
        }
      } catch {
        // try next feed
      }
    }
    return null;
  }
}

export function buildFeedRequest(feedUrl: string): MediaHttpRequest {
  return {
    headers: createBrowserHeaders({
      accept: 'xml',
      referer: siteRootReferer(feedUrl),
      secFetchSite: 'same-origin'
    }),
    url: feedUrl
  };
}

export function buildArticleRequest(articleUrl: string): MediaHttpRequest {
  const origin = originFromUrl(articleUrl);
  return {
    headers: createBrowserHeaders({
      accept: 'html',
      origin,
      referer: `${origin}/`,
      secFetchSite: 'same-origin'
    }),
    url: articleUrl
  };
}

export function looksLikeBlockedHtml(html: string): boolean {
  const sample = html.slice(0, 8000);
  if (
    /awsWaf|gokuProps|Just a moment|cf-browser-verification|cf-challenge|Access Denied|Enable JavaScript and cookies|JavaScript is disabled/i
      .test(sample)
  ) {
    return true;
  }

  // Tiny challenge shells: empty title, no article markers, almost no content.
  if (html.length < 3000) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
    const hasArticleSignal =
      /application\/ld\+json|articleBody|og:title|property=["']og:title["']/i.test(html);
    if (!title && !hasArticleSignal) {
      return true;
    }
  }
  return false;
}

function articleFromFeedEntry(
  entry: MediaFeedEntry,
  request: MediaHttpRequest,
  source: string,
  articleUrl: string
): MediaArticle | null {
  const bodyHtml = entry.contentHtml || '';
  const bodyText = (entry.summary ?? '').trim();
  if (bodyHtml.length < MIN_FEED_BODY_CHARS && bodyText.length < MIN_FEED_BODY_CHARS) {
    return null;
  }

  const safeTitle = escapeHtml(entry.title);
  const wrapped = `<!DOCTYPE html><html><head>
    <title>${safeTitle}</title>
    ${entry.image ? `<meta property="og:image" content="${escapeHtml(entry.image)}" />` : ''}
    ${entry.summary ? `<meta property="og:description" content="${escapeHtml(entry.summary)}" />` : ''}
    ${entry.authorName ? `<meta name="author" content="${escapeHtml(entry.authorName)}" />` : ''}
  </head><body><article>
    <h1>${safeTitle}</h1>
    ${bodyHtml || `<p>${escapeHtml(bodyText)}</p>`}
  </article></body></html>`;

  try {
    const article = extractArticleFromHtml({
      html: wrapped,
      request,
      source,
      url: articleUrl
    });
    if (entry.publishTime && !article.publishTime) {
      article.publishTime = entry.publishTime;
    }
    return article;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeChannel(
  channel: string,
  definition: MediaSourceDefinition
): string {
  const value = channel.trim();
  if (definition.channels[value]) {
    return value;
  }

  // Accept case-insensitive channel names.
  const matched = Object.keys(definition.channels).find(
    (key) => key.toLowerCase() === value.toLowerCase()
  );
  if (matched) {
    return matched;
  }

  throw new MediaCommandError(
    'MEDIA_INVALID_CHANNEL',
    `${definition.source} list only supports: ${Object.keys(definition.channels).join(', ')}.`,
    2,
    {
      channel: value,
      source: definition.source,
      supportedChannels: Object.keys(definition.channels)
    }
  );
}

function normalizeLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) {
    throw new MediaCommandError(
      'MEDIA_INVALID_LIMIT',
      `Media list limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}.`,
      2,
      { limit: value }
    );
  }
  return value;
}
