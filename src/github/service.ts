import {
  GitHubCommandError,
  type GitHubReadmeResult,
  type GitHubRuntime,
  type GitHubTrendingPeriod,
  type GitHubTrendingResult
} from './types.js';

const SUPPORTED_PERIODS = ['daily', 'weekly', 'monthly'] as const;
const SUPPORTED_PERIOD_SET = new Set<string>(SUPPORTED_PERIODS);
const RAW_ABSOLUTE_URL =
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*(?<path>\/[^?#]*)?(?:[?#].*)?$/;
const RAW_DOT_SEGMENT = /(?:^|\/)(?:(?:\.|%2e){1,2})(?:\/|$)/i;
const RAW_ENCODED_SEPARATOR = /%(?:2f|5c)/i;
const RAW_FORBIDDEN_CHARACTER = /[\\\u0000-\u001f\u007f]/;
const OWNER_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/;

interface GitHubRepositoryIdentity {
  owner: string;
  repo: string;
  repository: string;
  repositoryUrl: string;
}

export class GitHubService {
  constructor(private readonly dependencies: { runtime: GitHubRuntime }) {}

  async readme(repositoryUrl: string): Promise<GitHubReadmeResult> {
    const identity = parseRepositoryUrl(repositoryUrl);
    const result = await this.dependencies.runtime.fetchReadme({
      owner: identity.owner,
      repo: identity.repo
    });

    return {
      ...result,
      repository: identity.repository,
      repositoryUrl: identity.repositoryUrl
    };
  }

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

function parseRepositoryUrl(value: string): GitHubRepositoryIdentity {
  const rawMatch = RAW_ABSOLUTE_URL.exec(value);
  const rawPath = rawMatch?.groups?.path ?? '';

  if (
    !rawMatch ||
    RAW_DOT_SEGMENT.test(rawPath) ||
    RAW_ENCODED_SEPARATOR.test(rawPath) ||
    RAW_FORBIDDEN_CHARACTER.test(value)
  ) {
    throw invalidRepositoryUrl();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidRepositoryUrl();
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw invalidRepositoryUrl();
  }

  const rawSegments = url.pathname.split('/').filter(Boolean);
  if (rawSegments.length !== 2) {
    throw invalidRepositoryUrl();
  }

  let owner: string;
  let repo: string;
  try {
    owner = decodeURIComponent(rawSegments[0] as string);
    repo = decodeURIComponent(rawSegments[1] as string).replace(/\.git$/i, '');
  } catch {
    throw invalidRepositoryUrl();
  }

  if (
    !OWNER_NAME.test(owner) ||
    owner.includes('--') ||
    !REPOSITORY_NAME.test(repo)
  ) {
    throw invalidRepositoryUrl();
  }

  const repository = `${owner}/${repo}`;
  return {
    owner,
    repo,
    repository,
    repositoryUrl: `https://github.com/${repository}`
  };
}

function invalidRepositoryUrl(): GitHubCommandError {
  return new GitHubCommandError(
    'GITHUB_INVALID_REPOSITORY_URL',
    'GitHub repository URL must identify a public github.com repository root.',
    2
  );
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
