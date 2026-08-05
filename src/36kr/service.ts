import type { Kr36Runtime } from './runtime.js';
import {
  Kr36CommandError,
  type Kr36Article,
  type Kr36ArticleAuthor,
  type Kr36ArticleImage,
  type Kr36ArticleListItem,
  type Kr36ArticleOrganization,
  type Kr36ArticleStats,
  type Kr36InformationChannel,
  type Kr36InformationItem,
  type Kr36InformationList,
  type Kr36JsonRequest,
  type Kr36Request
} from './types.js';

/**
 * Prefer www.36kr.com for HTML pages: bare 36kr.com is often intercepted by a
 * Volcano Engine security challenge that returns no window.initialState.
 */
export const KR36_SITE_ORIGIN = 'https://www.36kr.com';

export const KR36_BROWSER_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  Referer: `${KR36_SITE_ORIGIN}/`,
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

const KR36_INFORMATION_ENDPOINT = 'https://gateway.36kr.com/api/mis/nav/ifm/subNav/flow';
const KR36_ARTICLE_MAX_RETAINED_BYTES = 20 * 1024 * 1024;
const KR36_INFORMATION_MAX_RETAINED_BYTES = 5 * 1024 * 1024;
const KR36_INFORMATION_PAGE_SIZE = 30;
const KR36_SUPPORTED_CHANNELS = new Set<Kr36InformationChannel>(['AI', 'technology']);

const KR36_JSON_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': KR36_BROWSER_HEADERS['Accept-Language']!,
  'Content-Type': 'application/json;charset=UTF-8',
  Origin: KR36_SITE_ORIGIN,
  'User-Agent': KR36_BROWSER_HEADERS['User-Agent']!
};

interface Kr36InitialState {
  articleDetail?: {
    articleDetailData?: {
      data?: Kr36RawArticle;
    };
    articleRecommendData?: Kr36RawRecommendData;
    favoriteCount?: number;
    likeCount?: number;
    organArticleData?: {
      data?: {
        organizationList?: Kr36ArticleOrganization[];
      };
    };
    latestArticle?: {
      articleLatestList?: Array<{ id: number; title: string }>;
    };
  };
  information?: {
    informationList?: Kr36RawInformationList;
  };
}

interface Kr36RawArticle {
  author?: string;
  authorFace?: string;
  authorId?: number;
  authorRoute?: string;
  companyCertifyNick?: string;
  imgSources?: Array<{ name: string; url: string }>;
  itemId?: number;
  popinImage?: string;
  publishTime?: number;
  sourceType?: string;
  summary?: string;
  widgetContent?: string;
  widgetTitle?: string;
}

interface Kr36RawRecommendData {
  authorFace?: string;
  authorName?: string;
  authorSummary?: string;
  authorTitle?: string;
  newestItemList?: Array<{
    itemContent?: string;
    itemId: number;
    itemRoute?: string;
    itemTitle: string;
    publishTime?: number;
  }>;
  nextItem?: {
    authorId?: number;
    itemContent?: string;
    itemId: number;
    itemRoute?: string;
    itemTitle: string;
    publishTime?: number;
  };
  relateArticleList?: Array<{
    author?: string;
    authorName?: string;
    itemId: number;
    route?: string;
    widgetImage?: string;
    widgetTitle: string;
  }>;
  statArticle?: number;
  statCollect?: number;
  statComment?: number;
  statPraise?: number;
}

interface Kr36RawInformationList {
  hasNextPage?: number;
  itemList?: Kr36RawInformationItem[];
  pageCallback?: string;
}

interface Kr36RawInformationItem {
  itemId: number;
  route?: string;
  templateMaterial?: {
    authorName?: string;
    authorRoute?: string;
    publishTime?: number;
    summary?: string;
    widgetImage?: string;
    widgetTitle?: string;
  };
}

interface Kr36InformationFlowResponse {
  code?: number;
  data?: Kr36RawInformationList;
  msg?: string;
}

export class Kr36ArticleService {
  constructor(private readonly runtime: Pick<Kr36Runtime, 'fetchArticleHtml' | 'fetchJson'>) {}

