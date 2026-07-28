import { parseGitHubTrendingHtml } from './parser.js';
import { parseGitHubReadmeResponse } from './readme-parser.js';
import {
  GitHubCommandError,
  type GitHubRuntime,
  type GitHubTrendingPeriod,
  type GitHubTrendingRuntimeResult
} from './types.js';

export interface GitHubRuntimeOptions {
  fetch?: typeof fetch;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_BUILT_BY = 10;
const MAX_ITEMS = 100;

interface RuntimeDependencies {
  fetch: typeof fetch;
  maxResponseBytes: number;
  requestTimeoutMs: number;
}

export function createDefaultGitHubRuntime(
  options: GitHubRuntimeOptions = {}
): GitHubRuntime {
  const dependencies: RuntimeDependencies = {
    fetch: options.fetch ?? fetch,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  };

  return {
    fetchReadme: async ({ owner, repo }) => fetchReadme(
      dependencies,
      owner,
      repo
    ),
    fetchTrending: async ({ period }) => fetchTrending(dependencies, period)
  };
}

async function fetchReadme(
  dependencies: RuntimeDependencies,
  owner: string,
  repo: string
) {
  const sourceUrl = createReadmeSourceUrl(owner, repo);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    dependencies.requestTimeoutMs
  );

  try {
    let response: Response;
    try {
      response = await dependencies.fetch(sourceUrl, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'ants-move GitHub collector',
          'x-github-api-version': '2022-11-28'
        },
        redirect: 'error',
        signal: controller.signal
      });
    } catch {
      throw readmeFetchFailed(sourceUrl);
    }

    const knownHttpError = await mapReadmeHttpError(response, sourceUrl);
    if (knownHttpError) throw knownHttpError;

    let body: Uint8Array;
    try {
      body = await readBoundedBody(
        response,
        dependencies.maxResponseBytes,
        sourceUrl,
        'GitHub README response exceeded the configured size limit.'
      );
    } catch (error) {
      if (error instanceof GitHubCommandError) throw error;
      throw readmeFetchFailed(sourceUrl);
    }

    return parseGitHubReadmeResponse(body, { owner, repo, sourceUrl });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTrending(
  dependencies: RuntimeDependencies,
  period: GitHubTrendingPeriod
): Promise<GitHubTrendingRuntimeResult> {
  const sourceUrl = createSourceUrl(period);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    dependencies.requestTimeoutMs
  );

  try {
    let response: Response;
    try {
      response = await dependencies.fetch(sourceUrl, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'ants-move GitHub collector'
        },
        redirect: 'error',
        signal: controller.signal
      });
    } catch {
      throw fetchFailed(sourceUrl);
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new GitHubCommandError(
        'GITHUB_FETCH_FAILED',
        `Failed to fetch GitHub Trending data. HTTP ${response.status}.`,
        2,
        {
          status: response.status,
          url: sourceUrl
        }
      );
    }

    let body: Uint8Array;
    try {
      body = await readBoundedBody(
        response,
        dependencies.maxResponseBytes,
        sourceUrl,
        'GitHub Trending response exceeded the configured size limit.'
      );
    } catch (error) {
      if (error instanceof GitHubCommandError) throw error;
      throw fetchFailed(sourceUrl);
    }

    return parseGitHubTrendingHtml(new TextDecoder().decode(body), {
      maxBuiltBy: MAX_BUILT_BY,
      maxItems: MAX_ITEMS,
      period,
      sourceUrl
    });
  } finally {
    clearTimeout(timeout);
  }
}

function createReadmeSourceUrl(owner: string, repo: string): string {
  return new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
    'https://api.github.com'
  ).toString();
}

async function mapReadmeHttpError(
  response: Response,
  sourceUrl: string
): Promise<GitHubCommandError | undefined> {
  if (response.ok) return undefined;

  const remaining = parseNonNegativeIntegerHeader(
    response.headers.get('x-ratelimit-remaining')
  );
  const limit = parseNonNegativeIntegerHeader(
    response.headers.get('x-ratelimit-limit')
  );
  const reset = parseNonNegativeIntegerHeader(
    response.headers.get('x-ratelimit-reset')
  );
  await cancelResponseBody(response);

  if (response.status === 404) {
    return new GitHubCommandError(
      'GITHUB_README_NOT_FOUND',
      'GitHub README was not found for the public repository.',
      2,
      { sourceUrl }
    );
  }

  if (response.status === 403 && remaining === 0) {
    const resetAt = reset === undefined
      ? undefined
      : toIsoTimestamp(reset);
    return new GitHubCommandError(
      'GITHUB_RATE_LIMITED',
      "GitHub's anonymous API rate limit has been exceeded.",
      2,
      {
        sourceUrl,
        remaining,
        ...(limit === undefined ? {} : { limit }),
        ...(resetAt === undefined ? {} : { resetAt })
      }
    );
  }

  return readmeFetchFailed(sourceUrl, response.status);
}

function parseNonNegativeIntegerHeader(
  value: string | null
): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function toIsoTimestamp(seconds: number): string | undefined {
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function createSourceUrl(period: GitHubTrendingPeriod): string {
  const url = new URL('/trending', 'https://github.com');
  url.searchParams.set('since', period);
  return url.toString();
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  url: string,
  message: string
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponseBody(response);
    throw responseTooLarge(url, maxBytes, message);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw responseTooLarge(url, maxBytes, message);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function readmeFetchFailed(
  sourceUrl: string,
  status?: number
): GitHubCommandError {
  return new GitHubCommandError(
    'GITHUB_FETCH_FAILED',
    status === undefined
      ? 'Failed to fetch GitHub README data.'
      : `Failed to fetch GitHub README data. HTTP ${status}.`,
    2,
    {
      sourceUrl,
      ...(status === undefined ? {} : { status })
    }
  );
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function fetchFailed(url: string): GitHubCommandError {
  return new GitHubCommandError(
    'GITHUB_FETCH_FAILED',
    'Failed to fetch GitHub Trending data.',
    2,
    {
      url
    }
  );
}

function responseTooLarge(
  url: string,
  maxBytes: number,
  message: string
): GitHubCommandError {
  return new GitHubCommandError(
    'GITHUB_RESPONSE_TOO_LARGE',
    message,
    2,
    {
      maxBytes,
      url
    }
  );
}
