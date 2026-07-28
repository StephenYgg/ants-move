# GitHub README Collector Design

**Date:** 2026-07-28
**Status:** Approved

## Summary

Add a `github readme` command that accepts a public GitHub repository URL and
returns the repository's preferred README from its default branch. The command
uses GitHub's documented REST endpoint, decodes the returned Base64 content,
and emits the raw README text together with stable file and repository metadata
inside the existing JSON success envelope.

The collector performs one bounded, unauthenticated request to
`GET /repos/{owner}/{repo}/readme`. It does not scrape repository pages, guess
Raw URLs, read a token, support private repositories, retry, or fall back to a
second request.

## Goals

- Fetch the preferred README for a public GitHub repository's default branch.
- Accept a repository URL while preventing user-controlled request targets.
- Return raw README content plus useful repository and file metadata.
- Use GitHub's documented README selection rules instead of assuming a filename
  such as `README.md`.
- Perform no more than one bounded upstream request per invocation.
- Return stable structured errors for invalid input, missing README files,
  anonymous rate limiting, transport failures, oversized responses, and invalid
  API responses.
- Keep URL parsing, network access, response parsing, and rendering independently
  testable.

## Non-Goals

- Accessing private repositories.
- Reading `GITHUB_TOKEN` or accepting another authentication mechanism.
- Selecting a branch, tag, commit, or README path.
- Accepting GitHub blob, tree, issue, pull request, or other non-root URLs.
- Rendering Markdown to HTML or returning terminal table output.
- Scraping GitHub repository HTML.
- Guessing `raw.githubusercontent.com` paths or probing multiple README names.
- Fetching the API response's `download_url`.
- Adding retries, fallback requests, caching, background refresh, scheduling, or
  cross-process request deduplication.
- Creating a Git commit, tag, or release as part of the implementation.

## Command Interface

The existing `github` command family gains one JSON-only detail command:

```text
ants github readme <repository-url>
```

Examples:

```bash
ants github readme https://github.com/owner/repository
ants github readme https://github.com/owner/repository.git
```

The `amv` executable exposes the identical command. The command does not add a
table shortcut, output-format option, branch option, token option, or retry
option.

## Repository URL Contract

Before parsing, the service rejects backslashes and control characters anywhere
in the raw input and inspects the raw URL path for encoded separators and
literal or percent-encoded dot segments. This prevents the platform URL parser
from silently normalizing a rejected authority or path into an accepted
repository root. It then parses the input with the platform URL parser before
any external work. A valid input must:

- use `https`;
- have the exact hostname `github.com`;
- contain no username, password, or non-default port;
- contain exactly two non-empty path segments, `owner` and `repository`, after
  removing a trailing slash;
- contain a valid GitHub owner without consecutive hyphens and a valid
  repository name; and
- contain no encoded slash, backslash, control character, literal or
  percent-encoded dot segment, or extra path such as `/tree/...` or `/blob/...`.

A conventional trailing `.git` suffix on the repository segment is removed.
Query parameters and fragments, including values copied from a repository page,
are ignored. The service emits a canonical repository URL without `.git`, query,
or fragment:

```text
https://github.com/{owner}/{repository}
```

Invalid input fails with `GITHUB_INVALID_REPOSITORY_URL` before the runtime is
called. The runtime never fetches the user-provided URL. It receives validated
`owner` and `repository` values and constructs the API URL from the fixed
`https://api.github.com` origin, preventing SSRF.

## Output Contract

Successful output uses the existing envelope:

```json
{
  "ok": true,
  "data": {
    "repository": "owner/repository",
    "repositoryUrl": "https://github.com/owner/repository",
    "sourceUrl": "https://api.github.com/repos/owner/repository/readme",
    "name": "README.md",
    "path": "README.md",
    "sha": "0123456789abcdef",
    "size": 1234,
    "htmlUrl": "https://github.com/owner/repository/blob/main/README.md",
    "downloadUrl": "https://raw.githubusercontent.com/owner/repository/main/README.md",
    "content": "# Repository\n"
  }
}
```

