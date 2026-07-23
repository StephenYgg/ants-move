import type { HackerNewsRuntime } from './runtime.js';
import {
  HackerNewsCommandError,
  type HackerNewsSearchResult,
  type HackerNewsSearchSort,
  type HackerNewsStoriesResult,
  type HackerNewsStorySource
} from './types.js';

const SUPPORTED_SOURCES = new Set<HackerNewsStorySource>(['top', 'new', 'best']);

export class HackerNewsService {
  constructor(private readonly dependencies: { runtime: HackerNewsRuntime }) {}

  async stories(options: {
    limit?: number;
    source: string;
  }): Promise<HackerNewsStoriesResult> {
    const source = parseSource(options.source);
    const limit = normalizeLimit(options.limit);
    const runtimeResult = await this.dependencies.runtime.fetchStories({
      limit,
      source
    });

    return {
      ...runtimeResult,
      meta: {
        limit,
        totalItems: runtimeResult.items.length
      }
    };
  }

  async search(options: {
    limit?: number;
    query: string;
    sort?: HackerNewsSearchSort;
  }): Promise<HackerNewsSearchResult> {
    const query = normalizeQuery(options.query);
    const limit = normalizeLimit(options.limit);
    const sort = options.sort ?? 'relevance';
    const runtimeResult = await this.dependencies.runtime.fetchSearch({
      limit,
      query,
      sort
    });

    return {
      ...runtimeResult,
      meta: {
        limit,
        sort,
        totalItems: runtimeResult.items.length
      }
    };
  }
}

function parseSource(source: string): HackerNewsStorySource {
  if (SUPPORTED_SOURCES.has(source as HackerNewsStorySource)) {
    return source as HackerNewsStorySource;
  }

  throw new HackerNewsCommandError(
    'HN_INVALID_SOURCE',
    'Hacker News list only supports top, new, and best.',
    2,
    {
      source,
      supportedSources: [...SUPPORTED_SOURCES]
    }
  );
}

function normalizeLimit(limit: number | undefined): number {
  const value = limit ?? 30;

  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new HackerNewsCommandError(
      'HN_INVALID_LIMIT',
      'Hacker News limit must be an integer between 1 and 100.',
      2,
      {
        limit: value
      }
    );
  }

  return value;
}

function normalizeQuery(query: string): string {
  const value = query.trim();

  if (value.length === 0) {
    throw new HackerNewsCommandError(
      'HN_INVALID_QUERY',
      'Hacker News search query must not be empty.',
      2
    );
  }

  return value;
}
