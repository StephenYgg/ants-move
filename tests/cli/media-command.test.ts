import { describe, expect, it, vi } from 'vitest';

import { createCli } from '../../src/index.js';

const FEED_XML = `<?xml version="1.0"?><rss><channel>
<item><title>AI News</title><link>https://www.wired.com/story/ai-news/</link><guid>1</guid><description>About AI</description></item>
</channel></rss>`;

const ARTICLE_HTML = `<html><head><script type="application/ld+json">
{"@type":"NewsArticle","headline":"AI News","articleBody":"Hello body.\\n\\nMore body.","image":"https://img/x.jpg"}
</script></head></html>`;

describe('media source commands', () => {
  it('lists wired AI channel as JSON envelope', async () => {
    let stdout = '';
    let stderr = '';
    const fetchText = vi.fn(async () => FEED_XML);
    const cli = createCli({
      mediaRuntime: { fetchText },
      stderr: (value) => {
        stderr += value;
      },
      stdout: (value) => {
        stdout += value;
      }
    });

    const code = await cli.run(['wired', 'list', 'AI', '--limit', '5']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const payload = JSON.parse(stdout);
    expect(payload.ok).toBe(true);
    expect(payload.data.source).toBe('wired');
    expect(payload.data.items[0].title).toBe('AI News');
    expect(fetchText).toHaveBeenCalled();
  });

  it('returns article JSON for wired', async () => {
    let stdout = '';
    const cli = createCli({
      mediaRuntime: {
        fetchText: vi.fn(async () => ARTICLE_HTML)
      },
      stderr: () => undefined,
      stdout: (value) => {
        stdout += value;
      }
    });

    const code = await cli.run(['wired', 'article', 'ai-news']);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.ok).toBe(true);
    expect(payload.data.title).toBe('AI News');
    expect(payload.data.content.paragraphs.length).toBeGreaterThanOrEqual(2);
  });

  it('returns structured error for bloomberg article', async () => {
    let stderr = '';
    const cli = createCli({
      mediaRuntime: { fetchText: vi.fn() },
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    // bloomberg has no article subcommand; unknown command becomes commander error
    const code = await cli.run(['bloomberg', 'article', 'x']);
    expect(code).not.toBe(0);
    expect(stderr.length + code).toBeGreaterThan(0);
  });

  it('lists bloomberg technology channel', async () => {
    let stdout = '';
    const cli = createCli({
      mediaRuntime: { fetchText: vi.fn(async () => FEED_XML) },
      stderr: () => undefined,
      stdout: (value) => {
        stdout += value;
      }
    });

    const code = await cli.run(['bloomberg', 'list', 'technology']);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.data.source).toBe('bloomberg');
  });
});
