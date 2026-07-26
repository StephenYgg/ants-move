import { describe, expect, it, vi } from 'vitest';

import { GitHubService } from '../../src/github/service.js';
import type {
  GitHubRuntime,
  GitHubTrendingPeriod
} from '../../src/github/types.js';

function createRuntime(): GitHubRuntime {
  return {
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
