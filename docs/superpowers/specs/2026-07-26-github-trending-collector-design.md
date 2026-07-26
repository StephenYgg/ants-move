# GitHub Trending Collector Design

**Date:** 2026-07-26
**Status:** Approved

## Summary

Add a `github trending` collector that reads the all-language GitHub Trending HTML page. The command supports daily, weekly, and monthly periods, defaults to daily, and returns every repository shown by GitHub. JSON remains the default output and table output remains available through the existing format conventions.

The collector will use Node.js Fetch for one bounded HTTP request and Cheerio for deterministic HTML parsing. It will not use Playwright, a third-party Trending API, language filtering, result limits, persistent caching, or automatic retries.

## Goals

- Collect the repositories shown on GitHub's all-language Trending page.
- Support `daily`, `weekly`, and `monthly` periods with `daily` as the default.
- Preserve page order as an explicit numeric rank.
- Return stable structured JSON for automation and a table for terminal use.
- Keep fetching, parsing, validation, and rendering independently testable.
- Bound network, parsing, and retained-result resources per invocation.
- Keep documentation, help text, errors, and code comments in English.

## Non-Goals

- Filtering by programming language or spoken language.
- Adding a `--limit` option or pagination.
- Reproducing GitHub's private Trending ranking algorithm.
- Using GitHub Search as a substitute for the Trending page.
- Using Playwright or requiring a browser for this collector.
- Depending on a hosted third-party Trending API.
- Adding cache persistence, background refresh, retries, scheduling, or cross-process deduplication.
- Creating a Git commit, tag, or release as part of this implementation.

## Command Interface

The root CLI will statically register one new command family:

```text
ants github trending [--since daily|weekly|monthly] [--format json|table] [-t]
```

Examples:

```bash
ants github trending
ants github trending --since daily
ants github trending --since weekly
ants github trending --since monthly
ants github trending --format table
ants github trending -t
```

`--since` is optional and defaults to `daily`. The collector always requests the all-language URL and does not expose a language argument. It returns every valid repository present in the bounded Trending page rather than applying a client-side result limit.

JSON is the default format. `--format table` and `-t` follow the same behavior as existing list commands. The `amv` executable exposes the identical command.

## Output Contract

Successful JSON uses the existing envelope:

```json
{
  "ok": true,
  "data": {
    "period": "daily",
    "sourceUrl": "https://github.com/trending?since=daily",
    "items": [
      {
        "rank": 1,
        "owner": "owner",
        "name": "repository",
        "fullName": "owner/repository",
        "url": "https://github.com/owner/repository",
        "description": "Repository description",
        "language": "TypeScript",
        "stars": 12000,
        "forks": 800,
        "starsInPeriod": 520,
        "builtBy": [
          {
            "username": "contributor",
            "url": "https://github.com/contributor",
            "avatarUrl": "https://avatars.githubusercontent.com/..."
          }
        ]
      }
    ],
    "meta": {
      "totalItems": 1
    }
  }
}
```

`description`, `language`, and `builtBy` are optional and are omitted when the page does not provide usable values. Missing values are not replaced with fabricated defaults. `stars`, `forks`, and `starsInPeriod` are non-negative integers. `builtBy` contains at most ten users per repository.

Table output contains these columns:

```text
rank | repository | language | stars | forks | period stars | description | url
```

Contributor details remain JSON-only because they do not fit a compact row-oriented table.

## Architecture

The collector follows the existing module boundaries and adds a private pure parser:

```text
src/github/
  command.ts
  service.ts
  runtime.ts
  parser.ts
  output.ts
  types.ts
```

- `command.ts` declares the Commander command, format options, and table shortcut.
- `service.ts` validates the period before external work and adds result metadata.
- `runtime.ts` performs the bounded Fetch request and delegates HTML mapping to the parser.
- `parser.ts` converts HTML into ordered domain values without network or output side effects.
- `output.ts` renders JSON, table output, and structured known errors.
- `types.ts` defines periods, repository values, results, and command errors.

`cli.ts` receives an optional injected GitHub runtime, creates the default runtime when none is provided, registers the command, and maps known GitHub errors to their stable exit codes.

## Data Flow

```text
argv
  -> Commander command
  -> service period validation
  -> runtime builds https://github.com/trending?since=<period>
  -> one bounded HTML Fetch
  -> Cheerio parser
  -> ordered repository values
  -> service metadata
  -> JSON or table renderer
  -> stdout
```

Validation completes before Fetch begins. Tests inject the runtime or Fetch boundary, so deterministic tests never contact GitHub.

## Fetching And Parsing

The runtime sends one GET request with an HTML accept header and an `ants-move` user agent. It uses an `AbortController` deadline and reads the response stream with an explicit byte limit. Non-success responses and rejected or aborted Fetch calls become structured collector errors. Response bodies are canceled when they are rejected before full consumption.

