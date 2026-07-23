import { describe, expect, it, vi } from 'vitest';

import { createCli } from '../../src/index.js';
import type { HackerNewsRuntime } from '../../src/hn/runtime.js';

function createRuntime(): HackerNewsRuntime {
  return {
    fetchSearch: vi.fn(async () => ({
      items: [
        {
          author: 'Sikul',
          commentCount: 642,
          id: 22238335,
          score: 1582,
          time: {
            iso: '2020-02-04T17:30:40.000Z',
            seconds: 1580837440
          },
          title: 'Why Discord is switching from Go to Rust',
          type: 'story' as const,
          url: 'https://blog.discordapp.com/why-discord-is-switching-from-go-to-rust-a190bbca2b1f'
        }
      ],
      query: 'rust'
    })),
    fetchStories: vi.fn(async ({ source }) => ({
      items: [
        {
          author: 'pg',
          commentCount: 12,
          id: 123,
          score: 99,
          time: {
            iso: '2026-07-05T00:00:00.000Z',
            seconds: 1783209600
          },
          title: `${source} story`,
          type: 'story' as const,
          url: 'https://example.com/story'
        }
      ],
      source
    }))
  };
}

describe('ants hn command', () => {
  it('fetches top stories and renders JSON', async () => {
    let stdout = '';
    const runtime = createRuntime();
    const cli = createCli({
      hackerNewsRuntime: runtime,
      stdout: (value) => {
        stdout += value;
      }
    });

    const exitCode = await cli.run(['hn', 'top', '--limit', '1']);
    const parsed = JSON.parse(stdout) as {
      data: { items: Array<{ title: string }>; source: string };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.source).toBe('top');
    expect(parsed.data.items[0]?.title).toBe('top story');
    expect(runtime.fetchStories).toHaveBeenCalledWith({
      limit: 1,
      source: 'top'
    });
  });

  it('fetches new and best story lists', async () => {
    const runtime = createRuntime();

    for (const source of ['new', 'best'] as const) {
      let stdout = '';
      const cli = createCli({
        hackerNewsRuntime: runtime,
        stdout: (value) => {
          stdout += value;
        }
      });

      const exitCode = await cli.run(['hn', source, '--limit', '1']);
      const parsed = JSON.parse(stdout) as {
        data: { source: string };
      };

      expect(exitCode).toBe(0);
      expect(parsed.data.source).toBe(source);
    }
  });

  it('searches stories and renders JSON', async () => {
    let stdout = '';
    const runtime = createRuntime();
    const cli = createCli({
      hackerNewsRuntime: runtime,
      stdout: (value) => {
        stdout += value;
      }
    });

    const exitCode = await cli.run(['hn', 'search', 'rust', '--limit', '1']);
    const parsed = JSON.parse(stdout) as {
      data: { items: Array<{ title: string }>; query: string };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.query).toBe('rust');
    expect(parsed.data.items[0]?.title).toContain('Rust');
    expect(runtime.fetchSearch).toHaveBeenCalledWith({
      limit: 1,
      query: 'rust',
      sort: 'relevance'
    });
  });

  it('renders story lists as a table with -t', async () => {
    let stdout = '';
    const runtime = createRuntime();
    const cli = createCli({
      hackerNewsRuntime: runtime,
      stdout: (value) => {
        stdout += value;
      }
    });

    const exitCode = await cli.run(['hn', 'top', '--limit', '1', '-t']);

    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).toThrow();
    expect(stdout).toContain('id');
    expect(stdout).toContain('title');
    expect(stdout).toContain('top story');
  });

  it('renders search results as a table with -t', async () => {
    let stdout = '';
    const runtime = createRuntime();
    const cli = createCli({
      hackerNewsRuntime: runtime,
      stdout: (value) => {
        stdout += value;
      }
    });

    const exitCode = await cli.run(['hn', 'search', 'rust', '--limit', '1', '-t']);

    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).toThrow();
    expect(stdout).toContain('id');
    expect(stdout).toContain('title');
    expect(stdout).toContain('Why Discord is switching from Go to Rust');
  });

  it('renders invalid limit errors as JSON', async () => {
    let stderr = '';
    const cli = createCli({
      hackerNewsRuntime: createRuntime(),
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    const exitCode = await cli.run(['hn', 'top', '--limit', '0']);

    expect(exitCode).toBe(2);
    expect(stderr).toContain('"code": "HN_INVALID_LIMIT"');
  });

  it('supports hackernews as an alias for hn', async () => {
    let stdout = '';
    const cli = createCli({
      hackerNewsRuntime: createRuntime(),
      stdout: (value) => {
        stdout += value;
      }
    });

    expect(await cli.run(['hackernews', 'best', '--limit', '1'])).toBe(0);
    expect(JSON.parse(stdout).data.source).toBe('best');
  });

  it('rejects non-integer limits', async () => {
    let stderr = '';
    const cli = createCli({
      stderr: (value) => { stderr += value; },
      stdout: () => undefined
    });

    expect(await cli.run(['hn', 'top', '--limit', 'many'])).toBe(2);
    expect(stderr).toContain('"code": "HN_INVALID_LIMIT"');
  });
});
