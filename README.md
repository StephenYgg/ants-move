# ants-move

`ants-move` is an open-source TypeScript CLI for moving data between systems. Its commands are small workers: collectors bring data in, and automation commands can move data into creator consoles and other systems. The current collectors read 36Kr, Toutiao, Hacker News, and GitHub data. Toutiao also supports creator-console auth and draft/publish commands for articles and micro-posts.

## Installation and requirements

Requirements:

- Node.js 22 or later
- npm
- `curl` on `PATH` for 36Kr collection
- Chromium installed through Playwright for Toutiao collection

Install the package globally, then install the browser used by Toutiao:

```bash
npm install -g ants-move
npx playwright@1.59.1 install chromium
```

The package installs two equivalent executables: `ants` and the short alias `amv`.

## Output conventions

Commands write successful results to stdout and structured errors to stderr. JSON is the default format. List and search commands accept `--format table` or the `-t` shortcut for table output. Article detail commands support JSON only.

Successful JSON uses an `{ "ok": true, "data": ... }` envelope. Errors use an `{ "ok": false, "error": ... }` envelope and return a nonzero exit code.

## 36Kr commands

Fetch an article by numeric ID:

```bash
ants 36kr article <article-id> [--format json]
```

Fetch one to 20 information pages from the `AI` or `technology` channel:

```bash
ants 36kr list <AI|technology> [--pages 1..20] [--format json|table] [-t]
```

Pagination is serial and bounded at 20 pages per invocation. Each curl response and mapped article result is limited to 20 MB, each list page to 30 items, and the mapped list to 5 MB, so a list retains at most 600 items without accumulating oversized fields across pages.

## Toutiao commands and verification limitations

Fetch an article by numeric ID or a Toutiao article, group, or legacy URL:

```bash
ants toutiao article <article-id-or-url> [--format json]
```

Fetch one to five pages from the technology channel or a supported search keyword:

```bash
ants toutiao list <tech|AI|光刻机|芯片|半导体> [--pages 1..5] [--format json|table] [-t]
```

Fetch an author feed by token or `/c/user/token/<token>/` profile URL:

```bash
ants toutiao author <token-or-url> [--pages 1..5] [--with-content] [--format json|table] [-t]
```

Feed collection keeps at most the requested number of response parses active, starts at most twice that many bounded parse attempts to replace malformed responses, and accepts at most five successful responses. Each feed body is limited to 5 MB before JSON parsing and 100 raw items after parsing.

Article extraction limits title, body, and paragraph text to 1 MB each. Search fallback inspection serializes at most 300 bounded links and rejects body text larger than 1 MB. `--with-content` fetches article details serially in the same browser session, accepts at most 100 unique articles, and retains at most 10 MB of article results per invocation. Toutiao can require interactive browser verification; when verification prevents usable search results, the command returns `TOUTIAO_VERIFICATION_REQUIRED`. The CLI does not attempt to bypass site verification.

### Toutiao creator auth and publish

These commands drive the unofficial creator console at `mp.toutiao.com` with Playwright. They are not an official Toutiao API. Account rate limits, verification challenges, and policy enforcement still apply. Use a test account first. The CLI never bypasses captchas or risk controls.

Login once with a headed browser and QR scan. The session is stored as a Playwright `storageState` file (mode `0600`) at `~/.config/ants-move/toutiao/default.json` unless `--state` overrides the path.

Auth and publish default to your **installed system browser** (`--browser chrome`), not Playwright's Chromium for Testing. Supported channels:

- `chrome` (default): Google Chrome installed on the machine
- `msedge`: Microsoft Edge
- `chromium`: Playwright-managed Chromium for Testing

You can also set `ANTS_TOUTIAO_BROWSER=chrome|msedge|chromium`.

```bash
ants toutiao auth login [--browser chrome|msedge|chromium] [--state <path>] [--timeout-ms <ms>]
ants toutiao auth status [--browser chrome|msedge|chromium] [--state <path>]
ants toutiao auth logout [--state <path>]
```

Create content as a **draft by default**. Live publication requires an explicit `--strategy publish`. Omitting `--strategy` always means draft. `--dry-run` validates inputs and the presence of auth state without writing to the console:

```bash
ants toutiao publish article \
  --title <title> \
  --content <text> | --content-file <path> \
  [--cover <path>] \
  [--keywords <csv>] \
  [--category <name>] \
  [--claim <name>] \
  [--strategy draft|publish] \
  [--browser chrome|msedge|chromium] \
  [--state <path>] \
  [--dry-run] \
  [--headed]

ants toutiao publish micro \
  --content <text> | --content-file <path> \
  [--images <path,path,...>] \
  [--topic <name>] \
  [--strategy draft|publish] \
  [--browser chrome|msedge|chromium] \
  [--state <path>] \
  [--dry-run] \
  [--headed]
```

Publish bounds: one article or one micro-post per invocation, body text at most 1 MB, article titles 2–30 characters, at most nine micro-post images, each image at most 10 MB. The same auth state file is single-flight across processes via a lock file; concurrent holders receive `TOUTIAO_LOCK_HELD`. Save/publish is not automatically retried.

