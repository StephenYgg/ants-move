import { renderSafeTable } from '../output.js';
import type {
  XianyuAuthStatusResult,
  XianyuSearchResult
} from './types.js';
import { XianyuCommandError } from './types.js';

export function renderXianyuSearchAsJson(result: XianyuSearchResult): string {
  return JSON.stringify({ ok: true, data: result }, null, 2);
}

export function renderXianyuSearchAsTable(result: XianyuSearchResult): string {
  return renderSafeTable([
    ['itemId', 'price', 'title', 'area', 'url'],
    ...result.items.map((item) => [
      item.itemId,
      item.price,
      item.title,
      item.area ?? '',
      item.url
    ])
  ]);
}

export function renderXianyuAuthStatusAsJson(result: XianyuAuthStatusResult): string {
  return JSON.stringify({ ok: true, data: result }, null, 2);
}

export function renderXianyuCommandErrorAsJson(error: XianyuCommandError): string {
  return JSON.stringify(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    },
    null,
    2
  );
}
