import { renderSafeTable } from '../output.js';
import type { MediaArticle, MediaListResult } from './types.js';

export function renderMediaListAsJson(list: MediaListResult): string {
  return JSON.stringify(
    {
      ok: true,
      data: list
    },
    null,
    2
  );
}

export function renderMediaListAsTable(list: MediaListResult): string {
  return renderSafeTable([
    ['id', 'title', 'author', 'publishTime', 'url'],
    ...list.items.map((item) => [
      item.id,
      item.title,
      item.authorName ?? '',
      item.publishTime?.iso ?? '',
      item.url
    ])
  ]);
}

export function renderMediaArticleAsJson(article: MediaArticle): string {
  return JSON.stringify(
    {
      ok: true,
      data: article
    },
    null,
    2
  );
}

export function renderMediaCommandErrorAsJson(
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
