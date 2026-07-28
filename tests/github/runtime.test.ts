import { describe, expect, it, vi } from 'vitest';

import { createDefaultGitHubRuntime } from '../../src/github/runtime.js';
import type { GitHubTrendingPeriod } from '../../src/github/types.js';

function trendingHtml(
  path = '/example/project',
  period: GitHubTrendingPeriod = 'daily'
): string {
  const periodLabel: Record<GitHubTrendingPeriod, string> = {
    daily: 'today',
    monthly: 'this month',
    weekly: 'this week'
  };

  return `
    <article class="Box-row">
      <h2><a href="${path}">example / project</a></h2>
      <a href="${path}/stargazers">1,200</a>
      <a href="${path}/forks">30</a>
      <span class="float-sm-right">25 stars ${periodLabel[period]}</span>
    </article>
  `;
}

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...init.headers
    },
    status: init.status ?? 200
  });
}

function readmePayload(overrides: Record<string, unknown> = {}) {
  const content = Buffer.from('# Project\n', 'utf8');
  return {
    content: content.toString('base64'),
    download_url: 'https://raw.githubusercontent.com/example/project/main/README.md',
    encoding: 'base64',
    html_url: 'https://github.com/example/project/blob/main/README.md',
    name: 'README.md',
    path: 'README.md',
    sha: '0123456789abcdef0123456789abcdef01234567',
    size: content.byteLength,
    ...overrides
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers
    },
    status: init.status ?? 200
  });
}

