# ants-move

`ants-move` is an open-source TypeScript CLI for moving data between systems. Its commands are small workers: collectors bring data in, and future automation commands can move that data into forms and other systems. The first release collects data from 36Kr, Toutiao, and Hacker News.

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

## High-concurrency usage warning

Resource use is bounded within one process, but identical commands running in separate processes are not globally deduplicated or rate limited. At `Q` concurrent invocations, upstream work can approach `20Q` requests for a 36Kr list, `201Q` requests for a Hacker News list, or `105Q` browser navigations plus page subresources for a Toutiao author collection.

Retained collector data is also bounded per invocation: 5 MB for a 36Kr list, approximately 50 MB across 200 Hacker News candidate details before result filtering, and 10 MB for Toutiao author article results. Toutiao may additionally hold up to five active 5 MB feed buffers inside one browser session; browser process overhead and required page subresources are separate from these payload limits.

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
