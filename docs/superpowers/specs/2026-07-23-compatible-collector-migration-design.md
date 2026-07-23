# Compatible Collector Migration Design

**Date:** 2026-07-23
**Status:** Approved

## Summary

`ants-move` will be an open-source TypeScript CLI for moving data between systems. The first release will migrate the existing 36Kr, Toutiao, and Hacker News collection behavior from `stephen-cli` into a focused standalone project.

The migration will preserve the existing command arguments, output schemas, error codes, and exit codes. The root executable changes from `stephen` to `ants`, with `amv` as a short alias. Hacker News keeps `hn` as its primary command and adds `hackernews` as an alias.

This release will use statically registered command modules. It will not include a plugin installation or discovery system.

## Goals

- Publishable npm package metadata for the unscoped package name `ants-move`.
- Install both `ants` and `amv` executables from the same compiled entrypoint.
- Preserve the documented 36Kr, Toutiao, and Hacker News behavior from `stephen-cli`.
- Keep JSON as the default machine-facing output and retain table output where it already exists.
- Keep command parsing, collection behavior, transport details, and rendering independently testable.
- Bound network and browser work performed by one CLI invocation.
- Use English for documentation, source comments, help text, errors, and other user-facing text.

## Non-Goals

- Migrating the `ak`, `config`, `disk`, or `video` commands from `stephen-cli`.
- Adding dynamically discovered plugins, third-party plugin installation, or a plugin SDK.
- Adding persistent configuration, a database, a cache, background workers, retries, or scheduled collection.
- Publishing the package to npm as part of this implementation.
- Creating Git commits without a separate explicit user request.
- Guaranteeing global rate limiting across independent CLI processes or machines.

## User-Facing Interface

### Package and Executables

The package will declare one compiled entrypoint under two executable names:

```json
{
  "name": "ants-move",
  "bin": {
    "ants": "dist/index.js",
    "amv": "dist/index.js"
  }
}
```

Both executables expose the same commands and output. The package requires Node.js 22 or newer.

### Command Compatibility

The following command families will be migrated:

```text
ants 36kr article <articleId> [--format json]
ants 36kr list <AI|technology> [--pages 1..20] [--format json|table] [-t]

ants toutiao article <article-id-or-url> [--format json]
ants toutiao list <tech|AI|光刻机|芯片|半导体> [--pages 1..5] [--format json|table] [-t]
ants toutiao author <token-or-url> [--pages 1..5] [--with-content] [--format json|table] [-t]

ants hn top [--limit 1..100] [--format json|table] [-t]
ants hn new [--limit 1..100] [--format json|table] [-t]
ants hn best [--limit 1..100] [--format json|table] [-t]
ants hn search <query> [--sort relevance|date] [--limit 1..100] [--format json|table] [-t]
```

`ants hackernews` is an alias for `ants hn`. Every example also works through the `amv` executable.

Successful JSON, table output, structured error JSON, error codes, and exit codes will match the corresponding `stephen-cli` behavior. Root help text and request user-agent values will use the `ants-move` identity instead of `stephen-cli`.

## Architecture

The project will be a single npm package using TypeScript ESM. Commander will provide command parsing, Zod will validate command options, `table` will render human-readable lists, Vitest will run tests, and tsup will build the executable with a Node shebang.

The root CLI will statically register three collector modules. Static registration is deliberate: it keeps the first release predictable while preserving a clean module boundary for future collectors.

```text
src/
  index.ts
  cli.ts
  36kr/
    command.ts
    output.ts
    runtime.ts
    service.ts
    types.ts
  hn/
    command.ts
    output.ts
    runtime.ts
    service.ts
    types.ts
  toutiao/
    command.ts
    output.ts
    runtime.ts
    service.ts
    types.ts
```

Each collector follows the same ownership boundaries:

- `command.ts` declares CLI arguments and delegates to the service.
- `service.ts` validates domain inputs and coordinates collection operations.
- `runtime.ts` owns curl, Fetch, or Playwright integration.
- `output.ts` renders domain values without performing collection work.
- `types.ts` defines the module contract and structured command error.

`cli.ts` creates the Commander program, injects runtimes and output writers, registers modules, and converts known errors into stable exit codes. `index.ts` exports the testable CLI factory and runs it only when used as the main entrypoint.

Utilities used by only one collector remain private to that collector. A shared directory will be introduced only when two or more collector modules need the same stable behavior, and it will not become a framework or plugin abstraction.

## Data Flow

For every command, the flow is:

```text
argv -> Commander command -> Zod/domain validation -> service -> runtime -> service result -> renderer -> stdout
                                                        |
                                                        +-> known error -> JSON stderr + stable exit code
```

Validation happens before external work. Services receive injected runtime interfaces, so command and service tests do not require live websites. Renderers receive completed values and have no side effects.

### 36Kr

- Article collection builds the canonical 36Kr URL and executes one browser-like curl request.
- Information lists parse the first HTML page and then fetch later pages serially through the 36Kr pagination API.
- The page limit remains 1 to 20 and every HTML or API page is rejected if it contains more than the configured 30 items, enforcing at most 600 retained list items.
- Mapped article results have a 20 MB retention cap.
- Mapped information items have a 5 MB cumulative retention cap, checked before appending each page.
- curl retains the 20 MB response buffer limit and gains explicit connection and total request timeouts.

### Hacker News

- Search uses one Algolia request.
- Top, new, and best lists fetch one Firebase ID list and enough item details to return the requested number of valid stories.
- The runtime may inspect at most twice the requested limit, so `--limit 100` produces at most 201 upstream requests.
- Detail requests use an order-preserving concurrency pool with at most eight active requests. IDs are deduplicated before detail requests.
- ID-list and Algolia Fetch requests have a 5 MB JSON response limit. Each of the at most 200 retained Firebase detail candidates has a 256 KB response limit, bounding their aggregate payload near 50 MB before filtering.

### Toutiao

- Each command creates at most one Chromium browser, context, and active collection session.
- Article, list, author feed, and optional author article details reuse that session rather than launching a browser per article.
- List and author pagination remain limited to five requested pages.
- Feed response parsing acquires at most one active slot per requested page before asynchronous work starts. Malformed responses may be replaced, but total parse attempts remain limited to twice the requested page count.
- Each feed response body is limited to 5 MB before JSON parsing and 100 raw items before it can enter the retained result set.
- Feed items are deduplicated by article ID.
- Search fallback inspection serializes at most the first 300 anchors with bounded URL and text fields, and rejects body text larger than 1 MB.
- `author --with-content` accepts at most 100 unique feed items per invocation. If the feed exceeds that safety bound, the command fails before detail collection with a structured resource-limit error instead of returning silently incomplete data.
- Article extraction limits title, body, and paragraph text to 1 MB each. Author content collection measures complete article objects before retaining them and stops at a 10 MB cumulative cap.
- Article details are collected serially in the shared browser session. The browser and context close in `finally` paths on success and failure.
- Images, media, and fonts are blocked where they are not required for extraction, reducing page resource amplification without changing returned text data.
- Existing navigation timeouts remain explicit, and the overall command receives a deadline so unexpected page behavior cannot create unbounded foreground work.

## Error Handling

Known validation, request, browser availability, verification, and parsing failures remain structured command errors. They are rendered as JSON to stderr and return the existing exit code. Existing collector-specific codes remain unchanged for compatible cases.

Commander and Zod input failures are converted to the same stable machine-facing error shape instead of leaking a stack trace. Unexpected programming errors are not relabeled as source-site parsing failures; the CLI returns a generic internal error without printing secrets or full page bodies.

Resource and timeout errors include only actionable metadata such as the URL, source, requested page count, or limit. Raw headers, cookies, page HTML, and browser storage are never printed.

## High-Concurrency and Resource Review

The CLI performs pure upstream reads and has no persistent shared state. There are no jobs, events, database rows, cache keys, retry chains, or delayed work created per invocation.

| Command path | Maximum explicit upstream fan-out per invocation | Mitigation |
| --- | ---: | --- |
| 36Kr article | 1 request | curl timeouts and 20 MB buffer cap |
| 36Kr list | 20 requests | Serial pagination, 20 MB response cap, 30 items per page, 600 items and 5 MB retained total |
| Hacker News search | 1 request | Fetch timeout and 5 MB response cap |
| Hacker News story list | 201 requests | Limit 100, 2x candidate cap, dedupe, concurrency 8, 5 MB ID list and 256 KB per detail |
| Toutiao article | 1 browser navigation plus required page resources | One browser session, 1 MB extracted-text fields, blocked heavy assets, deadline |
| Toutiao list or author | 5 successful feed responses, at most 10 bounded parse attempts | Active parse slots, 5 MB body cap before parsing, 100 items per response, search fallback bounded to 300 anchors and 1 MB body text, dedupe, one browser session |
| Toutiao author with content | 5 successful feed responses plus 100 serial article navigations | Feed response bounds, 10 MB retained article cap, one browser session, serial details, deadline |