The parser loads the bounded HTML with Cheerio and inspects GitHub Trending repository rows. It:

- preserves DOM order and assigns one-based ranks;
- extracts and normalizes the repository path from its heading link;
- accepts only two-segment GitHub repository paths and emits canonical GitHub URLs;
- removes grouping separators before converting star and fork counts to integers;
- extracts the displayed current-period star count;
- normalizes optional description and language text;
- extracts at most ten valid `builtBy` user links and avatar URLs per repository;
- skips malformed rows that do not identify a valid repository; and
- rejects the page with `GITHUB_PARSE_FAILED` if no valid repositories remain.

Treating a zero-row parse as an error prevents an HTML layout change, authentication interstitial, or abuse page from silently becoming a successful empty Trending result.

## Error Contract

Known failures use the existing JSON error envelope on stderr and return exit code `2`:

- `GITHUB_INVALID_PERIOD`: the period is not `daily`, `weekly`, or `monthly`.
- `GITHUB_FETCH_FAILED`: Fetch rejects, times out, or returns a non-success HTTP status.
- `GITHUB_RESPONSE_TOO_LARGE`: the declared or streamed HTML exceeds the configured limit.
- `GITHUB_PARSE_FAILED`: the HTML cannot produce a valid Trending repository list.

Error details may include safe values such as the period, source URL, HTTP status, or response-size limit. They never include response HTML, cookies, authorization values, complete response headers, or stack traces. Unexpected programming errors continue through the root CLI's generic `INTERNAL_ERROR` path with exit code `1`.

## Resource And High-Concurrency Review

One invocation performs exactly one upstream GitHub request. The default request timeout is 30 seconds, the maximum HTML response is 5 MiB, the parser accepts at most 100 repositories, and each repository retains at most ten `builtBy` entries. There is no retry fan-out.

The collector performs a pure read and creates no jobs, events, database rows, cache keys, delayed work, or persistent side effects. It has no check-then-act mutation, lock, or single-winner requirement. No background promise is intentionally left running after completion.

Independent processes are not globally rate limited or deduplicated. At `Q` simultaneous invocations, upstream work can reach `Q` requests and retained HTML can reach approximately `5 MiB * Q`, excluding Cheerio object overhead. An online service must place the CLI behind an external bounded queue and shared rate limiter rather than invoking it directly on a high-QPS request path.

Because the collector has no cache, cache expiry and stampede behavior do not apply. Adding caching later requires a separate design for shared coordination, expiry jitter, and single-flight behavior.

## Testing Strategy

Implementation follows Red-Green-Refactor cycles. Deterministic tests use injected runtimes, injected Fetch, and a small representative English HTML fixture.

### Command And Service Tests

- Default to `daily` when `--since` is omitted.
- Accept `daily`, `weekly`, and `monthly`.
- Reject unsupported periods before invoking the runtime.
- Render JSON by default and table output through `--format table` and `-t`.
- Add `github` and `trending` to command help.
- Preserve the common success and error envelopes.

### Parser Tests

- Preserve page order and assign ranks.
- Extract complete rows and omit unavailable optional fields.
- Normalize whitespace and comma-grouped numeric counts.
- Extract current-period stars and bounded contributor values.
- Skip malformed and non-repository links.
- Reject an empty or structurally incompatible page.
- Reject more than 100 repository rows rather than silently truncating an unexpectedly large page.
- Retain at most ten `builtBy` values per repository.

### Runtime Tests

- Request the exact all-language URL for each period.
- Send expected request headers and perform exactly one Fetch call.
- Enforce timeout and response-size limits.
- Handle declared and streamed oversized bodies.
- Cancel rejected response bodies without replacing the primary error when cancellation fails.
- Map network and non-success HTTP responses without exposing body contents.

### Output And Integration Tests

- Verify the complete JSON schema and table columns.
- Sanitize terminal control characters through the shared table renderer.
- Verify root CLI runtime injection and known-error handling.
- Update README command and resource-bound documentation in English.
- Keep live-site smoke checks manual and outside the deterministic test suite.

The completion gate is:

```bash
npm run check
npm test
npm run coverage
npm run build
npm pack --json
```

Coverage remains 100 percent for statements, branches, functions, and lines.

## Acceptance Criteria

- `ants github trending` returns the all-language daily Trending page as JSON.
- `--since daily|weekly|monthly` selects the requested period and defaults to daily.
- `--format table` and `-t` render the agreed columns.
- The result contains all valid page entries without a user-facing limit option.
- Results preserve page rank and the approved JSON field contract.
- One invocation performs no more than one bounded GitHub request.
- Invalid periods, fetch failures, oversized responses, and incompatible HTML return stable structured errors.
- Tests do not contact live GitHub and cover all resource and parser boundaries.
- Type checking, tests, 100 percent coverage, build, and package inspection pass.
- Documentation and source comments are English-only.
- No Git commit is created without a separate explicit user request.
