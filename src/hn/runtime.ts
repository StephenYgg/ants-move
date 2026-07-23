import {
  HackerNewsCommandError,
  type HackerNewsItem,
  type HackerNewsSearchRuntimeResult,
  type HackerNewsSearchSort,
  type HackerNewsStoriesRuntimeResult,
  type HackerNewsStorySource
} from './types.js';

export interface HackerNewsRuntime {
  fetchSearch: (options: {
    limit: number;
    query: string;
    sort: HackerNewsSearchSort;
  }) => Promise<HackerNewsSearchRuntimeResult>;
  fetchStories: (options: {
    limit: number;
    source: HackerNewsStorySource;
  }) => Promise<HackerNewsStoriesRuntimeResult>;
}

export interface HackerNewsRuntimeOptions {
  detailConcurrency?: number;
  fetch?: typeof fetch;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
}

const FIREBASE_BASE_URL = 'https://hacker-news.firebaseio.com/v0';
const ALGOLIA_BASE_URL = 'https://hn.algolia.com/api/v1';
const DEFAULT_DETAIL_CONCURRENCY = 8;
const DEFAULT_DETAIL_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const SOURCE_TO_ENDPOINT: Record<HackerNewsStorySource, string> = {
  best: 'beststories',
  new: 'newstories',
  top: 'topstories'
};

interface RuntimeDependencies {
  detailConcurrency: number;
  fetch: typeof fetch;
  maxResponseBytes: number;
  requestTimeoutMs: number;
}

export function createDefaultHackerNewsRuntime(
  options: HackerNewsRuntimeOptions = {}
): HackerNewsRuntime {
  const dependencies: RuntimeDependencies = {
    detailConcurrency: normalizeDetailConcurrency(options.detailConcurrency),
    fetch: options.fetch ?? fetch,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  };

  return {
    fetchSearch: async (request) => fetchSearch(dependencies, request),
    fetchStories: async (request) => fetchStories(dependencies, request)
  };
}

function normalizeDetailConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DETAIL_CONCURRENCY;
  }
  return Math.max(1, Math.min(DEFAULT_DETAIL_CONCURRENCY, Math.floor(value)));
}

async function fetchStories(
  dependencies: RuntimeDependencies,
  options: {
    limit: number;
    source: HackerNewsStorySource;
  }
): Promise<HackerNewsStoriesRuntimeResult> {
  const endpoint = SOURCE_TO_ENDPOINT[options.source];
  const ids = await fetchJson<number[]>(
    dependencies,
    `${FIREBASE_BASE_URL}/${endpoint}.json`
  );
  const candidateIds = [...new Set(ids.slice(0, options.limit * 2))];
  const rawItems = await mapOrderedBounded(
    candidateIds,
    dependencies.detailConcurrency,
    async (id) => fetchJson<HackerNewsFirebaseItem | null>(
      dependencies,
      `${FIREBASE_BASE_URL}/item/${id}.json`,
      Math.min(dependencies.maxResponseBytes, DEFAULT_DETAIL_RESPONSE_BYTES)
    )
  );

  return {
    items: rawItems.flatMap(mapFirebaseItem).slice(0, options.limit),
    source: options.source
  };
}

async function fetchSearch(
  dependencies: RuntimeDependencies,
  options: {
    limit: number;
    query: string;
    sort: HackerNewsSearchSort;
  }
): Promise<HackerNewsSearchRuntimeResult> {
  const params = new URLSearchParams({
    hitsPerPage: String(options.limit),
    query: options.query,
    tags: 'story'
  });
  const endpoint = options.sort === 'date' ? 'search_by_date' : 'search';
  const response = await fetchJson<HackerNewsAlgoliaResponse>(
    dependencies,
    `${ALGOLIA_BASE_URL}/${endpoint}?${params.toString()}`
  );

  return {
    items: response.hits.flatMap(mapAlgoliaHit).slice(0, options.limit),
    query: options.query
  };
}

