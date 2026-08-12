import type { XianyuSearchItem } from './types.js';

const MAX_ITEMS_PER_PAGE = 30;
const SEARCH_API_MARKER = 'mtop.taobao.idlemtopsearch.pc.search/1.0';

export function isXianyuSearchApiUrl(url: string): boolean {
  return url.includes(SEARCH_API_MARKER);
}

export function isMtopSuccess(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const ret = (body as { ret?: unknown }).ret;
  if (!Array.isArray(ret)) {
    return false;
  }
  return ret.some((item) => typeof item === 'string' && item.includes('SUCCESS'));
}

export function extractPriceText(price: unknown): string {
  if (typeof price === 'string' || typeof price === 'number') {
    return String(price);
  }
  if (Array.isArray(price)) {
    return price
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return '';
}

export function parsePriceNumber(priceText: string): number | undefined {
  const normalized = priceText.replace(/[^\d.]/g, '');
  if (!normalized) {
    return undefined;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

export function buildItemUrl(itemId: string): string {
  return `https://www.goofish.com/item?id=${encodeURIComponent(itemId)}`;
}

/**
 * Map one SUCCESS mtop.taobao.idlemtopsearch.pc.search payload to list items.
 */
export function mapSearchResponse(body: unknown): {
  hasNextPage: boolean;
  items: XianyuSearchItem[];
} {
  if (!body || typeof body !== 'object') {
    return { hasNextPage: false, items: [] };
  }

  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') {
    return { hasNextPage: false, items: [] };
  }

  const resultInfo = (data as { resultInfo?: { hasNextPage?: boolean } }).resultInfo;
  const hasNextPage = Boolean(resultInfo?.hasNextPage);
  const resultList = (data as { resultList?: unknown }).resultList;
  if (!Array.isArray(resultList)) {
    return { hasNextPage, items: [] };
  }

  const items: XianyuSearchItem[] = [];
  for (const entry of resultList) {
    if (items.length >= MAX_ITEMS_PER_PAGE) {
      break;
    }
    const item = mapResultListEntry(entry);
    if (item) {
      items.push(item);
    }
  }

  return { hasNextPage, items };
}

function mapResultListEntry(entry: unknown): XianyuSearchItem | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const exContent = digExContent(entry);
  if (!exContent) {
    return undefined;
  }

  const detailParams =
    exContent.detailParams && typeof exContent.detailParams === 'object'
      ? (exContent.detailParams as Record<string, unknown>)
      : {};

  const itemId = String(exContent.itemId ?? detailParams.itemId ?? '').trim();
  const title = String(exContent.title ?? detailParams.title ?? '').trim();
  if (!itemId || !title) {
    return undefined;
  }

  const priceText =
    extractPriceText(detailParams.soldPrice)
    || extractPriceText(detailParams.price)
    || extractPriceText(exContent.price);
  const priceNumber = parsePriceNumber(priceText);
  const item: XianyuSearchItem = {
    itemId,
    price: priceText || '',
    title,
    url: buildItemUrl(itemId)
  };

  if (priceNumber !== undefined) {
    item.priceNumber = priceNumber;
  }
  if (typeof exContent.area === 'string' && exContent.area.trim()) {
    item.area = exContent.area.trim();
  }
  if (typeof exContent.picUrl === 'string' && exContent.picUrl.trim()) {
    item.picUrl = exContent.picUrl.trim();
  }
  if (typeof detailParams.userNick === 'string' && detailParams.userNick.trim()) {
    item.userNick = detailParams.userNick.trim();
  }

  return item;
}

function digExContent(entry: unknown): Record<string, unknown> | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const data = (entry as { data?: unknown }).data;
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const item = (data as { item?: unknown }).item;
  if (!item || typeof item !== 'object') {
    return undefined;
  }
  const main = (item as { main?: unknown }).main;
  if (!main || typeof main !== 'object') {
    return undefined;
  }
  const exContent = (main as { exContent?: unknown }).exContent;
  if (!exContent || typeof exContent !== 'object') {
    return undefined;
  }
  return exContent as Record<string, unknown>;
}

export const XIANYU_MAX_ITEMS_PER_PAGE = MAX_ITEMS_PER_PAGE;
