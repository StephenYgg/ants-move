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

describe('GitHub runtime', () => {
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
