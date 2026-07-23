# Compatible Collector Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task with review checkpoints. Do not use subagents unless the user explicitly authorizes delegation. Do not create Git commits unless the user explicitly requests a commit in the active conversation.

**Goal:** Build the `ants-move` TypeScript package with compatible 36Kr, Toutiao, and Hacker News commands exposed through `ants` and `amv`.

**Architecture:** A small Commander-based CLI statically registers three collector modules. Each module keeps command parsing, service coordination, runtime IO, output rendering, and types separate; injected runtimes keep deterministic tests offline. Network and browser work is bounded per invocation through page and item limits, timeouts, an eight-request Hacker News pool, and one reusable Toutiao browser session.

**Tech Stack:** Node.js 22+, TypeScript ESM, Commander 14, Zod 4, table 6, Playwright 1.59, Vitest 4, V8 coverage, tsup 8, npm

**Compatibility Source:** `/Users/stephen/Development/stephen/stephen-cli` at commit `b31991b`. Treat it as read-only. Port the named tests before the corresponding production files and preserve their assertions unless this plan explicitly changes the root command identity or a resource bound.

---

### Task 1: Establish the Package and Test Harness

**Files:**
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `tests/scaffolding/package.test.ts`

- [ ] **Step 1: Add the minimal npm test toolchain**

Create `package.json` initially with the package identity, ESM mode, scripts, and dependencies, but omit `bin`, `files`, and `engines` so the first metadata test has a real failure:

```json
{
  "name": "ants-move",
  "version": "0.1.0",
  "description": "An open-source CLI for collecting and moving data between systems.",
  "type": "module",
  "scripts": {
    "build": "tsup",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage"
  },
  "dependencies": {
    "commander": "14.0.1",
    "playwright": "1.59.1",
    "table": "6.9.0",
    "zod": "4.1.12"
  },
  "devDependencies": {
    "@types/node": "24.9.0",
    "@vitest/coverage-v8": "4.0.3",
    "tsup": "8.5.0",
    "typescript": "5.9.3",
    "vitest": "4.0.3"
  }
}
```

Use the strict `NodeNext` compiler options from `../stephen-cli/tsconfig.json`. Configure Vitest V8 coverage thresholds to 100 percent for statements, branches, functions, and lines. Configure `.gitignore` for `node_modules/`, `dist/`, `coverage/`, `*.tgz`, Playwright reports, logs, and OS files; do not ignore `docs/`.

- [ ] **Step 2: Install dependencies**

Run: `npm install`

Expected: exit 0 and a new `package-lock.json` using lockfile version 3.

- [ ] **Step 3: Write the failing package metadata test**

```typescript
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('package scaffolding', () => {
  it('publishes one entrypoint as the ants and amv executables', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      bin?: Record<string, string>;
      engines?: { node?: string };
      files?: string[];
    };

    expect(packageJson.bin).toEqual({
      amv: 'dist/index.js',
      ants: 'dist/index.js'
    });
    expect(packageJson.engines?.node).toBe('>=22.0.0');
    expect(packageJson.files).toEqual(['dist']);
  });

  it('builds an ESM Node 22 entrypoint with a shebang', () => {
    const buildConfig = readFileSync('tsup.config.ts', 'utf8');

    expect(buildConfig).toContain("js: '#!/usr/bin/env node'");
    expect(buildConfig).toContain("target: 'node22'");
  });
});
```

- [ ] **Step 4: Run the metadata test and verify RED**

Run: `npm test -- tests/scaffolding/package.test.ts`

Expected: FAIL because `bin`, `engines`, `files`, and `tsup.config.ts` are absent.

- [ ] **Step 5: Complete publishable metadata and build configuration**

Add the following fields to `package.json` and retain the dependencies from Step 1:

```json
{
  "bin": {
    "amv": "dist/index.js",
    "ants": "dist/index.js"
  },
  "files": ["dist"],
  "engines": {
    "node": ">=22.0.0"
  },
  "homepage": "https://github.com/StephenYgg/ants-move",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/StephenYgg/ants-move.git"
  },
  "bugs": {
    "url": "https://github.com/StephenYgg/ants-move/issues"
  },
  "keywords": ["automation", "cli", "data-collection", "typescript"],
  "author": "Stephen",
  "license": "MIT"
}
```

