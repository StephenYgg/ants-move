import { describe, expect, it } from 'vitest';

import { parseGitHubTrendingHtml } from '../../src/github/parser.js';

const SOURCE_URL = 'https://github.com/trending?since=daily';

function parse(html: string, period: 'daily' | 'weekly' | 'monthly' = 'daily') {
  return parseGitHubTrendingHtml(html, {
    maxBuiltBy: 10,
    maxItems: 100,
    period,
    sourceUrl: SOURCE_URL
  });
}

function repositoryArticle(options: {
  builtBy?: string;
  description?: string;
  forks?: string;
  language?: string;
  path: string;
  periodStars?: string;
  stars?: string;
}): string {
  return `
    <article class="Box-row">
      <h2 class="h3 lh-condensed">
        <a href="${options.path}"> ${options.path.replace(/^\//, '').replace('/', ' / ')} </a>
      </h2>
      ${options.description === undefined ? '' : `<p class="col-9 color-fg-muted my-1 pr-4">${options.description}</p>`}
      ${options.language === undefined ? '' : `<span itemprop="programmingLanguage">${options.language}</span>`}
      <a href="${options.path}/stargazers">${options.stars ?? '0'}</a>
      <a href="${options.path}/forks">${options.forks ?? '0'}</a>
      <span class="d-inline-block float-sm-right">${options.periodStars ?? '0 stars today'}</span>
      ${options.builtBy ?? ''}
    </article>
  `;
}

describe('GitHub Trending parser', () => {
  it('maps complete and sparse rows in page order', () => {
    const html = `
      ${repositoryArticle({
        builtBy: `
          <span class="built-by">
            Built by
            <a data-hovercard-type="user" href="/alice"><img src="https://avatars.example/alice" /></a>
            <a data-hovercard-type="user" href="/bob"><img src="https://avatars.example/bob" /></a>
          </span>
        `,
        description: '  A   useful\n repository  ',
        forks: ' 678 ',
        language: ' TypeScript ',
        path: '/example/project',
        periodStars: '520 stars today',
        stars: ' 12,345 '
      })}
      ${repositoryArticle({
        forks: 'not available',
        path: '/sparse/repository',
        periodStars: 'stars unavailable',
        stars: 'unknown'
      })}
    `;

    expect(parse(html)).toEqual({
      items: [
        {
          builtBy: [
            {
              avatarUrl: 'https://avatars.example/alice',
              url: 'https://github.com/alice',
              username: 'alice'
            },
            {
              avatarUrl: 'https://avatars.example/bob',
              url: 'https://github.com/bob',
              username: 'bob'
            }
          ],
          description: 'A useful repository',
          forks: 678,
          fullName: 'example/project',
          language: 'TypeScript',
          name: 'project',
          owner: 'example',
          rank: 1,
          stars: 12_345,
          starsInPeriod: 520,
          url: 'https://github.com/example/project'
        },
        {
          forks: 0,
          fullName: 'sparse/repository',
          name: 'repository',
          owner: 'sparse',
          rank: 2,
          stars: 0,
          starsInPeriod: 0,
          url: 'https://github.com/sparse/repository'
        }
      ],
      period: 'daily',
      sourceUrl: SOURCE_URL
    });
  });

  it('maps numeric values outside the safe integer range to zero', () => {
    const unsafeCount = '9'.repeat(400);
    const result = parse(repositoryArticle({
      forks: unsafeCount,
      path: '/bounded/counts',
      periodStars: `${unsafeCount} stars today`,
      stars: unsafeCount
    }));

    expect(result.items[0]).toMatchObject({
      forks: 0,
      stars: 0,
      starsInPeriod: 0
    });
  });

  it('maps unsupported numeric display formats to zero', () => {
    const result = parse(repositoryArticle({
      forks: 'about 30',
      path: '/bounded/formats',
      stars: '1.2k'
    }));

    expect(result.items[0]).toMatchObject({
      forks: 0,
      stars: 0
    });
  });

  it.each([
    { label: 'today', mismatch: 'this week', period: 'daily' },
    { label: 'this week', mismatch: 'this month', period: 'weekly' },
    { label: 'this month', mismatch: 'today', period: 'monthly' }
  ] as const)(
    'maps only the $period period star label',
    ({ label, mismatch, period }) => {
      const matching = parse(repositoryArticle({
        path: '/period/matching',
        periodStars: `25 stars ${label}\n  `
      }), period);
      const mismatched = parse(repositoryArticle({
        path: '/period/mismatched',
        periodStars: `25 stars ${mismatch}`
      }), period);

      expect(matching.items[0]?.starsInPeriod).toBe(25);
      expect(mismatched.items[0]?.starsInPeriod).toBe(0);
    }
  );

  it('skips malformed links and assigns contiguous ranks', () => {
    const html = `
      ${repositoryArticle({ path: '' })}
      ${repositoryArticle({ path: 'http://[' })}
      ${repositoryArticle({ path: 'https://example.com/not/github' })}
      ${repositoryArticle({ path: '/too/many/segments' })}
      ${repositoryArticle({ path: '/valid/project' })}
    `;

    const result = parse(html);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      fullName: 'valid/project',
      rank: 1
    });
  });

  it('rejects HTML without usable repository rows', () => {
    expect(() => parse('<main><h1>Sign in</h1></main>')).toThrowError(
      expect.objectContaining({
        code: 'GITHUB_PARSE_FAILED',
        details: { sourceUrl: SOURCE_URL }
      })
    );
  });

  it('rejects pages beyond the repository safety bound', () => {
    const html = Array.from(
      { length: 101 },
      (_, index) => repositoryArticle({ path: `/owner/repository-${index}` })
    ).join('');

    expect(() => parse(html)).toThrowError(
      expect.objectContaining({
        code: 'GITHUB_PARSE_FAILED',
        details: {
          maxItems: 100,
          sourceUrl: SOURCE_URL
        }
      })
    );
  });

  it('retains at most ten valid contributors per repository', () => {
    const invalidContributors = `
      <a data-hovercard-type="user" href=""><img src="https://avatars.example/empty" /></a>
      <a data-hovercard-type="user" href="http://["><img src="https://avatars.example/bad-link" /></a>
      <a data-hovercard-type="user" href="/too/many"><img src="https://avatars.example/segments" /></a>
      <a data-hovercard-type="user" href="/missing-avatar"></a>
      <a data-hovercard-type="user" href="/bad-protocol"><img src="javascript:alert(1)" /></a>
      <a data-hovercard-type="user" href="/bad-avatar"><img src="http://[" /></a>
    `;
    const contributors = Array.from({ length: 12 }, (_, index) => `
      <a data-hovercard-type="user" href="/user-${index}">
        <img src="https://avatars.example/user-${index}" />
      </a>
    `).join('');
    const result = parse(repositoryArticle({
      builtBy: `
        <span class="built-by">
          ${invalidContributors}
          ${contributors}
        </span>
      `,
      path: '/bounded/contributors'
    }));

    expect(result.items[0]?.builtBy).toHaveLength(10);
    expect(result.items[0]?.builtBy?.at(-1)?.username).toBe('user-9');
  });
});
