import {
  GitHubCommandError,
  type GitHubRuntime,
  type GitHubTrendingPeriod,
  type GitHubTrendingResult
} from './types.js';

const SUPPORTED_PERIODS = ['daily', 'weekly', 'monthly'] as const;
const SUPPORTED_PERIOD_SET = new Set<string>(SUPPORTED_PERIODS);

export class GitHubService {
  constructor(private readonly dependencies: { runtime: GitHubRuntime }) {}

  async trending(options: { period?: string }): Promise<GitHubTrendingResult> {
    const period = parsePeriod(options.period);
    const result = await this.dependencies.runtime.fetchTrending({ period });

    return {
      ...result,
      meta: {
        totalItems: result.items.length
      }
    };
  }
}

function parsePeriod(period: string | undefined): GitHubTrendingPeriod {
  const value = period ?? 'daily';

  if (SUPPORTED_PERIOD_SET.has(value)) {
    return value as GitHubTrendingPeriod;
  }

  throw new GitHubCommandError(
    'GITHUB_INVALID_PERIOD',
    'GitHub Trending period must be daily, weekly, or monthly.',
    2,
    {
      period: value,
      supportedPeriods: [...SUPPORTED_PERIODS]
    }
  );
}