Create `tsup.config.ts`:

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  dts: true,
  entry: ['src/index.ts'],
  format: ['esm'],
  minify: false,
  shims: false,
  sourcemap: true,
  target: 'node22'
});
```

Run `npm install --package-lock-only` after changing package metadata.

- [ ] **Step 6: Run the metadata test and verify GREEN**

Run: `npm test -- tests/scaffolding/package.test.ts`

Expected: 2 tests PASS.

### Task 2: Build the Testable CLI Core

**Files:**
- Create: `src/cli.ts`
- Create: `src/index.ts`
- Create: `tests/cli/smoke.test.ts`
- Create: `tests/index.test.ts`

- [ ] **Step 1: Write failing CLI factory tests**

```typescript
import { describe, expect, it } from 'vitest';

import { createCli } from '../../src/index.js';

describe('ants CLI', () => {
  it('renders English top-level help through injected output', async () => {
    let stdout = '';
    const cli = createCli({
      stderr: () => undefined,
      stdout: (value) => { stdout += value; }
    });

    expect(await cli.run(['--help'])).toBe(0);
    expect(stdout).toContain('Usage: ants');
    expect(stdout).toContain('Move data between systems');
  });
});
```

Add `tests/index.test.ts` for `isMainEntrypoint()` using the three cases from `../stephen-cli/tests/scaffolding/main-entry.test.ts`: missing argv path, different path, and matching real path.

- [ ] **Step 2: Run the CLI tests and verify RED**

Run: `npm test -- tests/cli/smoke.test.ts tests/index.test.ts`

Expected: FAIL because `src/index.ts` does not exist.

- [ ] **Step 3: Implement the minimal CLI runner**

Implement this public boundary in `src/cli.ts`:

```typescript
export interface CliIo {
  stderr: (value: string) => void;
  stdout: (value: string) => void;
}

export interface CliRunner {
  run: (args: string[]) => Promise<number>;
}

export interface CreateCliOptions extends Partial<CliIo> {}

export function createCli(options: CreateCliOptions = {}): CliRunner;
```

Use `new Command().name('ants').description('Move data between systems with composable collectors.')`, `showHelpAfterError()`, `exitOverride()`, and injected Commander output writers. `run(args)` must call `parseAsync(args, { from: 'user' })`, return 0 for normal completion and help display, return Commander validation exit codes without a stack trace, and render unexpected errors as an `INTERNAL_ERROR` JSON object to stderr.

In `src/index.ts`, re-export `createCli`, implement `isMainEntrypoint(moduleUrl, argv)`, and set `process.exitCode` only when the module is the real executable entrypoint.

- [ ] **Step 4: Run the CLI tests and verify GREEN**

Run: `npm test -- tests/cli/smoke.test.ts tests/index.test.ts`

Expected: all tests PASS with no stderr warnings.

### Task 3: Migrate the 36Kr Domain and Renderers

**Files:**
- Create: `src/36kr/types.ts`
- Create: `src/36kr/output.ts`
- Create: `src/36kr/service.ts`
- Create: `src/36kr/runtime.ts` (interface only in this task)
- Create: `tests/36kr/service.test.ts`
- Create: `tests/36kr/output.test.ts`

- [ ] **Step 1: Port the failing 36Kr behavior tests**

Port every test from:

```text
../stephen-cli/tests/36kr/service.test.ts
```

Keep the inline article and information HTML fixtures and all field-level assertions unchanged. Add `tests/36kr/output.test.ts` asserting the exact JSON envelopes and table headers produced by the functions in `../stephen-cli/src/36kr/output.ts`.

- [ ] **Step 2: Run 36Kr tests and verify RED**

Run: `npm test -- tests/36kr/service.test.ts tests/36kr/output.test.ts`

Expected: FAIL because the `src/36kr` module does not exist.

- [ ] **Step 3: Port types, renderers, parser, service, and the runtime interface**

Port these source files without changing public result shapes or existing error codes:

```text
../stephen-cli/src/36kr/types.ts   -> src/36kr/types.ts
../stephen-cli/src/36kr/output.ts  -> src/36kr/output.ts
../stephen-cli/src/36kr/service.ts -> src/36kr/service.ts
```

Define only the dependency interface in `src/36kr/runtime.ts`; Task 4 adds its executable behavior after a failing runtime test:

```typescript
export interface Kr36Runtime {
  fetchArticleHtml: (request: Kr36Request) => Promise<string>;
  fetchJson: (request: Kr36JsonRequest) => Promise<string>;
}
```

- [ ] **Step 4: Run 36Kr tests and verify GREEN**

Run: `npm test -- tests/36kr/service.test.ts tests/36kr/output.test.ts`

Expected: all 36Kr service and output tests PASS.

### Task 4: Bound the 36Kr curl Runtime

**Files:**
- Modify: `src/36kr/runtime.ts`
- Create: `src/36kr/command.ts`
- Create: `tests/36kr/runtime.test.ts`
- Create: `tests/cli/36kr-command.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing curl boundary and CLI compatibility tests**

