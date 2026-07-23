import type { Browser, BrowserContext, Page, Response } from 'playwright';

import {
  ToutiaoCommandError,
  type ToutiaoArticle,
  type ToutiaoAuthorRuntimeResult,
  type ToutiaoItem,
  type ToutiaoRuntimeListResult,
  type ToutiaoSource
} from './types.js';

export interface ToutiaoSession {
  fetchArticle: (request: { input: string; url: string }) => Promise<ToutiaoArticle>;
  fetchAuthorArticles: (options: {
    authorToken: string;
    pages: number;
    url: string;
  }) => Promise<ToutiaoAuthorRuntimeResult>;
  fetchKeywordInformation: (options: {
    keyword: ToutiaoSource;
    pages: number;
    source: ToutiaoSource;
  }) => Promise<ToutiaoRuntimeListResult>;
  fetchTechnologyChannel: (
    options: { pages: number }
  ) => Promise<ToutiaoRuntimeListResult>;
}

export interface ToutiaoRuntime {
  withSession: <T>(
    operation: (session: ToutiaoSession) => Promise<T>
  ) => Promise<T>;
}

export interface ToutiaoRuntimeOptions {
  deadlineMs?: number;
  loadPlaywright?: () => Promise<typeof import('playwright')>;
}

const TOUTIAO_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TECH_CHANNEL_ID = 3189398999;
const DEFAULT_DEADLINE_MS = 10 * 60 * 1000;
const MAX_ARTICLE_TEXT_BYTES = 1024 * 1024;
const MAX_FEED_ITEMS_PER_RESPONSE = 100;
const MAX_FEED_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_SEARCH_TEXT_BYTES = 1024 * 1024;
const BLOCKED_RESOURCE_TYPES = new Set(['font', 'image', 'media']);

export function createDefaultToutiaoRuntime(
  options: ToutiaoRuntimeOptions = {}
): ToutiaoRuntime {
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const playwrightLoader = options.loadPlaywright ?? loadPlaywright;

  return {
    withSession: async <T>(operation: (session: ToutiaoSession) => Promise<T>) => {
      let browser: Browser | undefined;
      let browserClosed = false;
      let context: BrowserContext | undefined;
      let deadlineTriggered = false;
      let operationPromise: Promise<T> | undefined;
      let lifecyclePromise: Promise<T>;

      const createTimeoutError = () => new ToutiaoCommandError(
        'TOUTIAO_TIMEOUT',
        'Toutiao collection exceeded the command deadline.',
        1,
        { deadlineMs }
      );
      const ensureWithinDeadline = (): void => {
        if (deadlineTriggered) {
          throw createTimeoutError();
        }
      };

      lifecyclePromise = (async () => {
        try {
          let playwright: typeof import('playwright');
          try {
            playwright = await playwrightLoader();
          } catch {
            ensureWithinDeadline();
            throw new ToutiaoCommandError(
              'TOUTIAO_BROWSER_UNAVAILABLE',
              'Toutiao collection requires Playwright to be installed.',
              2
            );
          }
          ensureWithinDeadline();

          try {
            browser = await playwright.chromium.launch({ headless: true });
          } catch {
            ensureWithinDeadline();
            throw new ToutiaoCommandError(
              'TOUTIAO_BROWSER_UNAVAILABLE',
              'Toutiao collection requires Playwright Chromium to be installed.',
              2
            );
          }
          if (deadlineTriggered) {
            browserClosed = true;
            await browser.close().catch(() => undefined);
            throw createTimeoutError();
          }

          context = await browser.newContext({
            locale: 'zh-CN',
            userAgent: TOUTIAO_USER_AGENT
          });
          ensureWithinDeadline();
          const page = await context.newPage();
          ensureWithinDeadline();
          await page.route('**/*', async (route) => {
            if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
              await route.abort();
              return;
            }
            await route.continue();
          });
          ensureWithinDeadline();

          operationPromise = Promise.resolve().then(() =>
            operation(createToutiaoSession(page))
          );
          return await operationPromise;
        } finally {
          await context?.close().catch(() => undefined);
          if (!browserClosed) {
            await browser?.close().catch(() => undefined);
          }
        }
      })();

      return await new Promise<T>((resolve, reject) => {
        const deadlineTimer = setTimeout(() => {
          deadlineTriggered = true;
          void (async () => {
            if (browser !== undefined) {
              browserClosed = true;
              await browser.close().catch(() => undefined);
            }
            if (operationPromise !== undefined) {
              await operationPromise.then(
                () => undefined,
                () => undefined
              );
              await lifecyclePromise.then(
                () => undefined,
                () => undefined
              );
            }
            reject(createTimeoutError());
          })();
        }, deadlineMs);

        void lifecyclePromise.then(
          (value) => {
            if (!deadlineTriggered) {
              clearTimeout(deadlineTimer);
              resolve(value);
            }
          },
          (error: unknown) => {
            if (!deadlineTriggered) {
              clearTimeout(deadlineTimer);
              reject(error);
            }
          }
        );
      });
    }
  };
}

