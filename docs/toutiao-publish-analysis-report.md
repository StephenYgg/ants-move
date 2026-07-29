# Toutiao Publish Analysis Report

**Date:** 2026-07-29  
**Status:** Implemented (2026-07-29)  
**Project:** `ants-move` (open-source)

## Summary

`ants-move` currently has **read-only** Toutiao collectors (`article`, `list`, `author`). There is **no** official public API for ordinary creators to publish articles or micro-posts (微头条). Video-only open APIs do not cover this scope.

This report freezes the product and technical decisions for adding **write/publish** support via **Scheme E**: Playwright-backed creator-console automation with a one-time QR login that persists `storageState`, defaulting to **draft only** unless the user explicitly requests publish.

## Locked Decisions

| Decision | Choice |
|----------|--------|
| Approach | Scheme E — Playwright session + creator console flow (not raw reverse-engineered HTTP as the primary path) |
| Content types | Article (图文) + micro-post (微头条) only. No video in this effort. |
| Default strategy | **Draft**. Formal publish only when the user explicitly opts in. |
| Auth | One QR-code login (headed browser), persist Playwright `storageState` |
| Placement | Stay inside open-source `ants-move` under `ants toutiao ...` |

## Problem Statement

Users want CLI commands that:

1. Log into the Toutiao creator console once via QR scan.
2. Create an **article** with title, body, keywords, category, claim/declaration, cover, and publish strategy.
3. Create a **micro-post** with text, images, optional topic, and publish strategy.
4. **Never auto-publish** unless explicitly instructed.

## Constraints

### Platform

- No documented public publish API for articles / micro-posts for normal creator accounts.
- Creator console lives at `mp.toutiao.com` (UI and internal XHR both change over time).
- Automation may conflict with platform ToS; account risk is real. Documentation must state this clearly.
- Captcha / secondary verification may require human intervention; CLI must fail clearly, not bypass verification.

### Project

- Existing architecture: Commander + Zod + Service + Runtime + JSON envelope output.
- Toutiao collection already depends on Playwright Chromium.
- Historical non-goals included “no persistent configuration”. Publish **intentionally** introduces a narrow exception: **local auth state files only** (no DB, no cache, no background workers).
- Read collectors must remain anonymous and unchanged in behavior.

### Safety / concurrency

- One CLI invocation publishes **at most one** item (one article **or** one micro-post).
- No automatic retry of the final publish/save action (duplicate risk).
- Same `storageState` file must be single-flight across processes (file lock).
- Secrets (cookies / storageState) must never appear in stdout, stderr error details, logs, or git.

## Options Considered

| Option | Verdict |
|--------|---------|
| A. Official RSS / content source | Insufficient control over category, claim, strategy, micro-posts. Optional later side channel only. |
| B. Douyin open platform Toutiao publish | Video only — out of scope. |
| C. Cookie + reverse internal HTTP only | Fast but brittle; high maintenance; poor fit as primary path. |
| D. Pure DOM UI clicking | Aligns with Playwright stack but fragile alone. |
| **E. Hybrid (chosen)** | QR login + `storageState`; drive real creator console; prefer real browser context; default draft. |

## Recommended Architecture

Keep the existing module shape. Split **read** and **write** so collector code stays clean.

```text
src/toutiao/
  command.ts              # register auth + publish subcommands
  service.ts              # existing collectors (unchanged behavior)
  publish-service.ts      # write orchestration + validation
  auth.ts                 # login / status / logout + state path helpers
  runtime.ts              # withSession (anon) + withAuthedSession(state)
  publisher/
    article.ts            # article draft / explicit publish
    micro.ts              # micro-post draft / explicit publish
    upload.ts             # image upload helpers used by both
    form-map.ts           # category / claim UI mappings (volatile, isolated)
  types.ts                # shared types + error codes
  output.ts               # JSON envelopes for auth + publish results
```

### Session model

```text
Anonymous (existing collectors)
  createDefaultToutiaoRuntime().withSession(...)

Authenticated (publish)
  auth login (headed) → write storageState
  publish * → headless/headed browser with storageState
  auth status → validate session against creator console
  auth logout → delete local state file
```

Default state path (overridable with `--state`):

```text
~/.config/ants-move/toutiao/default.json
```

File mode `0600`. Path must be user-controlled and never committed by tooling.

### Command surface (target)

```bash
# Auth
ants toutiao auth login [--state <path>] [--timeout-ms <n>]
ants toutiao auth status [--state <path>]
ants toutiao auth logout [--state <path>]

# Article
ants toutiao publish article \
  --title <title> \
  --content-file <path> | --content <text> \
  [--cover <path>] \
  [--keywords <csv>] \
  [--category <name>] \
  [--claim <enum>] \
  [--strategy draft|publish] \
  [--state <path>] \
  [--dry-run] \
  [--headed]

# Micro-post
ants toutiao publish micro \
  --content <text> | --content-file <path> \
  [--images <path,path,...>] \
  [--topic <name>] \
  [--strategy draft|publish] \
  [--state <path>] \
  [--dry-run] \
  [--headed]
```

### Strategy semantics (critical)

| Value | Behavior |
|-------|----------|
| `draft` (**default**) | Save as draft only. Never click final “publish/online”. |
| `publish` | Explicit user opt-in to submit for publication. |

There is **no** implicit publish. Omitting `--strategy` always means draft.  
`--dry-run` validates args + auth + content rendering, performs no save/publish.

