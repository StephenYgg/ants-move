import { load } from 'cheerio';

import {
  GitHubCommandError,
  type GitHubTrendingContributor,
  type GitHubTrendingPeriod,
  type GitHubTrendingRepository,
  type GitHubTrendingRuntimeResult
} from './types.js';

export interface ParseGitHubTrendingHtmlOptions {
  maxBuiltBy: number;
  maxItems: number;
  period: GitHubTrendingPeriod;
  sourceUrl: string;
}

const GITHUB_ORIGIN = 'https://github.com';
const PERIOD_LABEL: Record<GitHubTrendingPeriod, string> = {
  daily: 'today',
  monthly: 'this month',
  weekly: 'this week'
};

export function parseGitHubTrendingHtml(
  html: string,
  options: ParseGitHubTrendingHtmlOptions
): GitHubTrendingRuntimeResult {
  const $ = load(html);
  const items: GitHubTrendingRepository[] = [];

  $('article.Box-row').each((_, element) => {
    const row = $(element);
    const repository = parseRepositoryLink(
      row.find('h2 a[href]').first().attr('href')
    );

    if (!repository) {
      return;
    }

    if (items.length >= options.maxItems) {
      throw new GitHubCommandError(
        'GITHUB_PARSE_FAILED',
        'GitHub Trending returned more repositories than the configured limit.',
        2,
        {
          maxItems: options.maxItems,
          sourceUrl: options.sourceUrl
        }
      );
    }

    const description = normalizeText(row.find('p.col-9').first().text());
    const language = normalizeText(
      row.find('[itemprop="programmingLanguage"]').first().text()
    );
    const builtBy = parseContributors(
      $,
      row.find('a[data-hovercard-type="user"][href]'),
      options.maxBuiltBy
    );

    items.push({
      forks: parseCount(findRepositoryLinkText(
        $,
        row.find('a[href]'),
        `${repository.path}/forks`
      )),
      fullName: `${repository.owner}/${repository.name}`,
      name: repository.name,
      owner: repository.owner,
      rank: items.length + 1,
      stars: parseCount(findRepositoryLinkText(
        $,
        row.find('a[href]'),
        `${repository.path}/stargazers`
      )),
      starsInPeriod: parsePeriodStars(
        row.find('span.float-sm-right').first().text(),
        options.period
      ),
      url: repository.url,
      ...(builtBy.length === 0 ? {} : { builtBy }),
      ...(description.length === 0 ? {} : { description }),
      ...(language.length === 0 ? {} : { language })
    });
  });

  if (items.length === 0) {
    throw new GitHubCommandError(
      'GITHUB_PARSE_FAILED',
      'Failed to parse GitHub Trending repositories.',
      2,
      {
        sourceUrl: options.sourceUrl
      }
    );
  }

  return {
    items,
    period: options.period,
    sourceUrl: options.sourceUrl
  };
}

function parseRepositoryLink(href: string | undefined): {
  name: string;
  owner: string;
  path: string;
  url: string;
} | undefined {
  const url = parseGitHubUrl(href);
  if (!url) return undefined;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return undefined;

  const [owner, name] = segments as [string, string];

  const path = `/${owner}/${name}`;
  return {
    name,
    owner,
    path,
    url: `${GITHUB_ORIGIN}${path}`
  };
}

function parseContributors(
  $: ReturnType<typeof load>,
  links: ReturnType<ReturnType<typeof load>>,
  maxBuiltBy: number
): GitHubTrendingContributor[] {
  const contributors: GitHubTrendingContributor[] = [];

  links.each((_, element) => {
    if (contributors.length >= maxBuiltBy) return false;

    const link = $(element);
    const user = parseGitHubUser(link.attr('href'));
    const avatarUrl = parseHttpUrl(link.find('img').first().attr('src'));
    if (!user || !avatarUrl) return;

    contributors.push({
      avatarUrl,
      url: `${GITHUB_ORIGIN}/${user}`,
      username: user
    });
  });

  return contributors;
}

function parseGitHubUser(href: string | undefined): string | undefined {
  const url = parseGitHubUrl(href);
  if (!url) return undefined;

  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length === 1 ? segments[0] : undefined;
}

function parseGitHubUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value, GITHUB_ORIGIN);
    return url.origin === GITHUB_ORIGIN ? url : undefined;
  } catch {
    return undefined;
  }
}

function parseHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value, GITHUB_ORIGIN);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function findRepositoryLinkText(
  $: ReturnType<typeof load>,
  links: ReturnType<ReturnType<typeof load>>,
  expectedPath: string
): string {
  let text = '';

  links.each((_, element) => {
    const link = $(element);
    const url = parseGitHubUrl(link.attr('href'));
    if (url?.pathname === expectedPath) {
      text = link.text();
      return false;
    }
  });

  return text;
}

function parsePeriodStars(value: string, period: GitHubTrendingPeriod): number {
  const suffix = new RegExp(`\\s+stars?\\s+${PERIOD_LABEL[period]}\\s*$`, 'i');
  if (!suffix.test(value)) return 0;
  return parseCount(value.replace(suffix, ''));
}

function parseCount(value: string): number {
  const digits = value.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(digits)) return 0;

  const count = Number(digits);
  return Number.isSafeInteger(count) ? count : 0;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
