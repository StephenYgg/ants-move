import { describe, expect, it, vi } from 'vitest';

import { createDefaultHackerNewsRuntime } from '../../src/hn/runtime.js';

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json', ...init.headers },
    status: init.status ?? 200
  });
}

function itemIdFromUrl(url: string): number {
  return Number(/\/item\/(\d+)\.json$/.exec(url)?.[1]);
}

function firebaseStory(id: number) {
  return {
    by: `author-${id}`,
    descendants: id,
    id,
    score: id * 10,
    time: 1_784_764_800 + id,
    title: `Story ${id}`,
    type: 'story',
    url: `https://example.com/${id}`
  };
}

describe('Hacker News runtime', () => {
  it('maps Firebase and Algolia stories while omitting unusable items', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/topstories.json')) {
        return jsonResponse([1, 2, 3, 4]);
      }
      if (url.includes('/item/1.json')) return jsonResponse(firebaseStory(1));
      if (url.includes('/item/2.json')) return jsonResponse({ ...firebaseStory(2), dead: true });
      if (url.includes('/item/3.json')) return jsonResponse({ ...firebaseStory(3), deleted: true });
      if (url.includes('/item/4.json')) return jsonResponse(firebaseStory(4));
      if (url.includes('/search?')) {
        return jsonResponse({
          hits: [{
            author: 'search-author',
            created_at_i: 1_580_837_440,
            num_comments: 4,
            objectID: '42',
            points: 12,
            title: 'Search story'
          }]
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const runtime = createDefaultHackerNewsRuntime({ fetch: fetchImpl });

    const stories = await runtime.fetchStories({ limit: 2, source: 'top' });
    const search = await runtime.fetchSearch({
      limit: 1,
      query: 'typescript',
      sort: 'relevance'
    });

    expect(stories.items.map((item) => item.id)).toEqual([1, 4]);
    expect(stories.items[0]?.time?.iso).toBe(new Date(1_784_764_801_000).toISOString());
    expect(search.items[0]).toMatchObject({
      author: 'search-author',
      id: 42,
      title: 'Search story',
      url: 'https://news.ycombinator.com/item?id=42'
    });
  });

  it('maps sparse Firebase and Algolia items through URL and optional-field fallbacks', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/topstories.json')) return jsonResponse([1]);
      if (url.includes('/item/1.json')) {
        return jsonResponse({ id: 1, text: 'Story text', title: 'Sparse story', type: 'story' });
      }
      if (url.includes('/search?')) {
        return jsonResponse({
          hits: [
            { objectID: 'not-a-number', title: 'Invalid id' },
            { objectID: '2' },
            {
              objectID: 'ignored',
              story_id: 3,
              title: 'Algolia story',
              url: 'https://example.com/algolia'
            }
          ]
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const runtime = createDefaultHackerNewsRuntime({ fetch: fetchImpl });

    const stories = await runtime.fetchStories({ limit: 1, source: 'top' });
    const search = await runtime.fetchSearch({
      limit: 3,
      query: 'sparse',
      sort: 'relevance'
    });

    expect(stories.items[0]).toEqual({
      id: 1,
      text: 'Story text',
      title: 'Sparse story',
      type: 'story',
      url: 'https://news.ycombinator.com/item?id=1'
    });
    expect(search.items).toEqual([{
      id: 3,
      title: 'Algolia story',
      type: 'story',
      url: 'https://example.com/algolia'
    }]);
  });

  it('returns an empty story list without starting detail workers', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse([]));
    const runtime = createDefaultHackerNewsRuntime({ fetch: fetchImpl });

    await expect(runtime.fetchStories({ limit: 10, source: 'top' })).resolves.toEqual({
      items: [],
      source: 'top'
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('deduplicates candidate ids and inspects at most twice the requested limit', async () => {
    const requestedItemIds: number[] = [];
    const ids = Array.from({ length: 300 }, (_, index) => index + 1);
    ids[1] = 1;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/beststories.json')) return jsonResponse(ids);
      const id = itemIdFromUrl(url);
      requestedItemIds.push(id);
      return jsonResponse(firebaseStory(id));
    });
    const runtime = createDefaultHackerNewsRuntime({ fetch: fetchImpl });

    await runtime.fetchStories({ limit: 100, source: 'best' });

    expect(requestedItemIds).toHaveLength(199);
    expect(new Set(requestedItemIds).size).toBe(199);
    expect(Math.max(...requestedItemIds)).toBe(200);
  });

  it('limits active detail requests to eight and preserves source order', async () => {
    let active = 0;
    let peak = 0;
    const ids = Array.from({ length: 20 }, (_, index) => index + 1);
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/newstories.json')) return jsonResponse(ids);
      const id = itemIdFromUrl(url);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jsonResponse(firebaseStory(id));
    });
    const runtime = createDefaultHackerNewsRuntime({ fetch: fetchImpl });

    const result = await runtime.fetchStories({ limit: 10, source: 'new' });

    expect(peak).toBe(8);
    expect(active).toBe(0);
    expect(result.items.map((item) => item.id)).toEqual(ids.slice(0, 10));
  });

  it('caps configured detail concurrency at eight', async () => {
    let active = 0;
    let peak = 0;
    const ids = Array.from({ length: 20 }, (_, index) => index + 1);
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/topstories.json')) return jsonResponse(ids);
      const id = itemIdFromUrl(url);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jsonResponse(firebaseStory(id));
    });
    const runtime = createDefaultHackerNewsRuntime({
      detailConcurrency: 100,
      fetch: fetchImpl
    });

    await runtime.fetchStories({ limit: 10, source: 'top' });

    expect(peak).toBe(8);
  });

  it('rejects responses larger than the configured byte limit', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      hits: [{ objectID: '1', title: 'A response that is too large' }]
    }));
    const runtime = createDefaultHackerNewsRuntime({
      fetch: fetchImpl,
      maxResponseBytes: 16
    });

    await expect(runtime.fetchSearch({
      limit: 1,
      query: 'large',
      sort: 'date'
    })).rejects.toMatchObject({
      code: 'HN_RESPONSE_TOO_LARGE',
      exitCode: 2
    });
  });

  it('limits each Firebase story detail response to 256 kilobytes', async () => {
    const cancel = vi.fn(async () => undefined);
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start: (controller) => {
        controller.enqueue(new Uint8Array([123]));
        controller.close();
      }
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/topstories.json')) {
        return jsonResponse([1]);
      }
      return new Response(stream, {
        headers: { 'content-length': String(256 * 1024 + 1) }
      });
    });
    const runtime = createDefaultHackerNewsRuntime({ fetch: fetchImpl });

    await expect(runtime.fetchStories({ limit: 1, source: 'top' }))
      .rejects.toMatchObject({
        code: 'HN_RESPONSE_TOO_LARGE',
        details: { maxBytes: 256 * 1024 }
      });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects declared response sizes before reading the body', async () => {
    const cancel = vi.fn(async () => undefined);
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(
      { hits: [] },
      { headers: { 'content-length': '100' } }
    ));
    fetchImpl.mockResolvedValueOnce(new Response(stream, {
      headers: { 'content-length': '100' }
    }));
    const runtime = createDefaultHackerNewsRuntime({
      fetch: fetchImpl,
      maxResponseBytes: 16
    });

    await expect(runtime.fetchSearch({ limit: 1, query: 'large', sort: 'date' }))
      .rejects.toMatchObject({ code: 'HN_RESPONSE_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels non-success response bodies before returning a fetch error', async () => {
    const cancel = vi.fn(async () => undefined);
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const runtime = createDefaultHackerNewsRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(stream, { status: 503 }))
    });

    await expect(runtime.fetchSearch({ limit: 1, query: 'failure', sort: 'relevance' }))
      .rejects.toMatchObject({ code: 'HN_FETCH_FAILED' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('preserves the fetch error when non-success body cancellation fails', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('cancel failed');
    });
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const runtime = createDefaultHackerNewsRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(stream, { status: 503 }))
    });

    await expect(runtime.fetchSearch({ limit: 1, query: 'failure', sort: 'relevance' }))
      .rejects.toMatchObject({ code: 'HN_FETCH_FAILED' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('handles missing response bodies as parse failures', async () => {
    const runtime = createDefaultHackerNewsRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(null))
    });

    await expect(runtime.fetchSearch({ limit: 1, query: 'empty', sort: 'relevance' }))
      .rejects.toMatchObject({ code: 'HN_PARSE_FAILED' });
  });

  it('settles a failing stream cancellation before returning a size error', async () => {
    const stream = new ReadableStream<Uint8Array>({
      cancel: async () => {
        throw new Error('cancel failed');
      },
      start: (controller) => {
        controller.enqueue(new Uint8Array(32));
      }
    });
    const runtime = createDefaultHackerNewsRuntime({
      fetch: vi.fn<typeof fetch>(async () => new Response(stream)),
      maxResponseBytes: 16
    });

    await expect(runtime.fetchSearch({ limit: 1, query: 'stream', sort: 'relevance' }))
      .rejects.toMatchObject({ code: 'HN_RESPONSE_TOO_LARGE' });
  });

  it.each([
    {
      fetch: vi.fn<typeof fetch>(async () => {
        throw new Error('offline');
      }),
      expectedCode: 'HN_FETCH_FAILED'
    },
    {
      fetch: vi.fn<typeof fetch>(async () => new Response('failure', { status: 503 })),
      expectedCode: 'HN_FETCH_FAILED'
    },
    {
      fetch: vi.fn<typeof fetch>(async () => new Response('{not-json')),
      expectedCode: 'HN_PARSE_FAILED'
    }
  ])('returns safe structured transport errors', async ({ fetch, expectedCode }) => {
    const runtime = createDefaultHackerNewsRuntime({ fetch });

    await expect(runtime.fetchSearch({
      limit: 1,
      query: 'error',
      sort: 'relevance'
    })).rejects.toMatchObject({
      code: expectedCode,
      details: {
        url: expect.stringContaining('hn.algolia.com')
      }
    });
  });

  it('normalizes non-Error fetch rejections', async () => {
    const runtime = createDefaultHackerNewsRuntime({
      fetch: vi.fn<typeof fetch>(async () => {
        throw 'offline';
      })
    });

    await expect(runtime.fetchSearch({ limit: 1, query: 'error', sort: 'relevance' }))
      .rejects.toMatchObject({
        code: 'HN_FETCH_FAILED',
        details: { cause: 'offline' }
      });
  });

  it('uses the global fetch and default bounds when no runtime options are provided', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ hits: [] }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const runtime = createDefaultHackerNewsRuntime();
      await expect(runtime.fetchSearch({ limit: 1, query: 'default', sort: 'date' }))
        .resolves.toEqual({ items: [], query: 'default' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stops acquiring work after a failure and waits for active workers', async () => {
    let detailCalls = 0;
    let releaseSecond: (() => void) | undefined;
    const secondRequest = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/topstories.json')) return jsonResponse([1, 2, 3, 4, 5, 6]);

      detailCalls += 1;
      const id = itemIdFromUrl(url);
      if (id === 1) throw new Error('first detail failed');
      if (id === 2) await secondRequest;
      return jsonResponse(firebaseStory(id));
    });
    const runtime = createDefaultHackerNewsRuntime({
      detailConcurrency: 2,
      fetch: fetchImpl
    });
    let settled = false;
    const pending = runtime.fetchStories({ limit: 3, source: 'top' });
    void pending.then(
      () => { settled = true; },
      () => { settled = true; }
    );

    await vi.waitFor(() => expect(detailCalls).toBe(2));
    expect(settled).toBe(false);
    releaseSecond?.();

    await expect(pending).rejects.toMatchObject({ code: 'HN_FETCH_FAILED' });
    expect(settled).toBe(true);
    expect(detailCalls).toBe(2);
  });

  it('aborts a request after the configured timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    });
    const runtime = createDefaultHackerNewsRuntime({
      fetch: fetchImpl,
      requestTimeoutMs: 5
    });

    await expect(runtime.fetchSearch({
      limit: 1,
      query: 'timeout',
      sort: 'relevance'
    })).rejects.toMatchObject({ code: 'HN_FETCH_FAILED' });
  });
});
