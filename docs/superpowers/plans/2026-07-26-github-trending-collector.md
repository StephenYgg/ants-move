# GitHub Trending Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded all-language GitHub Trending HTML collector with daily, weekly, and monthly JSON/table output.

**Architecture:** Register a new static `github` command module following the existing command/service/runtime/output/type boundaries. Use one injected Node.js Fetch request for bounded HTML, parse it through a private pure Cheerio parser, and preserve GitHub page order in a stable result contract.

**Tech Stack:** TypeScript ESM, Node.js 22 Fetch, Cheerio 1.2.0, Commander, Zod, Vitest, tsup

**Git Constraint:** Leave all work uncommitted. Do not create commits, tags, pushes, PRs, or releases.

---

## File Map

**Create:**

- `src/github/types.ts`: periods, result values, and structured collector error.
- `src/github/service.ts`: period validation and result metadata.
- `src/github/parser.ts`: pure bounded Cheerio HTML parser.
- `src/github/runtime.ts`: one bounded Fetch request and parser integration.
- `src/github/output.ts`: JSON, table, and error rendering.
- `src/github/command.ts`: Commander registration and table shortcut.
- `tests/github/service.test.ts`: period validation and metadata tests.
- `tests/github/parser.test.ts`: deterministic HTML parsing and bounds.
- `tests/github/runtime.test.ts`: Fetch URL, headers, timeout, size, and error tests.
- `tests/github/output.test.ts`: JSON/table/error rendering tests.
- `tests/cli/github-command.test.ts`: CLI defaults, periods, formats, and known errors.

**Modify:**

- `src/cli.ts`: inject and register the GitHub runtime and error handler.
- `package.json`: add exact `cheerio` production dependency.
- `package-lock.json`: synchronize the dependency graph.
- `tests/cli/smoke.test.ts`: require GitHub in root help.
- `tests/scaffolding/documentation.test.ts`: require GitHub commands and resource warning.
- `README.md`: document GitHub Trending commands and concurrency bounds.

---

### Task 1: Domain Contract And Service

**Files:**
- Create: `tests/github/service.test.ts`
- Create: `src/github/types.ts`
- Create: `src/github/service.ts`

- [ ] **Step 1: Write failing service tests**

Test a runtime stub with `fetchTrending({ period })`. Assert that omitted period becomes `daily`, all three supported periods pass through, `meta.totalItems` is added, and an unsupported period rejects with `GITHUB_INVALID_PERIOD` before the runtime is called.

Use this domain shape:

```typescript
export type GitHubTrendingPeriod = 'daily' | 'weekly' | 'monthly';

export interface GitHubTrendingContributor {
  avatarUrl: string;
  url: string;
  username: string;
}

export interface GitHubTrendingRepository {
  builtBy?: GitHubTrendingContributor[];
  description?: string;
  forks: number;
  fullName: string;
  language?: string;
  name: string;
  owner: string;
  rank: number;
  stars: number;
  starsInPeriod: number;
  url: string;
}

export interface GitHubTrendingRuntimeResult {
  items: GitHubTrendingRepository[];
  period: GitHubTrendingPeriod;
  sourceUrl: string;
}

export interface GitHubRuntime {
  fetchTrending: (options: {
    period: GitHubTrendingPeriod;
  }) => Promise<GitHubTrendingRuntimeResult>;
}

export interface GitHubTrendingResult extends GitHubTrendingRuntimeResult {
  meta: { totalItems: number };
}
```

- [ ] **Step 2: Run the service test and verify RED**

Run:

```bash
npm test -- tests/github/service.test.ts
```

Expected: FAIL because the GitHub files do not exist.

- [ ] **Step 3: Implement the domain contract and minimal service**

Define `GitHubCommandError` with `code`, `exitCode`, and optional `details`. Implement:

```typescript
export class GitHubService {
  constructor(private readonly dependencies: { runtime: GitHubRuntime }) {}

  async trending(options: { period?: string }): Promise<GitHubTrendingResult> {
    const period = parsePeriod(options.period);
    const result = await this.dependencies.runtime.fetchTrending({ period });
    return { ...result, meta: { totalItems: result.items.length } };
  }
}
```

`parsePeriod` defaults to `daily`, accepts only the three specified values, and otherwise throws `GITHUB_INVALID_PERIOD` with exit code `2` and supported periods in details.

- [ ] **Step 4: Run the service test and verify GREEN**

Run the focused test and require all cases to pass.

---

