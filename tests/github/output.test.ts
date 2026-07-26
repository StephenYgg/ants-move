import { describe, expect, it } from 'vitest';

import {
  renderGitHubCommandErrorAsJson,
  renderGitHubTrendingAsJson,
  renderGitHubTrendingAsTable
} from '../../src/github/output.js';
import type { GitHubTrendingResult } from '../../src/github/types.js';

function result(): GitHubTrendingResult {
  return {
    items: [
      {
        builtBy: [
          {
            avatarUrl: 'https://avatars.example/alice',
            url: 'https://github.com/alice',
            username: 'alice'
          }
        ],
        description: 'Useful \u001b[31mproject',
        forks: 80,
        fullName: 'example/project',
        language: 'TypeScript',
        name: 'project',
        owner: 'example',
        rank: 1,
        stars: 1_200,
        starsInPeriod: 120,
        url: 'https://github.com/example/project'
      },
      {
        forks: 0,
        fullName: 'sparse/repository',
        name: 'repository',
        owner: 'sparse',
        rank: 2,
        stars: 3,
        starsInPeriod: 1,
        url: 'https://github.com/sparse/repository'
      }
    ],
    meta: {
      totalItems: 2
    },
    period: 'daily',
    sourceUrl: 'https://github.com/trending?since=daily'
  };
}

describe('GitHub output', () => {
  it('renders the complete success envelope as JSON', () => {
    expect(JSON.parse(renderGitHubTrendingAsJson(result()))).toEqual({
      ok: true,
      data: result()
    });
  });

  it('renders the agreed table columns and sanitizes cells', () => {
    const output = renderGitHubTrendingAsTable(result());

    for (const value of [
      'rank',
      'repository',
      'language',
      'stars',
      'forks',
      'period stars',
      'description',
      'url',
      'example/project',
      'sparse/repository'
    ]) {
      expect(output).toContain(value);
    }
    expect(output).not.toContain('\u001b');
    expect(output).not.toContain('alice');
  });

  it('renders structured errors with optional details', () => {
    expect(JSON.parse(renderGitHubCommandErrorAsJson(
      'GITHUB_FETCH_FAILED',
      'Failed to fetch GitHub Trending data.',
      { status: 503 }
    ))).toEqual({
      ok: false,
      error: {
        code: 'GITHUB_FETCH_FAILED',
        details: { status: 503 },
        message: 'Failed to fetch GitHub Trending data.'
      }
    });

    expect(JSON.parse(renderGitHubCommandErrorAsJson(
      'GITHUB_PARSE_FAILED',
      'Failed to parse GitHub Trending repositories.'
    ))).toEqual({
      ok: false,
      error: {
        code: 'GITHUB_PARSE_FAILED',
        message: 'Failed to parse GitHub Trending repositories.'
      }
    });
  });
});