  async getArticle(articleId: string): Promise<Kr36Article> {
    assertArticleId(articleId);
    const request = buildKr36ArticleRequest(articleId);
    const html = await this.runtime.fetchArticleHtml(request);
    const initialState = parseInitialState(html);
    const articleDetail = initialState.articleDetail;
    const rawArticle = articleDetail?.articleDetailData?.data;

    if (!rawArticle) {
      throw new Kr36CommandError(
        'KR36_PARSE_ERROR',
        '36kr article data was not found in window.initialState.',
        2
      );
    }

    const contentHtml = rawArticle.widgetContent ?? '';
    const recommend = articleDetail?.articleRecommendData ?? {};
    const publishTime = rawArticle.publishTime ?? 0;
    const article: Kr36Article = {
      author: buildAuthor(rawArticle, recommend),
      content: {
        html: contentHtml,
        paragraphs: extractParagraphs(contentHtml)
      },
      id: String(rawArticle.itemId ?? articleId),
      imageSources: rawArticle.imgSources ?? [],
      images: extractImages(contentHtml),
      latestArticles: (articleDetail?.latestArticle?.articleLatestList ?? []).map((item) => ({
        id: item.id,
        title: item.title
      })),
      newestArticles: (recommend.newestItemList ?? []).map((item) => {
        const listItem: Kr36ArticleListItem = {
          id: item.itemId,
          title: item.itemTitle
        };

        if (item.itemContent !== undefined) {
          listItem.content = item.itemContent;
        }
        if (item.publishTime !== undefined) {
          listItem.publishTime = item.publishTime;
        }
        if (item.itemRoute !== undefined) {
          listItem.route = item.itemRoute;
        }

        return listItem;
      }),
      organizations: articleDetail?.organArticleData?.data?.organizationList ?? [],
      publishTime: {
        iso: publishTime ? new Date(publishTime).toISOString() : '',
        local: publishTime ? formatChinaTime(publishTime) : '',
        ms: publishTime
      },
      relatedArticles: (recommend.relateArticleList ?? []).map((item) => {
        const listItem: Kr36ArticleListItem = {
          id: item.itemId,
          title: item.widgetTitle
        };
        const author = item.author ?? item.authorName;

        if (author !== undefined) {
          listItem.author = author;
        }
        if (item.widgetImage !== undefined) {
          listItem.image = item.widgetImage;
        }
        if (item.route !== undefined) {
          listItem.route = item.route;
        }

        return listItem;
      }),
      request,
      stats: buildStats(articleDetail?.likeCount, articleDetail?.favoriteCount, recommend),
      summary: rawArticle.summary ?? '',
      title: rawArticle.widgetTitle ?? '',
      url: request.url
    };

    if (rawArticle.companyCertifyNick !== undefined) {
      article.companyCertifyNick = rawArticle.companyCertifyNick;
    }

    if (rawArticle.popinImage !== undefined) {
      article.coverImage = rawArticle.popinImage;
    }

    if (recommend.nextItem) {
      article.nextArticle = {
        id: recommend.nextItem.itemId,
        title: recommend.nextItem.itemTitle
      };

      if (recommend.nextItem.itemContent !== undefined) {
        article.nextArticle.content = recommend.nextItem.itemContent;
      }
      if (recommend.nextItem.publishTime !== undefined) {
        article.nextArticle.publishTime = recommend.nextItem.publishTime;
      }
      if (recommend.nextItem.itemRoute !== undefined) {
        article.nextArticle.route = recommend.nextItem.itemRoute;
      }
    }

    if (rawArticle.sourceType !== undefined) {
      article.sourceType = rawArticle.sourceType;
    }

    const retainedBytes = Buffer.byteLength(JSON.stringify(article), 'utf8');
    if (retainedBytes > KR36_ARTICLE_MAX_RETAINED_BYTES) {
      throw new Kr36CommandError(
        'KR36_RESOURCE_LIMIT',
        '36kr article result exceeded the configured size limit.',
        2,
        {
          maxRetainedBytes: KR36_ARTICLE_MAX_RETAINED_BYTES,
          retainedBytes
        }
      );
    }

    return article;
  }

  async getInformationList(options: {
    channel: string;
    pages?: number;
  }): Promise<Kr36InformationList> {
    const channel = parseInformationChannel(options.channel);
    const pageLimit = normalizePages(options.pages);
    // First page uses gateway flow API (pageEvent 0). HTML channel pages on
    // bare 36kr.com are frequently blocked by a security challenge.
    const firstPageRequest = buildKr36InformationFirstPageRequest(channel);
    const firstPageResponse = parseInformationFlowResponse(
      await this.runtime.fetchJson(firstPageRequest)
    );
    const firstPageList = firstPageResponse.data ?? {};

    const firstPageItems = mapInformationPageItems(firstPageList.itemList ?? []);
    let retainedBytes = addInformationRetainedBytes(0, firstPageItems);
    const items = [...firstPageItems];
    let pageCallback = firstPageList.pageCallback ?? '';
    let hasNextPage = firstPageList.hasNextPage ?? 0;
    let fetchedPages = 1;

    while (fetchedPages < pageLimit && hasNextPage && pageCallback) {
      const request = buildKr36InformationNextPageRequest(channel, pageCallback);
      const response = parseInformationFlowResponse(await this.runtime.fetchJson(request));
      const nextList = response.data ?? {};

      const nextItems = mapInformationPageItems(nextList.itemList ?? []);
      retainedBytes = addInformationRetainedBytes(retainedBytes, nextItems);
      items.push(...nextItems);
      pageCallback = nextList.pageCallback ?? '';
      hasNextPage = nextList.hasNextPage ?? 0;
      fetchedPages += 1;
    }

    return {
      channel,
      items,
      meta: {
        fetchedPages,
        hasNextPage,
        nextPageCallback: pageCallback,
        pageSize: KR36_INFORMATION_PAGE_SIZE,
        totalItems: items.length
      },
      request: {
        firstPage: firstPageRequest,
        nextPageEndpoint: KR36_INFORMATION_ENDPOINT
      }
    };
  }
}

