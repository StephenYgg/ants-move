import { describe, expect, it, vi } from 'vitest';

import { Kr36ArticleService } from '../../src/36kr/service.js';

const articleHtml = `
<html>
  <body>
    <script>
      window.initialState={"articleDetail":{"articleDetailData":{"data":{"itemId":3853011900142848,"widgetTitle":"36Kr article","summary":"Article summary.","author":"Stephen","authorId":1199336245,"authorFace":"https://img.example.com/author.jpg","authorRoute":"detail_author?userId=1199336245","publishTime":1781488200127,"widgetContent":"<p>Author&nbsp;|&nbsp;Stephen</p><p>Editor&nbsp;|&nbsp;Alice</p><p>First paragraph<strong>Important</strong></p><p class=\\"image-wrapper\\"><img data-img-size-val=\\"1080,975\\" src=\\"https://img.example.com/body.jpg\\"></p><p class=\\"img-desc\\">(Source/Company)</p>","sourceType":"original","imgSources":[{"name":"Interview image","url":""}],"popinImage":"https://img.example.com/cover.jpg","companyCertifyNick":"Stephen official account"}},"articleRecommendData":{"statPraise":42,"statComment":0,"statCollect":5,"statArticle":858,"authorName":"Stephen","authorTitle":"Author","authorSummary":"Technology","authorFace":"https://img.example.com/author.jpg","newestItemList":[{"itemId":1,"itemTitle":"Newest article","itemContent":"Summary","publishTime":1781488200000,"itemRoute":"detail_article?itemId=1"}],"nextItem":{"itemId":2,"itemTitle":"Next article","itemContent":"Next summary","publishTime":1781488100000,"authorId":1,"itemRoute":"detail_article?itemId=2"},"relateArticleList":[{"itemId":3,"widgetTitle":"Related article","author":"Alice","authorName":"Alice","route":"detail_article?itemId=3","widgetImage":"https://img.example.com/related.jpg"}]},"favoriteCount":5,"likeCount":42,"organArticleData":{"data":{"organizationList":[{"id":168,"identityName":"capital","name":"Example Capital","logo":"https://img.example.com/logo.png","briefIntro":"Introduction"}]}},"latestArticle":{"articleLatestList":[{"id":4,"title":"News title"}]}}};
    </script>
  </body>
</html>`;

const firstPageJson = JSON.stringify({
  code: 0,
  data: {
    itemList: [
      {
        itemId: 3882467938040710,
        itemType: 10,
        templateMaterial: {
          itemId: 3882467938040710,
          templateType: 1,
          widgetImage: 'https://img.example.com/first.jpg',
          publishTime: 1783240283508,
          widgetTitle: 'First information article',
          summary: 'First summary',
          authorName: 'Author One',
          authorRoute: 'detail_author?userId=5653862'
        },
        route: 'detail_article?itemId=3882467938040710',
        siteId: 1
      }
    ],
    pageCallback: 'first-callback',
    hasNextPage: 1
  }
});

const nextPageJson = JSON.stringify({
  code: 0,
  data: {
    itemList: [
      {
        itemId: 3882258709180678,
        itemType: 10,
        templateMaterial: {
          authorName: 'Author Two',
          authorRoute: 'detail_author?userId=214166',
          itemId: 3882258709180678,
          publishTime: 1783228733601,
          summary: 'Second summary',
          templateType: 1,
          widgetImage: 'https://img.example.com/second.jpg',
          widgetTitle: 'Second information article'
        },
        route: 'detail_article?itemId=3882258709180678',
        siteId: 1
      }
    ],
    pageCallback: 'second-callback',
    hasNextPage: 0
  }
});

