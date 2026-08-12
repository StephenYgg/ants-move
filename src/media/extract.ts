import { load } from 'cheerio';

import {
  MediaCommandError,
  type MediaArticle,
  type MediaArticleAuthor,
  type MediaArticleImage,
  type MediaHttpRequest,
  type MediaPublishTime
} from './types.js';

export interface ExtractArticleOptions {
  html: string;
  request: MediaHttpRequest;
  source: string;
  url: string;
}

/**
 * Extract article fields using JSON-LD → Open Graph → HTML content chain.
 * Hard-fails when no usable body paragraphs are found.
 */
export function extractArticleFromHtml(options: ExtractArticleOptions): MediaArticle {
  const { html, request, source, url } = options;
  const jsonLd = extractJsonLdArticle(html);
  const og = extractOpenGraph(html);
  const htmlContent = extractHtmlContent(html, url);

  const title = firstNonEmpty(
    jsonLd?.headline,
    og.title,
    htmlContent.title,
    extractHtmlTitle(html)
  );
  const textBody = firstNonEmpty(jsonLd?.articleBody, htmlContent.text);
  let paragraphs: string[] = [];
  if (jsonLd?.articleBody) {
    paragraphs = splitParagraphs(jsonLd.articleBody);
  } else if (htmlContent.paragraphs.length > 0) {
    paragraphs = htmlContent.paragraphs;
  } else if (textBody) {
    paragraphs = splitParagraphs(textBody);
  }

  if (!title) {
    throw new MediaCommandError(
      'MEDIA_PARSE_ERROR',
      'Article title was not found in the page.',
      2,
      { url }
    );
  }

  if (paragraphs.length === 0) {
    throw new MediaCommandError(
      'MEDIA_PARSE_ERROR',
      'Article body was not found in the page.',
      2,
      { url }
    );
  }

  const images = mergeImages([
    ...(jsonLd?.images ?? []),
    ...(og.image ? [og.image] : []),
    ...htmlContent.images
  ]);
  const coverImage = firstNonEmpty(jsonLd?.coverImage, og.image, images[0]?.url);
  const author = jsonLd?.author ?? htmlContent.author;
  const publishTime =
    parseIsoTime(jsonLd?.datePublished) ??
    parseIsoTime(og.publishedTime) ??
    htmlContent.publishTime;
  const summary = firstNonEmpty(jsonLd?.description, og.description);
  const articleUrl = firstNonEmpty(jsonLd?.url, og.url, url) ?? url;
  const id = deriveArticleId(articleUrl, jsonLd?.id);

  const article: MediaArticle = {
    content: {
      paragraphs,
      text: textBody ? textBody.trim() : paragraphs.join('\n\n')
    },
    id,
    images,
    request,
    source,
    title: title.trim(),
    url: articleUrl
  };

  if (htmlContent.html) {
    article.content.html = htmlContent.html;
  }
  if (author) {
    article.author = author;
  }
  if (coverImage) {
    article.coverImage = coverImage;
  }
  if (publishTime) {
    article.publishTime = publishTime;
  }
  if (summary) {
    article.summary = summary.trim();
  }
  if (jsonLd?.section) {
    article.section = jsonLd.section;
  }
  if (jsonLd?.keywords && jsonLd.keywords.length > 0) {
    article.keywords = jsonLd.keywords;
  }

  return article;
}

interface JsonLdArticle {
  articleBody?: string;
  author?: MediaArticleAuthor;
  coverImage?: string;
  datePublished?: string;
  description?: string;
  headline?: string;
  id?: string;
  images?: string[];
  keywords?: string[];
  section?: string;
  url?: string;
}

function extractJsonLdArticle(html: string): JsonLdArticle | null {
  const blocks = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )
  ];

  for (const match of blocks) {
    const raw = (match[1] ?? '').trim();
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      for (const node of flattenJsonLdNodes(parsed)) {
        if (!isArticleType(node['@type'])) {
          continue;
        }

        const result: JsonLdArticle = {};
        const articleBody = asString(node.articleBody);
        const headline = asString(node.headline) ?? asString(node.name);
        const description =
          asString(node.description) ?? asString(node.alternativeHeadline);
        const url = asString(node.url) ?? asString(node.mainEntityOfPage);
        const datePublished =
          asString(node.datePublished) ?? asString(node.dateCreated);
        const section = asString(node.articleSection);
        const keywords = normalizeKeywords(node.keywords);
        const images = normalizeImageList(node.image ?? node.thumbnailUrl);
        const author = normalizeAuthor(node.author);
        const id = asString(node['@id']) ?? asString(node.identifier);

        if (articleBody) result.articleBody = articleBody;
        if (author) result.author = author;
        if (images[0]) result.coverImage = images[0];
        if (datePublished) result.datePublished = datePublished;
        if (description) result.description = description;
        if (headline) result.headline = headline;
        if (id) result.id = id;
        if (images.length > 0) result.images = images;
        if (keywords.length > 0) result.keywords = keywords;
        if (section) result.section = section;
        if (url) result.url = url;
        return result;
      }
    } catch {
      // try next block
    }
  }

  return null;
}

function flattenJsonLdNodes(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenJsonLdNodes(entry));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const record = value as Record<string, unknown>;
  const nodes = [record];
  if (Array.isArray(record['@graph'])) {
    nodes.push(...flattenJsonLdNodes(record['@graph']));
  }
  return nodes;
}

function isArticleType(typeValue: unknown): boolean {
  const types = Array.isArray(typeValue)
    ? typeValue.map(String)
    : typeValue
      ? [String(typeValue)]
      : [];
  return types.some((type) =>
    /^(NewsArticle|Article|BlogPosting|ReportageNewsArticle|TechArticle|ScholarlyArticle)$/i
      .test(type)
  );
}