function createToutiaoSession(page: Page): ToutiaoSession {
  return {
    fetchArticle: async (request) => fetchArticle(page, request),
    fetchAuthorArticles: async (options) => fetchAuthorArticles(page, options),
    fetchKeywordInformation: async (options) => fetchKeywordInformation(page, options),
    fetchTechnologyChannel: async (options) => fetchTechnologyChannel(page, options)
  };
}

async function fetchArticle(
  page: Page,
  request: { input: string; url: string }
): Promise<ToutiaoArticle> {
  await page.goto(request.url, {
    timeout: 45000,
    waitUntil: 'domcontentloaded'
  });
  await page.waitForTimeout(5000);

  const title = await page.locator('h1').first().innerText({ timeout: 5000 }).catch(() => '');
  const paragraphs = await page.locator('article p').evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent ?? '').trim()).filter(Boolean)
  );
  const bodyText = await page.locator('body').innerText({ timeout: 5000 });
  const extractedTextBytes = Math.max(
    Buffer.byteLength(title, 'utf8'),
    Buffer.byteLength(bodyText, 'utf8'),
    paragraphs.reduce(
      (total, paragraph) => total + Buffer.byteLength(paragraph, 'utf8'),
      0
    )
  );
  if (extractedTextBytes > MAX_ARTICLE_TEXT_BYTES) {
    throw new ToutiaoCommandError(
      'TOUTIAO_RESOURCE_LIMIT',
      'Toutiao article text exceeded the configured size limit.',
      2,
      {
        maxTextBytes: MAX_ARTICLE_TEXT_BYTES,
        textBytes: extractedTextBytes
      }
    );
  }
  const metadata = extractArticleMetadata(bodyText, title);
  const id = extractArticleId(request.url) ?? extractArticleId(request.input) ?? '';

  if (!id || !title || paragraphs.length === 0) {
    throw new ToutiaoCommandError(
      'TOUTIAO_PARSE_ERROR',
      'Toutiao article page did not expose title and content.',
      2,
      {
        input: request.input,
        url: request.url
      }
    );
  }

  const article: ToutiaoArticle = {
    content: {
      paragraphs,
      text: paragraphs.join('\n')
    },
    id,
    request,
    title,
    url: page.url()
  };

  if (metadata.authorName !== undefined) {
    article.authorName = metadata.authorName;
  }
  if (metadata.publishTimeText !== undefined) {
    article.publishTimeText = metadata.publishTimeText;
  }

  return article;
}

