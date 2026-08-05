import { describe, expect, it } from 'vitest';

import {
  renderKr36ArticleAsJson,
  renderKr36CommandErrorAsJson,
  renderKr36InformationListAsJson,
  renderKr36InformationListAsTable
} from '../../src/36kr/output.js';
import type { Kr36Article, Kr36InformationList } from '../../src/36kr/types.js';

const list: Kr36InformationList = {
  channel: 'AI',
  items: [
    {
      authorName: 'Stephen',
      id: 1,
      publishTime: {
        iso: '2026-07-23T00:00:00.000Z',
        local: '2026-07-23 08:00:00',
        ms: 1784764800000
      },
      title: 'Example',
      url: 'https://36kr.com/p/1'
    }
  ],
  meta: {
    fetchedPages: 1,
    hasNextPage: 0,
    nextPageCallback: '',
    pageSize: 30,
    totalItems: 1
  },
  request: {
    firstPage: {
      body: {},
      headers: {},
      url: 'https://gateway.36kr.com/api/mis/nav/ifm/subNav/flow'
    },
    nextPageEndpoint: 'https://gateway.36kr.com'
  }
};

describe('36Kr output', () => {
  it('wraps article and list results in successful JSON envelopes', () => {
    const article = { id: '1', title: 'Example' } as Kr36Article;

    expect(JSON.parse(renderKr36ArticleAsJson(article))).toEqual({ ok: true, data: article });
    expect(JSON.parse(renderKr36InformationListAsJson(list))).toEqual({ ok: true, data: list });
  });

  it('renders stable information table columns', () => {
    const rendered = renderKr36InformationListAsTable(list);

    expect(rendered).toContain('id');
    expect(rendered).toContain('title');
    expect(rendered).toContain('author');
    expect(rendered).toContain('publishTime');
    expect(rendered).toContain('https://36kr.com/p/1');

    const sparseRendered = renderKr36InformationListAsTable({
      ...list,
      items: [{ id: 2, title: 'Sparse', url: 'https://36kr.com/p/2' }]
    });
    expect(sparseRendered).toContain('Sparse');
  });

  it('removes terminal control characters from information tables', () => {
    const rendered = renderKr36InformationListAsTable({
      ...list,
      items: [{
        authorName: 'author\nline',
        id: 3,
        title: 'unsafe\u001b[2Jtitle',
        url: 'https://36kr.com/p/3\u0000\u009b31m'
      }]
    });

    expect(rendered).not.toContain('\u001b');
    expect(rendered).not.toContain('\u0000');
    expect(rendered).not.toContain('\u009b');
    expect(rendered).toContain('unsafetitle');
    expect(rendered).toContain('author line');
  });

  it('omits absent details from error JSON', () => {
    expect(JSON.parse(renderKr36CommandErrorAsJson('KR36_ERROR', 'Failed'))).toEqual({
      ok: false,
      error: {
        code: 'KR36_ERROR',
        message: 'Failed'
      }
    });
    expect(JSON.parse(renderKr36CommandErrorAsJson('KR36_ERROR', 'Failed', { id: 1 }))).toEqual({
      ok: false,
      error: {
        code: 'KR36_ERROR',
        details: { id: 1 },
        message: 'Failed'
      }
    });
  });
});
