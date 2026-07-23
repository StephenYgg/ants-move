import { renderSafeTable } from '../output.js';
import type { ToutiaoArticle, ToutiaoAuthorResult, ToutiaoListResult } from './types.js';

export function renderToutiaoListAsJson(result: ToutiaoListResult): string {
  return JSON.stringify(
    {
      ok: true,
      data: result
    },
    null,
    2
  );
}

export function renderToutiaoListAsTable(result: ToutiaoListResult): string {
  return renderSafeTable([
    ['id', 'title', 'author', 'publishTime', 'comments', 'url'],
    ...result.items.map((item) => [
      item.id,
      item.title,
      item.authorName ?? '',
      item.publishTime?.local ?? '',
      item.commentCount === undefined ? '' : String(item.commentCount),
      item.url
    ])
  ]);
}

export function renderToutiaoArticleAsJson(article: ToutiaoArticle): string {
  return JSON.stringify(
    {
      ok: true,
      data: article
    },
    null,
    2
  );
}

export function renderToutiaoAuthorAsJson(result: ToutiaoAuthorResult): string {
  return JSON.stringify(
    {
      ok: true,
      data: result
    },
    null,
    2
  );
}

export function renderToutiaoAuthorAsTable(result: ToutiaoAuthorResult): string {
  return renderSafeTable([
    ['id', 'title', 'author', 'publishTime', 'comments', 'url'],
    ...result.items.map((item) => [
      item.id,
      item.title,
      item.authorName ?? '',
      item.publishTime?.local ?? '',
      item.commentCount === undefined ? '' : String(item.commentCount),
      item.url
    ])
  ]);
}

export function renderToutiaoCommandErrorAsJson(
  code: string,
  message: string,
  details?: unknown
): string {
  return JSON.stringify(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details })
      }
    },
    null,
    2
  );
}