async function fetchTechnologyChannel(
  page: Page,
  options: { pages: number }
): Promise<ToutiaoRuntimeListResult> {
  const feedResponses = await collectFeedResponses(
    page,
    options.pages,
    (response) => response.url().includes('/api/pc/list/feed'),
    async () => {
      await page.goto(
        `https://www.toutiao.com/?channel=tech&source=ch&channel_id=${TECH_CHANNEL_ID}`,
        {
          timeout: 45000,
          waitUntil: 'domcontentloaded'
        }
      );
    }
  );
  const selectedResponses = feedResponses.slice(0, options.pages);
  const items = deduplicateItems(
    selectedResponses.flatMap((response) => mapFeedItems(response.data ?? []))
  );
  const lastResponse = selectedResponses.at(-1);

  if (items.length === 0) {
    throw new ToutiaoCommandError(
      'TOUTIAO_PARSE_ERROR',
      'Toutiao technology channel did not return feed items.',
      2
    );
  }

  const result: ToutiaoRuntimeListResult = {
    hasMore: lastResponse?.has_more ?? false,
    items,
    source: 'tech'
  };
  addNextPage(result, lastResponse);
  return result;
}

async function fetchAuthorArticles(
  page: Page,
  options: {
    authorToken: string;
    pages: number;
    url: string;
  }
): Promise<ToutiaoAuthorRuntimeResult> {
  const feedResponses = await collectFeedResponses(
    page,
    options.pages,
    (response) => isAuthorFeedResponseUrl(response.url(), options.authorToken),
    async () => {
      await page.goto(options.url, {
        timeout: 45000,
        waitUntil: 'domcontentloaded'
      });
    }
  );
  const selectedResponses = feedResponses.slice(0, options.pages);
  const items = deduplicateItems(
    selectedResponses.flatMap((response) => mapFeedItems(response.data ?? []))
  );
  const lastResponse = selectedResponses.at(-1);

  if (items.length === 0) {
    throw new ToutiaoCommandError(
      'TOUTIAO_PARSE_ERROR',
      'Toutiao author homepage did not return article feed items.',
      2,
      {
        authorToken: options.authorToken,
        url: options.url
      }
    );
  }

  const result: ToutiaoAuthorRuntimeResult = {
    authorToken: options.authorToken,
    hasMore: lastResponse?.has_more ?? false,
    items
  };
  addNextPage(result, lastResponse);
  return result;
}

async function collectFeedResponses(
  page: Page,
  pages: number,
  accepts: (response: Response) => boolean,
  navigate: () => Promise<void>
): Promise<ToutiaoFeedResponse[]> {
  const feedResponses: ToutiaoFeedResponse[] = [];
  const maxResponseParses = pages * 2;
  const pendingResponses = new Set<Promise<void>>();
  const queuedResponses: Response[] = [];
  let firstResourceError: ToutiaoCommandError | undefined;
  let startedResponseParses = 0;

  const startQueuedResponses = (): void => {
    while (
      firstResourceError === undefined
      && queuedResponses.length > 0
      && feedResponses.length + pendingResponses.size < pages
      && startedResponseParses < maxResponseParses
    ) {
      startResponseParse(queuedResponses.shift()!);
    }
  };
  const startResponseParse = (response: Response): void => {
    startedResponseParses += 1;
    const pending = parseFeedResponse(response)
      .then((feedResponse) => {
        feedResponses.push(feedResponse);
      })
      .catch((error: unknown) => {
        if (error instanceof ToutiaoCommandError) {
          firstResourceError ??= error;
        }
      })
      .finally(() => {
        pendingResponses.delete(pending);
        startQueuedResponses();
      });
    pendingResponses.add(pending);
  };
  const handler = (response: Response): void => {
    if (
      !accepts(response)
      || firstResourceError !== undefined
      || feedResponses.length >= pages
      || startedResponseParses + queuedResponses.length >= maxResponseParses
    ) {
      return;
    }

    if (feedResponses.length + pendingResponses.size < pages) {
      startResponseParse(response);
      return;
    }
    queuedResponses.push(response);
  };

  page.on('response', handler);
  try {
    await navigate();
    await waitForFeedResponses(
      page,
      feedResponses,
      pages,
      () => firstResourceError !== undefined
    );
    while (pendingResponses.size > 0) {
      await Promise.allSettled([...pendingResponses]);
    }
    if (firstResourceError !== undefined) {
      throw firstResourceError;
    }
    return feedResponses;
  } finally {
    page.off('response', handler);
    queuedResponses.length = 0;
    while (pendingResponses.size > 0) {
      await Promise.allSettled([...pendingResponses]);
    }
  }
}