Port every test from `../stephen-cli/tests/cli/36kr-command.test.ts`, remove all `AkRepository` and in-memory database setup, and construct `createCli()` with only `kr36Runtime`, `stdout`, and `stderr`.

Design `createDefaultKr36Runtime` to accept an optional injected `execFile` function. Test that an article request invokes curl with all of these arguments:

```typescript
expect(args).toEqual(expect.arrayContaining([
  '--silent',
  '--show-error',
  '--location',
  '--compressed',
  '--connect-timeout',
  '10',
  '--max-time',
  '45'
]));
expect(options).toMatchObject({
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024
});
```

Also assert that a rejected process becomes `KR36_REQUEST_FAILED`, includes the URL and curl exit code, and never includes request headers in error details.

- [ ] **Step 2: Run the runtime test and verify RED**

Run: `npm test -- tests/36kr/runtime.test.ts tests/cli/36kr-command.test.ts`

Expected: FAIL because the bounded runtime factory and 36Kr command registration are missing.

- [ ] **Step 3: Implement the bounded runtime**

Port the curl argument construction from `../stephen-cli/src/36kr/runtime.ts`, add the two timeout options before headers, preserve the 20 MB `maxBuffer`, and expose this factory signature:

```typescript
export function createDefaultKr36Runtime(options: {
  execFile?: typeof execFileAsync;
} = {}): Kr36Runtime;
```

Use `options.execFile ?? execFileAsync`; do not add retries or background work.

- [ ] **Step 4: Port and register the 36Kr command**

Port `../stephen-cli/src/36kr/command.ts` without changing arguments, validation, rendering, error codes, or exit codes. Add `kr36Runtime?: Kr36Runtime` to `CreateCliOptions`, use `createDefaultKr36Runtime()` when absent, register the command, and call `handleKr36CommandError` from the runner catch path before generic error handling.

- [ ] **Step 5: Run all 36Kr tests and verify GREEN**

Run: `npm test -- tests/36kr tests/cli/36kr-command.test.ts`

Expected: all tests PASS.

### Task 5: Migrate the Hacker News Domain and Renderers

**Files:**
- Create: `src/hn/types.ts`
- Create: `src/hn/output.ts`
- Create: `src/hn/service.ts`
- Create: `src/hn/runtime.ts` (interface only in this task)
- Create: `tests/hn/service.test.ts`
- Create: `tests/hn/output.test.ts`

- [ ] **Step 1: Port failing Hacker News domain tests**

Port every case from `../stephen-cli/tests/hn/service.test.ts`. Add renderer tests for exact JSON envelopes and the seven table columns.

- [ ] **Step 2: Run Hacker News domain tests and verify RED**

Run: `npm test -- tests/hn/service.test.ts tests/hn/output.test.ts`

Expected: FAIL because `src/hn` does not exist.

- [ ] **Step 3: Port domain behavior and define the runtime interface**

Port `types.ts`, `output.ts`, and `service.ts` from `../stephen-cli/src/hn/`. Define only this IO interface in `src/hn/runtime.ts`; Task 6 adds executable transport behavior after its tests fail:

