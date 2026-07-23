import type { Command } from 'commander';
import { z } from 'zod';

import {
  renderToutiaoArticleAsJson,
  renderToutiaoAuthorAsJson,
  renderToutiaoAuthorAsTable,
  renderToutiaoCommandErrorAsJson,
  renderToutiaoListAsJson,
  renderToutiaoListAsTable
} from './output.js';
import type { ToutiaoRuntime } from './runtime.js';
import { ToutiaoService } from './service.js';
import { ToutiaoCommandError } from './types.js';

export interface ToutiaoCommandDependencies {
  runtime: ToutiaoRuntime;
  stderr: (value: string) => void;
  stdout: (value: string) => void;
}

const listOptionsSchema = z.object({
  format: z.enum(['json', 'table']).default('json'),
  pages: z.number().int().min(1).max(5).default(1),
  table: z.boolean().optional()
});

const articleOptionsSchema = z.object({
  format: z.enum(['json']).default('json')
});

const authorOptionsSchema = z.object({
  format: z.enum(['json', 'table']).default('json'),
  pages: z.number().int().min(1).max(5).default(1),
  table: z.boolean().optional(),
  withContent: z.boolean().default(false)
});

export function registerToutiaoCommands(
  program: Command,
  dependencies: ToutiaoCommandDependencies
): void {
  const toutiao = program.command('toutiao')
    .description('Fetch Toutiao channel and search content.');
  const service = new ToutiaoService({ runtime: dependencies.runtime });

  toutiao.command('article')
    .argument('<article>', 'Toutiao article id or URL')
    .option('--format <format>', 'output format', 'json')
    .action(async (article, options) => {
      articleOptionsSchema.parse(options);
      const result = await service.article(article);
      dependencies.stdout(`${renderToutiaoArticleAsJson(result)}\n`);
    });

  toutiao.command('list')
    .argument('<source>', 'Toutiao source: tech, AI, 光刻机, 芯片, or 半导体')
    .option('--pages <pages>', 'number of pages to fetch', parsePages, 1)
    .option('--format <format>', 'output format', 'json')
    .option('-t, --table', 'render as a table')
    .action(async (source, options) => {
      const parsed = listOptionsSchema.parse(applyTableShortcut(options));
      const result = await service.list({
        pages: parsed.pages,
        source
      });
      dependencies.stdout(
        parsed.format === 'table'
          ? `${renderToutiaoListAsTable(result)}\n`
          : `${renderToutiaoListAsJson(result)}\n`
      );
    });

  toutiao.command('author')
    .argument('<author>', 'Toutiao author token or /c/user/token/<token>/ homepage URL')
    .option('--pages <pages>', 'number of pages to fetch', parsePages, 1)
    .option('--with-content', 'also fetch detail content for each author article')
    .option('--format <format>', 'output format', 'json')
    .option('-t, --table', 'render as a table')
    .action(async (author, options) => {
      const parsed = authorOptionsSchema.parse(applyTableShortcut(options));
      const result = await service.author(author, {
        pages: parsed.pages,
        withContent: parsed.withContent
      });
      dependencies.stdout(
        parsed.format === 'table'
          ? `${renderToutiaoAuthorAsTable(result)}\n`
          : `${renderToutiaoAuthorAsJson(result)}\n`
      );
    });
}

export function handleToutiaoCommandError(
  error: unknown,
  dependencies: Pick<ToutiaoCommandDependencies, 'stderr'>
): number | undefined {
  if (error instanceof ToutiaoCommandError) {
    dependencies.stderr(
      `${renderToutiaoCommandErrorAsJson(error.code, error.message, error.details)}\n`
    );
    return error.exitCode;
  }

  return undefined;
}

function parsePages(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new ToutiaoCommandError(
      'TOUTIAO_INVALID_PAGES',
      'Toutiao list pages must be an integer between 1 and 5.',
      2,
      {
        pages: value
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
