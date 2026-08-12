import { describe, expect, it } from 'vitest';

import { extractArticleFromHtml } from '../../src/media/extract.js';
import { MediaCommandError } from '../../src/media/types.js';

const ARTICLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Fallback Title</title>
  <meta property="og:image" content="https://cdn.example.com/og.jpg" />
  <script type="application/ld+json">
  {
    "@context": "http://schema.org",
    "@type": "NewsArticle",
    "headline": "AI Reporters Break News",
    "description": "A short dek.",
    "articleBody": "First paragraph about AI.\\n\\nSecond paragraph with more detail.",
    "datePublished": "2026-08-12T10:30:00.000Z",
    "author": { "@type": "Person", "name": "Kate Knibbs", "sameAs": "https://www.wired.com/author/kate/" },
    "image": ["https://cdn.example.com/cover.jpg"],
    "keywords": ["artificial intelligence", "news"],
    "articleSection": "business",
    "url": "https://www.wired.com/story/ai-reporters-break-news/"
  }
  </script>
</head>
<body>
  <article>
    <p>Should not be needed when JSON-LD body exists.</p>
    <img src="/inline.jpg" alt="inline" />
  </article>
</body>
</html>`;

describe('extractArticleFromHtml', () => {
  it('extracts full article fields from JSON-LD with images', () => {
    const article = extractArticleFromHtml({
      html: ARTICLE_HTML,
      request: {
        headers: { 'User-Agent': 'test' },
        url: 'https://www.wired.com/story/ai-reporters-break-news/'
      },
      source: 'wired',
      url: 'https://www.wired.com/story/ai-reporters-break-news/'
    });

    expect(article.title).toBe('AI Reporters Break News');
    expect(article.content.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(article.author?.name).toBe('Kate Knibbs');
    expect(article.coverImage).toBe('https://cdn.example.com/cover.jpg');
    expect(article.images.map((image) => image.url)).toEqual(
      expect.arrayContaining([
        'https://cdn.example.com/cover.jpg',
        'https://cdn.example.com/og.jpg',
        'https://www.wired.com/inline.jpg'
      ])
    );
    expect(article.section).toBe('business');
    expect(article.keywords).toEqual(['artificial intelligence', 'news']);
  });

  it('hard-fails when body paragraphs are missing', () => {
    expect(() =>
      extractArticleFromHtml({
        html: '<html><head><title>Only title</title></head><body><p></p></body></html>',
        request: { headers: {}, url: 'https://example.com/x' },
        source: 'wired',
        url: 'https://example.com/x'
      })
    ).toThrow(MediaCommandError);
  });
});
