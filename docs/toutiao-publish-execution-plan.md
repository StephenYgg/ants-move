# Toutiao Publish Execution Plan

**Date:** 2026-07-29  
**Status:** Implemented (2026-07-29) — live console selector tuning may still be needed  
**Depends on:** `docs/toutiao-publish-analysis-report.md`  
**Approach:** Scheme E (Playwright + storageState, default draft)

## Goal

Add Toutiao **auth** and **publish** commands to `ants-move` for:

- Graphic articles (图文)
- Micro-posts (微头条)

Default action is **save draft**. Formal publish requires explicit `--strategy publish`.

## Success Criteria (overall)

- [ ] `ants toutiao auth login` opens headed browser, QR login, writes `storageState` (mode 0600)
- [ ] `ants toutiao auth status` reports logged-in account or clear auth error
- [ ] `ants toutiao auth logout` removes local state file only
- [ ] `ants toutiao publish article` without `--strategy` saves **draft only**
- [ ] `ants toutiao publish micro` without `--strategy` saves **draft only**
- [ ] `--strategy publish` is required for live publication
- [ ] `--dry-run` never writes to the platform
- [ ] Existing collector commands remain behavior-compatible
- [ ] Unit/integration tests cover validation, strategy default, auth errors, and mocked publish paths
- [ ] README documents risk, default draft, and auth flow
- [ ] High-concurrency rules enforced: single item per invocation, state file lock, no publish retry

## Architecture Touchpoints

| Area | Action |
|------|--------|
| `src/toutiao/command.ts` | Register `auth` and `publish` subcommands |
| `src/toutiao/auth.ts` | New: login/status/logout + state path |
| `src/toutiao/publish-service.ts` | New: orchestration |
| `src/toutiao/publisher/*` | New: article / micro / upload / form-map |
| `src/toutiao/runtime.ts` | Add authed session entry (load storageState) |
| `src/toutiao/types.ts` | Publish/auth types + error codes |
| `src/toutiao/output.ts` | Auth/publish JSON renderers |
| `src/cli.ts` | Wire deps if needed (likely via existing toutiao registration) |
| `README.md` | Document new commands + warnings |
| `tests/toutiao/*`, `tests/cli/toutiao-*.test.ts` | New coverage |

## Stage 0: Console Discovery

**Goal:** Capture real creator-console behavior before hardcoding selectors/enums.  
**Status:** Not Started

### Tasks

1. Manual QR login to `mp.toutiao.com` with a throwaway or personal test account.
2. Record network + DOM for:
   - Login completion / session validation endpoint
   - Article editor: title, body, cover, keywords, category, claim, save draft, publish
   - Micro-post editor: content, images, topic, save draft, publish
   - Image upload request/response shape
3. Write discovery notes under `docs/toutiao-publish-discovery.md` (gitignored secrets only; no cookies).
4. Freeze v1 allow-lists for category/claim if present; otherwise keep free-string with runtime validation.

### Success Criteria

- [ ] Draft vs publish controls identified without ambiguity
- [ ] At least one stable session-check method documented
- [ ] Image upload approach documented (UI input vs XHR in page context)
- [ ] Content format expectation documented (HTML vs plain)

### Tests

- None (manual). Do not commit live credentials.

---

## Stage 1: Auth (QR → storageState)

**Goal:** Reliable local session lifecycle.  
**Status:** Not Started

### Tasks

1. Add `auth.ts` with:
   - `resolveStatePath(explicit?: string)` → default `~/.config/ants-move/toutiao/default.json`
   - `login({ statePath, timeoutMs })` headed Chromium, wait for creator home / media info, `context.storageState({ path })`, chmod 0600
   - `status({ statePath })` load state, open console, return account summary or `TOUTIAO_AUTH_EXPIRED`
   - `logout({ statePath })` unlink state file if present
2. Extend runtime with `withAuthedSession(statePath, operation)`:
   - Fail `TOUTIAO_AUTH_REQUIRED` if missing
   - Launch browser with `storageState`
   - Prefer headless for status; login always headed
3. CLI:
   ```bash
   ants toutiao auth login [--state <path>] [--timeout-ms <n>]
   ants toutiao auth status [--state <path>]
   ants toutiao auth logout [--state <path>]
   ```
4. Errors: `TOUTIAO_AUTH_*`, timeout, browser unavailable — JSON on stderr.
5. Never print cookie values.

### Success Criteria

- [ ] Login produces a state file and status returns account identity fields available from console
- [ ] Expired/deleted state yields structured auth errors
- [ ] Logout is idempotent (missing file = success or clear no-op success)

### Tests

- Unit: state path resolution, missing file → `AUTH_REQUIRED`
- Runtime mocked: status with invalid state → `AUTH_EXPIRED`
- CLI smoke: command registration and option validation

---

## Stage 2: Publish Article (default draft)

**Goal:** Create article drafts; optional explicit publish.  
**Status:** Not Started

### Tasks

