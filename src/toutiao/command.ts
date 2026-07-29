import type { Command } from 'commander';
import { z } from 'zod';

import { ToutiaoAuthService } from './auth.js';
import {
  renderToutiaoArticleAsJson,
  renderToutiaoAuthStatusAsJson,
  renderToutiaoAuthorAsJson,
  renderToutiaoAuthorAsTable,
  renderToutiaoCommandErrorAsJson,
  renderToutiaoListAsJson,
  renderToutiaoListAsTable,
  renderToutiaoPublishResultAsJson
} from './output.js';
import type { ToutiaoPublishRuntime } from './publish-runtime.js';
import { createDefaultToutiaoPublishRuntime } from './publish-runtime.js';
import { ToutiaoPublishService } from './publish-service.js';
import type { ToutiaoRuntime } from './runtime.js';
import { ToutiaoService } from './service.js';
import { ToutiaoCommandError } from './types.js';

export interface ToutiaoCommandDependencies {
  publishRuntime?: ToutiaoPublishRuntime;
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

const authLoginOptionsSchema = z.object({
  state: z.string().optional(),
  timeoutMs: z.number().int().positive().default(5 * 60 * 1000)
});

const authStateOptionsSchema = z.object({
  state: z.string().optional()
});

const publishStrategySchema = z.enum(['draft', 'publish']).default('draft');

const publishArticleOptionsSchema = z.object({
  category: z.string().optional(),
  claim: z.string().optional(),
  content: z.string().optional(),
  contentFile: z.string().optional(),
  cover: z.string().optional(),
  dryRun: z.boolean().default(false),
  headed: z.boolean().default(false),
  keywords: z.string().optional(),
  state: z.string().optional(),
  strategy: publishStrategySchema,
  title: z.string().min(1)
});

const publishMicroOptionsSchema = z.object({
  content: z.string().optional(),
  contentFile: z.string().optional(),
  dryRun: z.boolean().default(false),
  headed: z.boolean().default(false),
  images: z.string().optional(),
  state: z.string().optional(),
  strategy: publishStrategySchema,
  topic: z.string().optional()
});

export function registerToutiaoCommands(
  program: Command,
  dependencies: ToutiaoCommandDependencies
): void {
  const toutiao = program.command('toutiao')
    .description('Fetch and publish Toutiao content.');
  const service = new ToutiaoService({ runtime: dependencies.runtime });
  const publishRuntime = dependencies.publishRuntime
    ?? createDefaultToutiaoPublishRuntime();
  const authService = new ToutiaoAuthService({ publishRuntime });
  const publishService = new ToutiaoPublishService({ publishRuntime });

  registerCollectorCommands(toutiao, service, dependencies);
  registerAuthCommands(toutiao, authService, dependencies);
  registerPublishCommands(toutiao, publishService, dependencies);
}

function registerCollectorCommands(
  toutiao: Command,
  service: ToutiaoService,
  dependencies: Pick<ToutiaoCommandDependencies, 'stdout'>
): void {
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

function registerAuthCommands(
  toutiao: Command,
  authService: ToutiaoAuthService,
  dependencies: Pick<ToutiaoCommandDependencies, 'stdout'>
): void {
  const auth = toutiao.command('auth')
    .description('Manage Toutiao creator console login state.');

  auth.command('login')
    .description('Open a headed browser, scan the QR code once, and save storageState.')
    .option('--state <path>', 'Playwright storageState path')
    .option('--timeout-ms <ms>', 'QR login timeout in milliseconds', parsePositiveInt, 5 * 60 * 1000)
    .action(async (options) => {
      const parsed = authLoginOptionsSchema.parse({
        ...(options.state === undefined ? {} : { state: options.state }),
        timeoutMs: options.timeoutMs
      });
      const result = await authService.login({
        ...(parsed.state === undefined ? {} : { statePath: parsed.state }),
        timeoutMs: parsed.timeoutMs
      });
      dependencies.stdout(`${renderToutiaoAuthStatusAsJson(result)}\n`);
    });

  auth.command('status')
    .description('Check whether the saved creator session is still valid.')
    .option('--state <path>', 'Playwright storageState path')
    .action(async (options) => {
      const parsed = authStateOptionsSchema.parse(
        options.state === undefined ? {} : { state: options.state }
      );
      const result = await authService.status(
        parsed.state === undefined ? {} : { statePath: parsed.state }
      );
      dependencies.stdout(`${renderToutiaoAuthStatusAsJson(result)}\n`);
    });

  auth.command('logout')
    .description('Delete the local storageState file for this account.')
    .option('--state <path>', 'Playwright storageState path')
    .action(async (options) => {
      const parsed = authStateOptionsSchema.parse(
        options.state === undefined ? {} : { state: options.state }
      );
      const result = await authService.logout(
        parsed.state === undefined ? {} : { statePath: parsed.state }
      );
      dependencies.stdout(`${renderToutiaoAuthStatusAsJson(result)}\n`);
    });
}

function registerPublishCommands(
  toutiao: Command,
  publishService: ToutiaoPublishService,
  dependencies: Pick<ToutiaoCommandDependencies, 'stdout'>
): void {
  const publish = toutiao.command('publish')
    .description('Create Toutiao drafts or explicitly publish content.');

  publish.command('article')
    .description('Create an article draft (default) or publish with --strategy publish.')
    .requiredOption('--title <title>', 'article title')
    .option('--content <text>', 'article body text')
    .option('--content-file <path>', 'read article body from a file')
    .option('--cover <path>', 'local cover image path')
    .option('--keywords <csv>', 'comma-separated keywords/tags')
    .option('--category <name>', 'category label as shown in the creator console')
    .option('--claim <name>', 'declaration/claim label as shown in the creator console')
    .option(
      '--strategy <strategy>',
      'draft (default) or publish (explicit live submit)',
      'draft'
    )
    .option('--state <path>', 'Playwright storageState path')
    .option('--dry-run', 'validate inputs and auth state without writing')
    .option('--headed', 'show the browser window while publishing')
    .action(async (options) => {
      const parsed = publishArticleOptionsSchema.parse(options);
      const result = await publishService.publishArticle(
        buildArticlePublishRequest(parsed)
      );
      dependencies.stdout(`${renderToutiaoPublishResultAsJson(result)}\n`);
    });

  publish.command('micro')
    .description('Create a micro-post draft (default) or publish with --strategy publish.')
    .option('--content <text>', 'micro-post body text')
    .option('--content-file <path>', 'read micro-post body from a file')
    .option('--images <paths>', 'comma-separated local image paths (max 9)')
    .option('--topic <name>', 'optional topic/hashtag without requiring # wrappers')
    .option(
      '--strategy <strategy>',
      'draft (default) or publish (explicit live submit)',
      'draft'
    )
    .option('--state <path>', 'Playwright storageState path')
    .option('--dry-run', 'validate inputs and auth state without writing')
    .option('--headed', 'show the browser window while publishing')
    .action(async (options) => {
      const parsed = publishMicroOptionsSchema.parse(options);
      const result = await publishService.publishMicro(
        buildMicroPublishRequest(parsed)
      );
      dependencies.stdout(`${renderToutiaoPublishResultAsJson(result)}\n`);
    });
}

function buildArticlePublishRequest(
  parsed: z.infer<typeof publishArticleOptionsSchema>
): Parameters<ToutiaoPublishService['publishArticle']>[0] {
  const keywords = parseKeywords(parsed.keywords);
  return {
    title: parsed.title,
    dryRun: parsed.dryRun,
    headed: parsed.headed,
    strategy: parsed.strategy,
    ...(parsed.category === undefined ? {} : { category: parsed.category }),
    ...(parsed.claim === undefined ? {} : { claim: parsed.claim }),
    ...(parsed.content === undefined ? {} : { content: parsed.content }),
    ...(parsed.contentFile === undefined ? {} : { contentFile: parsed.contentFile }),
    ...(parsed.cover === undefined ? {} : { cover: parsed.cover }),
    ...(keywords === undefined ? {} : { keywords }),
    ...(parsed.state === undefined ? {} : { statePath: parsed.state })
  };
}

function buildMicroPublishRequest(
  parsed: z.infer<typeof publishMicroOptionsSchema>
): Parameters<ToutiaoPublishService['publishMicro']>[0] {
  const images = parseImageList(parsed.images);
  return {
    dryRun: parsed.dryRun,
    headed: parsed.headed,
    strategy: parsed.strategy,
    ...(parsed.content === undefined ? {} : { content: parsed.content }),
    ...(parsed.contentFile === undefined ? {} : { contentFile: parsed.contentFile }),
    ...(images === undefined ? {} : { images }),
    ...(parsed.state === undefined ? {} : { statePath: parsed.state }),
    ...(parsed.topic === undefined ? {} : { topic: parsed.topic })
  };
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

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ToutiaoCommandError(
      'TOUTIAO_INVALID_INPUT',
      'Timeout must be a positive integer number of milliseconds.',
      2,
      { timeoutMs: value }
    );
  }
  return parsed;
}

function parseKeywords(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseImageList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
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
