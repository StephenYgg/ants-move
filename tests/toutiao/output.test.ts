import { describe, expect, it } from 'vitest';

import {
  renderToutiaoArticleAsJson,
  renderToutiaoAuthorAsJson,
  renderToutiaoAuthorAsTable,
  renderToutiaoCommandErrorAsJson,
  renderToutiaoListAsJson,
  renderToutiaoListAsTable
} from '../../src/toutiao/output.js';
import type {
  ToutiaoArticle,
  ToutiaoAuthorResult,
  ToutiaoListResult
} from '../../src/toutiao/types.js';

const item = {
  authorName: 'Stephen',
  commentCount: 2,
  id: '1',
  title: 'Example',
  url: 'https://www.toutiao.com/article/1/'
};
const list: ToutiaoListResult = {
  hasMore: false,
  items: [item],
  meta: { fetchedPages: 1, totalItems: 1 },
  source: 'tech'
};
const author: ToutiaoAuthorResult = {
  authorToken: 'author-token-value',
  hasMore: false,
  items: [item],
  meta: { fetchedPages: 1, totalItems: 1, withContent: false },
  request: { input: 'author-token-value', url: 'https://www.toutiao.com/author' }
};
const article: ToutiaoArticle = {
  content: { paragraphs: ['Body'], text: 'Body' },
  id: '1',
  request: { input: '1', url: 'https://www.toutiao.com/article/1/' },
  title: 'Example',
  url: 'https://www.toutiao.com/article/1/'
};

describe('Toutiao output', () => {
  it('wraps list, author, and article results in successful JSON envelopes', () => {
    expect(JSON.parse(renderToutiaoListAsJson(list))).toEqual({ ok: true, data: list });
    expect(JSON.parse(renderToutiaoAuthorAsJson(author))).toEqual({ ok: true, data: author });
    expect(JSON.parse(renderToutiaoArticleAsJson(article))).toEqual({ ok: true, data: article });
  });

  it('renders stable list and author table columns', () => {
    for (const rendered of [
      renderToutiaoListAsTable(list),
      renderToutiaoAuthorAsTable(author)
    ]) {
      expect(rendered).toContain('id');
      expect(rendered).toContain('title');
      expect(rendered).toContain('author');
      expect(rendered).toContain('publishTime');
      expect(rendered).toContain('comments');
      expect(rendered).toContain('url');
    }
  });

  it('removes terminal control characters from list and author tables', () => {
    const unsafeItem = {
      ...item,
      authorName: 'author\nline',
      title: 'unsafe\u001b[2Jtitle',
      url: 'https://www.toutiao.com/article/1/\u0000\u009b31m'
    };

    for (const rendered of [
      renderToutiaoListAsTable({ ...list, items: [unsafeItem] }),
      renderToutiaoAuthorAsTable({ ...author, items: [unsafeItem] })
    ]) {
      expect(rendered).not.toContain('\u001b');
      expect(rendered).not.toContain('\u0000');
      expect(rendered).not.toContain('\u009b');
      expect(rendered).toContain('unsafetitle');
      expect(rendered).toContain('author line');
    }
  });

  it('renders errors with optional details', () => {
    expect(JSON.parse(renderToutiaoCommandErrorAsJson('TOUTIAO_ERROR', 'Failed'))).toEqual({
      ok: false,
      error: { code: 'TOUTIAO_ERROR', message: 'Failed' }
    });
    expect(JSON.parse(renderToutiaoCommandErrorAsJson(
      'TOUTIAO_ERROR',
      'Failed',
      { source: 'tech' }
    ))).toEqual({
      ok: false,
      error: {
        code: 'TOUTIAO_ERROR',
        details: { source: 'tech' },
        message: 'Failed'
      }
    });
  });
});