1. Input validation (Zod):
   - title required
   - exactly one of `--content` / `--content-file`
   - content size bound (e.g. 1 MB text)
   - `--strategy` enum `draft | publish`, default `draft`
   - optional cover path exists and is image
   - keywords CSV parse
   - category/claim against discovery allow-list if available
2. `publish-service.publishArticle`:
   - acquire exclusive lock on state path
   - `withAuthedSession`
   - open article editor
   - fill fields
   - if `draft` → save draft only
   - if `publish` → explicit publish action only after form filled
   - return draft/publish ids + edit URL when available
3. `--dry-run`: validate + optional session check; no editor submit
4. `--headed` for debugging
5. Isolate volatile selectors in `publisher/form-map.ts` / `article.ts`

### Success Criteria

- [ ] Default strategy saves draft and does not publish
- [ ] `--strategy publish` performs publish path only when specified
- [ ] Dry-run makes no platform write
- [ ] Lock held prevents concurrent publish on same state

### Tests

- Default strategy is `draft` when omitted
- Reject missing title/content
- Reject both content sources or neither
- Mock publisher: draft vs publish call paths diverge
- Lock contention returns `TOUTIAO_LOCK_HELD`

---

## Stage 3: Publish Micro-post (default draft)

**Goal:** Create micro-post drafts; optional explicit publish.  
**Status:** Not Started

### Tasks

1. Zod input: content required, images optional list (max from discovery, fallback 9), topic optional, strategy default draft
2. `publish-service.publishMicro` with same lock + auth pattern as article
3. Upload images in order; fail clearly on partial upload
4. Draft vs publish click separation identical to article policy

### Success Criteria

- [ ] Default draft only
- [ ] Explicit publish only with `--strategy publish`
- [ ] Image limit enforced before browser work when possible

### Tests

- Validation: empty content, too many images, missing image files
- Mock draft vs publish paths
- Strategy default regression test shared with article

---

## Stage 4: Hardening, Docs, Regression

**Goal:** Ship-quality CLI surface.  
**Status:** Not Started

### Tasks

1. README section:
   - Auth QR flow
   - Publish commands
   - **Default draft** callout
   - Non-official / account risk disclaimer
   - No captcha bypass
2. Align error codes and exit codes with analysis report
3. Resource bounds: deadline, content bytes, image bytes
4. Ensure collector tests still pass unchanged
5. Optional: `--config <json>` if CLI flags become painful (only if Stage 2/3 feedback demands it)

### Success Criteria

- [ ] Full test suite green
- [ ] README accurate
- [ ] No secret leakage in fixtures
- [ ] Collectors unaffected

### Tests

- CLI help includes new commands
- Documentation scaffolding test if project has README contract tests
- Full `npm test` + `npm run check`

---

## Implementation Order (coding)

When user says **开始**:

1. Stage 0 discovery (or proceed with auth scaffolding if discovery already done offline)
2. Stage 1 auth end-to-end with mocks + manual login verification note
3. Stage 2 article draft/publish
4. Stage 3 micro draft/publish
5. Stage 4 docs + suite

Do **not** implement collector→publish pipeline in this plan.

## Testing Strategy

| Layer | Approach |
|-------|----------|
| Zod/command parsing | Pure unit tests |
| Auth path helpers | Temp dirs, fake fs |
| Publisher | Inject fake `PublishSession` (same DI style as existing ToutiaoRuntime mocks) |
| Runtime browser | Minimal mocked Playwright loader where possible; optional local manual checklist |
| CI | No live Toutiao network publish |

Follow existing patterns in `tests/cli/toutiao-command.test.ts` and `tests/toutiao/*.test.ts`.

## Risk Register

| Risk | Mitigation |
|------|------------|
| Console UI changes break selectors | Isolate in publisher modules; `TOUTIAO_UI_CHANGED`; Stage 0 notes |
| Session expires mid-run | Preflight status; clear `AUTH_EXPIRED` |
| Accidental live publish | Default draft; require `--strategy publish`; dry-run |
| Duplicate publish on retry | No automatic publish retry |
| Concurrent CLI | Exclusive lock on state file |
| ToS / account ban | README warning; rate limit by human invocation only |
| Open-source abuse optics | Default draft; no bypass tools; explicit publish flag |

## Commit Policy

- Do **not** create git commits unless the user explicitly asks in-session.
- After stages complete, suggest commit messages only.

## Suggested commit messages (for later user action)

```text
feat(toutiao): add QR auth with Playwright storageState

feat(toutiao): publish article drafts with explicit publish opt-in

feat(toutiao): publish micro-post drafts with explicit publish opt-in

docs(toutiao): document publish auth flow and draft-default safety
```

## Out of Scope Reminder

- Video
- Batch queues
- Schedule publish (v1)
- Captcha bypass
- Multi-platform sync
- Auto-publish from `36kr`/`hn` collectors

## Approval

Reply **开始** to execute this plan stage by stage.  
If Stage 0 discovery will be done by the user manually, say so and coding can start at Stage 1 with placeholder form-map filled after discovery notes land.
