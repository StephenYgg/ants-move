# GitHub README Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ants github readme <repository-url>` to return a public repository's preferred README content and metadata through one bounded, unauthenticated GitHub REST request.

**Architecture:** Extend the existing GitHub command/service/runtime/output/type boundaries. The service owns strict repository URL validation, a new pure parser owns GitHub JSON/Base64 validation, and the runtime owns one bounded Fetch to the documented README endpoint. Tests inject the runtime or Fetch boundary and never contact GitHub.

**Tech Stack:** TypeScript 5.9, Node.js 22 Fetch/Web Streams, Commander 14, Zod 4, Vitest 4, tsup.

**Design:** `docs/superpowers/specs/2026-07-28-github-readme-collector-design.md`

**Commit policy:** Do not run `git commit`. The repository instructions require separate, explicit user authorization for every commit, so this plan ends each task with an uncommitted checkpoint.

---

## File Map

- Modify `src/github/types.ts`: add README result values and the injected runtime method.
- Modify `src/github/service.ts`: validate/canonicalize repository URLs and assemble results.
- Create `src/github/readme-parser.ts`: validate bounded API JSON, URLs, Base64, size, and UTF-8.
- Modify `src/github/runtime.ts`: perform the one bounded unauthenticated README request and map HTTP failures.
- Modify `src/github/output.ts`: render README success JSON.
- Modify `src/github/command.ts`: register the JSON-only `github readme` command.
- Modify `tests/github/service.test.ts`: cover accepted and rejected repository URLs.
- Create `tests/github/readme-parser.test.ts`: cover the complete response parser contract.
- Modify `tests/github/runtime.test.ts`: cover request headers, one-call bound, rate limiting, and failures.
- Modify `tests/github/output.test.ts`: cover the README success envelope.
- Modify `tests/cli/github-command.test.ts`: cover command registration, output, injection, and known errors.
- Modify `tests/scaffolding/documentation.test.ts`: require README command and resource-bound documentation.
- Modify `README.md`: document the command, anonymous rate limit, and concurrency bound.

### Task 1: Add README Types And The Service Happy Path

**Files:**
- Modify: `src/github/types.ts`
- Modify: `src/github/service.ts`
- Modify: `tests/github/service.test.ts`

- [ ] **Step 1: Add a failing service test for a canonical repository URL**

Extend the runtime fixture in `tests/github/service.test.ts` with a `fetchReadme`
method and add this test. The fixture result is reused by later URL tests.

```ts
function readmeRuntimeResult() {
  return {
    content: '# Project\n',
    downloadUrl: 'https://raw.githubusercontent.com/example/project/main/README.md',
    htmlUrl: 'https://github.com/example/project/blob/main/README.md',
    name: 'README.md',
    path: 'README.md',
    sha: '0123456789abcdef0123456789abcdef01234567',
    size: 10,
    sourceUrl: 'https://api.github.com/repos/example/project/readme'
  };
}

function createRuntime(): GitHubRuntime {
  return {
    fetchReadme: vi.fn(async () => readmeRuntimeResult()),
    fetchTrending: vi.fn(async ({ period }) => ({
      items: [
        {
          forks: 42,
          fullName: 'example/project',
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

it('fetches a public repository README from a canonical URL', async () => {
  const runtime = createRuntime();
  const service = new GitHubService({ runtime });

  await expect(service.readme('https://github.com/example/project')).resolves.toEqual({
    ...readmeRuntimeResult(),
    repository: 'example/project',
    repositoryUrl: 'https://github.com/example/project'
  });
  expect(runtime.fetchReadme).toHaveBeenCalledOnce();
  expect(runtime.fetchReadme).toHaveBeenCalledWith({
    owner: 'example',
    repo: 'project'
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the Red state**

Run:

```bash
npm test -- tests/github/service.test.ts
```

Expected: FAIL because `GitHubRuntime.fetchReadme` and `GitHubService.readme` do
not exist.

- [ ] **Step 3: Add the README type contracts**

Add these interfaces to `src/github/types.ts`, and make `fetchReadme` a required
method beside `fetchTrending`:

```ts
export interface GitHubReadmeRuntimeResult {
  content: string;
  downloadUrl: string;
  htmlUrl: string;
  name: string;
  path: string;
  sha: string;
  size: number;
  sourceUrl: string;
}

export interface GitHubReadmeResult extends GitHubReadmeRuntimeResult {
  repository: string;
  repositoryUrl: string;
}