### Task 2: Pure Cheerio Parser

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/github/parser.test.ts`
- Create: `src/github/parser.ts`

- [ ] **Step 1: Add the exact parser dependency**

Create an isolated npm cache, then install the exact dependency:

```bash
github_npm_cache=$(mktemp -d /tmp/ants-move-github-npm.XXXXXX)
npm install --save-exact cheerio@1.2.0 --cache "$github_npm_cache"
/usr/bin/trash "$github_npm_cache"
```

Expected: `package.json` and `package-lock.json` add Cheerio without changing the package version.

- [ ] **Step 2: Write failing parser tests**

Use small inline HTML containing `article.Box-row` elements shaped like the current GitHub page. Cover:

- two complete repositories with page order, comma-grouped numbers, period stars, and contributors;
- one sparse repository with no description, language, or contributors;
- whitespace normalization;
- malformed non-repository links skipped;
- zero usable rows returning `GITHUB_PARSE_FAILED`;
- 101 usable rows returning `GITHUB_PARSE_FAILED` with `maxItems: 100`;
- 12 contributor links retaining the first 10 valid contributors; and
- malformed numeric text becoming `0` only when GitHub displays no parseable count.

Call this interface:

```typescript
parseGitHubTrendingHtml(html, {
  maxBuiltBy: 10,
  maxItems: 100,
  period: 'daily',
  sourceUrl: 'https://github.com/trending?since=daily'
});
```

- [ ] **Step 3: Run parser tests and verify RED**

Run the parser test and expect a missing-module failure.

- [ ] **Step 4: Implement the pure parser**

Load HTML with Cheerio. For each `article.Box-row`, find the repository heading link, normalize its path, require exactly two non-empty segments, and build the canonical URL. Extract counts by matching the repository links ending in `/stargazers` and `/forks`, and match the period text containing `stars today`, `stars this week`, or `stars this month`.

Normalize text with whitespace collapse. Parse counts by removing commas and non-digit grouping characters. Extract `builtBy` from the `Built by` container, accept only one-segment GitHub user paths, require a non-empty image source, and stop after ten accepted values.

Reject more than 100 usable rows before returning. Reject zero usable rows. Assign ranks only after malformed rows have been filtered so ranks remain contiguous.

- [ ] **Step 5: Run parser tests and verify GREEN**

Require every parser case to pass.

---

### Task 3: Bounded Fetch Runtime

**Files:**
- Create: `tests/github/runtime.test.ts`
- Create: `src/github/runtime.ts`

- [ ] **Step 1: Write failing runtime tests**

Cover exact URLs for daily, weekly, and monthly, the HTML accept header, an `ants-move` user agent, and exactly one Fetch call. Add cases for:

- successful streamed HTML parsing;
- Fetch rejection and abort mapped to `GITHUB_FETCH_FAILED`;
- HTTP 503 mapped to `GITHUB_FETCH_FAILED` while canceling the body;
- declared content length above 5 MiB;
- a stream crossing the 5 MiB bound;
- missing response body becoming `GITHUB_PARSE_FAILED`;
- failed body cancellation preserving the primary Fetch or size error; and
- injected small timeout and response-size limits for deterministic tests.

Use this factory contract:

```typescript
export interface GitHubRuntimeOptions {
  fetch?: typeof fetch;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
}

export function createDefaultGitHubRuntime(
  options: GitHubRuntimeOptions = {}
): GitHubRuntime;
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run the focused runtime test and expect the runtime module to be missing.

- [ ] **Step 3: Implement one bounded request**

Build the URL with `URL` and `searchParams.set('since', period)`. Start an `AbortController`, clear its timer in `finally`, and call injected Fetch once. Reject non-success status after settling body cancellation. Read `content-length` first, then stream chunks while tracking total bytes; cancel and throw `GITHUB_RESPONSE_TOO_LARGE` when the maximum is exceeded.

Decode the bounded body and delegate to `parseGitHubTrendingHtml` with `maxItems: 100` and `maxBuiltBy: 10`. Never retry.

- [ ] **Step 4: Run runtime tests and verify GREEN**

Require every runtime and cleanup case to pass.

---

### Task 4: Renderers

**Files:**
- Create: `tests/github/output.test.ts`
- Create: `src/github/output.ts`

- [ ] **Step 1: Write failing renderer tests**

Assert the JSON renderer produces `{ ok: true, data: result }` exactly. Assert the table headers are `rank`, `repository`, `language`, `stars`, `forks`, `period stars`, `description`, and `url`, optional fields render as empty strings, and terminal control characters are removed by `renderSafeTable`. Assert the error renderer emits the common `{ ok: false, error: { code, message, details? } }` shape.

