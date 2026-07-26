import { parseGitHubTrendingHtml } from './parser.js';
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
    fetchTrending: async ({ period }) => fetchTrending(dependencies, period)
  };
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
        sourceUrl
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

function createSourceUrl(period: GitHubTrendingPeriod): string {
  const url = new URL('/trending', 'https://github.com');
  url.searchParams.set('since', period);
  return url.toString();
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  url: string
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponseBody(response);
    throw responseTooLarge(url, maxBytes);
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
      throw responseTooLarge(url, maxBytes);
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

function responseTooLarge(url: string, maxBytes: number): GitHubCommandError {
  return new GitHubCommandError(
    'GITHUB_RESPONSE_TOO_LARGE',
    'GitHub Trending response exceeded the configured size limit.',
    2,
    {
      maxBytes,
      url
    }
  );
}