export interface GitHubRuntime {
  fetchReadme: (options: {
    owner: string;
    repo: string;
  }) => Promise<GitHubReadmeRuntimeResult>;
  fetchTrending: (options: {
    period: GitHubTrendingPeriod;
  }) => Promise<GitHubTrendingRuntimeResult>;
}
```

- [ ] **Step 4: Implement the smallest canonical-only service path**

Import `GitHubReadmeResult` in `src/github/service.ts` and add this method to
`GitHubService`. Task 2 replaces the temporary exact-shape check with the full
approved validator.

```ts
async readme(repositoryUrl: string): Promise<GitHubReadmeResult> {
  if (repositoryUrl !== 'https://github.com/example/project') {
    throw invalidRepositoryUrl();
  }

  const result = await this.dependencies.runtime.fetchReadme({
    owner: 'example',
    repo: 'project'
  });

  return {
    ...result,
    repository: 'example/project',
    repositoryUrl: 'https://github.com/example/project'
  };
}
```

Add the private error factory at file scope:

```ts
function invalidRepositoryUrl(): GitHubCommandError {
  return new GitHubCommandError(
    'GITHUB_INVALID_REPOSITORY_URL',
    'GitHub repository URL must identify a public github.com repository root.',
    2
  );
}
```

- [ ] **Step 5: Run the focused service tests and confirm Green**

Run:

```bash
npm test -- tests/github/service.test.ts
```

Expected: PASS for the existing Trending tests and the canonical README test.

- [ ] **Step 6: Leave an uncommitted checkpoint**

Run:

```bash
git status --short
```

Expected: only the approved design/plan files and Task 1 source/test edits are
listed. Do not stage or commit them.

### Task 2: Implement Strict Repository URL Validation

**Files:**
- Modify: `src/github/service.ts`
- Modify: `tests/github/service.test.ts`

- [ ] **Step 1: Add accepted URL normalization tests**

Add this table test to `tests/github/service.test.ts`:

```ts
it.each([
  'https://github.com/example/project/',
  'https://github.com/example/project.git',
  'https://github.com/example/project?tab=readme-ov-file',
  'https://github.com/example/project#readme'
])('normalizes the accepted repository URL %s', async (repositoryUrl) => {
  const runtime = createRuntime();
  const service = new GitHubService({ runtime });

  const result = await service.readme(repositoryUrl);

  expect(result.repository).toBe('example/project');
  expect(result.repositoryUrl).toBe('https://github.com/example/project');
  expect(runtime.fetchReadme).toHaveBeenCalledWith({
    owner: 'example',
    repo: 'project'
  });
});
```

- [ ] **Step 2: Add the complete rejected URL matrix**

Add this table test. The secret assertion prevents credential-bearing input from
being reflected in structured errors.

```ts
it.each([
  'http://github.com/example/project',
  'https://example.com/example/project',
  'https://github.com.example.org/example/project',
  'https://git\nhub.com/example/project',
  'https://git\rhub.com/example/project',
  'https://git\thub.com/example/project',
  'https://user:secret@github.com/example/project',
  'https://:secret@github.com/example/project',
  'https://github.com:444/example/project',
  'https://[::1/example/project',
  'https://github.com/example',
  'https://github.com/example/project/tree/main',
  'https://github.com/example/project/blob/main/README.md',
  'https://github.com/example/%2fproject',
  'https://github.com/example/%5cproject',
  'https://github.com/example\\project',
  'https://github.com/example/pro\u0000ject',
  'https://github.com/example/./project',
  'https://github.com/example/%2e%2e/project',
  'https://github.com/example/%',
  'https://github.com/exa_mple/project',
  'https://github.com/-example/project',
  'https://github.com/example--owner/project',
  'https://github.com/example/.git',
  'not a URL'
])('rejects %s before external work', async (repositoryUrl) => {
  const runtime = createRuntime();
  const service = new GitHubService({ runtime });
  const error = await service.readme(repositoryUrl).catch(
    (failure: unknown) => failure
  );

  expect(error).toMatchObject({
    code: 'GITHUB_INVALID_REPOSITORY_URL',
    exitCode: 2
  });
  expect(JSON.stringify(error)).not.toContain('secret');
  expect(runtime.fetchReadme).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the focused test and confirm the new cases fail**

Run:

```bash
npm test -- tests/github/service.test.ts
```

Expected: FAIL because the temporary Task 1 implementation accepts only one
literal URL.

- [ ] **Step 4: Replace the temporary check with the full URL parser**

Add these constants and helpers to `src/github/service.ts`:

```ts
interface GitHubRepositoryIdentity {
  owner: string;
  repo: string;
  repository: string;
  repositoryUrl: string;
}

const RAW_ABSOLUTE_URL =
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*(?<path>\/[^?#]*)?(?:[?#].*)?$/;
const RAW_DOT_SEGMENT =
  /(?:^|\/)(?:(?:\.|%2e){1,2})(?:\/|$)/i;
const RAW_ENCODED_SEPARATOR = /%(?:2f|5c)/i;
const RAW_FORBIDDEN_CHARACTER = /[\\\u0000-\u001f\u007f]/;
const OWNER_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/;

function parseRepositoryUrl(value: string): GitHubRepositoryIdentity {
  const rawMatch = RAW_ABSOLUTE_URL.exec(value);
  const rawPath = rawMatch?.groups?.path ?? '';

  if (
    !rawMatch ||
    RAW_DOT_SEGMENT.test(rawPath) ||
    RAW_ENCODED_SEPARATOR.test(rawPath) ||
    RAW_FORBIDDEN_CHARACTER.test(value)
  ) {
    throw invalidRepositoryUrl();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidRepositoryUrl();
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw invalidRepositoryUrl();
  }

  const rawSegments = url.pathname.split('/').filter(Boolean);
  if (rawSegments.length !== 2) {
    throw invalidRepositoryUrl();
  }

  let owner: string;
  let repo: string;
  try {
    owner = decodeURIComponent(rawSegments[0] as string);
    repo = decodeURIComponent(rawSegments[1] as string).replace(/\.git$/i, '');
  } catch {
    throw invalidRepositoryUrl();
  }

  if (
    !OWNER_NAME.test(owner) ||
    owner.includes('--') ||
    !REPOSITORY_NAME.test(repo)
  ) {
    throw invalidRepositoryUrl();
  }

  const repository = `${owner}/${repo}`;
  return {
    owner,
    repo,
    repository,
    repositoryUrl: `https://github.com/${repository}`
  };
}
```

Replace the Task 1 method body with:

```ts
async readme(repositoryUrl: string): Promise<GitHubReadmeResult> {
  const identity = parseRepositoryUrl(repositoryUrl);
  const result = await this.dependencies.runtime.fetchReadme({
    owner: identity.owner,
    repo: identity.repo
  });

  return {
    ...result,
    repository: identity.repository,
    repositoryUrl: identity.repositoryUrl
  };
}
```

- [ ] **Step 5: Run the focused tests and confirm Green**

Run:

```bash
npm test -- tests/github/service.test.ts
```

Expected: PASS, including every accepted and rejected URL case.

- [ ] **Step 6: Run type checking and record only the expected mock gap**

Run:

```bash
npm run check
```

Expected at this checkpoint: FAIL only where existing `GitHubRuntime` mocks in
`tests/cli/github-command.test.ts` do not yet define `fetchReadme`. Task 5 updates
those mocks before the full verification gate.

### Task 3: Add The Pure README Response Parser

**Files:**
- Create: `src/github/readme-parser.ts`
- Create: `tests/github/readme-parser.test.ts`

- [ ] **Step 1: Create the success-path parser test**

Create `tests/github/readme-parser.test.ts` with this initial content:

```ts
import { describe, expect, it } from 'vitest';

