import { describe, expect, it, vi } from 'vitest';

import { HackerNewsService } from '../../src/hn/service.js';
import { HackerNewsCommandError } from '../../src/hn/types.js';

describe('HackerNewsService', () => {
  it('fetches top stories with the requested limit', async () => {
    const fetchStories = vi.fn(async () => ({
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
          title: 'A good Hacker News story',
          type: 'story' as const,
          url: 'https://example.com/story'
        }
      ],
      source: 'top' as const
    }));
    const service = new HackerNewsService({
      runtime: {
        fetchSearch: vi.fn(),
        fetchStories
      }
    });

    const result = await service.stories({
      limit: 1,
      source: 'top'
    });

    expect(fetchStories).toHaveBeenCalledWith({
      limit: 1,
      source: 'top'
    });
    expect(result.source).toBe('top');
    expect(result.items[0]?.title).toBe('A good Hacker News story');
    expect(result.meta.totalItems).toBe(1);
  });

  it('uses the default result limit when none is provided', async () => {
    const fetchStories = vi.fn(async () => ({ items: [], source: 'new' as const }));
    const service = new HackerNewsService({
      runtime: { fetchSearch: vi.fn(), fetchStories }
    });

    const result = await service.stories({ source: 'new' });

    expect(fetchStories).toHaveBeenCalledWith({ limit: 30, source: 'new' });
    expect(result.meta.limit).toBe(30);
  });

  it('fetches search results from the runtime', async () => {
    const fetchSearch = vi.fn(async () => ({
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
    }));
    const service = new HackerNewsService({
      runtime: {
        fetchSearch,
        fetchStories: vi.fn()
      }
    });

    const result = await service.search({
      limit: 1,
      query: 'rust'
    });

    expect(fetchSearch).toHaveBeenCalledWith({
      limit: 1,
      query: 'rust',
      sort: 'relevance'
    });
    expect(result.query).toBe('rust');
    expect(result.items[0]?.title).toContain('Rust');
  });

  it('rejects invalid story sources', async () => {
    const service = new HackerNewsService({
      runtime: {
        fetchSearch: vi.fn(),
        fetchStories: vi.fn()
      }
    });

    await expect(service.stories({ limit: 1, source: 'show' })).rejects.toMatchObject({
      code: 'HN_INVALID_SOURCE',
      exitCode: 2
    });
  });

  it('rejects invalid limits', async () => {
    const service = new HackerNewsService({
      runtime: {
        fetchSearch: vi.fn(),
        fetchStories: vi.fn()
      }
    });

    await expect(service.stories({ limit: 0, source: 'top' })).rejects.toBeInstanceOf(
      HackerNewsCommandError
    );
    await expect(service.search({ limit: 101, query: 'rust' })).rejects.toMatchObject({
      code: 'HN_INVALID_LIMIT'
    });
  });

  it('rejects empty search queries', async () => {
    const service = new HackerNewsService({
      runtime: {
        fetchSearch: vi.fn(),
        fetchStories: vi.fn()
      }
    });

    await expect(service.search({ limit: 10, query: '   ' })).rejects.toMatchObject({
      code: 'HN_INVALID_QUERY',
      exitCode: 2
    });
  });
});