```typescript
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
```

- [ ] **Step 4: Run domain tests and verify GREEN**

Run: `npm test -- tests/hn/service.test.ts tests/hn/output.test.ts`

Expected: Hacker News service and renderer tests PASS.

### Task 6: Add Bounded Hacker News Transport and Concurrency

**Files:**
- Modify: `src/hn/runtime.ts`
- Create: `src/hn/command.ts`
- Create: `tests/hn/runtime.test.ts`
- Create: `tests/cli/hn-command.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing mapping, resource-bound, and CLI tests**

Port every case from `../stephen-cli/tests/cli/hn-command.test.ts`, remove repository setup, and rename the suite to `ants hn command`. Add a second invocation for every command registration assertion through `hackernews`, using a fresh CLI instance because Commander programs are single-run objects.

Inject Fetch through the runtime factory and cover:

- Firebase deleted, dead, non-story, and incomplete items are omitted.
- Algolia results preserve compatible IDs, timestamps, and fallback URLs.
- Duplicate story IDs issue one detail request.
- `--limit 100` inspects no more than 200 candidate IDs.
- At most eight detail Fetch calls are active at once and returned stories retain source order.
- A response over 5 MB fails with `HN_RESPONSE_TOO_LARGE` before JSON parsing.
- Network, timeout, non-2xx, and malformed JSON failures contain the URL but no response body.
- When one detail request fails, no new work is acquired and all already-active workers settle before rejection.

Use deferred promises in the concurrency test:

```typescript
let active = 0;
let peak = 0;
const releases: Array<() => void> = [];

const fetchImpl = vi.fn(async (input: string | URL | Request) => {
  active += 1;
  peak = Math.max(peak, active);
  await new Promise<void>((resolve) => releases.push(resolve));
  active -= 1;
  return jsonResponse(firebaseStoryFor(input));
});
```

Release requests in batches and assert `peak === 8` and final item order.

- [ ] **Step 2: Run runtime and CLI tests and verify RED**

Run: `npm test -- tests/hn/runtime.test.ts tests/cli/hn-command.test.ts`

Expected: FAIL because the injected runtime and Hacker News command registration are missing.

- [ ] **Step 3: Implement ordered bounded mapping**

Use a fixed worker pool that stops acquiring indices after the first failure and awaits all workers before throwing:

```typescript
async function mapOrderedBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<R>
): Promise<R[]> {
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

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker)
  );
  if (firstError !== undefined) throw firstError;
  return results;
}
```

Handle the empty array before constructing workers.

- [ ] **Step 4: Implement timeout and size-bounded JSON Fetch**

Expose:

```typescript
export interface HackerNewsRuntimeOptions {
  fetch?: typeof fetch;
  detailConcurrency?: number;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
}

export function createDefaultHackerNewsRuntime(
  options: HackerNewsRuntimeOptions = {}
): HackerNewsRuntime;
```

Defaults are concurrency 8, response limit `5 * 1024 * 1024`, and timeout 30 seconds. Check `content-length` first, then read `response.body` with a stream reader, accumulating the byte count and canceling the reader immediately when the limit is exceeded. Decode and `JSON.parse` only after the bounded read. Use the user-agent `ants-move/0.1 HackerNews collector`.

- [ ] **Step 5: Port and register the Hacker News commands**

Port `../stephen-cli/src/hn/command.ts` and replace its command creation with:

```typescript
const hn = program
  .command('hn')
  .alias('hackernews')
  .description('Fetch Hacker News stories and search results.');