import { parseGitHubReadmeResponse } from '../../src/github/readme-parser.js';

const OWNER = 'example';
const REPO = 'project';
const SOURCE_URL = 'https://api.github.com/repos/example/project/readme';

function responseBody(overrides: Record<string, unknown> = {}): Uint8Array {
  const content = Buffer.from('# Project\n', 'utf8');
  return new TextEncoder().encode(JSON.stringify({
    content: content.toString('base64'),
    download_url: 'https://raw.githubusercontent.com/example/project/main/README.md',
    encoding: 'base64',
    html_url: 'https://github.com/example/project/blob/main/README.md',
    name: 'README.md',
    path: 'README.md',
    sha: '0123456789abcdef0123456789abcdef01234567',
    size: content.byteLength,
    ...overrides
  }));
}

function parse(body = responseBody()) {
  return parseGitHubReadmeResponse(body, {
    owner: OWNER,
    repo: REPO,
    sourceUrl: SOURCE_URL
  });
}

describe('GitHub README response parser', () => {
  it('maps metadata and decodes raw UTF-8 content', () => {
    expect(parse()).toEqual({
      content: '# Project\n',
      downloadUrl: 'https://raw.githubusercontent.com/example/project/main/README.md',
      htmlUrl: 'https://github.com/example/project/blob/main/README.md',
      name: 'README.md',
      path: 'README.md',
      sha: '0123456789abcdef0123456789abcdef01234567',
      size: 10,
      sourceUrl: SOURCE_URL
    });
  });

  it('supports GitHub selecting a nested README with another extension', () => {
    const content = Buffer.from('Project\n=======\n', 'utf8');
    expect(parse(responseBody({
      content: content.toString('base64'),
      download_url: 'https://raw.githubusercontent.com/example/project/main/docs/README.rst',
      html_url: 'https://github.com/example/project/blob/main/docs/README.rst',
      name: 'README.rst',
      path: 'docs/README.rst',
      size: content.byteLength
    }))).toMatchObject({
      content: 'Project\n=======\n',
      name: 'README.rst',
      path: 'docs/README.rst'
    });
  });
});
```

- [ ] **Step 2: Run the parser test and confirm Red**

Run:

```bash
npm test -- tests/github/readme-parser.test.ts
```

Expected: FAIL because `src/github/readme-parser.ts` does not exist.

- [ ] **Step 3: Implement the success-path parser**

Create `src/github/readme-parser.ts`:

```ts
import { z } from 'zod';