async function fetchJson<T>(
  dependencies: RuntimeDependencies,
  url: string,
  maxResponseBytes = dependencies.maxResponseBytes
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.requestTimeoutMs);

  try {
    let response: Response;
    try {
      response = await dependencies.fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'ants-move/0.1 HackerNews collector'
        },
        signal: controller.signal
      });
    } catch (error) {
      throw new HackerNewsCommandError(
        'HN_FETCH_FAILED',
        'Failed to fetch Hacker News data.',
        2,
        {
          cause: error instanceof Error ? error.message : String(error),
          url
        }
      );
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new HackerNewsCommandError(
        'HN_FETCH_FAILED',
        `Failed to fetch Hacker News data. HTTP ${response.status}.`,
        2,
        { url }
      );
    }

    const body = await readBoundedBody(response, maxResponseBytes, url);
    try {
      return JSON.parse(new TextDecoder().decode(body)) as T;
    } catch {
      throw new HackerNewsCommandError(
        'HN_PARSE_FAILED',
        'Failed to parse Hacker News JSON.',
        2,
        { url }
      );
    }
  } finally {
    clearTimeout(timeout);
  }
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

function responseTooLarge(url: string, maxBytes: number): HackerNewsCommandError {
  return new HackerNewsCommandError(
    'HN_RESPONSE_TOO_LARGE',
    'Hacker News response exceeded the configured size limit.',
    2,
    { maxBytes, url }
  );
}

async function mapOrderedBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (values.length === 0) {
    return [];
  }

  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let firstError: unknown;

  const worker = async () => {
    while (firstError === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;

      try {
        results[index] = await map(values[index] as T, index);
      } catch (error) {
        firstError ??= error;
      }
    }
  };

  const workerCount = Math.max(1, Math.min(
    Math.floor(concurrency),
    values.length
  ));
  await Promise.all(Array.from({ length: workerCount }, worker));

  if (firstError !== undefined) {
    throw firstError;
  }
  return results;
}

interface HackerNewsFirebaseItem {
  by?: string;
  dead?: boolean;
  deleted?: boolean;
  descendants?: number;
  id?: number;
  score?: number;
  text?: string;
  time?: number;
  title?: string;
  type?: string;
  url?: string;
}

interface HackerNewsAlgoliaResponse {
  hits: HackerNewsAlgoliaHit[];
}

interface HackerNewsAlgoliaHit {
  author?: string;
  created_at_i?: number;
  num_comments?: number;
  objectID?: string;
  points?: number;
  story_id?: number;
  title?: string;
  url?: string;
}

function mapFirebaseItem(item: HackerNewsFirebaseItem | null): HackerNewsItem[] {
  if (!item || item.deleted || item.dead || item.type !== 'story' || !item.id || !item.title) {
    return [];
  }

  return [
    createItem({
      id: item.id,
      title: item.title,
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      ...optional('author', item.by),
      ...optional('commentCount', item.descendants),
      ...optional('score', item.score),
      ...optional('text', item.text),
      ...optional('timeSeconds', item.time)
    })
  ];
}

function mapAlgoliaHit(hit: HackerNewsAlgoliaHit): HackerNewsItem[] {
  const id = hit.story_id ?? parseNumericId(hit.objectID);
  if (!id || !hit.title) {
    return [];
  }

  return [
    createItem({
      id,
      title: hit.title,
      url: hit.url ?? `https://news.ycombinator.com/item?id=${id}`,
      ...optional('author', hit.author),
      ...optional('commentCount', hit.num_comments),
      ...optional('score', hit.points),
      ...optional('timeSeconds', hit.created_at_i)
    })
  ];
}

function createItem(input: {
  author?: string;
  commentCount?: number;
  id: number;
  score?: number;
  text?: string;
  timeSeconds?: number;
  title: string;
  url: string;
}): HackerNewsItem {
  const item: HackerNewsItem = {
    id: input.id,
    title: input.title,
    type: 'story',
    url: input.url
  };

  if (input.author !== undefined) item.author = input.author;
  if (input.commentCount !== undefined) item.commentCount = input.commentCount;
  if (input.score !== undefined) item.score = input.score;
  if (input.text !== undefined) item.text = input.text;
  if (input.timeSeconds !== undefined) {
    item.time = {
      iso: new Date(input.timeSeconds * 1000).toISOString(),
      seconds: input.timeSeconds
    };
  }

  return item;
}

function optional<K extends string, V>(
  key: K,
  value: V | undefined
): Partial<Record<K, V>> {
  return value === undefined
    ? {}
    : { [key]: value } as Record<K, V>;
}

function parseNumericId(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}