Cross-process race and TOCTOU risk is absent because these paths do not check and then mutate persistent shared state. Within one invocation, the Hacker News worker pool and Toutiao feed listener acquire bounded local work synchronously before asynchronous requests or parsing begin. Neither path holds a lock during unrelated work, and both settle already-started work before returning an error. No background promise is intentionally left running after command completion.

Identical requests from separate CLI processes are not globally deduplicated. At `Q` simultaneous invocations, upstream request volume can still approach `20Q` for a 36Kr list, `201Q` for a Hacker News list, or `105Q` plus browser subresources for a Toutiao author collection. The README will explicitly state that directly placing the CLI behind a high-QPS online API requires an external bounded queue and shared rate limiter. This project will not claim multi-instance coordination it does not provide.

Worst-case retained collector payload per invocation is bounded at 20 MB for a 36Kr article, 5 MB for a 36Kr list, about 50 MB for 200 Hacker News detail candidates, and 10 MB for Toutiao author article results. Toutiao feed parsing can additionally hold at most five active 5 MB response buffers. Browser process overhead and required document/script responses are separate, bounded operationally by a single session, blocked heavy resources, explicit navigation timeouts, and the overall command deadline.

There is no cache, so cache expiry and stampede behavior do not apply. Adding a cache later would require a separate design covering shared coordination, expiry jitter, and single-flight behavior.

## Testing Strategy

Development will follow test-first Red-Green-Refactor cycles for production behavior.

### Compatibility Tests

- Port service and CLI tests for all three collectors before porting their implementations.
- Update only the root CLI name and the intentional Hacker News alias expectations.
- Assert compatible JSON envelopes, field names, table columns, error codes, and exit codes.
- Cover `ants`, `amv`, `hn`, and `hackernews` entry paths.

### Unit and Fixture Tests

- Validate IDs, URLs, source names, page limits, result limits, and search queries.
- Parse fixed 36Kr HTML/API fixtures and fixed Toutiao response/DOM fixtures without live network access.
- Test Hacker News Firebase and Algolia mapping using deterministic response values.
- Test JSON and table renderers independently from runtimes.
- Inject stdout, stderr, Fetch, curl execution, and browser creation at their IO boundaries.

### Concurrency and Cleanup Tests

- Assert that Hacker News detail collection never exceeds eight active requests and preserves source ordering.
- Assert that duplicate Hacker News IDs and Toutiao article IDs do not create duplicate detail work.
- Assert that one Toutiao command creates one browser session, including `author --with-content`.
- Assert that browser cleanup runs after success, parsing failure, navigation failure, and deadline expiry.
- Assert that page, item, response-size, and request-time bounds reject or stop excess work predictably.

### Build and Package Tests

The release verification sequence is:

```bash
npm run check
npm test
npm run coverage
npm run build
npm pack
```

The packed tarball will be installed under a temporary npm prefix. Verification will execute both `ants --help` and `amv --help`, confirm that they resolve to the same CLI, and confirm that the built file contains a Node shebang.

Live-site smoke checks may be run manually when network and Playwright Chromium are available, but they will not make the deterministic test suite depend on third-party availability.

## Documentation and Distribution

The repository will use the MIT License with Stephen as the copyright holder. The README will cover:

- The data-moving mission and current collection scope.
- Node.js 22+, npm, curl, and Playwright Chromium requirements.
- Global installation through `npm install -g ants-move`.
- All 36Kr, Toutiao, and Hacker News commands using `ants`.
- The `amv` and `hackernews` aliases.
- JSON and table output conventions.
- External-site limitations and verification challenges.
- The warning about using an external queue and shared limiter for online high-QPS execution.
- Local development, test, coverage, build, and package verification commands.

The initial implementation will prepare publishable metadata but will not run `npm publish`.

## Acceptance Criteria

- `npm install` succeeds on Node.js 22+.
- `npm run check`, `npm test`, `npm run coverage`, and `npm run build` succeed.
- The packaged tarball installs working `ants` and `amv` executables.
- `ants --help` lists `36kr`, `toutiao`, `hn`, and `hackernews` without unrelated `stephen-cli` commands.
- All migrated commands retain their documented arguments, structured output, known errors, and exit behavior.
- Deterministic tests make no live requests.
- Hacker News detail request concurrency never exceeds eight.
- Toutiao uses at most one browser per command and always closes it.
- No command creates unbounded background work or persistent per-request resources.
- README and source comments are English-only.
- No npm publication or Git commit occurs without an explicit user request.