```

Move the source `optional()` object-property helper into `src/hn/runtime.ts`; do not import the old `video` module. Add `hackerNewsRuntime?: HackerNewsRuntime` to `CreateCliOptions`, use the bounded default runtime when absent, register the commands, and route `HackerNewsCommandError` through its JSON renderer.

- [ ] **Step 6: Run all Hacker News tests and verify GREEN**

Run: `npm test -- tests/hn tests/cli/hn-command.test.ts`

Expected: all tests PASS, including peak concurrency 8 and no outstanding deferred operations.

### Task 7: Migrate the Toutiao Domain and Session Contract

**Files:**
- Create: `src/toutiao/types.ts`
- Create: `src/toutiao/output.ts`
- Create: `src/toutiao/service.ts`
- Create: `src/toutiao/runtime.ts`
- Create: `tests/toutiao/service.test.ts`
- Create: `tests/toutiao/output.test.ts`

- [ ] **Step 1: Port failing Toutiao compatibility tests**

Port every case from:

```text
../stephen-cli/tests/toutiao/service.test.ts
```

Replace flat runtime fakes with a `withSession` fake while retaining every article, list, author, URL normalization, error-code, and metadata assertion. Add renderer tests and assert that `author --with-content` calls `withSession` once for the feed and all article details.

- [ ] **Step 2: Run Toutiao compatibility tests and verify RED**

Run: `npm test -- tests/toutiao/service.test.ts tests/toutiao/output.test.ts`

Expected: FAIL because the Toutiao module does not exist.

- [ ] **Step 3: Define the reusable browser-session interface**

Port result types and renderers unchanged, then define the IO contract in `src/toutiao/runtime.ts`:

```typescript
export interface ToutiaoSession {
  fetchArticle: (request: { input: string; url: string }) => Promise<ToutiaoArticle>;
  fetchAuthorArticles: (options: {
    authorToken: string;
    pages: number;
    url: string;
  }) => Promise<ToutiaoAuthorRuntimeResult>;
  fetchKeywordInformation: (options: {
    keyword: ToutiaoSource;
    pages: number;
    source: ToutiaoSource;
  }) => Promise<ToutiaoRuntimeListResult>;
  fetchTechnologyChannel: (
    options: { pages: number }
  ) => Promise<ToutiaoRuntimeListResult>;
}

export interface ToutiaoRuntime {
  withSession: <T>(operation: (session: ToutiaoSession) => Promise<T>) => Promise<T>;
}
```

- [ ] **Step 4: Port the service onto one session**

Keep URL parsing, supported sources, page validation, result shapes, and existing error codes from `../stephen-cli/src/toutiao/service.ts`. Wrap each public service operation in one `runtime.withSession()` call. Inside `author`, fetch the feed first, reject more than 100 items with:

```typescript
throw new ToutiaoCommandError(
  'TOUTIAO_RESOURCE_LIMIT',
  'Toutiao author content collection supports at most 100 articles per invocation.',
  2,
  { totalItems: runtimeResult.items.length }
);
```

Only apply this check when `withContent` is true, and perform it before the first article detail navigation. Fetch accepted article details serially through the same session.

Do not add command registration in this task; Task 8 does so after the default runtime passes its own failing tests.

- [ ] **Step 5: Run service and output tests and verify GREEN**

Run: `npm test -- tests/toutiao/service.test.ts tests/toutiao/output.test.ts`

Expected: all service, output, and 100-item resource-limit tests PASS.

### Task 8: Implement the Single-Browser Toutiao Runtime

**Files:**
- Modify: `src/toutiao/runtime.ts`
- Create: `src/toutiao/command.ts`
- Create: `tests/toutiao/runtime.test.ts`
- Create: `tests/cli/toutiao-command.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing browser lifecycle, parsing, and CLI tests**

Port every case from `../stephen-cli/tests/cli/toutiao-command.test.ts`, remove repository setup, and replace flat runtime fakes with the `withSession` contract.

Create narrow fake objects for Chromium, Browser, BrowserContext, and Page. Port runtime parsing examples from `../stephen-cli/src/toutiao/runtime.ts` and cover:

- Article title, paragraphs, metadata, canonical ID, and final URL extraction.
- Technology and author feed response mapping, next-page values, and ID dedupe.
- Keyword search DOM extraction, text fallback, verification error, and recursive redirect URLs.
- One `chromium.launch`, one `browser.newContext`, and one `context.newPage` for an author feed plus all article details.
- Blocking `image`, `media`, and `font` resource types while continuing documents, scripts, XHR, and Fetch.
- Response listeners are removed after feed collection and do not accumulate before article navigation.
- Context and browser close exactly once after success, callback failure, navigation failure, and deadline expiry.
- Missing Playwright maps to `TOUTIAO_BROWSER_UNAVAILABLE`.
- The command deadline closes the browser and returns `TOUTIAO_TIMEOUT` without a live timer or unhandled promise.