describe('GitHub runtime', () => {
  it('fetches a public README once with versioned JSON headers and no authorization', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(readmePayload()));
    const runtime = createDefaultGitHubRuntime({ fetch: fetchImpl });

    const result = await runtime.fetchReadme({
      owner: 'example',
      repo: 'project'
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(input)).toBe(
      'https://api.github.com/repos/example/project/readme'
    );
    const headers = new Headers(init?.headers);
    expect(headers.get('accept')).toBe('application/vnd.github+json');
    expect(headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(headers.get('user-agent')).toContain('ants-move');
    expect(headers.has('authorization')).toBe(false);
    expect(init?.redirect).toBe('error');
    expect(result).toMatchObject({
      content: '# Project\n',
      name: 'README.md',
      sourceUrl: 'https://api.github.com/repos/example/project/readme'
    });
  });

  it('maps a missing or inaccessible README without a second request', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(
      {},
      { status: 404 }
    ));
    const runtime = createDefaultGitHubRuntime({ fetch: fetchImpl });

    await expect(runtime.fetchReadme({ owner: 'example', repo: 'project' }))
      .rejects.toMatchObject({
        code: 'GITHUB_README_NOT_FOUND',
        details: {
          sourceUrl: 'https://api.github.com/repos/example/project/readme'
        }
      });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('maps exhausted anonymous rate limits with safe reset details', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, {
      headers: {
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1785210391'
      },
      status: 403
    }));
    const runtime = createDefaultGitHubRuntime({ fetch: fetchImpl });

    await expect(runtime.fetchReadme({ owner: 'example', repo: 'project' }))
      .rejects.toMatchObject({
        code: 'GITHUB_RATE_LIMITED',
        details: {
          limit: 60,
          remaining: 0,
          resetAt: new Date(1_785_210_391_000).toISOString()
        }
      });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('maps malformed or non-exhausted 403 headers as a fetch failure', async () => {
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => jsonResponse({}, {
        headers: {
          'x-ratelimit-limit': 'secret',
          'x-ratelimit-remaining': '1',
          'x-ratelimit-reset': 'invalid'
        },
        status: 403
      }))
    });

    await expect(runtime.fetchReadme({ owner: 'example', repo: 'project' }))
      .rejects.toMatchObject({ code: 'GITHUB_FETCH_FAILED' });
  });

  it('omits malformed and out-of-range optional rate-limit details', async () => {
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => jsonResponse({}, {
        headers: {
          'x-ratelimit-limit': '9007199254740992',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '9007199254740'
        },
        status: 403
      }))
    });

    const error = await runtime.fetchReadme({ owner: 'example', repo: 'project' })
      .catch((failure: unknown) => failure);

    expect(error).toMatchObject({
      code: 'GITHUB_RATE_LIMITED',
      details: {
        remaining: 0,
        sourceUrl: 'https://api.github.com/repos/example/project/readme'
      }
    });
    expect(error).not.toHaveProperty('details.limit');
    expect(error).not.toHaveProperty('details.resetAt');
  });

  it('omits reset details when an exhausted rate-limit reset header is invalid', async () => {
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => jsonResponse({}, {
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': 'invalid'
        },
        status: 403
      }))
    });

    const error = await runtime.fetchReadme({ owner: 'example', repo: 'project' })
      .catch((failure: unknown) => failure);

    expect(error).toMatchObject({
      code: 'GITHUB_RATE_LIMITED',
      details: { remaining: 0 }
    });
    expect(error).not.toHaveProperty('details.resetAt');
  });

  it('maps README request deadline aborts as a fetch failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted with secret', 'AbortError'));
        });
      })
    ));
    const runtime = createDefaultGitHubRuntime({
      fetch: fetchImpl,
      requestTimeoutMs: 1
    });

    await expect(runtime.fetchReadme({ owner: 'example', repo: 'project' }))
      .rejects.toMatchObject({ code: 'GITHUB_FETCH_FAILED' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects oversized README API responses before parsing', async () => {
    const cancel = vi.fn(async () => undefined);
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'content-length': '17' }
    });
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => response),
      maxResponseBytes: 16
    });

    await expect(runtime.fetchReadme({ owner: 'example', repo: 'project' }))
      .rejects.toMatchObject({
        code: 'GITHUB_RESPONSE_TOO_LARGE',
        details: { maxBytes: 16 }
      });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('maps malformed successful README JSON through the parser error', async () => {
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => jsonResponse({
        secret: 'not exposed'
      }))
    });
    const error = await runtime.fetchReadme({ owner: 'example', repo: 'project' })
      .catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code: 'GITHUB_PARSE_FAILED' });
    expect(JSON.stringify(error)).not.toContain('not exposed');
  });

  it('maps other README HTTP failures with status but without body contents', async () => {
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => jsonResponse(
        { secret: 'not exposed' },
        { status: 503 }
      ))
    });
    const error = await runtime.fetchReadme({ owner: 'example', repo: 'project' })
      .catch((failure: unknown) => failure);

    expect(error).toMatchObject({
      code: 'GITHUB_FETCH_FAILED',
      details: {
        sourceUrl: 'https://api.github.com/repos/example/project/readme',
        status: 503
      }
    });
    expect(JSON.stringify(error)).not.toContain('not exposed');
  });

  it('maps README response stream failures without exposing raw errors', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('stream secret'));
      }
    });
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(stream))
    });
    const error = await runtime.fetchReadme({ owner: 'example', repo: 'project' })
      .catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code: 'GITHUB_FETCH_FAILED' });
    expect(JSON.stringify(error)).not.toContain('stream secret');
  });

  it('rejects streamed README API responses beyond the byte limit', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('cancel failed');
    });
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array(17));
      }
    });
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(stream)),
      maxResponseBytes: 16
    });

    await expect(runtime.fetchReadme({ owner: 'example', repo: 'project' }))
      .rejects.toMatchObject({ code: 'GITHUB_RESPONSE_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    { expectedCode: 'GITHUB_README_NOT_FOUND', status: 404, tooLarge: false },
    { expectedCode: 'GITHUB_RESPONSE_TOO_LARGE', status: 200, tooLarge: true }
  ])('preserves $expectedCode when body cancellation fails', async ({
    expectedCode,
    status,
    tooLarge
  }) => {
    const stream = new ReadableStream<Uint8Array>({
      cancel: async () => {
        throw new Error('cancel failed');
      }
    });
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(stream, {
        status,
        ...(tooLarge ? { headers: { 'content-length': '17' } } : {})
      })),
      maxResponseBytes: 16
    });

    await expect(runtime.fetchReadme({ owner: 'example', repo: 'project' }))
      .rejects.toMatchObject({ code: expectedCode });
  });

  it.each(['daily', 'weekly', 'monthly'] as const)(
    'fetches the all-language %s page once with HTML headers',
    async (period: GitHubTrendingPeriod) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => htmlResponse(
        trendingHtml('/example/project', period)
      ));
      const runtime = createDefaultGitHubRuntime({ fetch: fetchImpl });

      const result = await runtime.fetchTrending({ period });

      expect(fetchImpl).toHaveBeenCalledOnce();
      const [input, init] = fetchImpl.mock.calls[0] ?? [];
      expect(String(input)).toBe(`https://github.com/trending?since=${period}`);
      const headers = new Headers(init?.headers);
      expect(headers.get('accept')).toContain('text/html');
      expect(headers.get('user-agent')).toContain('ants-move');
      expect(init?.redirect).toBe('error');
      expect(result).toMatchObject({
        period,
        sourceUrl: `https://github.com/trending?since=${period}`
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.starsInPeriod).toBe(25);
    }
  );

  it.each([
    new Error('authorization=secret'),
    'authorization=secret'
  ])('maps network failures without exposing raw error details', async (cause) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw cause;
    });
    const runtime = createDefaultGitHubRuntime({ fetch: fetchImpl });
    const error = await runtime.fetchTrending({ period: 'daily' }).catch(
      (failure: unknown) => failure
    );

    expect(error).toHaveProperty('details', {
      url: 'https://github.com/trending?since=daily'
    });
    expect(error).toMatchObject({
      code: 'GITHUB_FETCH_FAILED',
      message: 'Failed to fetch GitHub Trending data.'
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('maps request deadline aborts as fetch failures', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => new Promise<Response>(
      (_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }
    ));
    const runtime = createDefaultGitHubRuntime({
      fetch: fetchImpl,
      requestTimeoutMs: 1
    });

    await expect(runtime.fetchTrending({ period: 'daily' })).rejects.toMatchObject({
      code: 'GITHUB_FETCH_FAILED'
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('cancels non-success bodies and reports the HTTP status', async () => {
    const cancel = vi.fn(async () => undefined);
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      status: 503
    });
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => response)
    });

    await expect(runtime.fetchTrending({ period: 'weekly' })).rejects.toMatchObject({
      code: 'GITHUB_FETCH_FAILED',
      details: {
        status: 503,
        url: 'https://github.com/trending?since=weekly'
      }
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects declared response lengths beyond the byte limit', async () => {
    const cancel = vi.fn(async () => undefined);
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'content-length': '17' }
    });
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => response),
      maxResponseBytes: 16
    });

    await expect(runtime.fetchTrending({ period: 'daily' })).rejects.toMatchObject({
      code: 'GITHUB_RESPONSE_TOO_LARGE',
      details: {
        maxBytes: 16,
        url: 'https://github.com/trending?since=daily'
      }
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects streamed response bodies beyond the byte limit', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('cancel failed');
    });
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array(17));
      }
    });
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(stream)),
      maxResponseBytes: 16
    });

    await expect(runtime.fetchTrending({ period: 'daily' })).rejects.toMatchObject({
      code: 'GITHUB_RESPONSE_TOO_LARGE'
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('maps response stream failures without exposing raw error details', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('stream failed'));
      }
    });
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(stream))
    });
    const error = await runtime.fetchTrending({ period: 'daily' }).catch(
      (failure: unknown) => failure
    );

    expect(error).toMatchObject({
      code: 'GITHUB_FETCH_FAILED'
    });
    expect(error).toHaveProperty('details', {
      url: 'https://github.com/trending?since=daily'
    });
  });

  it('maps missing response bodies through the parser error', async () => {
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(null))
    });

    await expect(runtime.fetchTrending({ period: 'daily' })).rejects.toMatchObject({
      code: 'GITHUB_PARSE_FAILED'
    });
  });

  it.each([
    { status: 503, tooLarge: false },
    { status: 200, tooLarge: true }
  ])('preserves primary errors when response cancellation fails', async ({ status, tooLarge }) => {
    const stream = new ReadableStream<Uint8Array>({
      cancel: async () => {
        throw new Error('cancel failed');
      }
    });
    const runtime = createDefaultGitHubRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(stream, {
        status,
        ...(tooLarge ? { headers: { 'content-length': '17' } } : {})
      })),
      maxResponseBytes: 16
    });

    await expect(runtime.fetchTrending({ period: 'daily' })).rejects.toMatchObject({
      code: tooLarge ? 'GITHUB_RESPONSE_TOO_LARGE' : 'GITHUB_FETCH_FAILED'
    });
  });
});
