import { renderSafeTable } from '../output.js';
import type { GitHubTrendingResult } from './types.js';

export function renderGitHubTrendingAsJson(result: GitHubTrendingResult): string {
  return JSON.stringify(
    {
      ok: true,
      data: result
    },
    null,
    2
  );
}

export function renderGitHubTrendingAsTable(result: GitHubTrendingResult): string {
  return renderSafeTable([
    [
      'rank',
      'repository',
      'language',
      'stars',
      'forks',
      'period stars',
      'description',
      'url'
    ],
    ...result.items.map((item) => [
      String(item.rank),
      item.fullName,
      item.language ?? '',
      String(item.stars),
      String(item.forks),
      String(item.starsInPeriod),
      item.description ?? '',
      item.url
    ])
  ]);
}

export function renderGitHubCommandErrorAsJson(
  code: string,
  message: string,
  details?: unknown
): string {
  return JSON.stringify(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details })
      }
    },
    null,
    2
  );
}
