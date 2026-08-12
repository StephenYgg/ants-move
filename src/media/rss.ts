import { MediaCommandError, type MediaListItem, type MediaPublishTime } from './types.js';

const ITEM_RE = /<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi;

export interface MediaFeedEntry extends MediaListItem {
  /** Raw HTML body when content:encoded / atom content is present. */
  contentHtml?: string;
}

export function parseRssOrAtomFeed(xml: string): MediaListItem[] {
  return parseRssOrAtomEntries(xml).map((entry) => {
    const { contentHtml: _contentHtml, ...item } = entry;
    return item;
  });
}

export function parseRssOrAtomEntries(xml: string): MediaFeedEntry[] {
  if (!xml || !xml.trim()) {
    throw new MediaCommandError(
      'MEDIA_PARSE_ERROR',
      'Media feed response was empty.',
      2
    );
  }

  const blocks = xml.match(ITEM_RE) ?? [];
  if (blocks.length === 0) {
    throw new MediaCommandError(
      'MEDIA_PARSE_ERROR',
      'No feed items were found in the media feed response.',
      2
    );
  }

  const items: MediaFeedEntry[] = [];

  for (const block of blocks) {
    const title = firstText(block, ['title']);
    const link = extractLink(block);
    const guid = firstText(block, ['guid', 'id']);
    const id = guid || link || title;
    if (!title || !link || !id) {
      continue;
    }

    const contentHtml =
      firstText(block, ['content:encoded', 'content']) ?? undefined;
    const summary =
      firstText(block, ['description', 'summary']) ?? contentHtml ?? undefined;
    const authorName =
      firstText(block, ['dc:creator', 'creator', 'name']) ??
      firstText(block, ['author']) ??
      undefined;
    const pubRaw = firstText(block, ['pubDate', 'published', 'updated', 'dc:date']);
    const image =
      extractMediaThumbnail(block) ??
      extractEnclosureImage(block) ??
      extractFirstImgSrc(contentHtml ?? summary ?? '') ??
      undefined;
    const categories = extractCategories(block);
    const keywords = extractKeywords(block);

    const item: MediaFeedEntry = {
      id: stripCdata(id).trim(),
      title: decodeXmlEntities(stripCdata(title)).trim(),
      url: normalizeUrl(stripCdata(link).trim())
    };

    if (authorName) {
      item.authorName = decodeXmlEntities(stripHtml(stripCdata(authorName))).trim();
    }
    if (summary) {
      item.summary = decodeXmlEntities(stripHtml(stripCdata(summary))).trim();
    }
    if (contentHtml) {
      item.contentHtml = stripCdata(contentHtml).trim();
    }
    if (pubRaw) {
      const publishTime = parsePublishTime(stripCdata(pubRaw).trim());
      if (publishTime) {
        item.publishTime = publishTime;
      }
    }
    if (image) {
      item.image = image;
      item.images = [image];
    }
    if (categories.length > 0) {
      item.categories = categories;
    }
    if (keywords.length > 0) {
      item.keywords = keywords;
    }

    items.push(item);
  }

  if (items.length === 0) {
    throw new MediaCommandError(
      'MEDIA_PARSE_ERROR',
      'Feed items could not be mapped to media list entries.',
      2
    );
  }

  return items;
}

export function findFeedEntryByUrl(
  entries: MediaFeedEntry[],
  articleUrl: string
): MediaFeedEntry | undefined {
  const target = normalizeComparUrl(articleUrl);
  return entries.find((entry) => normalizeComparUrl(entry.url) === target);
}

function normalizeComparUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${path}`.toLowerCase();
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
}

function extractLink(block: string): string | null {
  const atomLink = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  if (atomLink?.[1]) {
    return atomLink[1];
  }

  const rssLink = firstText(block, ['link']);
  return rssLink;
}

function extractMediaThumbnail(block: string): string | null {
  const match =
    /<media:thumbnail\b[^>]*\burl=["']([^"']+)["'][^>]*\/?>/i.exec(block) ??
    /<media:content\b[^>]*\burl=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  return match?.[1] ?? null;
}

function extractEnclosureImage(block: string): string | null {
  const match =
    /<enclosure\b[^>]*\btype=["']image\/[^"']+["'][^>]*\burl=["']([^"']+)["'][^>]*\/?>/i
      .exec(block) ??
    /<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*\btype=["']image\/[^"']+["'][^>]*\/?>/i
      .exec(block);
  return match?.[1] ?? null;
}

function extractFirstImgSrc(html: string): string | null {
  const match = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(html);
  return match?.[1] ?? null;
}

function extractCategories(block: string): string[] {
  const values: string[] = [];
  for (const match of block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)) {
    const value = decodeXmlEntities(stripCdata(match[1] ?? '')).trim();
    if (value) {
      values.push(value);
    }
  }
  for (const match of block.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["'][^>]*\/?>/gi)) {
    const value = decodeXmlEntities(match[1] ?? '').trim();
    if (value) {
      values.push(value);
    }
  }
  return [...new Set(values)];
}

function extractKeywords(block: string): string[] {
  const raw = firstText(block, ['media:keywords']);
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((part) => decodeXmlEntities(part).trim())
    .filter(Boolean);
}

function firstText(block: string, tags: string[]): string | null {
  for (const tag of tags) {
    const escaped = tag.replace(':', '\\:');
    const re = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i');
    const match = re.exec(block);
    if (match?.[1] !== undefined && match[1].trim()) {
      // Atom <author><name>...</name></author> and similar nested markup.
      const nestedName = /<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(match[1]);
      if (nestedName?.[1]?.trim()) {
        return nestedName[1];
      }
      return match[1];
    }
  }
  return null;
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16))
    )
    .replace(/&amp;/g, '&');
}

function normalizeUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

function parsePublishTime(raw: string): MediaPublishTime | null {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return {
    iso: new Date(ms).toISOString(),
    ms
  };
}
