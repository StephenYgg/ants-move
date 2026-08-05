import { describe, expect, it, vi } from 'vitest';

import { createCli } from '../../src/index.js';
import type { Kr36Runtime } from '../../src/36kr/runtime.js';

const articleHtml = `
<script>
window.initialState={"articleDetail":{"articleDetailData":{"data":{"itemId":3853011900142848,"widgetTitle":"硬氪首发 | 海洋具身智能公司「世航智能」拿下创纪录10亿融资，朱啸虎押注","summary":"上半年订单超10亿元。","author":"邱晓芬","authorId":1199336245,"authorFace":"https://img.example.com/author.jpg","authorRoute":"detail_author?userId=1199336245","publishTime":1781488200127,"widgetContent":"<p>作者&nbsp;|&nbsp;邱晓芬</p><p>正文</p>","sourceType":"original","imgSources":[],"popinImage":"https://img.example.com/cover.jpg","companyCertifyNick":"邱晓芬官方企业号"}},"articleRecommendData":{"statPraise":42,"statComment":0,"statCollect":5,"statArticle":858,"authorName":"邱晓芬","authorTitle":"作者","authorSummary":"关注科技","authorFace":"https://img.example.com/author.jpg","newestItemList":[],"relateArticleList":[]},"favoriteCount":5,"likeCount":42,"organArticleData":{"data":{"organizationList":[]}},"latestArticle":{"articleLatestList":[]}}};
</script>`;

const informationJson = JSON.stringify({
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
          widgetTitle: 'MiniMax M3：一家AI公司，为什么开始重新定义自己的价值？',
          summary: '当模型能力逐渐趋同时，一家 AI 公司还能依靠什么建立长期价值？',
          authorName: '奇点湃',
          authorRoute: 'detail_author?userId=5653862'
        },
        route: 'detail_article?itemId=3882467938040710',
        siteId: 1
      }
    ],
    pageCallback: 'first-callback',
    hasNextPage: 0
  }
});

describe('ants 36kr command', () => {
  it('fetches an article by id and renders JSON by default', async () => {
    let stdout = '';
    let stderr = '';
    const runtime: Kr36Runtime = {
      fetchArticleHtml: vi.fn(async () => articleHtml),
      fetchJson: vi.fn()
    };
    const cli = createCli({
      kr36Runtime: runtime,
      stderr: (value) => {
        stderr += value;
      },
      stdout: (value) => {
        stdout += value;
      }
    });

    const exitCode = await cli.run(['36kr', 'article', '3853011900142848']);
    const parsed = JSON.parse(stdout) as {
      data: {
        author: { name: string };
        id: string;
        request: { headers: Record<string, string> };
        title: string;
        url: string;
      };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.id).toBe('3853011900142848');
    expect(parsed.data.url).toBe('https://www.36kr.com/p/3853011900142848');
    expect(parsed.data.title).toContain('世航智能');
    expect(parsed.data.author.name).toBe('邱晓芬');
    expect(parsed.data.request.headers['User-Agent']).toContain('Mozilla/5.0');
  });

  it('renders 36kr errors as JSON', async () => {
    let stderr = '';
    const cli = createCli({
      kr36Runtime: {
        fetchArticleHtml: vi.fn(),
        fetchJson: vi.fn()
      },
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    const exitCode = await cli.run(['36kr', 'article', 'not-an-id']);

    expect(exitCode).toBe(2);
    expect(stderr).toContain('"code": "KR36_INVALID_ARTICLE_ID"');
  });

  it('fetches a supported information channel and renders JSON by default', async () => {
    let stdout = '';
    const runtime: Kr36Runtime = {
      fetchArticleHtml: vi.fn(),
      fetchJson: vi.fn(async () => informationJson)
    };
    const cli = createCli({
      kr36Runtime: runtime,
      stderr: () => undefined,
      stdout: (value) => {
        stdout += value;
      }
    });

    const exitCode = await cli.run(['36kr', 'list', 'AI', '--pages', '1']);
    const parsed = JSON.parse(stdout) as {
      data: {
        channel: string;
        items: Array<{ authorName: string; id: number; title: string }>;
        meta: { totalItems: number };
      };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.channel).toBe('AI');
    expect(parsed.data.items[0]).toMatchObject({
      authorName: '奇点湃',
      id: 3882467938040710,
      title: 'MiniMax M3：一家AI公司，为什么开始重新定义自己的价值？'
    });
    expect(parsed.data.meta.totalItems).toBe(1);
  });

  it('renders information channel results as a table with -t', async () => {
    let stdout = '';
    const runtime: Kr36Runtime = {
      fetchArticleHtml: vi.fn(),
      fetchJson: vi.fn(async () => informationJson)
    };
    const cli = createCli({
      kr36Runtime: runtime,
      stdout: (value) => {
        stdout += value;
      }
    });

    const exitCode = await cli.run(['36kr', 'list', 'AI', '--pages', '1', '-t']);

    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).toThrow();
    expect(stdout).toContain('id');
    expect(stdout).toContain('title');
    expect(stdout).toContain('MiniMax M3');
    expect(stdout).toContain('奇点湃');
  });

  it('rejects unsupported information channels at the CLI boundary', async () => {
    let stderr = '';
    const cli = createCli({
      kr36Runtime: {
        fetchArticleHtml: vi.fn(),
        fetchJson: vi.fn()
      },
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    const exitCode = await cli.run(['36kr', 'list', 'travel']);

    expect(exitCode).toBe(2);
    expect(stderr).toContain('"code": "KR36_INVALID_CHANNEL"');
  });

  it('rejects non-integer page arguments', async () => {
    let stderr = '';
    const cli = createCli({
      stderr: (value) => { stderr += value; },
      stdout: () => undefined
    });

    expect(await cli.run(['36kr', 'list', 'AI', '--pages', 'many'])).toBe(2);
    expect(stderr).toContain('"code": "KR36_INVALID_PAGES"');
  });
});