- [ ] **Step 2: Run runtime and CLI tests and verify RED**

Run: `npm test -- tests/toutiao/runtime.test.ts tests/cli/toutiao-command.test.ts`

Expected: FAIL because the default runtime and Toutiao command registration are missing.

- [ ] **Step 3: Port extraction behavior into a session implementation**

Port these compatible behaviors from the source runtime into methods backed by one Page:

```text
fetchArticleWithBrowser            -> session.fetchArticle
fetchTechnologyChannelWithBrowser -> session.fetchTechnologyChannel
fetchAuthorArticlesWithBrowser     -> session.fetchAuthorArticles
fetchKeywordInformationWithBrowser -> session.fetchKeywordInformation
mapFeedItems, URL parsing, metadata, search fallback, and time formatting remain private helpers
```

When adding a response handler, retain its function identity and remove it in `finally` with `page.off('response', handler)`. Slice selected responses to the requested page count before mapping.

- [ ] **Step 4: Implement one bounded browser lifecycle**

Expose injectable loading and deadline options:

```typescript
export interface ToutiaoRuntimeOptions {
  deadlineMs?: number;
  loadPlaywright?: () => Promise<typeof import('playwright')>;
}

export function createDefaultToutiaoRuntime(
  options: ToutiaoRuntimeOptions = {}
): ToutiaoRuntime;
```

Default deadline: 10 minutes. `withSession` must launch one headless browser, create one `zh-CN` context with the existing user-agent, create one Page, and install a route that aborts image, media, and font requests. Race the operation against a deadline promise; on deadline, close the browser, await the operation's resulting settlement, and then throw `TOUTIAO_TIMEOUT`. Clear the timer in `finally`. Track whether the deadline already closed the browser so cleanup closes context and browser at most once; suppress cleanup errors but never suppress the collection error.

- [ ] **Step 5: Port and register the Toutiao commands**

Port `../stephen-cli/src/toutiao/command.ts` without changing arguments, output, or existing error behavior. Add `toutiaoRuntime?: ToutiaoRuntime` to `CreateCliOptions`, use the single-browser default runtime when absent, register the commands, and retain structured Toutiao error rendering.

- [ ] **Step 6: Run all Toutiao tests and verify GREEN**

Run: `npm test -- tests/toutiao tests/cli/toutiao-command.test.ts`

Expected: all tests PASS with one launch, deterministic cleanup, removed listeners, and no fake timers left pending.

