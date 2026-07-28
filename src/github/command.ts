import type { Command } from 'commander';
import { z } from 'zod';

import {
  renderGitHubCommandErrorAsJson,
  renderGitHubReadmeAsJson,
  renderGitHubTrendingAsJson,
  renderGitHubTrendingAsTable
} from './output.js';
import { GitHubService } from './service.js';
import {
  GitHubCommandError,
  type GitHubRuntime
} from './types.js';

export interface GitHubCommandDependencies {
  runtime: GitHubRuntime;
  stderr: (value: string) => void;
  stdout: (value: string) => void;
}

const trendingOptionsSchema = z.object({
  format: z.enum(['json', 'table']).default('json'),
  since: z.string().default('daily'),
  table: z.boolean().optional()
});

export function registerGitHubCommands(
  program: Command,
  dependencies: GitHubCommandDependencies
): void {
  const github = program
    .command('github')
    .description('Fetch GitHub repository data.');
  const service = new GitHubService({ runtime: dependencies.runtime });

  github.command('readme')
    .description('Fetch the preferred README for a public GitHub repository.')
    .argument('<repository-url>', 'public GitHub repository root URL')
    .action(async (repositoryUrl: string) => {
      const result = await service.readme(repositoryUrl);
      dependencies.stdout(`${renderGitHubReadmeAsJson(result)}\n`);
    });

  github.command('trending')
    .description('Fetch the all-language GitHub Trending page.')
    .option(
      '--since <period>',
      'trending period: daily, weekly, or monthly',
      'daily'
    )
    .option('--format <format>', 'output format', 'json')
    .option('-t, --table', 'render as a table')
    .action(async (options) => {
      const parsed = trendingOptionsSchema.parse(applyTableShortcut(options));
      const result = await service.trending({ period: parsed.since });
      dependencies.stdout(
        parsed.format === 'table'
          ? `${renderGitHubTrendingAsTable(result)}\n`
          : `${renderGitHubTrendingAsJson(result)}\n`
      );
    });
}

export function handleGitHubCommandError(
  error: unknown,
  dependencies: Pick<GitHubCommandDependencies, 'stderr'>
): number | undefined {
  if (error instanceof GitHubCommandError) {
    dependencies.stderr(
      `${renderGitHubCommandErrorAsJson(error.code, error.message, error.details)}\n`
    );
    return error.exitCode;
  }

  return undefined;
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