### Real managed browser profile (recommended for interactive auth/publish)

To drive a **real Chrome/Edge** with a **dedicated automation profile** (not your daily Chrome profile), start a debuggable browser once:

```bash
ants toutiao browser start [--browser chrome|msedge] [--port 9222] [--profile <path>]
ants toutiao browser status
ants toutiao browser stop
```

Defaults:

- Profile: `~/.config/ants-move/toutiao/chrome-profile`
- CDP: `http://127.0.0.1:9222`
- Meta: `~/.config/ants-move/toutiao/browser.json`

Then login / publish against that real browser via CDP:

```bash
# In the managed Chrome window, scan QR if needed
ants toutiao auth login --cdp http://127.0.0.1:9222

# Later publishes can use the same CDP endpoint (or omit --cdp if browser start is still running)
ants toutiao publish article --title "标题2到30字" --content "正文" --cdp http://127.0.0.1:9222
```

If `ants toutiao browser start` is already running, auth/publish **auto-detect** its CDP URL when `--cdp` is omitted.

This is Playwright `connectOverCDP` against a real installed Chrome/Edge process. It does **not** reuse your personal daily Chrome profile under `~/Library/Application Support/Google/Chrome`.

## Hacker News commands and aliases

Fetch one to 100 stories from each Firebase list:

```bash
ants hn top [--limit 1..100] [--format json|table] [-t]
ants hn new [--limit 1..100] [--format json|table] [-t]
ants hn best [--limit 1..100] [--format json|table] [-t]
```

Search through Algolia, ordered by relevance or date:

```bash
ants hn search <query> [--limit 1..100] [--sort relevance|date] [--format json|table] [-t]
```

`hackernews` is an alias for `hn`, so `ants hackernews top` is equivalent to `ants hn top`. The `amv` executable accepts every command shown above, for example `amv hackernews search typescript`.

Hacker News uses at most eight concurrent detail requests. ID-list and search responses are limited to 5 MB, while each Firebase story detail is limited to 256 KB.

## GitHub commands

### GitHub Trending

Fetch every repository shown on GitHub's all-language Trending page. The period defaults to `daily`:

```bash
ants github trending
ants github trending --since daily
ants github trending --since weekly
ants github trending --since monthly
```

JSON is the default output. Use `--format table` or `-t` for a terminal table:

```bash
ants github trending --since weekly --format table
ants github trending --since monthly -t
```

The collector reads the official server-rendered HTML with one GitHub request and does not use a third-party Trending API or Playwright. The request has a 30-second timeout and a 5 MB HTML limit. Parsing accepts at most 100 repositories and retains at most ten displayed contributors per repository. The command has no language filter, result limit, automatic retry, or cache; a successful zero-row parse is rejected as a page-structure error instead of returning a misleading empty ranking.

### GitHub README

Fetch the preferred README from the default branch of a public repository:

```bash
ants github readme https://github.com/owner/repository
ants github readme https://github.com/owner/repository.git
```

The command returns JSON containing the raw UTF-8 README content together with its name, path, SHA, byte size, HTML URL, download URL, canonical repository URL, and API source URL. It uses the documented `api.github.com/repos/{owner}/{repo}/readme` endpoint and performs one bounded GitHub API request with a 30-second timeout and a 5 MB response limit. It does not scrape repository pages, probe Raw URLs, retry, or fall back to another request. It does not read `GITHUB_TOKEN`.

Only public repositories are supported. GitHub normally limits unauthenticated REST clients sharing one source IP to 60 requests per hour. When that allowance is exhausted, the command returns `GITHUB_RATE_LIMITED` without retrying.

## High-concurrency usage warning

Resource use is bounded within one process, but identical commands running in separate processes are not globally deduplicated or rate limited. At `Q` concurrent invocations, upstream work can approach `20Q` requests for a 36Kr list, `201Q` requests for a Hacker News list, `105Q` browser navigations plus page subresources for a Toutiao author collection, or `Q` requests for either GitHub Trending or GitHub README. README collection also briefly retains a bounded API response, parsed JSON, Base64 text, and decoded content; anonymous callers sharing a source IP normally share GitHub's 60 requests per hour limit, and rate-limit failures do not retry or fall back.

Retained collector data is also bounded per invocation: 5 MB for a 36Kr list, approximately 50 MB across 200 Hacker News candidate details before result filtering, 10 MB for Toutiao author article results, and one 5 MB GitHub HTML response before Cheerio parsing. Toutiao may additionally hold up to five active 5 MB feed buffers inside one browser session; browser process overhead, required page subresources, and HTML parser object overhead are separate from these payload limits.

Do not place the CLI directly on a high-QPS request path. Online services must use an external bounded queue and a shared rate limiter to apply backpressure across processes and instances. This project has no distributed lock, shared cache, retry queue, or multi-instance single-flight mechanism.

## Development and verification

Install dependencies and run the deterministic checks:

```bash
npm install
npm run check
npm test
npm run coverage
npm run build
npm pack --json
```

Tests use injected network and browser boundaries and do not contact live websites.

## License

Licensed under the [MIT License](LICENSE).