function extractOpenGraph(html: string): {
  description?: string;
  image?: string;
  publishedTime?: string;
  title?: string;
  url?: string;
} {
  const get = (property: string): string | undefined => {
    const re = new RegExp(
      `<meta\\b[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      'i'
    );
    const reAlt = new RegExp(
      `<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["'][^>]*>`,
      'i'
    );
    return re.exec(html)?.[1] ?? reAlt.exec(html)?.[1];
  };

  const result: {
    description?: string;
    image?: string;
    publishedTime?: string;
    title?: string;
    url?: string;
  } = {};
  const description = get('og:description') ?? get('description');
  const image = get('og:image') ?? get('twitter:image');
  const publishedTime = get('article:published_time');
  const title = get('og:title');
  const url = get('og:url');
  if (description) result.description = description;
  if (image) result.image = image;
  if (publishedTime) result.publishedTime = publishedTime;
  if (title) result.title = title;
  if (url) result.url = url;
  return result;
}

function extractHtmlContent(
  html: string,
  pageUrl: string
): {
  author?: MediaArticleAuthor;
  html?: string;
  images: string[];
  paragraphs: string[];
  publishTime?: MediaPublishTime;
  text?: string;
  title?: string;
} {
  const $ = load(html);
  $('script, style, noscript, svg, iframe').remove();

  const titleText =
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    '';

  const candidates = [
    'article',
    '[itemprop="articleBody"]',
    '.article-body',
    '.article__body',
    '.post-content',
    '.entry-content',
    '.content-body',
    'main'
  ];

  let bodyHtml = '';
  for (const selector of candidates) {
    const node = $(selector).first();
    if (node.length > 0 && node.text().trim().length > 80) {
      bodyHtml = node.html() ?? '';
      break;
    }
  }

  if (!bodyHtml) {
    bodyHtml = $('body').html() ?? '';
  }

  const body = load(`<div id="root">${bodyHtml}</div>`);
  const paragraphs = body('#root')
    .find('p')
    .toArray()
    .map((el) => body(el).text().replace(/\s+/g, ' ').trim())
    .filter((text) => text.length > 0);

  const images: string[] = [];
  for (const el of body('#root').find('img').toArray()) {
    const node = body(el);
    const raw =
      node.attr('data-src') ||
      node.attr('data-lazy-src') ||
      pickSrcFromSrcset(node.attr('srcset')) ||
      node.attr('src') ||
      '';
    const absolute = absolutizeUrl(raw, pageUrl);
    if (absolute && !absolute.startsWith('data:')) {
      images.push(absolute);
    }
  }

  const authorName =
    $('meta[name="author"]').attr('content') ||
    $('[itemprop="author"] [itemprop="name"]').first().text().trim() ||
    $('[rel="author"]').first().text().trim() ||
    '';

  const published =
    $('meta[property="article:published_time"]').attr('content') ||
    $('time[datetime]').attr('datetime') ||
    '';

  const result: {
    author?: MediaArticleAuthor;
    html?: string;
    images: string[];
    paragraphs: string[];
    publishTime?: MediaPublishTime;
    text?: string;
    title?: string;
  } = {
    images: [...new Set(images)],
    paragraphs
  };

  if (authorName) {
    result.author = { name: authorName };
  }
  if (bodyHtml) {
    result.html = bodyHtml;
  }
  const publishTime = parseIsoTime(published || undefined);
  if (publishTime) {
    result.publishTime = publishTime;
  }
  if (paragraphs.length > 0) {
    result.text = paragraphs.join('\n\n');
  }
  if (titleText) {
    result.title = titleText;
  }
  return result;
}

function extractHtmlTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) {
    return undefined;
  }
  return decodeHtmlEntities(match[1].replace(/\s+/g, ' ').trim());
}

function mergeImages(urls: string[]): MediaArticleImage[] {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  return unique.map((url, index) => ({
    index: index + 1,
    url
  }));
}

function normalizeImageList(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === 'string') {
        return [entry];
      }
      if (entry && typeof entry === 'object' && 'url' in entry) {
        const url = asString((entry as { url?: unknown }).url);
        return url ? [url] : [];
      }
      return [];
    });
  }
  if (typeof value === 'object' && value && 'url' in value) {
    const url = asString((value as { url?: unknown }).url);
    return url ? [url] : [];
  }
  return [];
}

function normalizeAuthor(value: unknown): MediaArticleAuthor | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'string') {
    return { name: value };
  }
  if (Array.isArray(value)) {
    return normalizeAuthor(value[0]);
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const name = asString(record.name);
  if (!name) {
    return undefined;
  }
  const url = asString(record.url) ?? asString(record.sameAs);
  return url ? { name, url } : { name };
}

function normalizeKeywords(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String).map((part) => part.trim()).filter(Boolean);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === 'object' && '@id' in (value as object)) {
    const id = (value as { '@id'?: unknown })['@id'];
    if (typeof id === 'string' && id.trim()) {
      return id.trim();
    }
  }
  return undefined;
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (value && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}|\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseIsoTime(raw: string | undefined): MediaPublishTime | undefined {
  if (!raw) {
    return undefined;
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    return undefined;
  }
  return {
    iso: new Date(ms).toISOString(),
    ms
  };
}

function deriveArticleId(url: string, fallback?: string): string {
  if (fallback && fallback.trim()) {
    return fallback.trim();
  }
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = parts.at(-1);
    if (last) {
      return last.replace(/\/$/, '');
    }
    return parsed.pathname || url;
  } catch {
    return url;
  }
}

function pickSrcFromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) {
    return undefined;
  }
  const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
  return first ? first : undefined;
}

function absolutizeUrl(src: string, pageUrl: string): string | null {
  const value = src.trim();
  if (!value) {
    return null;
  }
  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