async function parseFeedResponse(response: Response): Promise<ToutiaoFeedResponse> {
  const declaredLength = Number(await response.headerValue('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_RESPONSE_BYTES) {
    throw feedResponseTooLarge();
  }

  const body = await response.body();
  if (body.byteLength > MAX_FEED_RESPONSE_BYTES) {
    throw feedResponseTooLarge();
  }
  const feedResponse = JSON.parse(body.toString('utf8')) as ToutiaoFeedResponse;
  if (
    Array.isArray(feedResponse.data)
    && feedResponse.data.length > MAX_FEED_ITEMS_PER_RESPONSE
  ) {
    throw new ToutiaoCommandError(
      'TOUTIAO_RESOURCE_LIMIT',
      'Toutiao feed response exceeded the configured item limit.',
      2,
      { maxItems: MAX_FEED_ITEMS_PER_RESPONSE }
    );
  }
  return feedResponse;
}

function feedResponseTooLarge(): ToutiaoCommandError {
  return new ToutiaoCommandError(
    'TOUTIAO_RESPONSE_TOO_LARGE',
    'Toutiao feed response exceeded the configured size limit.',
    2,
    { maxBytes: MAX_FEED_RESPONSE_BYTES }
  );
}

async function fetchKeywordInformation(
  page: Page,
  options: {
    keyword: ToutiaoSource;
    pages: number;
    source: ToutiaoSource;
  }
): Promise<ToutiaoRuntimeListResult> {
  const items: ToutiaoItem[] = [];
  const seen = new Set<string>();
  let blocked = false;

  for (let pageIndex = 0; pageIndex < options.pages; pageIndex += 1) {
    const url = buildSearchUrl(options.keyword, pageIndex);

    await page.goto(url, {
      timeout: 45000,
      waitUntil: 'domcontentloaded'
    });
    await page.waitForTimeout(5000);

    blocked = blocked || await page.locator('#pc_captcha').count() > 0;

    for (const item of await extractSearchItemsFromPage(page, options.keyword)) {
      if (seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      items.push(item);
    }
  }

  if (blocked && items.length === 0) {
    throw new ToutiaoCommandError(
      'TOUTIAO_VERIFICATION_REQUIRED',
      'Toutiao search requires browser verification before returning usable results.',
      1,
      {
        keyword: options.keyword
      }
    );
  }

  if (items.length === 0) {
    throw new ToutiaoCommandError(
      'TOUTIAO_PARSE_ERROR',
      'Toutiao search page did not expose result items.',
      2,
      {
        keyword: options.keyword
      }
    );
  }

  return {
    hasMore: true,
    items,
    keyword: options.keyword,
    source: options.source
  };
}

function buildSearchUrl(keyword: string, pageIndex: number): string {
  const params = new URLSearchParams({
    action_type: pageIndex === 0 ? 'search' : 'pagination',
    cur_tab_title: 'news',
    dvpf: 'pc',
    from: 'news',
    keyword,
    page_num: String(pageIndex),
    pd: 'information',
    source: pageIndex === 0 ? 'input' : 'pagination'
  });

  return `https://so.toutiao.com/search?${params.toString()}`;
}

async function waitForFeedResponses(
  page: Page,
  responses: ToutiaoFeedResponse[],
  pages: number,
  shouldStop: () => boolean
): Promise<void> {
  for (
    let attempt = 0;
    attempt < 45 && responses.length < pages && !shouldStop();
    attempt += 1
  ) {
    await page.waitForTimeout(1000);
    if (responses.length < pages && !shouldStop()) {
      await page.mouse.wheel(0, 4000);
    }
  }
}

interface ToutiaoFeedResponse {
  data?: ToutiaoRawFeedItem[];
  has_more?: boolean;
  next?: {
    max_behot_time?: number;
  };
  offset?: number;
}

interface ToutiaoRawFeedItem {
  Abstract?: string;
  abstract?: string;
  article_url?: string;
  behot_time?: number;
  comment_count?: number;
  display_url?: string;
  group_id?: string;
  id?: string;
  image_url?: string;
  item_id?: string;
  media_name?: string;
  source?: string;
  source_url?: string;
  title?: string;
  Title?: string;
}

function mapFeedItems(items: ToutiaoRawFeedItem[]): ToutiaoItem[] {
  return items.flatMap((item) => {
    const id = String(item.group_id ?? item.item_id ?? item.id ?? '');
    const title = item.title ?? item.Title ?? '';

    if (!id || !title) {
      return [];
    }

    const mapped: ToutiaoItem = {
      id,
      title,
      url: normalizeArticleUrl(item.article_url ?? item.display_url ?? item.source_url, id)
    };

    const abstract = item.Abstract ?? item.abstract;
    if (abstract !== undefined) {
      mapped.abstract = abstract;
    }
    if (item.comment_count !== undefined) {
      mapped.commentCount = item.comment_count;
    }
    if (item.image_url !== undefined) {
      mapped.image = item.image_url;
    }
    const authorName = item.media_name ?? item.source;
    if (authorName !== undefined) {
      mapped.authorName = authorName;
    }
    if (item.source_url !== undefined) {
      mapped.sourceUrl = item.source_url;
    }
    if (item.behot_time !== undefined) {
      mapped.publishTime = {
        iso: new Date(item.behot_time * 1000).toISOString(),
        local: formatChinaTime(item.behot_time),
        seconds: item.behot_time
      };
    }

    return [mapped];
  });
}

function deduplicateItems(items: ToutiaoItem[]): ToutiaoItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function addNextPage(
  result: ToutiaoAuthorRuntimeResult | ToutiaoRuntimeListResult,
  response: ToutiaoFeedResponse | undefined
): void {
  const next: NonNullable<typeof result.next> = {};
  if (response?.next?.max_behot_time !== undefined) {
    next.maxBehotTime = response.next.max_behot_time;
  }
  if (response?.offset !== undefined) {
    next.offset = response.offset;
  }
  if (Object.keys(next).length > 0) {
    result.next = next;
  }
}

function normalizeArticleUrl(value: string | undefined, id: string): string {
  if (!value) {
    return `https://www.toutiao.com/article/${id}/`;
  }

  try {
    const url = new URL(value, 'https://www.toutiao.com');
    return parseToutiaoArticleLink(url.toString())?.url
      ?? `https://www.toutiao.com/article/${id}/`;
  } catch {
    return `https://www.toutiao.com/article/${id}/`;
  }
}

async function extractSearchItemsFromPage(
  page: Page,
  keyword: string
): Promise<ToutiaoItem[]> {
  const anchors = await page.locator('a').evaluateAll((nodes) =>
    nodes.slice(0, 300).map((node) => ({
      href: (node as HTMLAnchorElement).href.slice(0, 2048),
      text: (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 1000)
    }))
  );
  const seen = new Set<string>();
  const items: ToutiaoItem[] = [];

  for (const anchor of anchors) {
    const articleLink = parseToutiaoArticleLink(anchor.href);

    if (!articleLink || !anchor.text || anchor.text.length < 6 || seen.has(articleLink.id)) {
      continue;
    }

    seen.add(articleLink.id);
    items.push({
      id: articleLink.id,
      title: anchor.text.slice(0, 180),
      url: articleLink.url
    });

    if (items.length >= 30) {
      break;
    }
  }

  if (items.length > 0) {
    return items;
  }

  const bodyText = await page.locator('body').innerText({ timeout: 5000 });
  const textBytes = Buffer.byteLength(bodyText, 'utf8');
  if (textBytes > MAX_SEARCH_TEXT_BYTES) {
    throw new ToutiaoCommandError(
      'TOUTIAO_RESOURCE_LIMIT',
      'Toutiao search text exceeded the configured size limit.',
      2,
      {
        maxTextBytes: MAX_SEARCH_TEXT_BYTES,
        textBytes
      }
    );
  }
  return extractSearchItemsFromText(bodyText, keyword);
}

function extractSearchItemsFromText(text: string, keyword: string): ToutiaoItem[] {
  const blockedPrefixes = new Set([
    '无障碍 今日头条首页 登录 综合 资讯 视频 图片 用户 小视频 微头条 音乐 去抖音搜'
  ]);
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12 && !blockedPrefixes.has(line));

  const seen = new Set<string>();
  const items: ToutiaoItem[] = [];

  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ');
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    items.push({
      id: createSearchItemId(keyword, normalized, items.length),
      title: normalized.slice(0, 180),
      url: `https://so.toutiao.com/search?keyword=${encodeURIComponent(keyword)}&pd=information&dvpf=pc&source=input`
    });

    if (items.length >= 30) {
      break;
    }
  }

  return items;
}

