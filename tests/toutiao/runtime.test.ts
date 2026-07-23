import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';

import { createDefaultToutiaoRuntime } from '../../src/toutiao/runtime.js';
import { ToutiaoService } from '../../src/toutiao/service.js';

interface FakeResponse {
  body: () => Promise<Buffer>;
  headerValue: (name: string) => Promise<string | null>;
  json: () => Promise<unknown>;
  url: () => string;
}

type ResponseHandler = (response: FakeResponse) => void;

interface FakeRoute {
  abort: ReturnType<typeof vi.fn>;
  continue: ReturnType<typeof vi.fn>;
  request: () => {
    resourceType: () => string;
  };
}

type RouteHandler = (route: FakeRoute) => Promise<void> | void;

interface FakePageOptions {
  anchors?: (url: string) => Array<{ href: string; text: string | null }>;
  body?: (url: string) => string;
  captcha?: (url: string) => boolean;
  finalUrl?: (url: string) => string;
  onGoto?: (url: string, page: FakePage) => Promise<void> | void;
  onWait?: (page: FakePage) => Promise<void> | void;
  paragraphs?: (url: string) => Array<string | null>;
  title?: (url: string) => string;
  titleError?: boolean;
}

class FakePage {
  readonly mouse = {
    wheel: vi.fn(async () => undefined)
  };
  readonly navigationListenerCounts: number[] = [];
  readonly responseHandlers = new Set<ResponseHandler>();
  readonly routeHandlers: RouteHandler[] = [];
  private currentUrl = 'about:blank';

  constructor(private readonly options: FakePageOptions = {}) {}

  readonly goto = vi.fn(async (url: string) => {
    this.currentUrl = this.options.finalUrl?.(url) ?? url;
    this.navigationListenerCounts.push(this.responseHandlers.size);
    await this.options.onGoto?.(url, this);
  });

  readonly locator = vi.fn((selector: string) => ({
    count: async () => selector === '#pc_captcha'
      && (this.options.captcha?.(this.currentUrl) ?? false)
      ? 1
      : 0,
    evaluateAll: async (evaluate: (nodes: Array<{
      href?: string;
      textContent: string | null;
    }>) => unknown) => {
      if (selector === 'article p') {
        return evaluate((this.options.paragraphs?.(this.currentUrl) ?? []).map((text) => ({
          textContent: text
        })));
      }
      if (selector === 'a') {
        return evaluate((this.options.anchors?.(this.currentUrl) ?? []).map(({ href, text }) => ({
          href,
          textContent: text
        })));
      }
      return evaluate([]);
    },
    first: () => ({
      innerText: async () => {
        if (this.options.titleError) {
          throw new Error('title unavailable');
        }
        return this.options.title?.(this.currentUrl) ?? '';
      }
    }),
    innerText: async () => this.options.body?.(this.currentUrl) ?? ''
  }));

  readonly off = vi.fn((event: string, handler: ResponseHandler) => {
    if (event === 'response') {
      this.responseHandlers.delete(handler);
    }
  });

  readonly on = vi.fn((event: string, handler: ResponseHandler) => {
    if (event === 'response') {
      this.responseHandlers.add(handler);
    }
  });

  readonly route = vi.fn(async (_pattern: string, handler: RouteHandler) => {
    this.routeHandlers.push(handler);
  });

  readonly url = vi.fn(() => this.currentUrl);

  readonly waitForTimeout = vi.fn(async () => {
    await this.options.onWait?.(this);
  });

  async emitResponse(
    url: string,
    json: unknown,
    options: { contentLength?: string } = {}
  ): Promise<void> {
    const response: FakeResponse = {
      body: async () => Buffer.from(JSON.stringify(json)),
      headerValue: async (name) => name.toLowerCase() === 'content-length'
        ? options.contentLength ?? null
        : null,
      json: async () => json,
      url: () => url
    };

    for (const handler of [...this.responseHandlers]) {
      handler(response);
    }
    await Promise.resolve();
  }

  async emitRejectedResponse(url: string): Promise<void> {
    const response: FakeResponse = {
      body: async () => Buffer.from('{invalid-json'),
      headerValue: async () => null,
      json: async () => {
        throw new Error('invalid response JSON');
      },
      url: () => url
    };

    for (const handler of [...this.responseHandlers]) {
      handler(response);
    }
    await Promise.resolve();
  }
}