describe('Kr36ArticleService', () => {
  it('fetches a 36kr article by id with browser-like curl headers and parses the article payload', async () => {
    const fetchArticleHtml = vi.fn(async () => articleHtml);
    const service = new Kr36ArticleService({ fetchArticleHtml, fetchJson: vi.fn() });

    const article = await service.getArticle('3853011900142848');

    expect(fetchArticleHtml).toHaveBeenCalledWith({
      headers: expect.objectContaining({
        Accept: expect.stringContaining('text/html'),
        'Accept-Language': expect.stringContaining('zh-CN'),
        Referer: 'https://www.36kr.com/',
        'User-Agent': expect.stringContaining('Mozilla/5.0')
      }),
      url: 'https://www.36kr.com/p/3853011900142848'
    });
    expect(article.id).toBe('3853011900142848');
    expect(article.url).toBe('https://www.36kr.com/p/3853011900142848');
    expect(article.title).toBe('36Kr article');
    expect(article.summary).toBe('Article summary.');
    expect(article.author.name).toBe('Stephen');
    expect(article.publishTime.local).toBe('2026-06-15 09:50:00');
    expect(article.content.paragraphs).toEqual([
      'Author | Stephen',
      'Editor | Alice',
      'First paragraph',
      'Important',
      '(Source/Company)'
    ]);
    expect(article.images).toEqual([
      {
        index: 1,
        size: '1080,975',
        url: 'https://img.example.com/body.jpg'
      }
    ]);
    expect(article.stats).toEqual({
      authorArticleCount: 858,
      collect: 5,
      comment: 0,
      favoriteCount: 5,
      likeCount: 42,
      praise: 42
    });
    expect(article.organizations[0]?.name).toBe('Example Capital');
    expect(article.relatedArticles[0]?.title).toBe('Related article');
  });

  it('rejects article ids that are not numeric', async () => {
    const service = new Kr36ArticleService({ fetchArticleHtml: vi.fn(), fetchJson: vi.fn() });

    await expect(service.getArticle('abc')).rejects.toMatchObject({
      code: 'KR36_INVALID_ARTICLE_ID',
      exitCode: 2
    });
  });

  it('returns a parse error when the page does not include initialState', async () => {
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(async () => '<html></html>'),
      fetchJson: vi.fn()
    });

    await expect(service.getArticle('3853011900142848')).rejects.toMatchObject({
      code: 'KR36_PARSE_ERROR',
      exitCode: 2,
      message: 'window.initialState was not found in the 36kr article page.'
    });
  });

  it('reports a security-challenge parse error when 36kr returns a WAF interstitial', async () => {
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(async () =>
        '<html><body><p class="title">正在进行安全检测...</p></body></html>'
      ),
      fetchJson: vi.fn()
    });

    await expect(service.getArticle('3853011900142848')).rejects.toMatchObject({
      code: 'KR36_PARSE_ERROR',
      exitCode: 2,
      message: expect.stringContaining('security challenge')
    });
  });

  it('returns a parse error when article data is absent or initialState is malformed', async () => {
    const fetchArticleHtml = vi.fn()
      .mockResolvedValueOnce('<script>window.initialState={"articleDetail":{}};</script>')
      .mockResolvedValueOnce('<script>window.initialState={"articleDetail":};</script>');
    const service = new Kr36ArticleService({ fetchArticleHtml, fetchJson: vi.fn() });

    await expect(service.getArticle('1')).rejects.toMatchObject({ code: 'KR36_PARSE_ERROR' });
    await expect(service.getArticle('1')).rejects.toMatchObject({ code: 'KR36_PARSE_ERROR' });
  });

  it('maps sparse article payloads through compatible defaults and fallback authors', async () => {
    const sparseArticleHtml = `<script>window.initialState=${JSON.stringify({
      articleDetail: {
        articleDetailData: {
          data: {
            widgetContent: '<p>&quot;Quote&#39; &lt;tag&gt; &amp;</p><img src="https://img.example.com/no-size.jpg"><img data-img-size-val="1,1">'
          }
        },
        articleRecommendData: {
          authorFace: 'https://img.example.com/fallback.jpg',
          authorName: 'Fallback Author',
          newestItemList: [{ itemId: 10, itemTitle: 'Sparse newest' }],
          nextItem: { itemId: 11, itemTitle: 'Sparse next' },
          relateArticleList: [
            {
              authorName: 'Related Author',
              itemId: 12,
              widgetTitle: 'Sparse related'
            },
            {
              itemId: 13,
              widgetTitle: 'Anonymous related'
            }
          ]
        }
      }
    })};</script>`;
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(async () => sparseArticleHtml),
      fetchJson: vi.fn()
    });

    const article = await service.getArticle('99');

    expect(article).toMatchObject({
      author: {
        face: 'https://img.example.com/fallback.jpg',
        name: 'Fallback Author'
      },
      id: '99',
      imageSources: [],
      organizations: [],
      publishTime: { iso: '', local: '', ms: 0 },
      stats: {
        authorArticleCount: 0,
        collect: 0,
        comment: 0,
        favoriteCount: 0,
        likeCount: 0,
        praise: 0
      },
      summary: '',
      title: ''
    });
    expect(article.content.paragraphs[0]).toBe('"Quote\' <tag> &');
    expect(article.images).toEqual([{
      index: 1,
      size: null,
      url: 'https://img.example.com/no-size.jpg'
    }]);
    expect(article.newestArticles[0]).toEqual({ id: 10, title: 'Sparse newest' });
    expect(article.nextArticle).toEqual({ id: 11, title: 'Sparse next' });
    expect(article.relatedArticles[0]).toEqual({
      author: 'Related Author',
      id: 12,
      title: 'Sparse related'
    });
    expect(article.relatedArticles[1]).toEqual({
      id: 13,
      title: 'Anonymous related'
    });
  });

  it('maps a completely minimal article payload', async () => {
    const minimalHtml = '<script>window.initialState={"articleDetail":{"articleDetailData":{"data":{}}}};</script>';
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(async () => minimalHtml),
      fetchJson: vi.fn()
    });

    const article = await service.getArticle('77');

    expect(article.author).toEqual({ name: '' });
    expect(article.content).toEqual({ html: '', paragraphs: [] });
    expect(article.newestArticles).toEqual([]);
    expect(article.relatedArticles).toEqual([]);
  });

  it('rejects article results larger than 20 retained megabytes', async () => {
    const oversizedArticleHtml = `<script>window.initialState=${JSON.stringify({
      articleDetail: {
        articleDetailData: {
          data: {
            itemId: 78,
            widgetContent: 'x'.repeat(11 * 1024 * 1024)
          }
        }
      }
    })};</script>`;
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(async () => oversizedArticleHtml),
      fetchJson: vi.fn()
    });

    const error = await service.getArticle('78').then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(error).toMatchObject({
      code: 'KR36_RESOURCE_LIMIT',
      details: { maxRetainedBytes: 20 * 1024 * 1024 },
      exitCode: 2,
      message: '36kr article result exceeded the configured size limit.'
    });
  });

  it('fetches an information channel and follows pageCallback for additional pages', async () => {
    const fetchJson = vi.fn()
      .mockResolvedValueOnce(firstPageJson)
      .mockResolvedValueOnce(nextPageJson);
    const service = new Kr36ArticleService({ fetchArticleHtml: vi.fn(), fetchJson });

    const result = await service.getInformationList({ channel: 'technology', pages: 2 });

    expect(fetchJson).toHaveBeenNthCalledWith(1, {
      body: expect.objectContaining({
        partner_id: 'web',
        param: expect.objectContaining({
          pageCallback: '',
          pageEvent: 0,
          pageSize: 30,
          platformId: 2,
          siteId: 1,
          subnavNick: 'technology',
          subnavType: 1
        })
      }),
      headers: expect.objectContaining({
        Origin: 'https://www.36kr.com',
        Referer: 'https://www.36kr.com/information/technology/',
        'User-Agent': expect.stringContaining('Mozilla/5.0')
      }),
      url: 'https://gateway.36kr.com/api/mis/nav/ifm/subNav/flow'
    });
    expect(fetchJson).toHaveBeenNthCalledWith(2, {
      body: expect.objectContaining({
        partner_id: 'web',
        param: expect.objectContaining({
          pageCallback: 'first-callback',
          pageEvent: 1,
          pageSize: 30,
          platformId: 2,
          siteId: 1,
          subnavNick: 'technology',
          subnavType: 1
        })
      }),
      headers: expect.objectContaining({
        Origin: 'https://www.36kr.com',
        Referer: 'https://www.36kr.com/information/technology/'
      }),
      url: 'https://gateway.36kr.com/api/mis/nav/ifm/subNav/flow'
    });
    expect(result.channel).toBe('technology');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      authorName: 'Author One',
      id: 3882467938040710,
      title: 'First information article',
      url: 'https://www.36kr.com/p/3882467938040710'
    });
    expect(result.items[1]).toMatchObject({
      authorName: 'Author Two',
      id: 3882258709180678,
      title: 'Second information article'
    });
    expect(result.meta).toMatchObject({
      fetchedPages: 2,
      hasNextPage: 0,
      nextPageCallback: 'second-callback',
      totalItems: 2
    });
  });

  it('stops channel fetching at the requested page count', async () => {
    const fetchJson = vi.fn(async () => firstPageJson);
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(),
      fetchJson
    });

    const result = await service.getInformationList({ channel: 'AI', pages: 1 });

    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(result.channel).toBe('AI');
    expect(result.items).toHaveLength(1);
    expect(result.meta).toMatchObject({
      fetchedPages: 1,
      hasNextPage: 1,
      nextPageCallback: 'first-callback'
    });
  });

  it('maps a sparse first information page with default pagination values', async () => {
    const fetchJson = vi.fn(async () => JSON.stringify({
      code: 0,
      data: {
        itemList: [{ itemId: 9 }]
      }
    }));
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(),
      fetchJson
    });

    const result = await service.getInformationList({ channel: 'AI' });

    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([{
      id: 9,
      title: '',
      url: 'https://www.36kr.com/p/9'
    }]);
    expect(result.meta).toMatchObject({
      fetchedPages: 1,
      hasNextPage: 0,
      nextPageCallback: ''
    });
  });

  it('defaults an absent first-page item list to an empty collection', async () => {
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(),
      fetchJson: vi.fn(async () => JSON.stringify({ code: 0, data: {} }))
    });

    await expect(service.getInformationList({ channel: 'AI' })).resolves.toMatchObject({
      items: [],
      meta: { totalItems: 0 }
    });
  });

  it('rejects a first information page containing more than 30 items', async () => {
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(),
      fetchJson: vi.fn(async () => JSON.stringify({
        code: 0,
        data: {
          itemList: Array.from({ length: 31 }, (_, index) => ({ itemId: index + 1 }))
        }
      }))
    });

    await expect(service.getInformationList({ channel: 'AI', pages: 1 }))
      .rejects.toMatchObject({
        code: 'KR36_RESOURCE_LIMIT',
        details: { maxItemsPerPage: 30, receivedItems: 31 },
        exitCode: 2,
        message: '36kr information response exceeded the configured item limit.'
      });
  });

  it('rejects a later information page containing more than 30 items', async () => {
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(),
      fetchJson: vi.fn()
        .mockResolvedValueOnce(firstPageJson)
        .mockResolvedValueOnce(JSON.stringify({
          code: 0,
          data: {
            itemList: Array.from({ length: 31 }, (_, index) => ({ itemId: index + 1 }))
          }
        }))
    });

    await expect(service.getInformationList({ channel: 'AI', pages: 2 }))
      .rejects.toMatchObject({
        code: 'KR36_RESOURCE_LIMIT',
        details: { maxItemsPerPage: 30, receivedItems: 31 },
        exitCode: 2
      });
  });

  it('rejects a first information page exceeding five retained megabytes', async () => {
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(),
      fetchJson: vi.fn(async () => JSON.stringify({
        code: 0,
        data: {
          itemList: [{
            itemId: 1,
            templateMaterial: { summary: 'x'.repeat(5 * 1024 * 1024) }
          }]
        }
      }))
    });

    const error = await service.getInformationList({ channel: 'AI', pages: 1 }).then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(error).toMatchObject({
      code: 'KR36_RESOURCE_LIMIT',
      details: { maxRetainedBytes: 5 * 1024 * 1024 },
      exitCode: 2,
      message: '36kr information results exceeded the configured size limit.'
    });
  });

  it('rejects information pages exceeding five retained megabytes cumulatively', async () => {
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(),
      fetchJson: vi.fn()
        .mockResolvedValueOnce(JSON.stringify({
          code: 0,
          data: {
            hasNextPage: 1,
            itemList: [{
              itemId: 1,
              templateMaterial: { summary: 'x'.repeat(3 * 1024 * 1024) }
            }],
            pageCallback: 'next'
          }
        }))
        .mockResolvedValueOnce(JSON.stringify({
          code: 0,
          data: {
            itemList: [{
              itemId: 2,
              templateMaterial: { summary: 'y'.repeat(3 * 1024 * 1024) }
            }]
          }
        }))
    });

    const error = await service.getInformationList({ channel: 'AI', pages: 2 }).then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(error).toMatchObject({
      code: 'KR36_RESOURCE_LIMIT',
      details: { maxRetainedBytes: 5 * 1024 * 1024 },
      exitCode: 2
    });
  });

  it.each([
    {
      firstJson: JSON.stringify({ code: 1, msg: 'upstream rejected request' }),
      code: 'KR36_REQUEST_FAILED',
      message: 'upstream rejected request'
    },
    {
      firstJson: JSON.stringify({ code: 1 }),
      code: 'KR36_REQUEST_FAILED',
      message: '36kr information flow request failed.'
    },
    {
      firstJson: '{invalid-json',
      code: 'KR36_PARSE_ERROR',
      message: 'Failed to parse 36kr information flow response.'
    }
  ])('normalizes information flow failures', async ({ code, firstJson, message }) => {
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(),
      fetchJson: vi.fn(async () => firstJson)
    });

    await expect(service.getInformationList({ channel: 'AI', pages: 1 }))
      .rejects.toMatchObject({ code, message });
  });

  it('maps absent next-page data to empty compatible defaults', async () => {
    const service = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(),
      fetchJson: vi.fn()
        .mockResolvedValueOnce(firstPageJson)
        .mockResolvedValueOnce(JSON.stringify({ code: 0 }))
    });

    const result = await service.getInformationList({ channel: 'AI', pages: 2 });

    expect(result.items).toHaveLength(1);
    expect(result.meta).toMatchObject({
      fetchedPages: 2,
      hasNextPage: 0,
      nextPageCallback: ''
    });
  });

  it('rejects invalid page bounds before network access', async () => {
    const fetchJson = vi.fn();
    const service = new Kr36ArticleService({ fetchArticleHtml: vi.fn(), fetchJson });

    await expect(service.getInformationList({ channel: 'AI', pages: 21 }))
      .rejects.toMatchObject({ code: 'KR36_INVALID_PAGES' });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('stringifies non-Error initial-state and flow parse failures', async () => {
    const originalParse = JSON.parse;
    const initialStateParse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'initial state failed';
    });
    const articleService = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(async () => '<script>window.initialState={"articleDetail":{}};</script>'),
      fetchJson: vi.fn()
    });

    await expect(articleService.getArticle('1')).rejects.toMatchObject({
      details: { cause: 'initial state failed' }
    });
    initialStateParse.mockRestore();

    const flowParse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'flow failed';
    });
    const listService = new Kr36ArticleService({
      fetchArticleHtml: vi.fn(),
      fetchJson: vi.fn(async () => '{}')
    });

    await expect(listService.getInformationList({ channel: 'AI', pages: 1 }))
      .rejects.toMatchObject({ details: { cause: 'flow failed' } });
    flowParse.mockRestore();
    // keep originalParse referenced so mock restore path stays obvious in reviews
    expect(typeof originalParse).toBe('function');
  });

  it('rejects unsupported information channels', async () => {
    const service = new Kr36ArticleService({ fetchArticleHtml: vi.fn(), fetchJson: vi.fn() });

    await expect(service.getInformationList({ channel: 'travel', pages: 1 })).rejects.toMatchObject({
      code: 'KR36_INVALID_CHANNEL',
      exitCode: 2
    });
  });
});