export function buildKr36ArticleUrl(articleId: string): string {
  assertArticleId(articleId);
  return `${KR36_SITE_ORIGIN}/p/${articleId}`;
}

export function buildKr36ArticleRequest(articleId: string): Kr36Request {
  return {
    headers: KR36_BROWSER_HEADERS,
    url: buildKr36ArticleUrl(articleId)
  };
}

export function buildKr36InformationFirstPageRequest(
  channel: Kr36InformationChannel,
  timestamp = Date.now()
): Kr36JsonRequest {
  return buildKr36InformationFlowRequest(channel, {
    pageCallback: '',
    pageEvent: 0,
    timestamp
  });
}

export function buildKr36InformationNextPageRequest(
  channel: Kr36InformationChannel,
  pageCallback: string,
  timestamp = Date.now()
): Kr36JsonRequest {
  return buildKr36InformationFlowRequest(channel, {
    pageCallback,
    pageEvent: 1,
    timestamp
  });
}

function buildKr36InformationFlowRequest(
  channel: Kr36InformationChannel,
  options: {
    pageCallback: string;
    pageEvent: 0 | 1;
    timestamp: number;
  }
): Kr36JsonRequest {
  return {
    body: {
      partner_id: 'web',
      timestamp: options.timestamp,
      param: {
        subnavType: 1,
        subnavNick: channel,
        pageSize: KR36_INFORMATION_PAGE_SIZE,
        pageEvent: options.pageEvent,
        pageCallback: options.pageCallback,
        siteId: 1,
        platformId: 2
      }
    },
    headers: {
      ...KR36_JSON_HEADERS,
      Referer: `${KR36_SITE_ORIGIN}/information/${channel}/`
    },
    url: KR36_INFORMATION_ENDPOINT
  };
}

function assertArticleId(articleId: string): void {
  if (!/^\d+$/.test(articleId)) {
    throw new Kr36CommandError(
      'KR36_INVALID_ARTICLE_ID',
      '36kr article id must contain digits only.',
      2,
      {
        articleId
      }
    );
  }
}

function parseInformationChannel(channel: string): Kr36InformationChannel {
  if (KR36_SUPPORTED_CHANNELS.has(channel as Kr36InformationChannel)) {
    return channel as Kr36InformationChannel;
  }

  throw new Kr36CommandError(
    'KR36_INVALID_CHANNEL',
    '36kr list only supports AI and technology channels.',
    2,
    {
      channel,
      supportedChannels: [...KR36_SUPPORTED_CHANNELS]
    }
  );
}

function normalizePages(pages: number | undefined): number {
  const value = pages ?? 1;

  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Kr36CommandError(
      'KR36_INVALID_PAGES',
      '36kr list pages must be an integer between 1 and 20.',
      2,
      {
        pages: value
      }
    );
  }

  return value;
}

