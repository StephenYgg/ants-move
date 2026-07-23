import { describe, expect, it, vi } from 'vitest';

import {
  buildToutiaoArticleUrl,
  buildToutiaoAuthorToken,
  ToutiaoService
} from '../../src/toutiao/service.js';
import type {
  ToutiaoRuntime,
  ToutiaoSession
} from '../../src/toutiao/runtime.js';
import { ToutiaoCommandError } from '../../src/toutiao/types.js';

function createRuntime(overrides: Partial<ToutiaoSession> = {}): {
  runtime: ToutiaoRuntime;
  session: ToutiaoSession;
  withSession: ReturnType<typeof vi.fn>;
} {
  const session: ToutiaoSession = {
    fetchArticle: vi.fn(),
    fetchAuthorArticles: vi.fn(),
    fetchKeywordInformation: vi.fn(),
    fetchTechnologyChannel: vi.fn(),
    ...overrides
  };
  const withSession = vi.fn(async <T>(
    operation: (activeSession: ToutiaoSession) => Promise<T>
  ) => operation(session));

  return {
    runtime: { withSession: withSession as ToutiaoRuntime['withSession'] },
    session,
    withSession
  };
}

describe('ToutiaoService', () => {
  it('fetches the technology channel in one runtime session', async () => {
    const fetchTechnologyChannel = vi.fn(async () => ({
      hasMore: true,
      items: [{
        id: '7657359132571255323',
        title: 'Moon dust is the hardest lunar challenge',
        url: 'https://toutiao.com/group/7657359132571255323/'
      }],
      next: { maxBehotTime: 1_783_244_242, offset: 15 },
      source: 'tech' as const
    }));
    const dependencies = createRuntime({ fetchTechnologyChannel });
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    const result = await service.list({ pages: 1, source: 'tech' });

    expect(dependencies.withSession).toHaveBeenCalledOnce();
    expect(fetchTechnologyChannel).toHaveBeenCalledWith({ pages: 1 });
    expect(result.source).toBe('tech');
    expect(result.meta.totalItems).toBe(1);
  });

  it('uses the default page count when list pages are omitted', async () => {
    const fetchTechnologyChannel = vi.fn(async () => ({
      hasMore: false,
      items: [],
      source: 'tech' as const
    }));
    const dependencies = createRuntime({ fetchTechnologyChannel });
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    const result = await service.list({ source: 'tech' });

    expect(fetchTechnologyChannel).toHaveBeenCalledWith({ pages: 1 });
    expect(result.meta.fetchedPages).toBe(1);
  });

  it('fetches supported keyword sources through Toutiao search', async () => {
    const fetchKeywordInformation = vi.fn(async () => ({
      hasMore: false,
      items: [{
        id: '7658211264790839862',
        title: 'An early AI camera',
        url: 'https://www.toutiao.com/article/7658211264790839862/'
      }],
      keyword: 'AI',
      source: 'AI' as const
    }));
    const dependencies = createRuntime({ fetchKeywordInformation });
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    const result = await service.list({ pages: 1, source: 'AI' });

    expect(fetchKeywordInformation).toHaveBeenCalledWith({
      keyword: 'AI',
      pages: 1,
      source: 'AI'
    });
    expect(result.items[0]?.title).toContain('AI');
  });

  it('rejects unsupported sources before opening a browser session', async () => {
    const dependencies = createRuntime();
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    await expect(service.list({ pages: 1, source: 'finance' })).rejects.toMatchObject({
      code: 'TOUTIAO_INVALID_SOURCE',
      exitCode: 2
    });
    expect(dependencies.withSession).not.toHaveBeenCalled();
  });

  it('normalizes invalid pages into command errors before opening a session', async () => {
    const dependencies = createRuntime();
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    await expect(service.list({ pages: 0, source: 'tech' })).rejects.toBeInstanceOf(
      ToutiaoCommandError
    );
    await expect(service.list({ pages: 6, source: 'tech' })).rejects.toMatchObject({
      code: 'TOUTIAO_INVALID_PAGES'
    });
    expect(dependencies.withSession).not.toHaveBeenCalled();
  });

  it('fetches article detail by canonical id in one session', async () => {
    const fetchArticle = vi.fn(async () => ({
      content: {
        paragraphs: ['Article body.'],
        text: 'Article body.'
      },
      id: '7657359132571255323',
      request: {
        input: '7657359132571255323',
        url: 'https://www.toutiao.com/article/7657359132571255323/'
      },
      title: 'Article title',
      url: 'https://www.toutiao.com/article/7657359132571255323/'
    }));
    const dependencies = createRuntime({ fetchArticle });
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    const article = await service.article('7657359132571255323');

    expect(dependencies.withSession).toHaveBeenCalledOnce();
    expect(fetchArticle).toHaveBeenCalledWith({
      input: '7657359132571255323',
      url: 'https://www.toutiao.com/article/7657359132571255323/'
    });
    expect(article.content.text).toBe('Article body.');
  });

  it('normalizes group, legacy, and wrapped URLs into canonical article URLs', () => {
    expect(buildToutiaoArticleUrl(
      'https://toutiao.com/group/7657359132571255323/'
    )).toBe('https://www.toutiao.com/article/7657359132571255323/');
    expect(buildToutiaoArticleUrl(
      'http://www.toutiao.com/a7658559628753601033/'
    )).toBe('https://www.toutiao.com/article/7658559628753601033/');
    expect(buildToutiaoArticleUrl(
      'https://www.toutiao.com/redirect?url=https%3A%2F%2Fwww.toutiao.com%2Farticle%2F7657359132571255323%2F'
    )).toBe('https://www.toutiao.com/article/7657359132571255323/');
  });

  it('rejects a valid Toutiao URL that contains no article or redirect', () => {
    expect(() => buildToutiaoArticleUrl('https://www.toutiao.com/not-an-article'))
      .toThrowError(expect.objectContaining({ code: 'TOUTIAO_INVALID_ARTICLE' }));
  });

  it('rejects invalid article inputs before opening a session', async () => {
    const dependencies = createRuntime();
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    await expect(service.article('not-an-id')).rejects.toMatchObject({
      code: 'TOUTIAO_INVALID_ARTICLE',
      exitCode: 2
    });
    expect(dependencies.withSession).not.toHaveBeenCalled();
  });

  it('normalizes author homepage URLs into author tokens', () => {
    expect(buildToutiaoAuthorToken(
      'https://www.toutiao.com/c/user/token/MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80/?source=profile'
    )).toBe('MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80');
  });

  it('rejects invalid author inputs before opening a session', async () => {
    const dependencies = createRuntime();
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    await expect(service.author('short')).rejects.toMatchObject({
      code: 'TOUTIAO_INVALID_AUTHOR',
      exitCode: 2
    });
    expect(dependencies.withSession).not.toHaveBeenCalled();
  });

  it('fetches author articles by token', async () => {
    const fetchAuthorArticles = vi.fn(async () => ({
      authorToken: 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      hasMore: true,
      items: [{
        id: '7658940228585734665',
        title: 'An AI hardware article',
        url: 'https://www.toutiao.com/article/7658940228585734665/'
      }]
    }));
    const dependencies = createRuntime({ fetchAuthorArticles });
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    const result = await service.author(
      'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      { pages: 1 }
    );

    expect(dependencies.withSession).toHaveBeenCalledOnce();
    expect(fetchAuthorArticles).toHaveBeenCalledWith({
      authorToken: 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      pages: 1,
      url: 'https://www.toutiao.com/c/user/token/MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80/'
    });
    expect(result.meta).toMatchObject({
      fetchedPages: 1,
      totalItems: 1,
      withContent: false
    });
  });

  it('enriches author articles serially in the same session', async () => {
    const callOrder: string[] = [];
    const fetchAuthorArticles = vi.fn(async () => ({
      authorToken: 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      hasMore: false,
      items: [1, 2].map((id) => ({
        id: String(id),
        title: `Article ${id}`,
        url: `https://www.toutiao.com/article/${id}/`
      }))
    }));
    const fetchArticle = vi.fn(async ({ input, url }: { input: string; url: string }) => {
      callOrder.push(input);
      return {
        content: { paragraphs: [`Body ${input}`], text: `Body ${input}` },
        id: input,
        request: { input, url },
        title: `Article ${input}`,
        url
      };
    });
    const dependencies = createRuntime({ fetchArticle, fetchAuthorArticles });
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    const result = await service.author(
      'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      { pages: 1, withContent: true }
    );

    expect(dependencies.withSession).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(['1', '2']);
    expect(result.articles?.map((article) => article.id)).toEqual(['1', '2']);
    expect(result.meta.totalArticles).toBe(2);
  });

  it('stops author detail collection at ten retained megabytes', async () => {
    const body = 'x'.repeat(1024 * 1024);
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: String(index + 1),
      title: `Article ${index + 1}`,
      url: `https://www.toutiao.com/article/${index + 1}/`
    }));
    const fetchArticle = vi.fn(async ({ input, url }: { input: string; url: string }) => ({
      content: { paragraphs: [body], text: body },
      id: input,
      request: { input, url },
      title: `Article ${input}`,
      url
    }));
    const dependencies = createRuntime({
      fetchArticle,
      fetchAuthorArticles: vi.fn(async () => ({
        authorToken: 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
        hasMore: false,
        items
      }))
    });
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    const error = await service.author(
      'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      { withContent: true }
    ).then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(error).toMatchObject({
      code: 'TOUTIAO_RESOURCE_LIMIT',
      details: { maxRetainedBytes: 10 * 1024 * 1024 },
      exitCode: 2,
      message: 'Toutiao author content exceeded the configured size limit.'
    });
    expect(fetchArticle.mock.calls.length).toBeLessThan(items.length);
  });

  it('falls back to an author item id when its URL is empty', async () => {
    const fetchArticle = vi.fn(async ({ input, url }: { input: string; url: string }) => ({
      content: { paragraphs: ['Body'], text: 'Body' },
      id: input,
      request: { input, url },
      title: 'Article',
      url
    }));
    const dependencies = createRuntime({
      fetchArticle,
      fetchAuthorArticles: vi.fn(async () => ({
        authorToken: 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
        hasMore: false,
        items: [{ id: '9', title: 'Article', url: '' }]
      }))
    });
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    await service.author(
      'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      { withContent: true }
    );

    expect(fetchArticle).toHaveBeenCalledWith({
      input: '9',
      url: 'https://www.toutiao.com/article/9/'
    });
  });

  it('rejects more than 100 content details before fetching the first article', async () => {
    const fetchArticle = vi.fn();
    const fetchAuthorArticles = vi.fn(async () => ({
      authorToken: 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      hasMore: true,
      items: Array.from({ length: 101 }, (_, index) => ({
        id: String(index + 1),
        title: `Article ${index + 1}`,
        url: `https://www.toutiao.com/article/${index + 1}/`
      }))
    }));
    const dependencies = createRuntime({ fetchArticle, fetchAuthorArticles });
    const service = new ToutiaoService({ runtime: dependencies.runtime });

    await expect(service.author(
      'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      { pages: 5, withContent: true }
    )).rejects.toMatchObject({
      code: 'TOUTIAO_RESOURCE_LIMIT',
      details: { totalItems: 101 },
      exitCode: 2
    });
    expect(dependencies.withSession).toHaveBeenCalledOnce();
    expect(fetchArticle).not.toHaveBeenCalled();
  });
});