### Task 9: Complete CLI Error and Alias Integration

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli/smoke.test.ts`
- Create: `tests/cli/error-handling.test.ts`

- [ ] **Step 1: Write failing integrated help and error tests**

Extend smoke tests to assert top-level help contains `36kr`, `toutiao`, and `hn|hackernews`, and excludes `ak`, `config`, `disk`, `video`, and `stephen`. Add error tests for:

```typescript
expect(JSON.parse(stderr)).toMatchObject({
  ok: false,
  error: { code: 'INVALID_ARGUMENT' }
});
```

Cover invalid Zod formats, missing Commander arguments, a known collector error, and an injected unexpected error rendered as `INTERNAL_ERROR` without a stack.

- [ ] **Step 2: Run integrated CLI tests and verify RED**

Run: `npm test -- tests/cli`

Expected: at least the normalized Commander or Zod error case FAILS.

- [ ] **Step 3: Centralize stable runner error handling**

Catch in this order:

```text
help/version Commander exits -> return 0
Kr36CommandError -> collector JSON and existing exit code
ToutiaoCommandError -> collector JSON and existing exit code
HackerNewsCommandError -> collector JSON and existing exit code
ZodError or Commander usage error -> INVALID_ARGUMENT JSON and exit code 2
unexpected error -> INTERNAL_ERROR JSON and exit code 1
```

Only include safe `message` and collector-provided details. Never print headers, response bodies, cookies, storage state, or stacks.

- [ ] **Step 4: Run all CLI tests and verify GREEN**

Run: `npm test -- tests/cli`

Expected: all CLI tests PASS and stderr is empty for successful commands.

### Task 10: Add English Project Documentation and License

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `tests/scaffolding/documentation.test.ts`

- [ ] **Step 1: Write failing documentation tests**

Assert README contains all of these exact strings:

```text
npm install -g ants-move
npx playwright install chromium
ants 36kr article
ants 36kr list
ants toutiao article
ants toutiao list
ants toutiao author
ants hn top
ants hn new
ants hn best
ants hn search
amv
hackernews
external bounded queue
shared rate limiter
```

Assert `LICENSE` begins with `MIT License` and contains `Copyright (c) 2026 Stephen`.

- [ ] **Step 2: Run documentation tests and verify RED**

Run: `npm test -- tests/scaffolding/documentation.test.ts`

Expected: FAIL because README and LICENSE do not exist.

- [ ] **Step 3: Write the English documentation**

Create README sections in this order:

```text
ants-move mission
Installation and requirements
Output conventions
36Kr commands
Toutiao commands and verification limitations
Hacker News commands and aliases
High-concurrency usage warning
Development and verification
License
```

Document Node 22+, curl, Chromium installation, JSON default output, `-t`, every compatible range, the 100-article `--with-content` cap, and the absence of global cross-process rate limiting. Use `ants` in primary examples and explain that `amv` is equivalent.

Use the MIT text from `../stephen-cli/LICENSE`, retaining the 2026 Stephen copyright line.

- [ ] **Step 4: Run documentation tests and verify GREEN**

Run: `npm test -- tests/scaffolding/documentation.test.ts`

Expected: all documentation tests PASS.

### Task 11: Full Verification and Packed-Install Smoke Test

**Files:**
- Modify only if verification exposes a defect in a file already in scope.
- Do not commit, publish, or push.

- [ ] **Step 1: Run static checks**

Run: `npm run check`

Expected: exit 0 with no TypeScript diagnostics.

- [ ] **Step 2: Run the deterministic test suite**

Run: `npm test`

Expected: all tests PASS; no live website is contacted.

- [ ] **Step 3: Run full coverage**

Run: `npm run coverage`

Expected: exit 0 and 100 percent statements, branches, functions, and lines for included production modules. Exclude only the guarded direct-entry process exit branch with a narrow V8 ignore comment if it cannot execute safely in-process.

- [ ] **Step 4: Build the package**

Run: `npm run build`

Expected: exit 0; `dist/index.js`, source map, and declarations exist; the first line of `dist/index.js` is `#!/usr/bin/env node`.

- [ ] **Step 5: Pack without publishing**

Run: `npm pack --json`

Expected: one `ants-move-0.1.0.tgz` containing package metadata and `dist/`, with no `src/`, `tests/`, coverage, or local runtime state.

- [ ] **Step 6: Install and execute both binaries under a temporary prefix**

Create a temporary directory with `mktemp -d`, install the explicit generated tarball using `npm install --prefix <temp-dir> <absolute-tarball-path>`, then run:

```bash
<temp-dir>/node_modules/.bin/ants --help
<temp-dir>/node_modules/.bin/amv --help
```

Expected: both exit 0, show `Usage: ants`, and list the same four visible command names/aliases.

- [ ] **Step 7: Perform the mandatory high-concurrency review**

Confirm from tests and code:

```text
36Kr: serial pagination, 20-page cap, curl timeouts, 20 MB buffer
Hacker News: 201-request maximum, concurrency 8, 5 MB bodies, settled workers
Toutiao: five-page cap, 100 content-detail cap, one browser, serial details, deadline, cleanup
No jobs, retries, cache keys, persistent rows, locks, or unbounded queues
No claim of multi-process dedupe or shared rate limiting
```

Expected: every statement is backed by a named passing test or a direct configuration assertion.

- [ ] **Step 8: Inspect the final worktree without changing Git history**

Run: `git status --short` and `git diff --check`

Expected: only intended uncommitted project files are present and no whitespace errors are reported. Do not run `git commit`, `git push`, or `npm publish`.
