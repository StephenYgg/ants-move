import type { Browser, Page, Response } from 'playwright';

import { searchViaApi } from './api-search.js';
import { launchXianyuBrowser, resolveXianyuBrowserChannel } from './browser-channel.js';
import {
  isMtopSuccess,
  isXianyuSearchApiUrl,
  mapSearchResponse,
  XIANYU_MAX_ITEMS_PER_PAGE
} from './parse.js';
import type { XianyuSearchFilterOptions } from './search-filters.js';
import {
  ensureStateDirectory,
  readStateFile,
  resolveXianyuStatePath,
  stateFileExists,
  writeStateFile
} from './state.js';
import {
  parseAndSanitizeStorageState,
  sanitizeStorageState
} from './storage-state.js';
import type {
  XianyuAuthStatusResult,
  XianyuBrowserChannel,
  XianyuSearchItem,
  XianyuSearchResult,
  XianyuSearchTransport
} from './types.js';
import { XianyuCommandError } from './types.js';

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SEARCH_TIMEOUT_MS = 45_000;
const MAX_SEARCH_PAGES = 5;
const MAX_RETAINED_BYTES = 5 * 1024 * 1024;

export interface XianyuRuntime {
  loginWithQr: (options: {
    browser: XianyuBrowserChannel;
    statePath: string;
    timeoutMs?: number;
  }) => Promise<XianyuAuthStatusResult>;
  getAuthStatus: (options: {
    browser: XianyuBrowserChannel;
    statePath: string;
    headed?: boolean;
  }) => Promise<XianyuAuthStatusResult>;
  search: (options: {
    browser: XianyuBrowserChannel;
    headed?: boolean;
    keyword: string;
    pages?: number;
    statePath: string;
    transport?: XianyuSearchTransport;
    filters?: Omit<XianyuSearchFilterOptions, 'keyword' | 'pageNumber' | 'rowsPerPage'>;
    brand?: string;
    brandVid?: string;
  }) => Promise<XianyuSearchResult>;
}

export function createDefaultXianyuRuntime(): XianyuRuntime {
  return {
    loginWithQr: async (options) => loginWithQr(options),
    getAuthStatus: async (options) => getAuthStatus(options),
    search: async (options) => {
      const transport = options.transport ?? 'api';
      const hasFilters = Boolean(options.filters && Object.keys(options.filters).length > 0);
      const hasBrand = Boolean(options.brand || options.brandVid);
      // Advanced filters / brand CPV are MTOP body fields; always use pure API.
      if (transport === 'api' || hasFilters || hasBrand) {
        return searchViaApi({
          keyword: options.keyword,
          statePath: options.statePath,
          ...(options.pages === undefined ? {} : { pages: options.pages }),
          ...(options.filters === undefined ? {} : { filters: options.filters }),
          ...(options.brand === undefined ? {} : { brand: options.brand }),
          ...(options.brandVid === undefined ? {} : { brandVid: options.brandVid })
        });
      }
      return searchKeywordBrowser(options);
    }
  };
}