- [ ] **Step 2: Run output tests and verify RED**

Run the focused output test and expect the module to be missing.

- [ ] **Step 3: Implement minimal pure renderers**

Implement:

```typescript
renderGitHubTrendingAsJson(result)
renderGitHubTrendingAsTable(result)
renderGitHubCommandErrorAsJson(code, message, details?)
```

Use `renderSafeTable` for table output and do not include `builtBy` in table rows.

- [ ] **Step 4: Run output tests and verify GREEN**

Require all output tests to pass.

---

### Task 5: Command And Root CLI Integration

**Files:**
- Create: `tests/cli/github-command.test.ts`
- Create: `src/github/command.ts`
- Modify: `src/cli.ts`
- Modify: `tests/cli/smoke.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Inject a GitHub runtime and assert:

- `github trending` requests `{ period: 'daily' }` by default;
- each explicit period reaches the runtime;
- JSON is the default;
- `--format table` and `-t` produce non-JSON table output;
- unsupported periods return `GITHUB_INVALID_PERIOD`, exit `2`, and never call the runtime;
- known GitHub runtime errors retain their code and exit status; and
- root help contains `github`.

- [ ] **Step 2: Run CLI tests and verify RED**

Run the GitHub command and smoke tests. Expected: FAIL because `CreateCliOptions` has no GitHub runtime and the command is absent.

- [ ] **Step 3: Implement command registration**

Register:

```typescript
program.command('github')
  .description('Fetch GitHub Trending repositories.')
  .command('trending')
  .option('--since <period>', 'trending period: daily, weekly, or monthly', 'daily')
  .option('--format <format>', 'output format', 'json')
  .option('-t, --table', 'render as a table')
```

Validate only the format enum in the command schema, let the service own period validation, call the service, and render the selected format. Add `handleGitHubCommandError` following the established collector pattern.

Extend `CreateCliOptions` with `githubRuntime?: GitHubRuntime`, create the default runtime, register the command, and invoke the GitHub error handler before generic Zod/Commander handling.

- [ ] **Step 4: Run CLI and smoke tests and verify GREEN**

Require focused tests to pass.

---

### Task 6: Documentation And Release Verification

**Files:**
- Modify: `README.md`
- Modify: `tests/scaffolding/documentation.test.ts`

- [ ] **Step 1: Write failing documentation expectations**

Require README text for:

```text
ants github trending
--since daily
--since weekly
--since monthly
one GitHub request
5 MB
```

- [ ] **Step 2: Run documentation tests and verify RED**

Expected: FAIL until README is updated.

- [ ] **Step 3: Update the English README**

Add GitHub to the summary, document all command variants and JSON/table behavior, state that the command uses the all-language official HTML page, and document the one-request, 30-second, 5 MiB, 100-repository, and ten-contributor bounds. Update the high-concurrency calculation so `Q` concurrent GitHub invocations add at most `Q` upstream requests and require the existing external queue/shared limiter for high-QPS use.

- [ ] **Step 4: Run focused documentation tests and verify GREEN**

Require the scaffolding tests to pass.

- [ ] **Step 5: Run the complete deterministic gate**

Run each command and require exit code `0`:

```bash
npm run check
npm test
npm run coverage
npm run build
```

Expected: all tests pass and statements, branches, functions, and lines remain at 100 percent.

- [ ] **Step 6: Inspect the package artifact**

Run:

```bash
npm pack --json
```

Require one `ants-move@0.0.1` tarball, the same six package files as the current release shape, executable mode `0755` for `dist/index.js`, and the Node shebang. Install the exact tarball under a temporary prefix with an isolated npm cache, run `ants --help`, `amv --help`, and `ants github trending --help`, then move the tarball and temporary prefix to Trash.

- [ ] **Step 7: Run an optional bounded live smoke check**

If GitHub is reachable, run:

```bash
node dist/index.js github trending --since daily
```

Require successful JSON with `period: "daily"` and at least one repository. Treat a site/network failure as a reported external limitation, not a deterministic test failure.

- [ ] **Step 8: Review concurrency and final Git state**

Confirm one request per invocation, no retries/background work/shared mutations, response and item bounds, and `Q`-to-`Q` multi-process request amplification. Run `git diff --check` and `git status --short --branch`. Leave every design, plan, dependency, source, test, and documentation change uncommitted on `dev`.
