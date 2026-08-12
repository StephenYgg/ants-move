import { describe, expect, it } from 'vitest';

import {
  renderMediaArticleAsJson,
  renderMediaCommandErrorAsJson,
  renderMediaListAsJson,
  renderMediaListAsTable
} from '../../src/media/output.js';
import type { MediaArticle, MediaListResult } from '../../src/media/types.js';

const list: MediaListResult = {
  channel: 'AI',
  items: [
    {
      id: '1',
      title: 'Hello',
      url: 'https://example.com/a',
      authorName: 'Ada',
      publishTime: { iso: '2026-08-12T00:00:00.000Z', ms: 1 }
    }
  ],
  meta: { limit: 20, source: 'wired', totalItems: 1 },
  request: { headers: {}, url: 'https://example.com/feed' },
  source: 'wired'
};

const article: MediaArticle = {
  content: { paragraphs: ['p1', 'p2'], text: 'p1\n\np2' },
  id: 'a',
  images: [{ index: 1, url: 'https://img/a.jpg' }],
  request: { headers: {}, url: 'https://example.com/a' },
  source: 'wired',
  title: 'Hello',
  url: 'https://example.com/a'
};

describe('media output', () => {
  it('renders list json envelope and table', () => {
    const json = JSON.parse(renderMediaListAsJson(list));
    expect(json.ok).toBe(true);
    expect(json.data.items).toHaveLength(1);
    expect(renderMediaListAsTable(list)).toContain('Hello');
  });

  it('renders article json and error envelope', () => {
    const json = JSON.parse(renderMediaArticleAsJson(article));
    expect(json.ok).toBe(true);
    expect(json.data.images[0].url).toBe('https://img/a.jpg');

    const error = JSON.parse(
      renderMediaCommandErrorAsJson('MEDIA_PARSE_ERROR', 'missing body', { url: 'x' })
    );
    expect(error.ok).toBe(false);
    expect(error.error.code).toBe('MEDIA_PARSE_ERROR');
    expect(error.error.details).toEqual({ url: 'x' });

    const plain = JSON.parse(renderMediaCommandErrorAsJson('MEDIA_PARSE_ERROR', 'missing body'));
    expect(plain.error.details).toBeUndefined();
  });
});
