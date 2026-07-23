import { describe, expect, it, vi } from 'vitest';

import { createCli } from '../../src/index.js';
import type {
  ToutiaoRuntime,
  ToutiaoSession
} from '../../src/toutiao/runtime.js';

function createRuntime(): {
  runtime: ToutiaoRuntime;
  session: ToutiaoSession;
} {
  const session: ToutiaoSession = {
    fetchArticle: vi.fn(async ({ input, url }) => ({
      authorName: 'Space Boundary',
      content: {
        paragraphs: ['Imagine humanity successfully returning to the Moon.'],
        text: 'Imagine humanity successfully returning to the Moon.'
      },
      id: input,
      publishTimeText: '2026-07-03 20:08',
      request: {
        input,
        url
      },
      title: 'Lunar dust is the hardest problem humans face on the Moon',
      url
    })),
    fetchAuthorArticles: vi.fn(async () => ({
      authorToken: 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      hasMore: true,
      items: [
        {
          id: '7658940228585734665',
          title: 'Google just released a new AI device',
          url: 'https://www.toutiao.com/article/7658940228585734665/'
        }
      ]
    })),
    fetchKeywordInformation: vi.fn(async () => ({
      hasMore: false,
      items: [
        {
          id: '7658211264790839862',
          title: 'An early AI camera with a forward-looking idea',
          url: 'https://www.toutiao.com/article/7658211264790839862/'
        }
      ],
      keyword: 'AI',
      source: 'AI' as const
    })),
    fetchTechnologyChannel: vi.fn(async () => ({
      hasMore: true,
      items: [
        {
          id: '7657359132571255323',
          title: 'Lunar dust is the hardest problem humans face on the Moon',
          url: 'https://toutiao.com/group/7657359132571255323/'
        }
      ],
      next: {
        maxBehotTime: 1_783_244_242,
        offset: 15
      },
      source: 'tech' as const
    }))
  };

  const withSession = vi.fn(async (
    operation: (activeSession: ToutiaoSession) => Promise<unknown>
  ) => operation(session));

  return {
    runtime: {
      withSession: withSession as ToutiaoRuntime['withSession']
    },
    session
  };
}

describe('ants toutiao command', () => {
  it('fetches article detail and renders JSON', async () => {
    let stdout = '';
    const { runtime, session } = createRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoRuntime: runtime
    });

    const exitCode = await cli.run(['toutiao', 'article', '7657359132571255323']);
    const parsed = JSON.parse(stdout) as {
      data: { content: { paragraphs: string[] }; id: string; title: string };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.id).toBe('7657359132571255323');
    expect(parsed.data.title).toContain('Lunar dust');
    expect(parsed.data.content.paragraphs).toHaveLength(1);
    expect(session.fetchArticle).toHaveBeenCalledWith({
      input: '7657359132571255323',
      url: 'https://www.toutiao.com/article/7657359132571255323/'
    });
  });

  it('fetches the technology channel and renders JSON', async () => {
    let stdout = '';
    const { runtime, session } = createRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoRuntime: runtime
    });

    const exitCode = await cli.run(['toutiao', 'list', 'tech', '--pages', '1']);
    const parsed = JSON.parse(stdout) as {
      data: { items: Array<{ id: string; title: string }>; source: string };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.source).toBe('tech');
    expect(parsed.data.items[0]?.title).toContain('Lunar dust');
    expect(session.fetchTechnologyChannel).toHaveBeenCalledWith({ pages: 1 });
  });

  it('fetches a supported keyword and renders JSON', async () => {
    let stdout = '';
    const { runtime, session } = createRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoRuntime: runtime
    });

    const exitCode = await cli.run(['toutiao', 'list', 'AI', '--pages', '1']);
    const parsed = JSON.parse(stdout) as {
      data: { items: Array<{ id: string; title: string }>; source: string };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.data.source).toBe('AI');
    expect(parsed.data.items[0]?.title).toContain('AI camera');
    expect(session.fetchKeywordInformation).toHaveBeenCalledWith({
      keyword: 'AI',
      pages: 1,
      source: 'AI'
    });
  });

  it('renders channel results as a table with -t', async () => {
    let stdout = '';
    const { runtime } = createRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoRuntime: runtime
    });

    const exitCode = await cli.run(['toutiao', 'list', 'AI', '--pages', '1', '-t']);

    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).toThrow();
    expect(stdout).toContain('id');
    expect(stdout).toContain('title');
    expect(stdout).toContain('An early AI camera');
  });

  it('renders unsupported source errors as JSON', async () => {
    let stderr = '';
    const { runtime } = createRuntime();
    const cli = createCli({
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined,
      toutiaoRuntime: runtime
    });

    const exitCode = await cli.run(['toutiao', 'list', 'sports']);

    expect(exitCode).toBe(2);
    expect(stderr).toContain('"code": "TOUTIAO_INVALID_SOURCE"');
  });

  it('fetches an author homepage feed and renders JSON', async () => {
    let stdout = '';
    const { runtime, session } = createRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoRuntime: runtime
    });

    const exitCode = await cli.run([
      'toutiao',
      'author',
      'https://www.toutiao.com/c/user/token/MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80/',
      '--pages',
      '1'
    ]);
    const parsed = JSON.parse(stdout) as {
      data: { authorToken: string; items: Array<{ id: string; title: string }> };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.authorToken).toBe(
      'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80'
    );
    expect(parsed.data.items[0]?.title).toContain('Google');
    expect(session.fetchAuthorArticles).toHaveBeenCalledWith({
      authorToken: 'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      pages: 1,
      url: 'https://www.toutiao.com/c/user/token/MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80/'
    });
  });

  it('renders an author feed as a table with -t', async () => {
    let stdout = '';
    const { runtime } = createRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoRuntime: runtime
    });

    const exitCode = await cli.run([
      'toutiao',
      'author',
      'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      '--pages',
      '1',
      '-t'
    ]);

    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).toThrow();
    expect(stdout).toContain('id');
    expect(stdout).toContain('title');
    expect(stdout).toContain('Google just released a new AI device');
  });

  it('fetches an author feed with article content when requested', async () => {
    let stdout = '';
    const { runtime, session } = createRuntime();
    const cli = createCli({
      stdout: (value) => {
        stdout += value;
      },
      toutiaoRuntime: runtime
    });

    const exitCode = await cli.run([
      'toutiao',
      'author',
      'MS4wLjABAAAAulU9CSwHtRjcF9bakxqiK8uYN7UQi2m8KFaNukylH80',
      '--with-content',
      '--pages',
      '1'
    ]);
    const parsed = JSON.parse(stdout) as {
      data: { articles?: Array<{ id: string; content: { text: string } }> };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.articles?.[0]?.id).toBe('7658940228585734665');
    expect(session.fetchArticle).toHaveBeenCalledWith({
      input: '7658940228585734665',
      url: 'https://www.toutiao.com/article/7658940228585734665/'
    });
  });

  it('rejects non-integer page arguments', async () => {
    let stderr = '';
    const cli = createCli({
      stderr: (value) => { stderr += value; },
      stdout: () => undefined
    });

    expect(await cli.run(['toutiao', 'list', 'AI', '--pages', 'many'])).toBe(2);
    expect(stderr).toContain('"code": "TOUTIAO_INVALID_PAGES"');
  });
});