function parseToutiaoArticleLink(
  href: string,
  depth = 0
): { id: string; url: string } | undefined {
  if (depth > 3) {
    return undefined;
  }

  const directId = extractArticleId(href);

  if (directId) {
    return {
      id: directId,
      url: `https://www.toutiao.com/article/${directId}/`
    };
  }

  try {
    const url = new URL(href);
    const nextUrl = url.searchParams.get('url');

    if (nextUrl) {
      return parseToutiaoArticleLink(nextUrl, depth + 1);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function extractArticleMetadata(bodyText: string, title: string): {
  authorName?: string;
  publishTimeText?: string;
} {
  const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const titleIndex = lines.findIndex((line) => line === title);
  const metadataLine = titleIndex >= 0 ? lines[titleIndex + 1] : undefined;
  const match = metadataLine?.match(/^(.+?)·(.+)$/);

  if (!match?.[1] || !match[2]) {
    return {};
  }

  return {
    authorName: match[2],
    publishTimeText: match[1]
  };
}

function extractArticleId(value: string): string | undefined {
  return /(?:article|group)\/(\d+)/.exec(value)?.[1]
    ?? /\/a(\d+)/.exec(value)?.[1]
    ?? (/^\d+$/.test(value) ? value : undefined);
}

function isAuthorFeedResponseUrl(value: string, authorToken: string): boolean {
  try {
    const url = new URL(value);
    const isProfileArticleFeed = url.pathname.includes('/api/pc/list/feed')
      && (
        url.searchParams.get('category') === 'pc_profile_article'
        || url.searchParams.get('author_token') === authorToken
      );
    const isProfileAllFeed = url.pathname.includes('/api/pc/list/user/feed')
      && url.searchParams.get('category') === 'profile_all'
      && url.searchParams.get('token') === authorToken;

    return isProfileArticleFeed || isProfileAllFeed;
  } catch {
    return (
      value.includes('/api/pc/list/feed')
      && (value.includes('pc_profile_article') || value.includes(authorToken))
    ) || (
      value.includes('/api/pc/list/user/feed')
      && value.includes('profile_all')
      && value.includes(authorToken)
    );
  }
}

function createSearchItemId(keyword: string, value: string, index: number): string {
  let hash = 2166136261;
  const input = `${keyword}:${index}:${value}`;

  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return `search-${(hash >>> 0).toString(16)}`;
}

function formatChinaTime(timestampSeconds: number): string {
  return new Intl.DateTimeFormat('sv-SE', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric'
  }).format(new Date(timestampSeconds * 1000));
}

async function loadPlaywright(): Promise<typeof import('playwright')> {
  return await import('playwright');
}