import {
  GitHubCommandError,
  type GitHubReadmeRuntimeResult
} from './types.js';

interface ParseGitHubReadmeResponseOptions {
  owner: string;
  repo: string;
  sourceUrl: string;
}

const responseSchema = z.object({
  content: z.string(),
  download_url: z.string().min(1),
  encoding: z.literal('base64'),
  html_url: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  sha: z.string().min(1),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
});

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function parseGitHubReadmeResponse(
  body: Uint8Array,
  options: ParseGitHubReadmeResponseOptions
): GitHubReadmeRuntimeResult {
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(body);
    const parsed = responseSchema.parse(JSON.parse(json));
    const normalizedContent = parsed.content.replace(/[\t\n\r ]/g, '');

    if (!BASE64.test(normalizedContent)) {
      throw new Error('Invalid Base64 content.');
    }

    const decoded = Buffer.from(normalizedContent, 'base64');
    if (decoded.byteLength !== parsed.size) {
      throw new Error('README size mismatch.');
    }

    return {
      content: new TextDecoder('utf-8', { fatal: true }).decode(decoded),
      downloadUrl: requireRepositoryUrl(
        parsed.download_url,
        'raw.githubusercontent.com',
        options,
        false
      ),
      htmlUrl: requireRepositoryUrl(
        parsed.html_url,
        'github.com',
        options,
        true
      ),
      name: parsed.name,
      path: parsed.path,
      sha: parsed.sha,
      size: parsed.size,
      sourceUrl: options.sourceUrl
    };
  } catch {
    throw new GitHubCommandError(
      'GITHUB_PARSE_FAILED',
      'Failed to parse GitHub README response.',
      2,
      { sourceUrl: options.sourceUrl }
    );
  }
}

function requireRepositoryUrl(
  value: string,
  hostname: 'github.com' | 'raw.githubusercontent.com',
  options: Pick<ParseGitHubReadmeResponseOptions, 'owner' | 'repo'>,
  requireBlobSegment: boolean
): string {
  const url = new URL(value);
  const segments = url.pathname.split('/').filter(Boolean);
  const expectedLength = requireBlobSegment ? 5 : 4;

  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== hostname ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    segments.length < expectedLength ||
    segments[0]?.toLowerCase() !== options.owner.toLowerCase() ||
    segments[1]?.toLowerCase() !== options.repo.toLowerCase() ||
    (requireBlobSegment && segments[2] !== 'blob')
  ) {
    throw new Error('Unexpected README URL.');
  }

  return url.toString();
}
```

- [ ] **Step 4: Run the parser tests and confirm the success cases pass**

Run:

```bash
npm test -- tests/github/readme-parser.test.ts
```

Expected: PASS for both success cases.

- [ ] **Step 5: Add the parser rejection matrix**

Append these tests inside the parser `describe` block:

```ts
it.each([
  ['malformed JSON', new TextEncoder().encode('{')],
  ['invalid response UTF-8', new Uint8Array([0xff])],
  ['missing fields', new TextEncoder().encode('{}')]
])('rejects %s without exposing response data', (_label, body) => {
  const error = (() => {
    try {
      parse(body);
    } catch (failure) {
      return failure;
    }
    return undefined;
  })();

  expect(error).toMatchObject({
    code: 'GITHUB_PARSE_FAILED',
    details: { sourceUrl: SOURCE_URL }
  });
  expect(JSON.stringify(error)).not.toContain('content');
});