async function loginWithQr(options: {
  browser: XianyuBrowserChannel;
  statePath: string;
  timeoutMs?: number;
}): Promise<XianyuAuthStatusResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const playwright = await import('playwright');
  const browser = await launchXianyuBrowser(playwright, {
    browser: options.browser,
    headless: false
  });

  try {
    const context = await browser.newContext({
      locale: 'zh-CN',
      viewport: { width: 1360, height: 900 }
    });
    const page = await context.newPage();
    await page.goto('https://www.goofish.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });
    await clickLoginIfPresent(page);
    await waitForLogin(page, timeoutMs);

    await ensureStateDirectory(options.statePath);
    const state = sanitizeStorageState(await context.storageState());
    await writeStateFile(options.statePath, JSON.stringify(state, null, 2));

    const account = await probeAccount(page).catch(() => undefined);
    return {
      loggedIn: true,
      statePath: options.statePath,
      ...(account ? { account } : {})
    };
  } catch (error) {
    throw toXianyuError(error, 'Xianyu login failed.');
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function getAuthStatus(options: {
  browser: XianyuBrowserChannel;
  statePath: string;
  headed?: boolean;
}): Promise<XianyuAuthStatusResult> {
  if (!(await stateFileExists(options.statePath))) {
    return { loggedIn: false, statePath: options.statePath };
  }

  const playwright = await import('playwright');
  let browser: Browser | undefined;
  try {
    browser = await launchXianyuBrowser(playwright, {
      browser: options.browser,
      headless: !(options.headed ?? false)
    });
    const storageState = parseAndSanitizeStorageState(await readStateFile(options.statePath));
    const context = await browser.newContext({
      locale: 'zh-CN',
      storageState
    });
    const page = await context.newPage();
    await page.goto('https://www.goofish.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });
    const account = await probeAccount(page);
    if (!account) {
      return { loggedIn: false, statePath: options.statePath };
    }
    return {
      loggedIn: true,
      statePath: options.statePath,
      account
    };
  } catch (error) {
    if (error instanceof XianyuCommandError) {
      if (
        error.code === 'XIANYU_AUTH_INVALID'
        || error.code === 'XIANYU_AUTH_REQUIRED'
        || error.code === 'XIANYU_BROWSER_UNAVAILABLE'
      ) {
        throw error;
      }
    }
    return { loggedIn: false, statePath: options.statePath };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function searchKeywordBrowser(options: {
  browser: XianyuBrowserChannel;
  headed?: boolean;
  keyword: string;
  pages?: number;
  statePath: string;
}): Promise<XianyuSearchResult> {
  const keyword = options.keyword.trim();
  if (!keyword) {
    throw new XianyuCommandError(
      'XIANYU_INVALID_INPUT',
      'Search keyword must not be empty.',
      2
    );
  }
  const pageLimit = normalizePages(options.pages);
  if (!(await stateFileExists(options.statePath))) {
    throw new XianyuCommandError(
      'XIANYU_AUTH_REQUIRED',
      'Xianyu auth state file is missing. Run `ants xianyu auth login` first.',
      2,
      { statePath: options.statePath }
    );
  }

  const playwright = await import('playwright');
  let browser: Browser | undefined;
  try {
    browser = await launchXianyuBrowser(playwright, {
      browser: options.browser,
      headless: !(options.headed ?? false)
    });
    const storageState = parseAndSanitizeStorageState(await readStateFile(options.statePath));
    const context = await browser.newContext({
      locale: 'zh-CN',
      storageState,
      viewport: { width: 1360, height: 900 }
    });
    const page = await context.newPage();

    const items: XianyuSearchItem[] = [];
    let hasNextPage = false;
    let fetchedPages = 0;
    let retainedBytes = 0;

    const searchUrl =
      `https://www.goofish.com/search?q=${encodeURIComponent(keyword)}`;
    const firstPayload = await captureSearchPayload(page, async () => {
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000
      });
    });
    assertSearchNotRiskBlocked(firstPayload);
    const firstMapped = mapSearchResponse(firstPayload);
    retainedBytes = addRetainedBytes(retainedBytes, firstMapped.items);
    items.push(...firstMapped.items);
    hasNextPage = firstMapped.hasNextPage;
    fetchedPages = 1;

    while (fetchedPages < pageLimit && hasNextPage) {
      const nextPayload = await captureSearchPayload(page, async () => {
        await page.mouse.wheel(0, 2200);
        await page.waitForTimeout(1500);
      }, {
        timeoutMs: DEFAULT_SEARCH_TIMEOUT_MS
      });
      assertSearchNotRiskBlocked(nextPayload);
      const mapped = mapSearchResponse(nextPayload);
      if (mapped.items.length === 0) {
        hasNextPage = false;
        break;
      }
      // Deduplicate by itemId across pages.
      const existing = new Set(items.map((item) => item.itemId));
      const fresh = mapped.items.filter((item) => !existing.has(item.itemId));
      if (fresh.length === 0) {
        hasNextPage = false;
        break;
      }
      retainedBytes = addRetainedBytes(retainedBytes, fresh);
      items.push(...fresh);
      hasNextPage = mapped.hasNextPage;
      fetchedPages += 1;
    }

    return {
      keyword,
      items,
      meta: {
        fetchedPages,
        hasNextPage,
        pageSize: XIANYU_MAX_ITEMS_PER_PAGE,
        totalItems: items.length,
        transport: 'browser'
      }
    };
  } catch (error) {
    throw toXianyuError(error, 'Xianyu browser search failed.');
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function captureSearchPayload(
  page: Page,
  trigger: () => Promise<void>,
  options: { timeoutMs?: number } = {}
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  const responsePromise = page.waitForResponse(
    (response: Response) =>
      isXianyuSearchApiUrl(response.url()) && response.status() === 200,
    { timeout: timeoutMs }
  );

  await trigger();
  let response: Response;
  try {
    response = await responsePromise;
  } catch {
    throw new XianyuCommandError(
      'XIANYU_SEARCH_FAILED',
      'Timed out waiting for a Xianyu search API response. Re-login if the session expired, or pass --headed to inspect the browser.',
      2
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // Risk control sometimes returns HTML login pages.
    const text = await response.text().catch(() => '');
    if (text.includes('登录') || text.includes('mini_login') || text.includes('<!doctype')) {
      throw new XianyuCommandError(
        'XIANYU_RISK_BLOCKED',
        'Xianyu returned a login/challenge page instead of search JSON. Run `ants xianyu auth login` again.',
        2
      );
    }
    throw new XianyuCommandError(
      'XIANYU_PARSE_ERROR',
      'Failed to parse Xianyu search API JSON.',
      2,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }

  assertSearchNotRiskBlocked(body);

  if (!isMtopSuccess(body)) {
    const ret = body && typeof body === 'object'
      ? (body as { ret?: unknown }).ret
      : undefined;
    throw new XianyuCommandError(
      'XIANYU_SEARCH_FAILED',
      'Xianyu search API did not return SUCCESS.',
      2,
      { ret }
    );
  }

  return body;
}

async function clickLoginIfPresent(page: Page): Promise<void> {
  const loginBtn = page.getByRole('button', { name: /登录/ }).first();
  if (await loginBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
    await loginBtn.click().catch(() => undefined);
    return;
  }
  const loginLink = page.locator('text=登录').first();
  if (await loginLink.isVisible({ timeout: 1500 }).catch(() => false)) {
    await loginLink.click().catch(() => undefined);
  }
}

async function waitForLogin(page: Page, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const account = await probeAccount(page).catch(() => undefined);
    if (account) {
      return;
    }

    const cookies = await page.context().cookies();
    const names = new Set(cookies.map((cookie) => cookie.name));
    const hasSession =
      names.has('cookie2')
      || names.has('unb')
      || names.has('_m_h5_tk')
      || names.has('sgcookie')
      || [...names].some((name) => /token|sid/i.test(name));

    const loggedInUi = await page.evaluate(() => {
      const text = document.body?.innerText ?? '';
      if (/扫码登录|手机号登录/.test(text) && !/退出|我的闲鱼|消息/.test(text)) {
        return false;
      }
      return /退出登录|我的闲鱼|卖闲置/.test(text);
    }).catch(() => false);

    if (hasSession && loggedInUi) {
      return;
    }

    await page.waitForTimeout(2000);
  }

  throw new XianyuCommandError(
    'XIANYU_AUTH_TIMEOUT',
    `Xianyu login timed out after ${timeoutMs}ms. Complete QR login in the browser window.`,
    2,
    { timeoutMs }
  );
}

async function probeAccount(page: Page): Promise<{ nick?: string } | undefined> {
  const probe = await page.evaluate(async () => {
    const t = Date.now();
    const url =
      'https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.loginuser.get/1.0/'
      + `?jsv=2.7.2&appKey=34839810&t=${t}&v=1.0&type=originaljson`
      + '&accountSite=xianyu&dataType=json&timeout=20000'
      + '&api=mtop.taobao.idlemessage.pc.loginuser.get&sessionOption=AutoLoginOnly';
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          referer: 'https://www.goofish.com/'
        },
        body: 'data=%7B%7D'
      });
      return await res.text();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });

  if (
    !probe.includes('SUCCESS')
    || probe.includes('SESSION_EXPIRED')
    || probe.includes('TOKEN_EMPTY')
    || probe.includes('FAIL_SYS')
  ) {
    return undefined;
  }

  try {
    const json = JSON.parse(probe) as {
      data?: { userNick?: string; nick?: string; displayName?: string };
    };
    const nick =
      json.data?.userNick
      ?? json.data?.nick
      ?? json.data?.displayName;
    return nick ? { nick } : {};
  } catch {
    return {};
  }
}

function normalizePages(pages: number | undefined): number {
  const value = pages ?? 1;
  if (!Number.isInteger(value) || value < 1 || value > MAX_SEARCH_PAGES) {
    throw new XianyuCommandError(
      'XIANYU_INVALID_PAGES',
      `Xianyu search pages must be an integer between 1 and ${MAX_SEARCH_PAGES}.`,
      2,
      { pages: value, maxPages: MAX_SEARCH_PAGES }
    );
  }
  return value;
}

function addRetainedBytes(retainedBytes: number, items: XianyuSearchItem[]): number {
  const next = retainedBytes + Buffer.byteLength(JSON.stringify(items), 'utf8');
  if (next > MAX_RETAINED_BYTES) {
    throw new XianyuCommandError(
      'XIANYU_RESOURCE_LIMIT',
      'Xianyu search results exceeded the configured size limit.',
      2,
      {
        maxRetainedBytes: MAX_RETAINED_BYTES,
        retainedBytes: next
      }
    );
  }
  return next;
}

function assertSearchNotRiskBlocked(body: unknown): void {
  if (!body || typeof body !== 'object') {
    return;
  }
  const ret = (body as { ret?: unknown }).ret;
  if (!Array.isArray(ret)) {
    return;
  }
  const joined = ret.map(String).join(' | ');
  if (/RGV587|挤爆|SESSION_EXPIRED|TOKEN_EMPTY|FAIL_SYS/i.test(joined)) {
    throw new XianyuCommandError(
      'XIANYU_RISK_BLOCKED',
      'Xianyu blocked the search session (login challenge or risk control). Run `ants xianyu auth login` again and retry with --headed.',
      2,
      { ret }
    );
  }
}

function toXianyuError(error: unknown, fallbackMessage: string): XianyuCommandError {
  if (error instanceof XianyuCommandError) {
    return error;
  }
  const cause = error instanceof Error ? error.message : String(error);
  return new XianyuCommandError(
    'XIANYU_RUNTIME_ERROR',
    `${fallbackMessage} ${cause}`,
    1,
    { cause }
  );
}

// re-export for tests / command wiring convenience
export { resolveXianyuBrowserChannel, resolveXianyuStatePath };