function parseInitialState(html: string): Kr36InitialState {
  const match = /window\.initialState=(\{[\s\S]*?\})\s*;?\s*<\/script>/.exec(html);

  if (!match?.[1]) {
    const securityChallenge =
      html.includes('正在进行安全检测') || html.includes('安全检测');
    throw new Kr36CommandError(
      'KR36_PARSE_ERROR',
      securityChallenge
        ? '36kr returned a security challenge page instead of article HTML (window.initialState missing).'
        : 'window.initialState was not found in the 36kr article page.',
      2
    );
  }

  try {
    return JSON.parse(match[1]) as Kr36InitialState;
  } catch (error) {
    throw new Kr36CommandError(
      'KR36_PARSE_ERROR',
      'Failed to parse window.initialState from the 36kr article page.',
      2,
      {
        cause: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

function extractImages(html: string): Kr36ArticleImage[] {
  return [...html.matchAll(/<img\b[^>]*>/gi)].map((match, index) => {
    const tag = match[0];
    return {
      index: index + 1,
      size: getAttribute(tag, 'data-img-size-val'),
      url: getAttribute(tag, 'src') ?? ''
    };
  }).filter((image) => image.url);
}

function parseInformationFlowResponse(jsonText: string): Kr36InformationFlowResponse {
  try {
    const response = JSON.parse(jsonText) as Kr36InformationFlowResponse;

    if (response.code !== 0) {
      throw new Kr36CommandError(
        'KR36_REQUEST_FAILED',
        response.msg || '36kr information flow request failed.',
        1,
        {
          code: response.code
        }
      );
    }

    return response;
  } catch (error) {
    if (error instanceof Kr36CommandError) {
      throw error;
    }

    throw new Kr36CommandError(
      'KR36_PARSE_ERROR',
      'Failed to parse 36kr information flow response.',
      2,
      {
        cause: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

function mapInformationItems(items: Kr36RawInformationItem[]): Kr36InformationItem[] {
  return items.map((item) => {
    const material = item.templateMaterial ?? {};
    const mapped: Kr36InformationItem = {
      id: item.itemId,
      title: material.widgetTitle ?? '',
      url: `${KR36_SITE_ORIGIN}/p/${item.itemId}`
    };

    if (material.authorName !== undefined) {
      mapped.authorName = material.authorName;
    }
    if (material.authorRoute !== undefined) {
      mapped.authorRoute = material.authorRoute;
    }
    if (material.widgetImage !== undefined) {
      mapped.image = material.widgetImage;
    }
    if (material.publishTime !== undefined) {
      mapped.publishTime = {
        iso: new Date(material.publishTime).toISOString(),
        local: formatChinaTime(material.publishTime),
        ms: material.publishTime
      };
    }
    if (item.route !== undefined) {
      mapped.route = item.route;
    }
    if (material.summary !== undefined) {
      mapped.summary = material.summary;
    }

    return mapped;
  });
}

function mapInformationPageItems(items: Kr36RawInformationItem[]): Kr36InformationItem[] {
  if (items.length > KR36_INFORMATION_PAGE_SIZE) {
    throw new Kr36CommandError(
      'KR36_RESOURCE_LIMIT',
      '36kr information response exceeded the configured item limit.',
      2,
      {
        maxItemsPerPage: KR36_INFORMATION_PAGE_SIZE,
        receivedItems: items.length
      }
    );
  }
  return mapInformationItems(items);
}

function addInformationRetainedBytes(
  retainedBytes: number,
  items: Kr36InformationItem[]
): number {
  const nextRetainedBytes = retainedBytes
    + Buffer.byteLength(JSON.stringify(items), 'utf8');
  if (nextRetainedBytes > KR36_INFORMATION_MAX_RETAINED_BYTES) {
    throw new Kr36CommandError(
      'KR36_RESOURCE_LIMIT',
      '36kr information results exceeded the configured size limit.',
      2,
      {
        maxRetainedBytes: KR36_INFORMATION_MAX_RETAINED_BYTES,
        retainedBytes: nextRetainedBytes
      }
    );
  }
  return nextRetainedBytes;
}

function extractParagraphs(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .split(/\n+/)
    .map((value) => decodeHtmlEntities(value).trim())
    .filter(Boolean);
}

function getAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}=["']([^"']+)["']`, 'i').exec(tag);
  return match?.[1] ?? null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function buildStats(
  likeCount: number | undefined,
  favoriteCount: number | undefined,
  recommend: Kr36RawRecommendData
): Kr36ArticleStats {
  return {
    authorArticleCount: recommend.statArticle ?? 0,
    collect: recommend.statCollect ?? 0,
    comment: recommend.statComment ?? 0,
    favoriteCount: favoriteCount ?? 0,
    likeCount: likeCount ?? 0,
    praise: recommend.statPraise ?? 0
  };
}

function buildAuthor(
  rawArticle: Kr36RawArticle,
  recommend: Kr36RawRecommendData
): Kr36ArticleAuthor {
  const author: Kr36ArticleAuthor = {
    name: rawArticle.author ?? recommend.authorName ?? ''
  };
  const face = rawArticle.authorFace ?? recommend.authorFace;

  if (face !== undefined) {
    author.face = face;
  }
  if (rawArticle.authorId !== undefined) {
    author.id = rawArticle.authorId;
  }
  if (rawArticle.authorRoute !== undefined) {
    author.route = rawArticle.authorRoute;
  }
  if (recommend.authorSummary !== undefined) {
    author.summary = recommend.authorSummary;
  }
  if (recommend.authorTitle !== undefined) {
    author.title = recommend.authorTitle;
  }

  return author;
}

function formatChinaTime(timestampMs: number): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric'
  });

  return formatter.format(new Date(timestampMs));
}