it.each([
  { content: 'not base64!', label: 'malformed Base64' },
  { encoding: 'utf-8', label: 'unsupported encoding' },
  { name: '', label: 'empty name' },
  { path: '', label: 'empty path' },
  { sha: '', label: 'empty SHA' },
  { size: -1, label: 'negative size' },
  { size: Number.MAX_SAFE_INTEGER + 1, label: 'unsafe size' },
  { size: 9, label: 'decoded-size mismatch' }
])('rejects $label', (overrides) => {
  expect(() => parse(responseBody(overrides))).toThrowError(
    expect.objectContaining({ code: 'GITHUB_PARSE_FAILED' })
  );
});

it('rejects invalid README content UTF-8', () => {
  expect(() => parse(responseBody({
    content: Buffer.from([0xff]).toString('base64'),
    size: 1
  }))).toThrowError(expect.objectContaining({
    code: 'GITHUB_PARSE_FAILED'
  }));
});

it.each([
  { html_url: 'http://[' },
  { html_url: 'http://github.com/example/project/blob/main/README.md' },
  { html_url: 'https://github.example/example/project/blob/main/README.md' },
  { html_url: 'https://github.com:444/example/project/blob/main/README.md' },
  { html_url: 'https://user:secret@github.com/example/project/blob/main/README.md' },
  { html_url: 'https://:secret@github.com/example/project/blob/main/README.md' },
  { html_url: 'https://github.com/example/project' },
  { html_url: 'https://github.com/other/project/blob/main/README.md' },
  { html_url: 'https://github.com/example/other/blob/main/README.md' },
  { html_url: 'https://github.com/example/project/tree/main/README.md' },
  { download_url: 'http://raw.githubusercontent.com/example/project/main/README.md' },
  { download_url: 'https://example.com/example/project/main/README.md' },
  { download_url: 'https://raw.githubusercontent.com/example/project' },
  { download_url: 'https://raw.githubusercontent.com/other/project/main/README.md' },
  { download_url: 'https://raw.githubusercontent.com/example/other/main/README.md' }
])('rejects unsafe or mismatched metadata URLs', (overrides) => {
  expect(() => parse(responseBody(overrides))).toThrowError(
    expect.objectContaining({ code: 'GITHUB_PARSE_FAILED' })
  );
});
```

- [ ] **Step 6: Run parser tests and coverage for the new file**

Run:

```bash
npm test -- tests/github/readme-parser.test.ts
npm run coverage -- tests/github/readme-parser.test.ts
```

Expected: tests PASS. If the focused coverage report identifies an uncovered
parser branch, add the concrete invalid fixture that reaches that branch before
continuing; do not add coverage ignores.

### Task 4: Add The Bounded GitHub README Runtime

**Files:**
- Modify: `src/github/runtime.ts`
- Modify: `tests/github/runtime.test.ts`

- [ ] **Step 1: Add a successful one-request runtime test**

Add these helpers near the top of `tests/github/runtime.test.ts`:

```ts
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
```

Add the test:

```ts
it('fetches a public README once with versioned JSON headers and no authorization', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(readmePayload()));
  const runtime = createDefaultGitHubRuntime({ fetch: fetchImpl });

  const result = await runtime.fetchReadme({ owner: 'example', repo: 'project' });

  expect(fetchImpl).toHaveBeenCalledOnce();
  const [input, init] = fetchImpl.mock.calls[0] ?? [];
  expect(String(input)).toBe('https://api.github.com/repos/example/project/readme');
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
```

- [ ] **Step 2: Run the successful runtime test and confirm Red**

Run:

```bash
npm test -- tests/github/runtime.test.ts -t 'fetches a public README once'
```

Expected: FAIL because the default runtime does not implement `fetchReadme`.

- [ ] **Step 3: Add the README request path to the runtime**

Import `parseGitHubReadmeResponse` and add `fetchReadme` to the returned runtime:

```ts
import { parseGitHubReadmeResponse } from './readme-parser.js';

return {
  fetchReadme: async ({ owner, repo }) => fetchReadme(
    dependencies,
    owner,
    repo
  ),
  fetchTrending: async ({ period }) => fetchTrending(dependencies, period)
};
```

Add the request implementation. It reuses the existing bounded body reader and
does not read an environment token:

```ts
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

