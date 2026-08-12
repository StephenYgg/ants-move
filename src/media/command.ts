import type { Command } from 'commander';
import { z } from 'zod';

import {
  renderMediaArticleAsJson,
  renderMediaCommandErrorAsJson,
  renderMediaListAsJson,
  renderMediaListAsTable
} from './output.js';
import type { MediaRuntime } from './runtime.js';
import { MediaCollectorService } from './service.js';
import { MEDIA_SOURCES } from './sources.js';
import { MediaCommandError, type MediaSourceDefinition } from './types.js';

export interface MediaCommandDependencies {
  runtime: MediaRuntime;
  stderr: (value: string) => void;
  stdout: (value: string) => void;
}

const listOptionsSchema = z.object({
  format: z.enum(['json', 'table']).default('json'),
  limit: z.number().int().min(1).max(50).default(20),
  table: z.boolean().optional()
});

const articleOptionsSchema = z.object({
  format: z.enum(['json']).default('json')
});

export function registerMediaCommands(
  program: Command,
  dependencies: MediaCommandDependencies
): void {
  for (const definition of MEDIA_SOURCES) {
    registerOneMediaSource(program, dependencies, definition);
  }
}

function registerOneMediaSource(
  program: Command,
  dependencies: MediaCommandDependencies,
  definition: MediaSourceDefinition
): void {
  const root = program
    .command(definition.command)
    .description(definition.description);
  const service = new MediaCollectorService(definition, dependencies.runtime);
  const channels = Object.keys(definition.channels).join('|');

  root
    .command('list')
    .argument('<channel>', `information channel: ${channels}`)
    .option('--limit <limit>', 'max items to return (1-50)', parseLimit, 20)
    .option('--format <format>', 'output format', 'json')
    .option('-t, --table', 'render as a table')
    .action(async (channel, options) => {
      const parsed = listOptionsSchema.parse(applyTableShortcut(options));
      const list = await service.getList({
        channel,
        limit: parsed.limit
      });
      dependencies.stdout(
        parsed.format === 'table'
          ? `${renderMediaListAsTable(list)}\n`
          : `${renderMediaListAsJson(list)}\n`
      );
    });

  if (!definition.listOnly) {
    root
      .command('article')
      .argument('<articleRef>', 'article id, slug, or full URL')
      .option('--format <format>', 'output format', 'json')
      .action(async (articleRef, options) => {
        articleOptionsSchema.parse(options);
        const article = await service.getArticle(articleRef);
        dependencies.stdout(`${renderMediaArticleAsJson(article)}\n`);
      });
  }
}

export function handleMediaCommandError(
  error: unknown,
  dependencies: Pick<MediaCommandDependencies, 'stderr'>
): number | undefined {
  if (error instanceof MediaCommandError) {
    dependencies.stderr(
      `${renderMediaCommandErrorAsJson(error.code, error.message, error.details)}\n`
    );
    return error.exitCode;
  }

  return undefined;
}

function parseLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new MediaCommandError(
      'MEDIA_INVALID_LIMIT',
      'Media list limit must be an integer between 1 and 50.',
      2,
      { limit: value }
    );
  }
  return parsed;
}

function applyTableShortcut<T extends { format?: string; table?: boolean }>(
  options: T
): T & { format: 'json' | 'table' } {
  if (options.table) {
    return {
      ...options,
      format: 'table'
    };
  }

  return {
    ...options,
    format: (options.format ?? 'json') as 'json' | 'table'
  };
}