`repository`, `repositoryUrl`, and `sourceUrl` are derived from validated input.
`name`, `path`, `sha`, `size`, `htmlUrl`, `downloadUrl`, and `content` come from a
validated GitHub response. The actual preferred README may use another supported
name, extension, or location; the command reports GitHub's selected `name` and
`path` rather than claiming that every result is literally `README.md`.

`content` is decoded as strict UTF-8 from the API's Base64 content. The parser
requires the decoded byte count to equal the non-negative integer `size` in the
response. It does not return the transport encoding or the Base64 representation.

## Architecture

The feature extends the existing GitHub module boundaries:

```text
src/github/
  command.ts
  service.ts
  runtime.ts
  readme-parser.ts
  output.ts
  types.ts
```

- `command.ts` registers `github readme`, passes the URL to the service, and
  writes JSON to stdout.
- `service.ts` validates and canonicalizes the repository URL before invoking
  the runtime.
- `runtime.ts` constructs and performs the one bounded GitHub REST request.
- `readme-parser.ts` validates the bounded JSON response and maps it to the
  result contract without network or output side effects.
- `output.ts` renders the success value using the common JSON envelope.
- `types.ts` extends the injected GitHub runtime and defines README values.

The existing `GitHubCommandError` and GitHub command error renderer remain the
single known-error path for both Trending and README commands.

## Data Flow

```text
argv
  -> Commander `github readme` command
  -> service parses and canonicalizes the repository URL
  -> runtime builds https://api.github.com/repos/{owner}/{repo}/readme
  -> one bounded unauthenticated Fetch
  -> pure JSON/Base64 parser
  -> JSON success envelope
  -> stdout
```

Validation completes before Fetch begins. Tests inject the GitHub runtime or
Fetch boundary, so deterministic tests never contact GitHub.

## GitHub Request

The runtime sends one unauthenticated GET request with these headers:

```http
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
User-Agent: ants-move GitHub collector
```

The standard JSON media type is intentional. It returns both Base64 content and
file metadata in one response, matching the approach used by Octokit's
`repos.getReadme` consumers. The raw media type would return content without the
approved path and SHA metadata, while following `download_url` would require a
second request.

The request uses an `AbortController` with a 30-second deadline and reads the
body stream with a 5 MiB maximum. It checks both a valid declared content length
and streamed bytes. Rejected bodies are canceled when possible. Redirects are
rejected so one invocation cannot silently perform more than one HTTP request.

No authorization header is sent and no environment token is read. Consequently,
the command can access public resources only and is subject to GitHub's shared
anonymous REST limit, normally 60 requests per hour per source IP.

## Response Validation

The parser accepts only a JSON object containing the required README fields. It
requires:

- non-empty `name`, `path`, and `sha` strings;
- a non-negative safe integer `size`;
- an HTTPS `html_url` whose exact hostname is `github.com` and whose repository
  path matches the validated owner and repository;
- an HTTPS `download_url` whose exact hostname is `raw.githubusercontent.com` and
  whose repository path matches the validated owner and repository;
- `encoding` equal to `base64`; and
- a syntactically valid Base64 `content` string that decodes to exactly `size`
  bytes of valid UTF-8.

Malformed JSON, missing or invalid fields, unsupported encoding, invalid Base64,
size mismatch, or invalid UTF-8 becomes `GITHUB_PARSE_FAILED`. The response body,
decoded content, response headers, and stack trace are not included in errors.

## Error Contract

Known failures use the existing JSON error envelope on stderr and return exit
code `2`:

- `GITHUB_INVALID_REPOSITORY_URL`: input is not an accepted public GitHub
  repository root URL.
- `GITHUB_README_NOT_FOUND`: GitHub returns `404`. This deliberately does not
  distinguish a missing repository, a repository without a README, or a resource
  inaccessible without authentication.
- `GITHUB_RATE_LIMITED`: GitHub returns `403` and the rate-limit headers show no
  remaining core requests. Safe details may include `limit`, `remaining`,
  `resetAt`, and `sourceUrl`.
