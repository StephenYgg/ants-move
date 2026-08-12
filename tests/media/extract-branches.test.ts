import { describe, expect, it } from 'vitest';

import { extractArticleFromHtml } from '../../src/media/extract.js';
import { MediaCommandError } from '../../src/media/types.js';

const request = {
  headers: {},
  url: 'https://www.example.com/story/x'
};

describe('extractArticleFromHtml branches', () => {
  it('falls back to HTML body when JSON-LD has no articleBody', () => {
    const html = `<!DOCTYPE html><html><head>
      <meta property="og:title" content="OG Title" />
      <meta property="og:image" content="https://cdn.example.com/og.jpg" />
      <meta property="og:description" content="OG dek" />
      <meta property="og:url" content="https://www.example.com/story/x" />
      <meta property="article:published_time" content="2026-08-12T12:00:00.000Z" />
      <meta name="author" content="Ada Lovelace" />
      <meta content="https://cdn.example.com/tw.jpg" name="twitter:image" />
      <script type="application/ld+json">{"@type":"WebPage"}</script>
      <script type="application/ld+json">{not-json</script>
      <script type="application/ld+json"></script>
    </head><body>
      <article>
        <p>${'A'.repeat(40)} first long paragraph for extractor.</p>
        <p>${'B'.repeat(40)} second long paragraph for extractor.</p>
        <img data-src="/a.jpg" />
        <img srcset="/b.jpg 1x, /c.jpg 2x" />
        <img src="data:image/png;base64,abc" />
      </article>
    </body></html>`;

    const article = extractArticleFromHtml({
      html,
      request,
      source: 'wired',
      url: 'https://www.example.com/story/x'
    });

    expect(article.title).toBe('OG Title');
    expect(article.author?.name).toBe('Ada Lovelace');
    expect(article.content.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(article.images.some((image) => image.url.endsWith('/a.jpg'))).toBe(true);
    expect(article.images.some((image) => image.url.endsWith('/b.jpg'))).toBe(true);
    expect(article.summary).toBe('OG dek');
    expect(article.publishTime?.iso).toBe('2026-08-12T12:00:00.000Z');
  });

  it('parses graph JSON-LD authors arrays and image objects', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@graph": [
          {
            "@type": ["NewsArticle"],
            "@id": "id-1",
            "headline": "Graph Story",
            "articleBody": "Para one.\\n\\nPara two.",
            "author": [{"@type":"Person","name":"Writer","url":"https://example.com/w"}],
            "image": {"url":"https://cdn.example.com/i.jpg"},
            "keywords": "ai, robots",
            "datePublished": "2026-01-01T00:00:00.000Z",
            "mainEntityOfPage": {"@id":"https://www.example.com/story/graph"}
          }
        ]
      }
      </script>
    </head><body></body></html>`;

    const article = extractArticleFromHtml({
      html,
      request,
      source: 'mtr',
      url: 'https://www.example.com/story/graph'
    });

    expect(article.id).toBe('id-1');
    expect(article.author).toEqual({
      name: 'Writer',
      url: 'https://example.com/w'
    });
    expect(article.keywords).toEqual(['ai', 'robots']);
    expect(article.coverImage).toBe('https://cdn.example.com/i.jpg');
  });

  it('uses title tag and body paragraphs when no article container matches', () => {
    const html = `<html><head><title>Title &amp; More</title></head>
      <body>
        <div>
          <p>${'C'.repeat(50)}</p>
          <p>${'D'.repeat(50)}</p>
          <img src="" />
        </div>
      </body></html>`;

    const article = extractArticleFromHtml({
      html,
      request,
      source: 'bbc',
      url: 'https://www.example.com/story/plain'
    });

    expect(article.title).toBe('Title & More');
    expect(article.content.paragraphs).toHaveLength(2);
  });

  it('throws when title is missing', () => {
    expect(() =>
      extractArticleFromHtml({
        html: '<html><body><p>only body without title tag or h1</p></body></html>',
        request,
        source: 'wired',
        url: 'https://www.example.com/x'
      })
    ).toThrow(MediaCommandError);
  });

  it('accepts string author and image array variants', () => {
    const html = `<html><head><script type="application/ld+json">
    {
      "@type":"Article",
      "name":"Named Story",
      "articleBody":"Only one paragraph body text that is long enough.",
      "author":"Solo Author",
      "image":["https://cdn.example.com/1.jpg", {"url":"https://cdn.example.com/2.jpg"}, {"no":"pe"}],
      "keywords":["one","two"],
      "dateCreated":"not-a-date",
      "description":"desc"
    }
    </script></head></html>`;

    const article = extractArticleFromHtml({
      html,
      request,
      source: 'ars',
      url: 'https://www.example.com/story/named'
    });

    expect(article.title).toBe('Named Story');
    expect(article.author?.name).toBe('Solo Author');
    expect(article.images.map((image) => image.url)).toEqual([
      'https://cdn.example.com/1.jpg',
      'https://cdn.example.com/2.jpg'
    ]);
    expect(article.keywords).toEqual(['one', 'two']);
  });

  it('ignores unusable author/keyword shapes and invalid relative media urls', () => {
    const html = `<html><head><script type="application/ld+json">
    {
      "@type":"NewsArticle",
      "headline":"Edge Story",
      "articleBody":"Body paragraph for edge story content.",
      "author": 42,
      "keywords": {"no":"pe"},
      "image": 12,
      "url": {"@id":"https://www.example.com/story/edge"}
    }
    </script>
    <meta content="from-name-attr" property="og:description" />
    </head><body>
      <article>
        <p>${'E'.repeat(90)}</p>
        <img srcset="   " />
        <img src="http://[::1" />
      </article>
    </body></html>`;

    const article = extractArticleFromHtml({
      html,
      request: { headers: {}, url: 'https://www.example.com/story/edge' },
      source: 'verge',
      url: 'https://www.example.com/story/edge'
    });

    expect(article.title).toBe('Edge Story');
    expect(article.author).toBeUndefined();
    expect(article.keywords).toBeUndefined();
    expect(article.url).toBe('https://www.example.com/story/edge');
  });

  it('derives id from malformed page urls without crashing', () => {
    const html = `<html><head><title>Loose</title></head><body>
      <main><p>${'F'.repeat(90)}</p><p>${'G'.repeat(90)}</p></main>
    </body></html>`;

    const article = extractArticleFromHtml({
      html,
      request: { headers: {}, url: 'not-a-valid-url' },
      source: 'ieee',
      url: 'not-a-valid-url'
    });

    expect(article.id).toBe('not-a-valid-url');
    expect(article.title).toBe('Loose');
  });

  it('skips author objects without names and image objects without urls', () => {
    const html = `<html><head><script type="application/ld+json">
    {
      "@type":"NewsArticle",
      "headline":"No Author Name",
      "articleBody":"Body for no-author-name fixture content.",
      "author":{"@type":"Person","url":"https://example.com/a"},
      "image":{"url":"https://cdn.example.com/thumb.jpg"}
    }
    </script></head></html>`;

    const article = extractArticleFromHtml({
      html,
      request,
      source: 'engadget',
      url: 'https://www.example.com/story/no-author'
    });

    expect(article.author).toBeUndefined();
    expect(article.images.map((image) => image.url)).toContain(
      'https://cdn.example.com/thumb.jpg'
    );
  });
});