Scheduled publish (`schedule`) is **out of v1** unless Stage 0 proves the console exposes a stable, simple control. Prefer draft + manual schedule in console over half-baked timers.

### Parameter model (v1 intent)

Exact enums for category / claim must be filled from Stage 0 console discovery. Until then, treat them as **strings validated against a discovered allow-list** (or rejected with a clear error listing known values).

**Article**

| Field | Required | Notes |
|-------|----------|-------|
| title | yes | Bound length after discovery |
| content / content-file | yes (one of) | Markdown or plain/HTML; convert as needed after discovery |
| cover | no | Local image path |
| keywords | no | CSV → tags |
| category | no | Must match console options |
| claim | no | e.g. original / reprint / AI — **only real console options** |
| strategy | no | default `draft` |
| state | no | storageState path |
| dry-run | no | validate only |
| headed | no | show browser for debugging / verification |

**Micro-post**

| Field | Required | Notes |
|-------|----------|-------|
| content / content-file | yes (one of) | Text body; length bound after discovery |
| images | no | Local paths, max per console (often ≤9) |
| topic | no | If console supports topic/hashtag field |
| strategy | no | default `draft` |
| state / dry-run / headed | no | same as article |

### Success / error output

Keep project conventions:

- Success stdout: `{ "ok": true, "data": ... }`
- Failure stderr: `{ "ok": false, "error": { "code", "message", "details?" } }`
- Nonzero exit codes

Suggested success `data` fields:

```json
{
  "type": "article",
  "strategy": "draft",
  "status": "draft_saved",
  "title": "...",
  "draftId": "...",
  "editUrl": "https://mp.toutiao.com/...",
  "account": { "name": "...", "mediaId": "..." }
}
```

Suggested error codes:

| Code | Meaning | Exit |
|------|---------|------|
| `TOUTIAO_AUTH_REQUIRED` | No state file / not logged in | 2 |
| `TOUTIAO_AUTH_EXPIRED` | State present but session invalid | 2 |
| `TOUTIAO_AUTH_TIMEOUT` | QR login timed out | 1 |
| `TOUTIAO_INVALID_INPUT` | Bad args / missing content | 2 |
| `TOUTIAO_UPLOAD_FAILED` | Image upload failed | 1 |
| `TOUTIAO_UI_CHANGED` | Selectors / flow no longer match console | 1 |
| `TOUTIAO_PUBLISH_REJECTED` | Console rejected save/publish | 1 |
| `TOUTIAO_LOCK_HELD` | Another process holds state lock | 1 |
| `TOUTIAO_VERIFICATION_REQUIRED` | Captcha / human check needed | 1 |
| `TOUTIAO_BROWSER_UNAVAILABLE` | Playwright/Chromium missing | 2 |
| `TOUTIAO_TIMEOUT` | Operation deadline exceeded | 1 |

Reuse existing codes where meanings match (`TOUTIAO_BROWSER_UNAVAILABLE`, `TOUTIAO_TIMEOUT`, `TOUTIAO_VERIFICATION_REQUIRED`).

## High-Concurrency Review

| Check | Design |
|-------|--------|
| Hot-path fan-out | Forbidden. 1 invocation ≤ 1 write. |
| Race / TOCTOU | Auth status then publish can race; mitigate with exclusive lock on state file for the whole publish. |
| Lock contention | Local flock only; fail fast if held. |
| Single-flight | Per state path, not global machine mutex for unrelated accounts. |
| Retry | No auto-retry of save/publish. Upload may retry at most once only if idempotent and no draft created. |
| Stampede | N/A — user-triggered CLI. |
| Resource bounds | Bound content size, image count/size, browser deadline. |
| Multi-instance | Multiple processes with same state must serialize or fail. |

## Open Source / Docs Obligations

Because this stays in public `ants-move`:

1. README section: non-official automation, account risk, default draft, no verification bypass.
2. Help text in English (project convention); user conversation may be Chinese.
3. Do not ship sample cookies or real account state.
4. Tests must mock Playwright / publisher boundaries; no live publish in CI.

## Non-Goals (v1)

- Video publish
- Scheduled publish (unless Stage 0 proves trivial)
- Batch publish / queue workers
- Multi-account profile manager UI
- Bypassing captcha or risk control
- Official partner API integration
- Collect → auto-publish pipeline (can be a later stage after single publish is stable)
- Persistent app config DB beyond `storageState` files

## Stage 0 Discovery Requirement

Implementation of category, claim, selectors, and exact draft vs publish clicks **must not be invented**. Before coding publish flows, capture a live console session:

1. QR login and confirm `storageState` fields needed.
2. Create article draft with title, body, cover, keywords, category, claim.
3. Explicitly publish one article (manual, controlled).
4. Create micro-post draft with text + images.
5. Explicitly publish one micro-post.

Deliverable: a short discovery note listing real UI labels, stable selectors or network endpoints observed, and allow-lists for enums.

## Recommendation

Proceed with Scheme E inside `ants-move` as designed above:

1. Auth first (QR → `storageState`).
2. Article draft.
3. Micro-post draft.
4. Explicit `--strategy publish` for both.
5. Optional later: richer metadata, collector-to-draft pipeline.

## Approval Gate

Coding starts only after explicit user approval (e.g. “开始”).  
This document + the execution plan are the pre-code artifacts.