function createReadmeSourceUrl(owner: string, repo: string): string {
  return new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
    'https://api.github.com'
  ).toString();
}

function readmeFetchFailed(sourceUrl: string, status?: number): GitHubCommandError {
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
```

Change `readBoundedBody` to accept a message and use it when constructing the
size error. Replace the current function with this complete implementation:

```ts
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

function responseTooLarge(
  url: string,
  maxBytes: number,
  message: string
): GitHubCommandError {
  return new GitHubCommandError(
    'GITHUB_RESPONSE_TOO_LARGE',
    message,
    2,
    { maxBytes, url }
  );
}
```

Update the existing Trending call exactly as follows:

```ts
body = await readBoundedBody(
  response,
  dependencies.maxResponseBytes,
  sourceUrl,
  'GitHub Trending response exceeded the configured size limit.'
);
```

- [ ] **Step 4: Add exact 404 and primary-rate-limit mapping**

Add these helpers to `src/github/runtime.ts`:

```ts
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

function parseNonNegativeIntegerHeader(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function toIsoTimestamp(seconds: number): string | undefined {
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
```

- [ ] **Step 5: Add runtime failure and resource-bound tests**

Append these tests to `tests/github/runtime.test.ts`:

```ts
it('maps a missing or inaccessible README without a second request', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, { status: 404 }));
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

it('maps README request deadline aborts as a fetch failure', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => new Promise<Response>(
    (_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted with secret', 'AbortError'));
      });
    }
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
    fetch: vi.fn<typeof fetch>(async () => jsonResponse({ secret: 'not exposed' }))
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
```

- [ ] **Step 6: Run the GitHub parser/runtime suites and confirm Green**

Run:

```bash
npm test -- tests/github/readme-parser.test.ts tests/github/runtime.test.ts
```

Expected: PASS with one Fetch call in every README path and no Trending
regression.

### Task 5: Register The Command And Render README JSON

**Files:**
- Modify: `src/github/output.ts`
- Modify: `src/github/command.ts`
- Modify: `tests/github/output.test.ts`
- Modify: `tests/cli/github-command.test.ts`

- [ ] **Step 1: Add the failing README output test**

Import `renderGitHubReadmeAsJson` and `GitHubReadmeResult` in
`tests/github/output.test.ts`, then add:

```ts
it('renders the complete README success envelope as JSON', () => {
  const readme: GitHubReadmeResult = {
    content: '# Project\n',
    downloadUrl: 'https://raw.githubusercontent.com/example/project/main/README.md',
    htmlUrl: 'https://github.com/example/project/blob/main/README.md',
    name: 'README.md',
    path: 'README.md',
    repository: 'example/project',
    repositoryUrl: 'https://github.com/example/project',
    sha: '0123456789abcdef0123456789abcdef01234567',
    size: 10,
    sourceUrl: 'https://api.github.com/repos/example/project/readme'
  };

  expect(JSON.parse(renderGitHubReadmeAsJson(readme))).toEqual({
    ok: true,
    data: readme
  });
});
```

- [ ] **Step 2: Run the output test and confirm Red**

Run:

```bash
npm test -- tests/github/output.test.ts
```

Expected: FAIL because `renderGitHubReadmeAsJson` does not exist.

- [ ] **Step 3: Add the README JSON renderer**

Add the import type and function to `src/github/output.ts`:

```ts
import type {
  GitHubReadmeResult,
  GitHubTrendingResult
} from './types.js';

export function renderGitHubReadmeAsJson(result: GitHubReadmeResult): string {
  return JSON.stringify(
    {
      ok: true,
      data: result
    },
    null,
    2
  );
}
```

- [ ] **Step 4: Add a failing CLI success/help test and update runtime fixtures**

Update every `GitHubRuntime` fixture in `tests/cli/github-command.test.ts` so it
defines both required methods. The shared `createRuntime` gets:

```ts
fetchReadme: vi.fn(async () => ({
  content: '# Project\n',
  downloadUrl: 'https://raw.githubusercontent.com/example/project/main/README.md',
  htmlUrl: 'https://github.com/example/project/blob/main/README.md',
  name: 'README.md',
  path: 'README.md',
  sha: '0123456789abcdef0123456789abcdef01234567',
  size: 10,
  sourceUrl: 'https://api.github.com/repos/example/project/readme'
})),
```

Runtime literals used by error tests get `fetchReadme: vi.fn()` when the test is
about Trending. For example, replace the existing known-Trending-error runtime
literal with this complete object:

```ts
const runtime: GitHubRuntime = {
  fetchReadme: vi.fn(),
  fetchTrending: vi.fn(async () => {
    throw new GitHubCommandError(
      'GITHUB_FETCH_FAILED',
      'Failed to fetch GitHub Trending data.',
      2,
      { status: 503 }
    );
  })
};
```

Add these command tests:

```ts
it('fetches a repository README as JSON', async () => {
  let stdout = '';
  const runtime = createRuntime();
  const cli = createCli({
    githubRuntime: runtime,
    stdout: (value) => {
      stdout += value;
    }
  });

  expect(await cli.run([
    'github',
    'readme',
    'https://github.com/example/project'
  ])).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({
    ok: true,
    data: {
      content: '# Project\n',
      repository: 'example/project',
      repositoryUrl: 'https://github.com/example/project'
    }
  });
  expect(runtime.fetchReadme).toHaveBeenCalledOnce();
  expect(runtime.fetchTrending).not.toHaveBeenCalled();
});

it('lists readme in GitHub command help', async () => {
  let stdout = '';
  const cli = createCli({
    githubRuntime: createRuntime(),
    stdout: (value) => {
      stdout += value;
    }
  });

  expect(await cli.run(['github', '--help'])).toBe(0);
  expect(stdout).toContain('readme');
  expect(stdout).toContain('trending');
});
```

- [ ] **Step 5: Run the CLI test and confirm Red**

Run:

```bash
npm test -- tests/cli/github-command.test.ts
```

Expected: FAIL because the `readme` subcommand is not registered.

- [ ] **Step 6: Register the JSON-only README command**

Import `renderGitHubReadmeAsJson` in `src/github/command.ts`, update the parent
description, and register the new subcommand before `trending`:

```ts
const github = program
  .command('github')
  .description('Fetch GitHub repository data.');

github.command('readme')
  .description('Fetch the preferred README for a public GitHub repository.')
  .argument('<repository-url>', 'public GitHub repository root URL')
  .action(async (repositoryUrl: string) => {
    const result = await service.readme(repositoryUrl);
    dependencies.stdout(`${renderGitHubReadmeAsJson(result)}\n`);
  });
```

Do not add `--format`, `--table`, token, branch, retry, or fallback options.

- [ ] **Step 7: Add a known README error CLI test**

Add this test to `tests/cli/github-command.test.ts`:

```ts
it('preserves known README runtime errors', async () => {
  let stderr = '';
  const runtime = createRuntime();
  vi.mocked(runtime.fetchReadme).mockRejectedValueOnce(new GitHubCommandError(
    'GITHUB_RATE_LIMITED',
    "GitHub's anonymous API rate limit has been exceeded.",
    2,
    { remaining: 0, resetAt: '2026-07-28T03:46:31.000Z' }
  ));
  const cli = createCli({
    githubRuntime: runtime,
    stderr: (value) => {
      stderr += value;
    },
    stdout: () => undefined
  });

  expect(await cli.run([
    'github',
    'readme',
    'https://github.com/example/project'
  ])).toBe(2);
  expect(JSON.parse(stderr)).toMatchObject({
    ok: false,
    error: {
      code: 'GITHUB_RATE_LIMITED',
      details: { remaining: 0 }
    }
  });
});
```

- [ ] **Step 8: Run output, service, and CLI tests plus type checking**

Run:

```bash
npm test -- tests/github/output.test.ts tests/github/service.test.ts tests/cli/github-command.test.ts
npm run check
```

Expected: all selected tests PASS and TypeScript exits `0` with every runtime
fixture satisfying the expanded interface.

### Task 6: Document The Command And Concurrency Boundary

**Files:**
- Modify: `README.md`
- Modify: `tests/scaffolding/documentation.test.ts`

- [ ] **Step 1: Add failing documentation requirements**

Add these exact strings to the `requiredText` array in
`tests/scaffolding/documentation.test.ts`:

```ts
'ants github readme',
'api.github.com/repos/{owner}/{repo}/readme',
'60 requests per hour',
'does not read `GITHUB_TOKEN`',
'one bounded GitHub API request'
```

- [ ] **Step 2: Run the documentation test and confirm Red**

Run:

```bash
npm test -- tests/scaffolding/documentation.test.ts
```

Expected: FAIL because the README does not yet document the command.

- [ ] **Step 3: Add the GitHub README command documentation**

Append this subsection after the existing GitHub Trending examples and before
the Trending resource paragraph in `README.md`:

````markdown
### GitHub README

Fetch the preferred README from the default branch of a public repository:

```bash
ants github readme https://github.com/owner/repository
ants github readme https://github.com/owner/repository.git
```

The command returns JSON containing the raw UTF-8 README content together with
its name, path, SHA, byte size, HTML URL, download URL, canonical repository URL,
and API source URL. It uses the documented
`api.github.com/repos/{owner}/{repo}/readme` endpoint and performs one bounded
GitHub API request with a 30-second timeout and a 5 MB response limit. It does
not scrape repository pages, probe Raw URLs, retry, or fall back to another
request. It does not read `GITHUB_TOKEN`.

Only public repositories are supported. GitHub normally limits unauthenticated
REST clients sharing one source IP to 60 requests per hour. When that allowance
is exhausted, the command returns `GITHUB_RATE_LIMITED` without retrying.
````

- [ ] **Step 4: Update the high-concurrency warning**

Change the GitHub portion of the request-amplification paragraph to state that
each Trending or README invocation adds one GitHub request. Add that anonymous
README requests share GitHub's 60-request hourly allowance per source IP and that
rate-limit failures do not retry or fall back.

Use this exact replacement sentence:

```markdown
At `Q` concurrent invocations, upstream work can approach `20Q` requests for a 36Kr list, `201Q` requests for a Hacker News list, `105Q` browser navigations plus page subresources for a Toutiao author collection, or `Q` requests for either GitHub Trending or GitHub README. README collection also briefly retains a bounded API response, parsed JSON, Base64 text, and decoded content; anonymous callers sharing a source IP normally share GitHub's 60 requests per hour limit, and rate-limit failures do not retry or fall back.
```

- [ ] **Step 5: Run the documentation test and confirm Green**

Run:

```bash
npm test -- tests/scaffolding/documentation.test.ts
```

Expected: PASS.

### Task 7: Close Coverage And Verify The Deliverable

**Files:**
- Modify only files already listed when a real uncovered branch or failed check requires it.

- [ ] **Step 1: Run all deterministic tests**

Run:

```bash
npm test
```

Expected: all test files and tests PASS with zero failures.

- [ ] **Step 2: Run the strict TypeScript check**

Run:

```bash
npm run check
```

Expected: exit code `0` and no diagnostics.

- [ ] **Step 3: Run the 100 percent coverage gate**

Run:

```bash
npm run coverage
```

Expected: statements, branches, functions, and lines are all `100%`. For any
real uncovered branch, add the smallest deterministic input that exercises the
documented behavior and rerun the full coverage command. Do not lower thresholds
or add coverage exclusions.

- [ ] **Step 4: Build the package**

Run:

```bash
npm run build
```

Expected: tsup produces ESM output and declarations without errors.

- [ ] **Step 5: Inspect the packed artifact without leaving generated files**

Run:

```bash
readme_pack_dir=$(mktemp -d /tmp/ants-move-readme-pack.XXXXXX)
npm pack --json --pack-destination "$readme_pack_dir"
tar -tzf "$readme_pack_dir"/ants-move-*.tgz
/usr/bin/trash "$readme_pack_dir"
```

Expected: one package tarball containing the built `dist` entry points and
package metadata; the temporary directory is moved to Trash afterward.

- [ ] **Step 6: Perform the mandatory high-concurrency audit against the diff**

Confirm each item from the repository instructions with evidence from tests and
code:

```text
Hot path amplification: one Fetch call, no retry or Raw/page fallback.
Race / TOCTOU: pure read; no check-then-act mutation.
Lock contention: no locks or critical sections.
Single-flight / dedupe: not claimed; independent processes can each issue one request.
Bounded background work: no jobs, chains, delayed work, or retained promises.
Stampede / multi-instance: no cache; external shared rate limiting is documented.
Resource bounds: at Q concurrency, Q requests and a bounded multiple of 5 MiB * Q memory.
```

Re-run the focused one-call runtime test while checking this audit:

```bash
npm test -- tests/github/runtime.test.ts -t 'fetches a public README once'
```

Expected: PASS with `fetchImpl` called exactly once.

- [ ] **Step 7: Inspect the final uncommitted diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors, only scoped README collector files are changed,
and all work remains uncommitted. Do not run `git commit` without a new explicit
user instruction.
