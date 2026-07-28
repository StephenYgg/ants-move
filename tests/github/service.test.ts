import { describe, expect, it, vi } from 'vitest';

import { GitHubService } from '../../src/github/service.js';
import type {
  GitHubRuntime,
  GitHubTrendingPeriod
} from '../../src/github/types.js';

function readmeRuntimeResult() {
  return {
    content: '# Project\n',
    downloadUrl: 'https://raw.githubusercontent.com/example/project/main/README.md',
    htmlUrl: 'https://github.com/example/project/blob/main/README.md',
    name: 'README.md',
    path: 'README.md',
    sha: '0123456789abcdef0123456789abcdef01234567',
    size: 10,
    sourceUrl: 'https://api.github.com/repos/example/project/readme'
  };
}

function createRuntime(): GitHubRuntime {
  return {
    fetchReadme: vi.fn(async () => readmeRuntimeResult()),
    fetchTrending: vi.fn(async ({ period }) => ({
      items: [
        {
          forks: 42,
          fullName: 'example/project',
          name: 'project',
          owner: 'example',
          rank: 1,
          stars: 1_200,
          starsInPeriod: 120,
          url: 'https://github.com/example/project'
        }
      ],
      period,
      sourceUrl: `https://github.com/trending?since=${period}`
    }))
  };
}

describe('GitHub service', () => {
  it('fetches a public repository README from a canonical URL', async () => {
    const runtime = createRuntime();
    const service = new GitHubService({ runtime });

    await expect(
      service.readme('https://github.com/example/project')
    ).resolves.toEqual({
      ...readmeRuntimeResult(),
      repository: 'example/project',
      repositoryUrl: 'https://github.com/example/project'
    });
    expect(runtime.fetchReadme).toHaveBeenCalledOnce();
    expect(runtime.fetchReadme).toHaveBeenCalledWith({
      owner: 'example',
      repo: 'project'
    });
  });

  it.each([
    'https://github.com/example/project/',
    'https://github.com/example/project.git',
    'https://github.com/example/project?tab=readme-ov-file',
    'https://github.com/example/project#readme'
  ])('normalizes the accepted repository URL %s', async (repositoryUrl) => {
    const runtime = createRuntime();
    const service = new GitHubService({ runtime });

    const result = await service.readme(repositoryUrl);

    expect(result.repository).toBe('example/project');
    expect(result.repositoryUrl).toBe('https://github.com/example/project');
    expect(runtime.fetchReadme).toHaveBeenCalledWith({
      owner: 'example',
      repo: 'project'
    });
  });

  it.each([
    'http://github.com/example/project',
    'https://example.com/example/project',
    'https://github.com.example.org/example/project',
    'https://git\nhub.com/example/project',
    'https://git\rhub.com/example/project',
    'https://git\thub.com/example/project',
    'https://user:secret@github.com/example/project',
    'https://:secret@github.com/example/project',
    'https://github.com:444/example/project',
    'https://[::1/example/project',
    'https://github.com/example',
    'https://github.com/example/project/tree/main',
    'https://github.com/example/project/blob/main/README.md',
    'https://github.com/example/%2fproject',
    'https://github.com/example/%5cproject',
    'https://github.com/example\\project',
    'https://github.com/example/pro\u0000ject',
    'https://github.com/example/./project',
    'https://github.com/example/%2e%2e/project',
    'https://github.com/example/%',
    'https://github.com/exa_mple/project',
    'https://github.com/-example/project',
    'https://github.com/example--owner/project',
    'https://github.com/example/.git',
    'not a URL'
  ])('rejects %s before external work', async (repositoryUrl) => {
    const runtime = createRuntime();
    const service = new GitHubService({ runtime });
    const error = await service.readme(repositoryUrl).catch(
      (failure: unknown) => failure
    );

    expect(error).toMatchObject({
      code: 'GITHUB_INVALID_REPOSITORY_URL',
      exitCode: 2
    });
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(runtime.fetchReadme).not.toHaveBeenCalled();
  });

  it('defaults to the daily period and adds result metadata', async () => {
    const runtime = createRuntime();
    const service = new GitHubService({ runtime });

    const result = await service.trending({});

    expect(result.period).toBe('daily');
    expect(result.meta).toEqual({ totalItems: 1 });
    expect(runtime.fetchTrending).toHaveBeenCalledWith({ period: 'daily' });
  });

  it.each(['daily', 'weekly', 'monthly'] as const)(
    'accepts the %s period',
    async (period: GitHubTrendingPeriod) => {
      const runtime = createRuntime();
      const service = new GitHubService({ runtime });

      const result = await service.trending({ period });

      expect(result.period).toBe(period);
      expect(runtime.fetchTrending).toHaveBeenCalledWith({ period });
    }
  );

  it('rejects unsupported periods before starting external work', async () => {
    const runtime = createRuntime();
    const service = new GitHubService({ runtime });

    await expect(service.trending({ period: 'yearly' })).rejects.toMatchObject({
      code: 'GITHUB_INVALID_PERIOD',
      details: {
        period: 'yearly',
        supportedPeriods: ['daily', 'weekly', 'monthly']
      },
      exitCode: 2
    });
    expect(runtime.fetchTrending).not.toHaveBeenCalled();
  });
});
