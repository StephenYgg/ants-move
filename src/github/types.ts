export type GitHubTrendingPeriod = 'daily' | 'weekly' | 'monthly';

export interface GitHubTrendingContributor {
  avatarUrl: string;
  url: string;
  username: string;
}

export interface GitHubTrendingRepository {
  builtBy?: GitHubTrendingContributor[];
  description?: string;
  forks: number;
  fullName: string;
  language?: string;
  name: string;
  owner: string;
  rank: number;
  stars: number;
  starsInPeriod: number;
  url: string;
}

export interface GitHubTrendingRuntimeResult {
  items: GitHubTrendingRepository[];
  period: GitHubTrendingPeriod;
  sourceUrl: string;
}

export interface GitHubReadmeRuntimeResult {
  content: string;
  downloadUrl: string;
  htmlUrl: string;
  name: string;
  path: string;
  sha: string;
  size: number;
  sourceUrl: string;
}

export interface GitHubReadmeResult extends GitHubReadmeRuntimeResult {
  repository: string;
  repositoryUrl: string;
}

export interface GitHubRuntime {
  fetchReadme: (options: {
    owner: string;
    repo: string;
  }) => Promise<GitHubReadmeRuntimeResult>;
  fetchTrending: (options: {
    period: GitHubTrendingPeriod;
  }) => Promise<GitHubTrendingRuntimeResult>;
}

export interface GitHubTrendingResult extends GitHubTrendingRuntimeResult {
  meta: {
    totalItems: number;
  };
}

export class GitHubCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'GitHubCommandError';
  }
}
