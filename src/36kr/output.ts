import { renderSafeTable } from '../output.js';
import type { Kr36Article, Kr36InformationList } from './types.js';

export function renderKr36ArticleAsJson(article: Kr36Article): string {
  return JSON.stringify(
    {
      ok: true,
      data: article
    },
    null,
    2
  );
}

export function renderKr36InformationListAsJson(list: Kr36InformationList): string {
  return JSON.stringify(
    {
      ok: true,
      data: list
    },
    null,
    2
  );
}

export function renderKr36InformationListAsTable(list: Kr36InformationList): string {
  return renderSafeTable([
    ['id', 'title', 'author', 'publishTime', 'url'],
    ...list.items.map((item) => [
      String(item.id),
      item.title,
      item.authorName ?? '',
      item.publishTime?.local ?? '',
      item.url
    ])
  ]);
}

export function renderKr36CommandErrorAsJson(
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
