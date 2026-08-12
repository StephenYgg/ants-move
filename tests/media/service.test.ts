import { describe, expect, it, vi } from 'vitest';

import { MediaCollectorService } from '../../src/media/service.js';
import { getMediaSourceByCommand } from '../../src/media/sources.js';
import { MediaCommandError } from '../../src/media/types.js';

const FEED_XML = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <item>
      <title>DeepSeek Challenges Claude Code</title>
      <link>https://www.bloomberg.com/news/articles/2026-08-12/deepseek</link>
      <guid>G1</guid>
      <description>AI agents and Anthropic competition.</description>
      <dc:creator>Reporter</dc:creator>
      <pubDate>Wed, 12 Aug 2026 16:29:17 GMT</pubDate>
    </item>
    <item>
      <title>Apple Hires Lobbyist</title>
      <link>https://www.bloomberg.com/news/articles/2026-08-12/apple</link>
      <guid>G2</guid>
      <description>Government affairs role.</description>
    </item>
  </channel>
</rss>`;

const ARTICLE_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@type":"NewsArticle","headline":"AI Story","articleBody":"Body one.\\n\\nBody two.","image":"https://img.example/a.jpg","url":"https://www.wired.com/story/ai-story/"}
</script>
</head><body></body></html>`;

describe('MediaCollectorService', () => {
  it('lists feed items with browser-like headers and applies AI filter for bloomberg', async () => {
    const fetchText = vi.fn(async () => FEED_XML);
    const definition = getMediaSourceByCommand('bloomberg')!;
    const service = new MediaCollectorService(definition, { fetchText });

    const list = await service.getList({ channel: 'AI', limit: 10 });

    expect(fetchText).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://feeds.bloomberg.com/technology/news.rss',
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Chrome/126'),
          Accept: expect.stringContaining('application/rss+xml')
        })
      })
    );
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.title).toContain('DeepSeek');
    expect(list.source).toBe('bloomberg');
  });

  it('fetches and parses article details', async () => {
    const fetchText = vi.fn(async () => ARTICLE_HTML);
    const definition = getMediaSourceByCommand('wired')!;
    const service = new MediaCollectorService(definition, { fetchText });

    const article = await service.getArticle('ai-story');

    expect(fetchText).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://www.wired.com/story/ai-story/',
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Chrome/126'),
          'Sec-Fetch-Mode': 'navigate'
        })
      })
    );
    expect(article.title).toBe('AI Story');
    expect(article.content.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(article.images[0]?.url).toBe('https://img.example/a.jpg');
  });

  it('rejects article collection for list-only sources', async () => {
    const definition = getMediaSourceByCommand('bloomberg')!;
    const service = new MediaCollectorService(definition, {
      fetchText: vi.fn()
    });

    await expect(service.getArticle('x')).rejects.toMatchObject({
      code: 'MEDIA_ARTICLE_UNAVAILABLE'
    });
  });

  it('rejects unsupported channels and invalid limits', async () => {
    const definition = getMediaSourceByCommand('wired')!;
    const service = new MediaCollectorService(definition, {
      fetchText: vi.fn()
    });

    await expect(service.getList({ channel: 'sports' })).rejects.toBeInstanceOf(
      MediaCommandError
    );
    await expect(service.getList({ channel: 'AI', limit: 0 })).rejects.toMatchObject({
      code: 'MEDIA_INVALID_LIMIT'
    });
    await expect(service.getList({ channel: 'AI', limit: 51 })).rejects.toMatchObject({
      code: 'MEDIA_INVALID_LIMIT'
    });
  });

  it('rejects empty article references before fetching', async () => {
    const definition = getMediaSourceByCommand('wired')!;
    const fetchText = vi.fn();
    const service = new MediaCollectorService(definition, { fetchText });

    await expect(service.getArticle('')).rejects.toMatchObject({
      code: 'MEDIA_INVALID_ARTICLE'
    });
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('falls back to browser HTML when curl and RSS body are unavailable', async () => {
    const blockedHtml = `<!DOCTYPE html><html><head><title></title>
      <script>window.awsWafCookieDomainList=[]</script></head><body></body></html>`;
    const browserHtml = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">
      {"@type":"NewsArticle","headline":"Browser Story","articleBody":"Paragraph one from browser.\\n\\nParagraph two from browser.","image":"https://img/b.jpg"}
      </script></head></html>`;
    const emptyFeed = `<?xml version="1.0"?><rss><channel>
      <item><title>Other</title><link>https://example.com/other</link><guid>o</guid><description>short</description></item>
    </channel></rss>`;
    const definition = getMediaSourceByCommand('openai')!;
    const service = new MediaCollectorService(definition, {
      fetchText: vi.fn(async (request: { url: string }) =>
        request.url.includes('rss') || request.url.includes('feed')
          ? emptyFeed
          : blockedHtml
      ),
      fetchHtmlBrowser: vi.fn(async () => browserHtml)
    });

    const article = await service.getArticle(
      'https://openai.com/index/browser-story'
    );
    expect(article.title).toBe('Browser Story');
    expect(article.content.paragraphs.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to RSS content when HTML is bot-blocked', async () => {
    const blockedHtml = `<!DOCTYPE html><html><head><title></title>
      <script>window.awsWafCookieDomainList=[];window.gokuProps={}</script>
    </head><body><h1>JavaScript is disabled</h1></body></html>`;
    const feedXml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>DEF CON crowd suspected</title>
        <link>https://arstechnica.com/information-technology/2026/08/def-con-story/</link>
        <guid>ars-1</guid>
        <content:encoded><![CDATA[<p>${'A'.repeat(120)}</p><p>${'B'.repeat(120)}</p><img src="https://cdn.ars/a.jpg" />]]></content:encoded>
      </item>
    </channel></rss>`;
    const fetchText = vi.fn(async (request: { url: string }) => {
      if (request.url.includes('feeds.arstechnica.com') || request.url.includes('feed')) {
        return feedXml;
      }
      return blockedHtml;
    });
    // Use a definition that maps to ars-like feeds via wired for simplicity? use ars source
    const definition = getMediaSourceByCommand('ars')!;
    const service = new MediaCollectorService(definition, { fetchText });

    const article = await service.getArticle(
      'https://arstechnica.com/information-technology/2026/08/def-con-story/'
    );
    expect(article.title).toContain('DEF CON');
    expect(article.content.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(fetchText.mock.calls.length).toBeGreaterThan(1);
  });

  it('defaults list limit to 20 when omitted', async () => {
    const manyItems = Array.from({ length: 25 }, (_, index) => `
      <item>
        <title>Item ${index}</title>
        <link>https://www.wired.com/story/item-${index}/</link>
        <guid>${index}</guid>
      </item>`).join('');
    const feed = `<?xml version="1.0"?><rss><channel>${manyItems}</channel></rss>`;
    const definition = getMediaSourceByCommand('wired')!;
    const service = new MediaCollectorService(definition, {
      fetchText: vi.fn(async () => feed)
    });

    const list = await service.getList({ channel: 'AI' });
    expect(list.meta.limit).toBe(20);
    expect(list.items).toHaveLength(20);
  });
});
