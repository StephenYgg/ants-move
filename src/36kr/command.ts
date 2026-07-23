import type { Command } from 'commander';
import { z } from 'zod';

import {
  renderKr36ArticleAsJson,
  renderKr36CommandErrorAsJson,
  renderKr36InformationListAsJson,
  renderKr36InformationListAsTable
} from './output.js';
import type { Kr36Runtime } from './runtime.js';
import { Kr36ArticleService } from './service.js';
import { Kr36CommandError } from './types.js';

export interface Kr36CommandDependencies {
  runtime: Kr36Runtime;
  stderr: (value: string) => void;
  stdout: (value: string) => void;
}

const articleOptionsSchema = z.object({
  format: z.enum(['json']).default('json')
});

const informationListOptionsSchema = z.object({
  format: z.enum(['json', 'table']).default('json'),
  pages: z.number().int().min(1).max(20).default(1),
  table: z.boolean().optional()
});

export function registerKr36Commands(
  program: Command,
  dependencies: Kr36CommandDependencies
): void {
  const kr36 = program.command('36kr').description('Fetch and parse 36kr content.');
  const articleService = new Kr36ArticleService(dependencies.runtime);

  kr36.command('article')
    .argument('<articleId>', '36kr article id')
    .option('--format <format>', 'output format', 'json')
    .action(async (articleId, options) => {
      articleOptionsSchema.parse(options);
      const article = await articleService.getArticle(articleId);
      dependencies.stdout(`${renderKr36ArticleAsJson(article)}\n`);
    });

  kr36.command('list')
    .argument('<channel>', '36kr information channel: AI or technology')
    .option('--pages <pages>', 'number of pages to fetch', parsePages, 1)
    .option('--format <format>', 'output format', 'json')
    .option('-t, --table', 'render as a table')
    .action(async (channel, options) => {
      const parsed = informationListOptionsSchema.parse(applyTableShortcut(options));
      const list = await articleService.getInformationList({
        channel,
        pages: parsed.pages
      });
      dependencies.stdout(
        parsed.format === 'table'
          ? `${renderKr36InformationListAsTable(list)}\n`
          : `${renderKr36InformationListAsJson(list)}\n`
      );
    });
}

export function handleKr36CommandError(
  error: unknown,
  dependencies: Pick<Kr36CommandDependencies, 'stderr'>
): number | undefined {
  if (error instanceof Kr36CommandError) {
    dependencies.stderr(
      `${renderKr36CommandErrorAsJson(error.code, error.message, error.details)}\n`
    );
    return error.exitCode;
  }

  return undefined;
}

function parsePages(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Kr36CommandError(
      'KR36_INVALID_PAGES',
      '36kr list pages must be an integer between 1 and 20.',
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