function createBrowserHarness(options: {
  browserCloseError?: Error;
  contextCloseError?: Error;
  onBrowserClose?: () => Promise<void> | void;
  page?: FakePage;
} = {}) {
  const page = options.page ?? new FakePage();
  const contextClose = vi.fn(async () => {
    if (options.contextCloseError) {
      throw options.contextCloseError;
    }
  });
  const browserClose = vi.fn(async () => {
    await options.onBrowserClose?.();
    if (options.browserCloseError) {
      throw options.browserCloseError;
    }
  });
  const context = {
    close: contextClose,
    newPage: vi.fn(async () => page)
  };
  const browser = {
    close: browserClose,
    newContext: vi.fn(async () => context)
  };
  const chromium = {
    launch: vi.fn(async () => browser)
  };
  const loadPlaywright = vi.fn(async () => ({
    chromium
  }) as unknown as typeof import('playwright'));

  return {
    browser,
    browserClose,
    chromium,
    context,
    contextClose,
    loadPlaywright,
    page
  };
}

function createFakeRoute(resourceType: string): FakeRoute {
  return {
    abort: vi.fn(async () => undefined),
    continue: vi.fn(async () => undefined),
    request: () => ({
      resourceType: () => resourceType
    })
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Toutiao runtime', () => {
  it('extracts article content, metadata, canonical id, and final URL', async () => {
    const requestedUrl = 'https://www.toutiao.com/article/7657359132571255323/';
    const page = new FakePage({
      body: () => [
        'Lunar dust is a difficult problem',
        '2026-07-03 20:08·Space Boundary',
        'First paragraph',
        'Second paragraph'
      ].join('\n'),
      finalUrl: () => `${requestedUrl}?source=redirect`,
      paragraphs: () => ['First paragraph', 'Second paragraph'],
      title: () => 'Lunar dust is a difficult problem'
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    const article = await runtime.withSession((session) => session.fetchArticle({
      input: 'https://toutiao.com/group/7657359132571255323/',
      url: requestedUrl
    }));

    expect(article).toMatchObject({
      authorName: 'Space Boundary',
      content: {
        paragraphs: ['First paragraph', 'Second paragraph'],
        text: 'First paragraph\nSecond paragraph'
      },
      id: '7657359132571255323',
      publishTimeText: '2026-07-03 20:08',
      title: 'Lunar dust is a difficult problem',
      url: `${requestedUrl}?source=redirect`
    });
    expect(harness.chromium.launch).toHaveBeenCalledOnce();
    expect(harness.browser.newContext).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'zh-CN',
      userAgent: expect.stringContaining('Mozilla/5.0')
    }));
    expect(harness.context.newPage).toHaveBeenCalledOnce();
    expect(harness.contextClose).toHaveBeenCalledOnce();
    expect(harness.browserClose).toHaveBeenCalledOnce();
  });

  it('extracts a numeric input when the request URL has no canonical id', async () => {
    const page = new FakePage({
      body: () => 'A title without a metadata line',
      paragraphs: () => [null, '  Body paragraph  '],
      title: () => 'A title without a metadata line'
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    const article = await runtime.withSession((session) => session.fetchArticle({
      input: '7001',
      url: 'https://www.toutiao.com/redirect'
    }));

    expect(article).toMatchObject({
      content: { paragraphs: ['Body paragraph'], text: 'Body paragraph' },
      id: '7001'
    });
    expect(article).not.toHaveProperty('authorName');
    expect(article).not.toHaveProperty('publishTimeText');
  });

  it('returns a parse error when article title, content, or id is unavailable', async () => {
    const page = new FakePage({
      body: () => '',
      paragraphs: () => [],
      titleError: true
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession((session) => session.fetchArticle({
      input: 'not-an-id',
      url: 'https://www.toutiao.com/redirect'
    }))).rejects.toMatchObject({
      code: 'TOUTIAO_PARSE_ERROR',
      exitCode: 2
    });
  });

  it.each([
    {
      body: 'x'.repeat(1024 * 1024 + 1),
      label: 'body text',
      paragraphs: ['Body'],
      title: 'Title'
    },
    {
      body: 'Body',
      label: 'paragraph text',
      paragraphs: ['x'.repeat(1024 * 1024 + 1)],
      title: 'Title'
    },
    {
      body: 'Body',
      label: 'title text',
      paragraphs: ['Body'],
      title: 'x'.repeat(1024 * 1024 + 1)
    }
  ])('rejects article $label larger than one megabyte', async ({ body, paragraphs, title }) => {
    const page = new FakePage({
      body: () => body,
      paragraphs: () => paragraphs,
      title: () => title
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    const error = await runtime.withSession((session) => session.fetchArticle({
      input: '7002',
      url: 'https://www.toutiao.com/article/7002/'
    })).then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(error).toMatchObject({
      code: 'TOUTIAO_RESOURCE_LIMIT',
      details: { maxTextBytes: 1024 * 1024 },
      exitCode: 2,
      message: 'Toutiao article text exceeded the configured size limit.'
    });
  });

  it('maps and deduplicates technology feed responses with next-page values', async () => {
    const page = new FakePage({
      onGoto: async (_url, activePage) => {
        await activePage.emitResponse('https://www.toutiao.com/unrelated', { ignored: true });
        await activePage.emitRejectedResponse(
          'https://www.toutiao.com/api/pc/list/feed?broken=true'
        );
        await activePage.emitResponse('https://www.toutiao.com/api/pc/list/feed?page=1', {
          data: [{
            Abstract: 'First abstract',
            article_url: '/group/1001/',
            behot_time: 1_784_764_800,
            comment_count: 8,
            group_id: '1001',
            image_url: 'https://example.com/image.jpg',
            media_name: 'Tech Desk',
            source_url: '/group/1001/',
            title: 'First technology story'
          }],
          has_more: true,
          next: { max_behot_time: 1_784_764_700 },
          offset: 15
        });
        await activePage.emitResponse('https://www.toutiao.com/api/pc/list/feed?page=2', {
          data: [
            { group_id: '1001', title: 'Duplicate story' },
            {
              Abstract: 'Second abstract',
              Title: 'Second technology story',
              item_id: '1002',
              source: 'News Lab'
            },
            {
              abstract: 'Third abstract',
              display_url: 'https://example.com/not-an-article',
              id: '1003',
              title: 'Third technology story'
            },
            {
              article_url: 'http://[',
              id: '1004',
              title: 'Story with invalid URL'
            },
            {
              id: '1005',
              source_url: '/article/1005/',
              title: 'Story using a source URL'
            },
            { group_id: 'missing-title' },
            { title: 'Missing id' }
          ],
          next: { max_behot_time: 1_784_764_600 },
          offset: 30
        });
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    const result = await runtime.withSession((session) =>
      session.fetchTechnologyChannel({ pages: 2 })
    );

    expect(result.items.map((item) => item.id)).toEqual([
      '1001',
      '1002',
      '1003',
      '1004',
      '1005'
    ]);
    expect(result.items[0]).toMatchObject({
      abstract: 'First abstract',
      authorName: 'Tech Desk',
      commentCount: 8,
      image: 'https://example.com/image.jpg',
      publishTime: {
        iso: new Date(1_784_764_800_000).toISOString(),
        seconds: 1_784_764_800
      },
      sourceUrl: '/group/1001/',
      url: 'https://www.toutiao.com/article/1001/'
    });
    expect(result.items[1]).toMatchObject({
      abstract: 'Second abstract',
      authorName: 'News Lab',
      url: 'https://www.toutiao.com/article/1002/'
    });
    expect(result.items[2]).toMatchObject({
      abstract: 'Third abstract',
      url: 'https://www.toutiao.com/article/1003/'
    });
    expect(result.items[3]?.url).toBe('https://www.toutiao.com/article/1004/');
    expect(result.items[4]?.url).toBe('https://www.toutiao.com/article/1005/');
    expect(result).toMatchObject({
      hasMore: false,
      next: { maxBehotTime: 1_784_764_600, offset: 30 },
      source: 'tech'
    });
    expect(page.responseHandlers.size).toBe(0);
    expect(page.off).toHaveBeenCalledOnce();
  });

  it('starts at most one feed body parse per requested page during a response burst', async () => {
    const parseBody = vi.fn(async (index: number) => ({
      data: [{ group_id: String(1100 + index), title: `Story ${index}` }]
    }));
    const page = new FakePage({
      onGoto: (_url, activePage) => {
        for (let index = 0; index < 10; index += 1) {
          const response: FakeResponse = {
            body: async () => Buffer.from(JSON.stringify(await parseBody(index))),
            headerValue: async () => null,
            json: async () => parseBody(index),
            url: () => `https://www.toutiao.com/api/pc/list/feed?page=${index}`
          };

          for (const handler of [...activePage.responseHandlers]) {
            handler(response);
          }
        }
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await runtime.withSession((session) =>
      session.fetchTechnologyChannel({ pages: 2 })
    );

    expect(parseBody).toHaveBeenCalledTimes(2);
  });

  it('rejects feed responses with a declared body larger than five megabytes', async () => {
    const page = new FakePage({
      onGoto: async (_url, activePage) => {
        await activePage.emitResponse(
          'https://www.toutiao.com/api/pc/list/feed?oversized=true',
          { data: [{ group_id: '1201', title: 'Oversized response' }] },
          { contentLength: String(5 * 1024 * 1024 + 1) }
        );
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession((session) =>
      session.fetchTechnologyChannel({ pages: 1 })
    )).rejects.toMatchObject({
      code: 'TOUTIAO_RESPONSE_TOO_LARGE',
      exitCode: 2,
      message: 'Toutiao feed response exceeded the configured size limit.'
    });
  });

  it('rejects feed JSON larger than five megabytes without a size header', async () => {
    const page = new FakePage({
      onGoto: async (_url, activePage) => {
        await activePage.emitResponse(
          'https://www.toutiao.com/api/pc/list/feed?undeclared-oversized=true',
          {
            data: [{ group_id: '1251', title: 'Undeclared oversized response' }],
            padding: 'x'.repeat(5 * 1024 * 1024)
          }
        );
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession((session) =>
      session.fetchTechnologyChannel({ pages: 1 })
    )).rejects.toMatchObject({
      code: 'TOUTIAO_RESPONSE_TOO_LARGE',
      exitCode: 2
    });
  });

  it('checks actual feed body bytes before parsing JSON', async () => {
    const parseJson = vi.fn(async () => ({
      data: [{ group_id: '1271', title: 'Misleading small JSON' }]
    }));
    const page = new FakePage({
      onGoto: (_url, activePage) => {
        const response: FakeResponse = {
          body: async () => Buffer.alloc(5 * 1024 * 1024 + 1),
          headerValue: async () => null,
          json: parseJson,
          url: () => 'https://www.toutiao.com/api/pc/list/feed?actual-oversized=true'
        };
        for (const handler of [...activePage.responseHandlers]) {
          handler(response);
        }
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession((session) =>
      session.fetchTechnologyChannel({ pages: 1 })
    )).rejects.toMatchObject({ code: 'TOUTIAO_RESPONSE_TOO_LARGE' });
    expect(parseJson).not.toHaveBeenCalled();
  });

  it('settles active feed bodies before returning a resource error', async () => {
    let releaseBody: (() => void) | undefined;
    const bodyGate = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    const delayedBody = vi.fn(async () => {
      await bodyGate;
      return Buffer.from(JSON.stringify({
        data: [{ group_id: '1282', title: 'Delayed response' }]
      }));
    });
    const page = new FakePage({
      onGoto: (_url, activePage) => {
        const responses: FakeResponse[] = [
          {
            body: async () => Buffer.alloc(5 * 1024 * 1024 + 1),
            headerValue: async () => null,
            json: async () => undefined,
            url: () => 'https://www.toutiao.com/api/pc/list/feed?oversized=true'
          },
          {
            body: delayedBody,
            headerValue: async () => null,
            json: async () => undefined,
            url: () => 'https://www.toutiao.com/api/pc/list/feed?delayed=true'
          }
        ];
        for (const response of responses) {
          for (const handler of [...activePage.responseHandlers]) {
            handler(response);
          }
        }
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });
    let settled = false;

    const pending = runtime.withSession((session) =>
      session.fetchTechnologyChannel({ pages: 2 })
    );
    void pending.then(
      () => { settled = true; },
      () => { settled = true; }
    );
    await vi.waitFor(() => expect(delayedBody).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    releaseBody?.();
    await expect(pending).rejects.toMatchObject({ code: 'TOUTIAO_RESPONSE_TOO_LARGE' });
    expect(settled).toBe(true);
  });

  it('rejects feed responses containing more than 100 items', async () => {
    const page = new FakePage({
      onGoto: async (_url, activePage) => {
        await activePage.emitResponse(
          'https://www.toutiao.com/api/pc/list/feed?too-many-items=true',
          {
            data: Array.from({ length: 101 }, (_, index) => ({
              group_id: String(1300 + index),
              title: `Story ${index}`
            }))
          }
        );
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession((session) =>
      session.fetchTechnologyChannel({ pages: 1 })
    )).rejects.toMatchObject({
      code: 'TOUTIAO_RESOURCE_LIMIT',
      exitCode: 2,
      message: 'Toutiao feed response exceeded the configured item limit.'
    });
  });

  it('maps both author feed URL variants and deduplicates article ids', async () => {
    const authorToken = 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80';
    const page = new FakePage({
      onGoto: async (_url, activePage) => {
        await activePage.emitResponse(
          `https://www.toutiao.com/api/pc/list/user/feed?category=profile_all&token=${authorToken}`,
          {
            data: [{ group_id: '2001', title: 'First author story' }],
            has_more: true,
            offset: 10
          }
        );
        await activePage.emitResponse(
          `https://www.toutiao.com/api/pc/list/feed?category=pc_profile_article&author_token=${authorToken}`,
          {
            data: [
              { group_id: '2001', title: 'Duplicate author story' },
              { group_id: '2002', title: 'Second author story' }
            ],
            next: { max_behot_time: 99 },
            offset: 20
          }
        );
        await activePage.emitResponse(
          `https://www.toutiao.com/api/pc/list/feed?category=other&author_token=${authorToken}`,
          { data: [] }
        );
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    const result = await runtime.withSession((session) => session.fetchAuthorArticles({
      authorToken,
      pages: 2,
      url: `https://www.toutiao.com/c/user/token/${authorToken}/`
    }));

    expect(result).toMatchObject({
      authorToken,
      hasMore: false,
      next: { maxBehotTime: 99, offset: 20 }
    });
    expect(result.items.map((item) => item.id)).toEqual(['2001', '2002']);
    expect(page.responseHandlers.size).toBe(0);
  });

  it('supports fallback author feed URL matching without accepting unrelated responses', async () => {
    const authorToken = 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80';
    const page = new FakePage({
      onGoto: async (_url, activePage) => {
        await activePage.emitResponse('not-url /api/pc/list/feed unrelated', { data: [] });
        await activePage.emitResponse('not-url /api/pc/list/user/feed wrong', { data: [] });
        await activePage.emitResponse(
          'not-url /api/pc/list/user/feed profile_all wrong-token',
          { data: [] }
        );
        await activePage.emitResponse(
          'not-url /api/pc/list/feed pc_profile_article',
          { data: [{ group_id: '2101', title: 'Fallback URL story' }] }
        );
        await activePage.emitResponse(
          `not-url /api/pc/list/feed category-other ${authorToken}`,
          { data: [] }
        );
        await activePage.emitResponse(
          `not-url /api/pc/list/user/feed profile_all ${authorToken}`,
          { data: [] }
        );
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    const result = await runtime.withSession((session) => session.fetchAuthorArticles({
      authorToken,
      pages: 1,
      url: `https://www.toutiao.com/c/user/token/${authorToken}/`
    }));

    expect(result.items.map((item) => item.id)).toEqual(['2101']);
  });

  it('reports parse errors for technology and author feeds without items', async () => {
    let emittedEmptyTechnologyResponse = false;
    const technologyPage = new FakePage({
      onWait: async (activePage) => {
        if (!emittedEmptyTechnologyResponse) {
          emittedEmptyTechnologyResponse = true;
          await activePage.emitResponse(
            'https://www.toutiao.com/api/pc/list/feed?empty=true',
            {}
          );
        }
      }
    });
    const technologyHarness = createBrowserHarness({ page: technologyPage });
    const technologyRuntime = createDefaultToutiaoRuntime({
      loadPlaywright: technologyHarness.loadPlaywright
    });

    await expect(technologyRuntime.withSession((session) =>
      session.fetchTechnologyChannel({ pages: 1 })
    )).rejects.toMatchObject({ code: 'TOUTIAO_PARSE_ERROR' });

    let authorWaits = 0;
    const authorPage = new FakePage({
      onWait: async (activePage) => {
        authorWaits += 1;
        if (authorWaits === 2) {
          await activePage.emitResponse(
            'https://www.toutiao.com/api/pc/list/feed?category=pc_profile_article',
            {}
          );
        }
      }
    });
    const authorHarness = createBrowserHarness({ page: authorPage });
    const authorRuntime = createDefaultToutiaoRuntime({
      loadPlaywright: authorHarness.loadPlaywright
    });
    await expect(authorRuntime.withSession((session) => session.fetchAuthorArticles({
      authorToken: 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      pages: 1,
      url: 'https://www.toutiao.com/c/user/token/token/'
    }))).rejects.toMatchObject({ code: 'TOUTIAO_PARSE_ERROR' });
    expect(authorPage.mouse.wheel).toHaveBeenCalled();
  });

  it('extracts keyword items from direct and recursively wrapped article links', async () => {
    const direct = 'https://www.toutiao.com/article/3001/';
    const wrapped = new URL('https://www.toutiao.com/redirect');
    const nested = new URL('https://www.toutiao.com/redirect');
    nested.searchParams.set('url', 'https://toutiao.com/group/3002/');
    wrapped.searchParams.set('url', nested.toString());
    const page = new FakePage({
      anchors: () => [
        { href: direct, text: 'A direct search result title' },
        { href: wrapped.toString(), text: 'A wrapped search result title' },
        { href: direct, text: 'Duplicate direct result title' },
        { href: 'https://example.com/not-toutiao', text: 'An unrelated result title' }
      ]
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    const result = await runtime.withSession((session) =>
      session.fetchKeywordInformation({ keyword: 'AI', pages: 2, source: 'AI' })
    );

    expect(result.items).toEqual([
      {
        id: '3001',
        title: 'A direct search result title',
        url: 'https://www.toutiao.com/article/3001/'
      },
      {
        id: '3002',
        title: 'A wrapped search result title',
        url: 'https://www.toutiao.com/article/3002/'
      }
    ]);
    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining('keyword=AI'),
      expect.objectContaining({ waitUntil: 'domcontentloaded' })
    );
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('falls back to stable text-derived keyword results', async () => {
    const page = new FakePage({
      body: () => [
        'A sufficiently detailed fallback result title',
        'A sufficiently detailed fallback result title',
        'Another sufficiently detailed fallback result'
      ].join('\n')
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    const result = await runtime.withSession((session) =>
      session.fetchKeywordInformation({ keyword: 'AI', pages: 1, source: 'AI' })
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: expect.stringMatching(/^search-[a-f0-9]+$/),
      title: 'A sufficiently detailed fallback result title',
      url: expect.stringContaining('keyword=AI')
    });
  });

  it('reports browser verification when search has no usable results', async () => {
    const page = new FakePage({
      body: () => 'short',
      captcha: () => true
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession((session) =>
      session.fetchKeywordInformation({ keyword: 'AI', pages: 1, source: 'AI' })
    )).rejects.toMatchObject({
      code: 'TOUTIAO_VERIFICATION_REQUIRED',
      details: { keyword: 'AI' },
      exitCode: 1
    });
    expect(harness.contextClose).toHaveBeenCalledOnce();
    expect(harness.browserClose).toHaveBeenCalledOnce();
  });

  it('reports parse errors for empty unblocked search results', async () => {
    const harness = createBrowserHarness({
      page: new FakePage({ body: () => 'short' })
    });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession((session) =>
      session.fetchKeywordInformation({ keyword: 'AI', pages: 1, source: 'AI' })
    )).rejects.toMatchObject({
      code: 'TOUTIAO_PARSE_ERROR',
      exitCode: 2
    });
  });

  it('rejects search fallback text larger than one megabyte', async () => {
    const harness = createBrowserHarness({
      page: new FakePage({ body: () => 'x'.repeat(1024 * 1024 + 1) })
    });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    const error = await runtime.withSession((session) =>
      session.fetchKeywordInformation({ keyword: 'AI', pages: 1, source: 'AI' })
    ).then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(error).toMatchObject({
      code: 'TOUTIAO_RESOURCE_LIMIT',
      details: { maxTextBytes: 1024 * 1024 },
      exitCode: 2,
      message: 'Toutiao search text exceeded the configured size limit.'
    });
  });

  it('inspects at most 300 DOM anchors per search page', async () => {
    const anchors = [
      ...Array.from({ length: 300 }, (_, index) => ({
        href: `https://example.com/result/${index}`,
        text: `Unrelated result ${index}`
      })),
      {
        href: 'https://www.toutiao.com/article/9999/',
        text: 'Valid result after the DOM bound'
      }
    ];
    const harness = createBrowserHarness({
      page: new FakePage({ anchors: () => anchors })
    });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession((session) =>
      session.fetchKeywordInformation({ keyword: 'AI', pages: 1, source: 'AI' })
    )).rejects.toMatchObject({ code: 'TOUTIAO_PARSE_ERROR' });
  });

  it('bounds DOM and text fallback search results at 30 items', async () => {
    const nestedRedirect = Array.from({ length: 5 }).reduce<string>(
      (next) => `https://www.toutiao.com/redirect?url=${encodeURIComponent(next)}`,
      'https://example.com/no-article'
    );
    const anchors = [
      { href: 'https://www.toutiao.com/article/1/', text: null },
      { href: 'http://[', text: 'Invalid URL result' },
      { href: nestedRedirect, text: 'Overly nested redirect result' },
      ...Array.from({ length: 31 }, (_, index) => ({
        href: `https://www.toutiao.com/article/${index + 100}/`,
        text: `DOM result title number ${index + 1}`
      }))
    ];
    const domHarness = createBrowserHarness({
      page: new FakePage({ anchors: () => anchors })
    });
    const domRuntime = createDefaultToutiaoRuntime({
      loadPlaywright: domHarness.loadPlaywright
    });

    const domResult = await domRuntime.withSession((session) =>
      session.fetchKeywordInformation({ keyword: 'AI', pages: 1, source: 'AI' })
    );
    expect(domResult.items).toHaveLength(30);

    const textHarness = createBrowserHarness({
      page: new FakePage({
        body: () => Array.from(
          { length: 31 },
          (_, index) => `Fallback result title number ${index + 1}`
        ).join('\n')
      })
    });
    const textRuntime = createDefaultToutiaoRuntime({
      loadPlaywright: textHarness.loadPlaywright
    });

    const textResult = await textRuntime.withSession((session) =>
      session.fetchKeywordInformation({ keyword: 'AI', pages: 1, source: 'AI' })
    );
    expect(textResult.items).toHaveLength(30);
  });

  it('reuses one browser session for an author feed and serial article details', async () => {
    const authorToken = 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80';
    const page = new FakePage({
      body: (url) => `Article ${/article\/(\d+)/.exec(url)?.[1]}\n2026-07-03·Author`,
      onGoto: async (url, activePage) => {
        if (url.includes('/c/user/token/')) {
          await activePage.emitResponse(
            `https://www.toutiao.com/api/pc/list/feed?category=pc_profile_article&author_token=${authorToken}`,
            {
              data: [
                { group_id: '4001', title: 'Article 4001' },
                { group_id: '4002', title: 'Article 4002' }
              ],
              has_more: false
            }
          );
        }
      },
      paragraphs: (url) => [`Body ${/article\/(\d+)/.exec(url)?.[1]}`],
      title: (url) => `Article ${/article\/(\d+)/.exec(url)?.[1]}`
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });
    const service = new ToutiaoService({ runtime });

    const result = await service.author(authorToken, {
      pages: 1,
      withContent: true
    });

    expect(result.articles?.map((article) => article.id)).toEqual(['4001', '4002']);
    expect(page.goto.mock.calls.map(([url]) => url)).toEqual([
      `https://www.toutiao.com/c/user/token/${authorToken}/`,
      'https://www.toutiao.com/article/4001/',
      'https://www.toutiao.com/article/4002/'
    ]);
    expect(page.navigationListenerCounts).toEqual([1, 0, 0]);
    expect(harness.chromium.launch).toHaveBeenCalledOnce();
    expect(harness.browser.newContext).toHaveBeenCalledOnce();
    expect(harness.context.newPage).toHaveBeenCalledOnce();
    expect(harness.contextClose).toHaveBeenCalledOnce();
    expect(harness.browserClose).toHaveBeenCalledOnce();
  });

  it('blocks heavy resources while allowing extraction resources', async () => {
    const harness = createBrowserHarness();
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await runtime.withSession(async () => {
      expect(harness.page.routeHandlers).toHaveLength(1);
      const handler = harness.page.routeHandlers[0];
      expect(handler).toBeDefined();

      for (const resourceType of ['image', 'media', 'font']) {
        const route = createFakeRoute(resourceType);
        await handler?.(route);
        expect(route.abort).toHaveBeenCalledOnce();
        expect(route.continue).not.toHaveBeenCalled();
      }

      for (const resourceType of ['document', 'script', 'xhr', 'fetch']) {
        const route = createFakeRoute(resourceType);
        await handler?.(route);
        expect(route.continue).toHaveBeenCalledOnce();
        expect(route.abort).not.toHaveBeenCalled();
      }
    });
  });

  it('suppresses context and browser cleanup failures after a successful operation', async () => {
    const harness = createBrowserHarness({
      browserCloseError: new Error('browser cleanup failed'),
      contextCloseError: new Error('context cleanup failed')
    });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession(async () => 'complete')).resolves.toBe('complete');
    expect(harness.contextClose).toHaveBeenCalledOnce();
    expect(harness.browserClose).toHaveBeenCalledOnce();
  });

  it('uses the default Playwright loader when no loader is injected', async () => {
    const harness = createBrowserHarness();
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(harness.browser as never);
    try {
      const runtime = createDefaultToutiaoRuntime();
      await expect(runtime.withSession(async () => 'loaded')).resolves.toBe('loaded');
      expect(launch).toHaveBeenCalledWith({ headless: true });
    } finally {
      launch.mockRestore();
    }
  });

  it('closes context and browser exactly once after callback failure', async () => {
    const harness = createBrowserHarness();
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession(async () => {
      throw new Error('callback failed');
    })).rejects.toThrow('callback failed');
    expect(harness.contextClose).toHaveBeenCalledOnce();
    expect(harness.browserClose).toHaveBeenCalledOnce();
  });

  it('closes context and browser exactly once after navigation failure', async () => {
    const page = new FakePage({
      onGoto: () => {
        throw new Error('navigation failed');
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });

    await expect(runtime.withSession((session) => session.fetchArticle({
      input: '5001',
      url: 'https://www.toutiao.com/article/5001/'
    }))).rejects.toThrow('navigation failed');
    expect(harness.contextClose).toHaveBeenCalledOnce();
    expect(harness.browserClose).toHaveBeenCalledOnce();
  });

  it('settles an active feed parse before returning a navigation failure', async () => {
    let releaseResponse: (() => void) | undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const parseBody = vi.fn(async () => {
      await responseGate;
      return { data: [{ group_id: '5002', title: 'Delayed story' }] };
    });
    const page = new FakePage({
      onGoto: (_url, activePage) => {
        const response: FakeResponse = {
          body: async () => Buffer.from(JSON.stringify(await parseBody())),
          headerValue: async () => null,
          json: parseBody,
          url: () => 'https://www.toutiao.com/api/pc/list/feed?pending=true'
        };
        for (const handler of [...activePage.responseHandlers]) {
          handler(response);
        }
        throw new Error('navigation failed');
      }
    });
    const harness = createBrowserHarness({ page });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: harness.loadPlaywright
    });
    let settled = false;

    const pending = runtime.withSession((session) =>
      session.fetchTechnologyChannel({ pages: 1 })
    );
    void pending.then(
      () => { settled = true; },
      () => { settled = true; }
    );
    await vi.waitFor(() => expect(parseBody).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    releaseResponse?.();
    await expect(pending).rejects.toThrow('navigation failed');
    expect(settled).toBe(true);
    expect(page.responseHandlers.size).toBe(0);
  });

  it('maps Playwright loading failures to a browser-unavailable error', async () => {
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: vi.fn(async () => {
        throw new Error('module not found');
      })
    });

    await expect(runtime.withSession(async () => undefined)).rejects.toMatchObject({
      code: 'TOUTIAO_BROWSER_UNAVAILABLE',
      exitCode: 2
    });
  });

  it('maps Chromium launch failures without exposing local browser paths', async () => {
    const launch = vi.fn(async () => {
      throw new Error('Executable does not exist at /secret/local/chromium');
    });
    const runtime = createDefaultToutiaoRuntime({
      loadPlaywright: vi.fn(async () => ({
        chromium: { launch }
      }) as unknown as typeof import('playwright'))
    });

    const pending = runtime.withSession(async () => undefined);
    await expect(pending).rejects.toMatchObject({
      code: 'TOUTIAO_BROWSER_UNAVAILABLE',
      exitCode: 2,
      message: 'Toutiao collection requires Playwright Chromium to be installed.'
    });
    await pending.catch((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain('/secret/local/chromium');
    });
  });

  it('applies the command deadline while Playwright is still loading', async () => {
    vi.useFakeTimers();
    let resolveLoader: ((playwright: typeof import('playwright')) => void) | undefined;
    const harness = createBrowserHarness();
    const loadPlaywright = vi.fn(() => new Promise<typeof import('playwright')>((resolve) => {
      resolveLoader = resolve;
    }));
    const runtime = createDefaultToutiaoRuntime({ deadlineMs: 25, loadPlaywright });
    let rejection: unknown;
    const pending = runtime.withSession(async () => 'never started');
    void pending.catch((error: unknown) => {
      rejection = error;
    });

    await vi.advanceTimersByTimeAsync(25);

    expect(rejection).toMatchObject({ code: 'TOUTIAO_TIMEOUT', exitCode: 1 });
    resolveLoader?.(await harness.loadPlaywright());
    await Promise.resolve();
    expect(harness.chromium.launch).not.toHaveBeenCalled();
  });

  it('closes a browser that finishes launching after the command deadline', async () => {
    vi.useFakeTimers();
    const harness = createBrowserHarness({
      browserCloseError: new Error('late browser close failed')
    });
    let resolveLaunch: ((browser: typeof harness.browser) => void) | undefined;
    const launch = vi.fn(() => new Promise<typeof harness.browser>((resolve) => {
      resolveLaunch = resolve;
    }));
    const loadPlaywright = vi.fn(async () => ({
      chromium: { launch }
    }) as unknown as typeof import('playwright'));
    const runtime = createDefaultToutiaoRuntime({ deadlineMs: 25, loadPlaywright });
    const pending = runtime.withSession(async () => 'never started');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TOUTIAO_TIMEOUT' });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    resolveLaunch?.(harness.browser);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.browserClose).toHaveBeenCalledOnce();
    expect(harness.browser.newContext).not.toHaveBeenCalled();
  });

  it('closes bounded resources and settles the operation on deadline expiry', async () => {
    vi.useFakeTimers();
    let rejectOperation: ((reason: Error) => void) | undefined;
    const harness = createBrowserHarness({
      onBrowserClose: () => {
        rejectOperation?.(new Error('browser closed'));
        throw new Error('browser close failed');
      }
    });
    const runtime = createDefaultToutiaoRuntime({
      deadlineMs: 25,
      loadPlaywright: harness.loadPlaywright
    });
    const pending = runtime.withSession(async () =>
      new Promise<never>((_resolve, reject) => {
        rejectOperation = reject;
      })
    );
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'TOUTIAO_TIMEOUT',
      exitCode: 1
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;

    expect(harness.contextClose).toHaveBeenCalledOnce();
    expect(harness.browserClose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns the timeout error when browser closure resolves the operation', async () => {
    vi.useFakeTimers();
    let resolveOperation: ((value: string) => void) | undefined;
    const harness = createBrowserHarness({
      onBrowserClose: () => {
        resolveOperation?.('closed');
      }
    });
    const runtime = createDefaultToutiaoRuntime({
      deadlineMs: 25,
      loadPlaywright: harness.loadPlaywright
    });
    const pending = runtime.withSession(async () =>
      new Promise<string>((resolve) => {
        resolveOperation = resolve;
      })
    );
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TOUTIAO_TIMEOUT' });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;

    expect(harness.browserClose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
