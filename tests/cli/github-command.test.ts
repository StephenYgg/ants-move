import { describe, expect, it, vi } from 'vitest';

import { createCli } from '../../src/index.js';
import {
  GitHubCommandError,
  type GitHubRuntime
} from '../../src/github/types.js';

function createRuntime(): GitHubRuntime {
  return {
    fetchTrending: vi.fn(async ({ period }) => ({
      items: [
        {
          description: 'Example repository',
          forks: 40,
          fullName: 'example/project',
          language: 'TypeScript',
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

describe('ants github command', () => {
  it('fetches the daily Trending page as JSON by default', async () => {
    let stdout = '';
    const runtime = createRuntime();
    const cli = createCli({
      githubRuntime: runtime,
      stdout: (value) => {
        stdout += value;
      }
    });

    const exitCode = await cli.run(['github', 'trending']);
    const parsed = JSON.parse(stdout) as {
      data: { meta: { totalItems: number }; period: string };
      ok: boolean;
    };

    expect(exitCode).toBe(0);
    expect(parsed).toMatchObject({
      ok: true,
      data: {
        meta: { totalItems: 1 },
        period: 'daily'
      }
    });
    expect(runtime.fetchTrending).toHaveBeenCalledWith({ period: 'daily' });
  });

  it.each(['daily', 'weekly', 'monthly'] as const)(
    'supports the %s Trending period',
    async (period) => {
      const runtime = createRuntime();
      const cli = createCli({
        githubRuntime: runtime,
        stdout: () => undefined
      });

      expect(await cli.run(['github', 'trending', '--since', period])).toBe(0);
      expect(runtime.fetchTrending).toHaveBeenCalledWith({ period });
    }
  );

  it.each([
    ['--format', 'table'],
    ['-t']
  ])('renders table output with %s', async (...args) => {
    let stdout = '';
    const cli = createCli({
      githubRuntime: createRuntime(),
      stdout: (value) => {
        stdout += value;
      }
    });

    expect(await cli.run(['github', 'trending', ...args])).toBe(0);
    expect(() => JSON.parse(stdout)).toThrow();
    expect(stdout).toContain('repository');
    expect(stdout).toContain('example/project');
  });

  it('rejects unsupported periods before invoking the runtime', async () => {
    let stderr = '';
    const runtime = createRuntime();
    const cli = createCli({
      githubRuntime: runtime,
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    expect(await cli.run(['github', 'trending', '--since', 'yearly'])).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({
      ok: false,
      error: {
        code: 'GITHUB_INVALID_PERIOD'
      }
    });
    expect(runtime.fetchTrending).not.toHaveBeenCalled();
  });

  it('preserves known GitHub runtime errors', async () => {
    let stderr = '';
    const runtime: GitHubRuntime = {
      fetchTrending: vi.fn(async () => {
        throw new GitHubCommandError(
          'GITHUB_FETCH_FAILED',
          'Failed to fetch GitHub Trending data.',
          2,
          { status: 503 }
        );
      })
    };
    const cli = createCli({
      githubRuntime: runtime,
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    expect(await cli.run(['github', 'trending'])).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({
      ok: false,
      error: {
        code: 'GITHUB_FETCH_FAILED',
        details: { status: 503 }
      }
    });
  });

  it('normalizes unsupported output formats as invalid arguments', async () => {
    let stderr = '';
    const cli = createCli({
      githubRuntime: createRuntime(),
      stderr: (value) => {
        stderr += value;
      },
      stdout: () => undefined
    });

    expect(await cli.run(['github', 'trending', '--format', 'yaml'])).toBe(2);
    expect(JSON.parse(stderr)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    });
  });
});
