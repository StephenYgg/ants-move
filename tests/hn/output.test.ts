import { describe, expect, it } from 'vitest';

import {
  renderHackerNewsCommandErrorAsJson,
  renderHackerNewsSearchAsJson,
  renderHackerNewsSearchAsTable,
  renderHackerNewsStoriesAsJson,
  renderHackerNewsStoriesAsTable
} from '../../src/hn/output.js';
import type {
  HackerNewsSearchResult,
  HackerNewsStoriesResult
} from '../../src/hn/types.js';

const item = {
  author: 'pg',
  commentCount: 3,
  id: 1,
  score: 42,
  time: {
    iso: '2026-07-23T00:00:00.000Z',
    seconds: 1784764800
  },
  title: 'Example',
  type: 'story' as const,
  url: 'https://example.com/story'
};

describe('Hacker News output', () => {
  it('wraps story and search results in successful JSON envelopes', () => {
    const stories: HackerNewsStoriesResult = {
      items: [item],
      meta: { limit: 1, totalItems: 1 },
      source: 'top'
    };
    const search: HackerNewsSearchResult = {
      items: [item],
      meta: { limit: 1, sort: 'relevance', totalItems: 1 },
      query: 'example'
    };

    expect(JSON.parse(renderHackerNewsStoriesAsJson(stories))).toEqual({
      ok: true,
      data: stories
    });
    expect(JSON.parse(renderHackerNewsSearchAsJson(search))).toEqual({
      ok: true,
      data: search
    });
  });

  it('renders stable story and search table columns', () => {
    const stories: HackerNewsStoriesResult = {
      items: [item],
      meta: { limit: 1, totalItems: 1 },
      source: 'best'
    };
    const search: HackerNewsSearchResult = {
      items: [item],
      meta: { limit: 1, sort: 'date', totalItems: 1 },
      query: 'example'
    };

    for (const rendered of [
      renderHackerNewsStoriesAsTable(stories),
      renderHackerNewsSearchAsTable(search)
    ]) {
      expect(rendered).toContain('id');
      expect(rendered).toContain('title');
      expect(rendered).toContain('author');
      expect(rendered).toContain('score');
      expect(rendered).toContain('comments');
      expect(rendered).toContain('time');
      expect(rendered).toContain('url');
    }

    const sparseItem = {
      id: 2,
      title: 'Sparse story',
      type: 'story' as const,
      url: 'https://news.ycombinator.com/item?id=2'
    };
    expect(renderHackerNewsStoriesAsTable({
      items: [sparseItem],
      meta: { limit: 1, totalItems: 1 },
      source: 'top'
    })).toContain('Sparse story');
    expect(renderHackerNewsSearchAsTable({
      items: [sparseItem],
      meta: { limit: 1, sort: 'relevance', totalItems: 1 },
      query: 'sparse'
    })).toContain('Sparse story');
  });

  it('removes terminal control characters from story and search tables', () => {
    const unsafeItem = {
      ...item,
      author: 'author\nline',
      title: 'unsafe\u001b[2Jtitle',
      url: 'https://example.com/story\u0000\u009b31m'
    };
    const stories: HackerNewsStoriesResult = {
      items: [unsafeItem],
      meta: { limit: 1, totalItems: 1 },
      source: 'top'
    };
    const search: HackerNewsSearchResult = {
      items: [unsafeItem],
      meta: { limit: 1, sort: 'relevance', totalItems: 1 },
      query: 'unsafe'
    };

    for (const rendered of [
      renderHackerNewsStoriesAsTable(stories),
      renderHackerNewsSearchAsTable(search)
    ]) {
      expect(rendered).not.toContain('\u001b');
      expect(rendered).not.toContain('\u0000');
      expect(rendered).not.toContain('\u009b');
      expect(rendered).toContain('unsafetitle');
      expect(rendered).toContain('author line');
    }
  });

  it('renders errors with optional details', () => {
    expect(JSON.parse(renderHackerNewsCommandErrorAsJson('HN_ERROR', 'Failed'))).toEqual({
      ok: false,
      error: { code: 'HN_ERROR', message: 'Failed' }
    });
    expect(JSON.parse(renderHackerNewsCommandErrorAsJson(
      'HN_ERROR',
      'Failed',
      { source: 'top' }
    ))).toEqual({
      ok: false,
      error: {
        code: 'HN_ERROR',
        details: { source: 'top' },
        message: 'Failed'
      }
    });
  });
});