- `GITHUB_RESPONSE_TOO_LARGE`: the declared or streamed JSON body exceeds 5 MiB.
- `GITHUB_PARSE_FAILED`: the successful API body violates the response contract.
- `GITHUB_FETCH_FAILED`: Fetch rejects, times out, redirects, returns another
  non-success status, or fails while reading the response.

Unexpected programming errors continue through the root CLI's generic
`INTERNAL_ERROR` path with exit code `1`. Errors never include response bodies,
README content, credentials, cookies, complete response headers, or stack traces.

## Resource And High-Concurrency Review

One invocation performs at most one upstream request. It creates no jobs, events,
database rows, cache keys, locks, retries, delayed work, or persistent side
effects. There is no check-then-act mutation, critical section, single-winner
requirement, or background promise intentionally left running after completion.

The response is capped at 5 MiB before JSON parsing. Raw response bytes, the
parsed JSON string, Base64 text, and decoded UTF-8 content may coexist briefly,
so peak memory is a bounded multiple of the response limit rather than only the
README's reported size. The implementation must release references after mapping
the final result and must not retain results globally.

Independent CLI processes are not globally rate limited or deduplicated. At `Q`
simultaneous invocations, upstream work can reach `Q` GitHub API requests and
memory can reach a bounded multiple of `5 MiB * Q`. The anonymous 60-request
hourly limit may be exhausted quickly behind a shared NAT. The command returns a
rate-limit error without retry or fallback, so failure does not amplify traffic.

An online service must place the CLI behind an external bounded queue and shared
rate limiter. This feature does not claim multi-instance single-flight or cache
stampede protection because it has no cache. Adding caching or authenticated
access requires a separate design.

## Testing Strategy

Implementation follows Red-Green-Refactor cycles. All automated tests inject the
runtime or Fetch boundary and remain deterministic.

### Service And URL Tests

- Accept a canonical root URL, a trailing slash, a conventional `.git` suffix,
  query parameters, and fragments.
- Preserve valid owner and repository names while producing canonical URLs.
- Reject HTTP, other hosts, deceptive host suffixes, credentials, ports, missing
  segments, extra paths, encoded separators, dot segments, and malformed names.
- Reject invalid input before calling the runtime.

### Parser Tests

- Map all approved metadata and decode representative UTF-8 Base64 content.
- Support a preferred README whose name, extension, or path is not `README.md`.
- Reject malformed JSON, missing fields, unsafe sizes, unsupported encoding,
  malformed Base64, decoded-size mismatches, invalid UTF-8, and unsafe URLs.
- Do not expose response content in parse errors.

### Runtime Tests

- Request the exact API URL with the approved headers and no authorization.
- Perform exactly one Fetch call and reject redirects.
- Enforce the 30-second timeout and 5 MiB declared/streamed size limits.
- Cancel rejected bodies without replacing the primary error if cancellation
  fails.
- Map `404`, rate-limited `403`, other statuses, network errors, aborts, and body
  read failures to the approved errors.
- Parse rate-limit details defensively without trusting malformed headers.

### Command, Output, And Integration Tests

- Register `github readme` and expose it in command help.
- Render the exact JSON success envelope and a trailing newline.
- Preserve the existing GitHub JSON error envelope and exit codes.
- Verify root CLI runtime injection for both Trending and README methods.
- Update README command documentation and the high-concurrency warning.
- Keep live GitHub smoke checks manual and outside deterministic tests.

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

- `ants github readme https://github.com/owner/repository` returns GitHub's
  preferred README for the public repository's default branch.
- The result contains the approved canonical repository values, source URL, file
  metadata, and raw UTF-8 content.
- The command performs no more than one unauthenticated, bounded GitHub request.
- Invalid URLs fail before network access and cannot choose the request origin.
- The command does not read a token or access private repositories by design.
- Missing README files, anonymous rate limiting, oversized responses, invalid API
  bodies, and transport failures return stable structured errors.
- No automatic retry, page scraping, Raw URL probing, or download request occurs.
- Type checking, tests, 100 percent coverage, build, and package inspection pass.
- Documentation and source comments remain English-only.
- The high-concurrency review confirms one-request fan-out, bounded response
  memory, no background work, and no retry amplification.
- No Git commit is created without a separate explicit user request.
