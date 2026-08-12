import { describe, expect, it } from 'vitest';

import { parseRssOrAtomFeed } from '../../src/media/rss.js';
import { MediaCommandError } from '../../src/media/types.js';

const SAMPLE_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Sample</title>
    <item>
      <title><![CDATA[AI Model Ships Today]]></title>
      <link>https://www.wired.com/story/ai-model-ships-today/</link>
      <guid isPermaLink="false">abc123</guid>
      <pubDate>Wed, 12 Aug 2026 10:30:00 +0000</pubDate>
      <description><![CDATA[A short summary about artificial intelligence.]]></description>
      <dc:creator>Jane Reporter</dc:creator>
      <category>Business / Artificial Intelligence</category>
      <media:keywords>artificial intelligence, OpenAI</media:keywords>
      <media:thumbnail url="https://media.example.com/cover.jpg" />
    </item>
    <item>
      <title>No AI Here</title>
      <link>https://www.wired.com/story/gadget-review/</link>
      <guid>def456</guid>
      <description>Just a phone review.</description>
    </item>
  </channel>
</rss>`;

describe('parseRssOrAtomFeed', () => {
  it('maps rss items with author, time, image, and keywords', () => {
    const items = parseRssOrAtomFeed(SAMPLE_RSS);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'abc123',
      title: 'AI Model Ships Today',
      url: 'https://www.wired.com/story/ai-model-ships-today/',
      authorName: 'Jane Reporter',
      image: 'https://media.example.com/cover.jpg',
      summary: 'A short summary about artificial intelligence.'
    });
    expect(items[0]?.publishTime?.iso).toBe('2026-08-12T10:30:00.000Z');
    expect(items[0]?.keywords).toEqual(['artificial intelligence', 'OpenAI']);
    expect(items[0]?.categories).toContain('Business / Artificial Intelligence');
  });

  it('throws when feed has no items', () => {
    expect(() => parseRssOrAtomFeed('<rss><channel></channel></rss>')).toThrow(
      MediaCommandError
    );
  });
});
