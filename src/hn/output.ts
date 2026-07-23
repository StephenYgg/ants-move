import { renderSafeTable } from '../output.js';
import type { HackerNewsSearchResult, HackerNewsStoriesResult } from './types.js';

export function renderHackerNewsStoriesAsJson(result: HackerNewsStoriesResult): string {
  return JSON.stringify(
    {
      ok: true,
      data: result
    },
    null,
    2
  );
}

export function renderHackerNewsStoriesAsTable(result: HackerNewsStoriesResult): string {
  return renderSafeTable([
    ['id', 'title', 'author', 'score', 'comments', 'time', 'url'],
    ...result.items.map((item) => [
      String(item.id),
      item.title,
      item.author ?? '',
      item.score === undefined ? '' : String(item.score),
      item.commentCount === undefined ? '' : String(item.commentCount),
      item.time?.iso ?? '',
      item.url
    ])
  ]);
}

export function renderHackerNewsSearchAsJson(result: HackerNewsSearchResult): string {
  return JSON.stringify(
    {
      ok: true,
      data: result
    },
    null,
    2
  );
}

export function renderHackerNewsSearchAsTable(result: HackerNewsSearchResult): string {
  return renderSafeTable([
    ['id', 'title', 'author', 'score', 'comments', 'time', 'url'],
    ...result.items.map((item) => [
      String(item.id),
      item.title,
      item.author ?? '',
      item.score === undefined ? '' : String(item.score),
      item.commentCount === undefined ? '' : String(item.commentCount),
      item.time?.iso ?? '',
      item.url
    ])
  ]);
}

export function renderHackerNewsCommandErrorAsJson(
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
