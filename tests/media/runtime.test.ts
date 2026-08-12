import { describe, expect, it, vi } from 'vitest';

import { createDefaultMediaRuntime } from '../../src/media/runtime.js';
import { MediaCommandError } from '../../src/media/types.js';

describe('createDefaultMediaRuntime', () => {
  it('invokes curl with browser headers and returns stdout', async () => {
    const execFile = vi.fn(async () => ({
      stderr: '',
      stdout: '<rss></rss>'
    }));
    const runtime = createDefaultMediaRuntime({ execFile });

    const body = await runtime.fetchText({
      headers: {
        Accept: 'application/rss+xml',
        'User-Agent': 'Chrome/126'
      },
      url: 'https://example.com/feed.xml'
    });

    expect(body).toBe('<rss></rss>');
    expect(execFile).toHaveBeenCalledWith(
      'curl',
      expect.arrayContaining([
        '--compressed',
        '--header',
        'User-Agent: Chrome/126',
        'https://example.com/feed.xml'
      ]),
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('maps curl failures to MEDIA_REQUEST_FAILED', async () => {
    const execFile = vi.fn(async () => {
      const error = new Error('boom') as Error & { code?: number; stderr?: string };
      error.code = 22;
      error.stderr = 'HTTP 403';
      throw error;
    });
    const runtime = createDefaultMediaRuntime({ execFile });

    await expect(
      runtime.fetchText({
        headers: {},
        url: 'https://example.com/x'
      })
    ).rejects.toMatchObject({
      code: 'MEDIA_REQUEST_FAILED'
    });
    await expect(
      runtime.fetchText({
        headers: {},
        url: 'https://example.com/x'
      })
    ).rejects.toBeInstanceOf(MediaCommandError);
  });

  it('falls back to generic message when stderr is empty', async () => {
    const execFile = vi.fn(async () => {
      throw new Error('silent failure');
    });
    const runtime = createDefaultMediaRuntime({ execFile, maxBuffer: 1024 });

    await expect(
      runtime.fetchText({
        headers: {},
        url: 'https://example.com/y'
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('curl request failed')
    });
  });

  it('supports browser fallback via injected playwright loader', async () => {
    const page = {
      content: vi.fn(async () => '<html><body>ok</body></html>'),
      goto: vi.fn(async () => ({ status: () => 200 })),
      waitForTimeout: vi.fn(async () => undefined)
    };
    const context = {
      newPage: vi.fn(async () => page)
    };
    const browser = {
      close: vi.fn(async () => undefined),
      newContext: vi.fn(async () => context)
    };
    const runtime = createDefaultMediaRuntime({
      execFile: vi.fn(async () => ({ stderr: '', stdout: '' })),
      loadPlaywright: async () =>
        ({
          chromium: {
            launch: vi.fn(async () => browser)
          }
        }) as unknown as typeof import('playwright')
    });

    expect(runtime.fetchHtmlBrowser).toBeTypeOf('function');
    const html = await runtime.fetchHtmlBrowser!({
      headers: { 'User-Agent': 'Chrome/126' },
      url: 'https://example.com/story'
    });
    expect(html).toContain('ok');
    expect(page.goto).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it('can disable browser fallback', () => {
    const runtime = createDefaultMediaRuntime({
      enableBrowserFallback: false,
      execFile: vi.fn(async () => ({ stderr: '', stdout: '' }))
    });
    expect(runtime.fetchHtmlBrowser).toBeUndefined();
  });
});
