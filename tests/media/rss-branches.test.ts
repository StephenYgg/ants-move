import { describe, expect, it } from 'vitest';

import { parseRssOrAtomFeed } from '../../src/media/rss.js';
import { MediaCommandError } from '../../src/media/types.js';

describe('parseRssOrAtomFeed branches', () => {
  it('parses atom entries with href links and enclosure images', () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Atom Story</title>
          <link href="https://example.com/atom-story" />
          <id>urn:1</id>
          <updated>2026-08-12T10:00:00Z</updated>
          <summary>Hello &amp; welcome</summary>
          <author><name>Atom Author</name></author>
          <category term="AI" />
          <enclosure type="image/jpeg" url="https://cdn.example.com/e.jpg" />
        </entry>
      </feed>`;

    const items = parseRssOrAtomFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe('https://example.com/atom-story');
    expect(items[0]?.image).toBe('https://cdn.example.com/e.jpg');
    expect(items[0]?.authorName).toBe('Atom Author');
    expect(items[0]?.categories).toContain('AI');
    expect(items[0]?.summary).toContain('Hello & welcome');
  });

  it('extracts image from description html and skips incomplete items', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title></title><link></link></item>
      <item>
        <title>With Img</title>
        <link>https://example.com/with-img</link>
        <description><![CDATA[<p>Hi <img src="https://cdn.example.com/d.jpg" /></p>]]></description>
      </item>
    </channel></rss>`;

    const items = parseRssOrAtomFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]?.image).toBe('https://cdn.example.com/d.jpg');
  });

  it('throws on empty payload and unmappable items', () => {
    expect(() => parseRssOrAtomFeed('   ')).toThrow(MediaCommandError);
    expect(() =>
      parseRssOrAtomFeed(`<?xml version="1.0"?><rss><channel>
        <item><title></title><link></link><guid></guid></item>
      </channel></rss>`)
    ).toThrow(MediaCommandError);
  });

  it('parses numeric and hex entities and invalid dates safely', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>Entity &#39;Title&#x21; &quot;Q&quot; &lt;x&gt; &nbsp; &apos;y&apos;</title>
        <link>not a url but ok</link>
        <guid>g1</guid>
        <pubDate>not-a-real-date</pubDate>
        <enclosure url="https://cdn.example.com/x.png" type="image/png" />
        <description><![CDATA[<script>bad()</script><style>.x{}</style><p>Hi</p>]]></description>
      </item>
      <item>
        <title>Author empty name</title>
        <link>https://example.com/empty-author</link>
        <author><name>   </name>Fallback Author</author>
      </item>
    </channel></rss>`;

    const items = parseRssOrAtomFeed(xml);
    expect(items[0]?.title).toContain("Entity 'Title!");
    expect(items[0]?.publishTime).toBeUndefined();
    expect(items[0]?.image).toBe('https://cdn.example.com/x.png');
    expect(items[0]?.summary).toContain('Hi');
    expect(items[1]?.authorName).toContain('Fallback Author');
  });
});
