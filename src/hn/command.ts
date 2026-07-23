import type { Command } from 'commander';
import { z } from 'zod';

import {
  renderHackerNewsCommandErrorAsJson,
  renderHackerNewsSearchAsJson,
  renderHackerNewsSearchAsTable,
  renderHackerNewsStoriesAsJson,
  renderHackerNewsStoriesAsTable
} from './output.js';
import type { HackerNewsRuntime } from './runtime.js';
import { HackerNewsService } from './service.js';
import { HackerNewsCommandError, type HackerNewsStorySource } from './types.js';

export interface HackerNewsCommandDependencies {
  runtime: HackerNewsRuntime;
  stderr: (value: string) => void;
  stdout: (value: string) => void;
}

const storiesOptionsSchema = z.object({
  format: z.enum(['json', 'table']).default('json'),
  limit: z.number().int().default(30),
  table: z.boolean().optional()
});

const searchOptionsSchema = z.object({
  format: z.enum(['json', 'table']).default('json'),
  limit: z.number().int().default(30),
  sort: z.enum(['relevance', 'date']).default('relevance'),
  table: z.boolean().optional()
});

export function registerHackerNewsCommands(
  program: Command,
  dependencies: HackerNewsCommandDependencies
): void {
  const hn = program
    .command('hn')
    .alias('hackernews')
    .description('Fetch Hacker News stories and search results.');
  const service = new HackerNewsService({ runtime: dependencies.runtime });

  for (const source of ['top', 'new', 'best'] as const) {
    hn.command(source)
      .option('--limit <limit>', 'number of stories to fetch', parseLimit, 30)
      .option('--format <format>', 'output format', 'json')
      .option('-t, --table', 'render as a table')
      .action(async (options) => {
        const parsed = storiesOptionsSchema.parse(applyTableShortcut(options));
        const result = await service.stories({
          limit: parsed.limit,
          source
        });
        dependencies.stdout(
          parsed.format === 'table'
            ? `${renderHackerNewsStoriesAsTable(result)}\n`
            : `${renderHackerNewsStoriesAsJson(result)}\n`
        );
      });
  }

  hn.command('search')
    .argument('<query>', 'search query')
    .option('--limit <limit>', 'number of search results to fetch', parseLimit, 30)
    .option('--sort <sort>', 'search sort: relevance or date', 'relevance')
    .option('--format <format>', 'output format', 'json')
    .option('-t, --table', 'render as a table')
    .action(async (query, options) => {
      const parsed = searchOptionsSchema.parse(applyTableShortcut(options));
      const result = await service.search({
        limit: parsed.limit,
        query,
        sort: parsed.sort
      });
      dependencies.stdout(
        parsed.format === 'table'
          ? `${renderHackerNewsSearchAsTable(result)}\n`
          : `${renderHackerNewsSearchAsJson(result)}\n`
      );
    });
}

export function handleHackerNewsCommandError(
  error: unknown,
  dependencies: Pick<HackerNewsCommandDependencies, 'stderr'>
): number | undefined {
  if (error instanceof HackerNewsCommandError) {
    dependencies.stderr(
      `${renderHackerNewsCommandErrorAsJson(error.code, error.message, error.details)}\n`
    );
    return error.exitCode;
  }

  return undefined;
}

function parseLimit(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new HackerNewsCommandError(
      'HN_INVALID_LIMIT',
      'Hacker News limit must be an integer between 1 and 100.',
      2,
      {
        limit: value
      }
    );
  }

  return parsed;
}

function applyTableShortcut<T extends { format: string; table?: boolean }>(options: T): T & {
  format: 'json' | 'table';
} {
  if (options.table) {
    return {
      ...options,
      format: 'table'
    };
  }

  return {
    ...options,
    format: options.format as 'json' | 'table'
  };
}
