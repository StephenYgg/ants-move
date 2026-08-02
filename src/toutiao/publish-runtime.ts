import { chmod } from 'node:fs/promises';
import type { Browser, BrowserContext, Page } from 'playwright';

import {
  DEFAULT_TOUTIAO_BROWSER_CHANNEL,
  launchToutiaoBrowser,
  resolveToutiaoBrowserChannel,
  type ToutiaoBrowserChannel
} from './browser-channel.js';
import { isCdpEndpointReady, resolveCdpUrl } from './managed-browser.js';
import { publishArticleOnPage } from './publisher/article.js';
import { grantCreatorSitePermissions, TOUTIAO_SITE_PERMISSIONS } from './publisher/browser-helpers.js';
import {
  DEFAULT_AUTH_TIMEOUT_MS,
  DEFAULT_PUBLISH_DEADLINE_MS,
  TOUTIAO_MEDIA_INFO_URL,
  TOUTIAO_MP_HOME_URL,
  TOUTIAO_MP_LOGIN_URL
} from './publisher/form-map.js';
import { publishMicroOnPage } from './publisher/micro.js';
import { ensureStateDirectory, stateFileExists } from './state.js';
import {
  ToutiaoCommandError,
  type ToutiaoArticlePublishInput,
  type ToutiaoAuthAccount,
  type ToutiaoAuthStatusResult,
  type ToutiaoMicroPublishInput,
  type ToutiaoPublishResult
} from './types.js';

export interface ToutiaoAuthedSession {
  getStatus: () => Promise<ToutiaoAuthStatusResult>;
  publishArticle: (
    input: Omit<ToutiaoArticlePublishInput, 'dryRun' | 'headed' | 'statePath'>
  ) => Promise<ToutiaoPublishResult>;
  publishMicro: (
    input: Omit<ToutiaoMicroPublishInput, 'dryRun' | 'headed' | 'statePath'>
  ) => Promise<ToutiaoPublishResult>;
}

export interface ToutiaoPublishRuntime {
  loginWithQr: (options: {
    browser?: ToutiaoBrowserChannel;
    cdpUrl?: string;
    statePath: string;
    timeoutMs?: number;
  }) => Promise<ToutiaoAuthStatusResult>;
  withAuthedSession: <T>(
    options: {
      browser?: ToutiaoBrowserChannel;
      cdpUrl?: string;
      headed?: boolean;
      statePath: string;
      deadlineMs?: number;
    },
    operation: (session: ToutiaoAuthedSession) => Promise<T>
  ) => Promise<T>;
}

export interface ToutiaoPublishRuntimeOptions {
  defaultBrowser?: ToutiaoBrowserChannel;
  loadPlaywright?: () => Promise<typeof import('playwright')>;
}

type PlaywrightLoader = () => Promise<typeof import('playwright')>;

export function createDefaultToutiaoPublishRuntime(
  options: ToutiaoPublishRuntimeOptions = {}
): ToutiaoPublishRuntime {
  const playwrightLoader = options.loadPlaywright ?? loadPlaywright;
  const defaultBrowser = options.defaultBrowser
    ?? resolveToutiaoBrowserChannel();

  return {
    loginWithQr: (loginOptions) => loginWithQr(playwrightLoader, {
      ...loginOptions,
      browser: loginOptions.browser ?? defaultBrowser
    }),
    withAuthedSession: (sessionOptions, operation) =>
      withAuthedSession(playwrightLoader, {
        ...sessionOptions,
        browser: sessionOptions.browser ?? defaultBrowser
      }, operation)
  };
}

async function loginWithQr(
  playwrightLoader: PlaywrightLoader,
  options: {
    browser: ToutiaoBrowserChannel;
    cdpUrl?: string;
    statePath: string;
    timeoutMs?: number;
  }
): Promise<ToutiaoAuthStatusResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  await ensureStateDirectory(options.statePath);

  const cdpUrl = await resolveOptionalCdpUrl(options.cdpUrl);
  if (cdpUrl !== undefined) {
    return loginWithCdp(playwrightLoader, {
      cdpUrl,
      statePath: options.statePath,
      timeoutMs
    });
  }

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    const playwright = await loadPlaywrightOrThrow(playwrightLoader);
    browser = await launchToutiaoBrowser(playwright, {
      browser: options.browser,
      headless: false
    });
    context = await browser.newContext(buildContextOptions(options.browser));
    await grantCreatorSitePermissions(context);
    const page = await context.newPage();
    await openLoginPage(page);
    const account = await waitForLogin(page, timeoutMs);
    await context.storageState({ path: options.statePath });
    await chmod(options.statePath, 0o600);

    return {
      account,
      loggedIn: true,
      statePath: options.statePath
    };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

async function loginWithCdp(
  playwrightLoader: PlaywrightLoader,
  options: {
    cdpUrl: string;
    statePath: string;
    timeoutMs: number;
  }
): Promise<ToutiaoAuthStatusResult> {
  const connection = await connectCdp(playwrightLoader, options.cdpUrl);
  await grantCreatorSitePermissions(connection.context);
  const page = await connection.context.newPage();

  try {
    await openLoginPage(page);
    const account = await waitForLogin(page, options.timeoutMs);
    await connection.context.storageState({ path: options.statePath });
    await chmod(options.statePath, 0o600);

    return {
      account,
      loggedIn: true,
      statePath: options.statePath
    };
  } finally {
    await page.close().catch(() => undefined);
    await connection.browser.close().catch(() => undefined);
  }
}

async function openLoginPage(page: Page): Promise<void> {
  try {
    await page.goto(TOUTIAO_MP_LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });
  } catch {
    await page.goto(TOUTIAO_MP_HOME_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });
  }
}

async function withAuthedSession<T>(
  playwrightLoader: PlaywrightLoader,
  sessionOptions: {
    browser: ToutiaoBrowserChannel;
    cdpUrl?: string;
    headed?: boolean;
    statePath: string;
    deadlineMs?: number;
  },
  operation: (session: ToutiaoAuthedSession) => Promise<T>
): Promise<T> {
  const cdpUrl = await resolveOptionalCdpUrl(sessionOptions.cdpUrl);

  if (cdpUrl === undefined && !(await stateFileExists(sessionOptions.statePath))) {
    throw new ToutiaoCommandError(
      'TOUTIAO_AUTH_REQUIRED',
      'Toutiao auth state file is missing. Run `ants toutiao auth login` first, or start a managed browser: ants toutiao browser start',
      2,
      { statePath: sessionOptions.statePath }
    );
  }

  const deadlineMs = sessionOptions.deadlineMs ?? DEFAULT_PUBLISH_DEADLINE_MS;
  const headed = sessionOptions.headed ?? false;
  let browser: Browser | undefined;
  let ownedContext: BrowserContext | undefined;
  let ownedPage: Page | undefined;
  let deadlineTriggered = false;
  let connectedViaCdp = false;

  const createTimeoutError = () => new ToutiaoCommandError(
    'TOUTIAO_TIMEOUT',
    'Toutiao publish operation exceeded the command deadline.',
    1,
    { deadlineMs }
  );

  const lifecycle = (async () => {
    try {
      const playwright = await loadPlaywrightOrThrow(playwrightLoader);

      if (cdpUrl !== undefined) {
        connectedViaCdp = true;
        const connection = await connectCdpWithPlaywright(playwright, cdpUrl);
        browser = connection.browser;
        await grantCreatorSitePermissions(connection.context);
        ownedPage = await connection.context.newPage();
        const account = await readAccountFromPage(ownedPage);
        if (account === undefined) {
          throw new ToutiaoCommandError(
            'TOUTIAO_AUTH_EXPIRED',
            'Connected browser session is not logged in to the Toutiao creator console. Scan login in that browser, or run auth login --cdp.',
            2,
            { cdpUrl }
          );
        }
        return await operation(
          createAuthedSession(ownedPage, account, sessionOptions.statePath)
        );
      }

      browser = await launchToutiaoBrowser(playwright, {
        browser: sessionOptions.browser,
        headless: !headed
      });
      ownedContext = await browser.newContext({
        ...buildContextOptions(sessionOptions.browser),
        storageState: sessionOptions.statePath
      });
      await grantCreatorSitePermissions(ownedContext);
      ownedPage = await ownedContext.newPage();
      const account = await readAccountFromPage(ownedPage);
      if (account === undefined) {
        throw new ToutiaoCommandError(
          'TOUTIAO_AUTH_EXPIRED',
          'Toutiao auth state is present but the creator session is invalid. Run `ants toutiao auth login` again.',
          2,
          { statePath: sessionOptions.statePath }
        );
      }

      return await operation(
        createAuthedSession(ownedPage, account, sessionOptions.statePath)
      );
    } finally {
      await ownedPage?.close().catch(() => undefined);
      if (!connectedViaCdp) {
        await ownedContext?.close().catch(() => undefined);
      }
      // CDP: close() disconnects and leaves the real browser running.
      // Launch mode: close() shuts down the temporary browser.
      await browser?.close().catch(() => undefined);
    }
  })();

  return await raceWithDeadline(lifecycle, deadlineMs, () => {
    deadlineTriggered = true;
    void browser?.close().catch(() => undefined);
    return createTimeoutError();
  }, () => deadlineTriggered);
}

async function resolveOptionalCdpUrl(explicit?: string): Promise<string | undefined> {
  if (explicit !== undefined && explicit.trim() !== '') {
    const cdpUrl = explicit.trim().replace(/\/$/, '');
    if (!(await isCdpEndpointReady(cdpUrl))) {
      throw new ToutiaoCommandError(
        'TOUTIAO_CDP_UNAVAILABLE',
        `CDP endpoint is not reachable at ${cdpUrl}. Start it with: ants toutiao browser start`,
        1,
        { cdpUrl }
      );
    }
    return cdpUrl;
  }

  // Auto-use managed browser from `ants toutiao browser start` when available.
  return resolveCdpUrl();
}

async function connectCdp(
  playwrightLoader: PlaywrightLoader,
  cdpUrl: string
): Promise<{ browser: Browser; context: BrowserContext }> {
  const playwright = await loadPlaywrightOrThrow(playwrightLoader);
  return connectCdpWithPlaywright(playwright, cdpUrl);
}

async function connectCdpWithPlaywright(
  playwright: typeof import('playwright'),
  cdpUrl: string
): Promise<{ browser: Browser; context: BrowserContext }> {
  if (!(await isCdpEndpointReady(cdpUrl))) {
    throw new ToutiaoCommandError(
      'TOUTIAO_CDP_UNAVAILABLE',
      `CDP endpoint is not reachable at ${cdpUrl}. Start it with: ants toutiao browser start`,
      1,
      { cdpUrl }
    );
  }

  try {
    const browser = await playwright.chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] ?? await browser.newContext();
    return { browser, context };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new ToutiaoCommandError(
      'TOUTIAO_CDP_UNAVAILABLE',
      `Failed to connect to browser over CDP at ${cdpUrl}.`,
      1,
      { cdpUrl, cause }
    );
  }
}

function buildContextOptions(browser: ToutiaoBrowserChannel): {
  locale: string;
  permissions: string[];
  userAgent?: string;
} {
  const permissions = [...TOUTIAO_SITE_PERMISSIONS];
  if (browser === 'chromium') {
    return {
      locale: 'zh-CN',
      permissions,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    };
  }

  return { locale: 'zh-CN', permissions };
}

async function raceWithDeadline<T>(
  lifecycle: Promise<T>,
  deadlineMs: number,
  onTimeout: () => ToutiaoCommandError,
  isTimedOut: () => boolean
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(onTimeout());
    }, deadlineMs);

    void lifecycle.then(
      (value) => {
        if (!isTimedOut()) {
          clearTimeout(timer);
          resolve(value);
        }
      },
      (error: unknown) => {
        if (!isTimedOut()) {
          clearTimeout(timer);
          reject(error);
        }
      }
    );
  });
}

function createAuthedSession(
  page: Page,
  account: ToutiaoAuthAccount,
  statePath: string
): ToutiaoAuthedSession {
  return {
    getStatus: async () => ({
      account,
      loggedIn: true,
      statePath
    }),
    publishArticle: async (input) => publishArticleOnPage(page, input, account),
    publishMicro: async (input) => publishMicroOnPage(page, input, account)
  };
}

async function waitForLogin(page: Page, timeoutMs: number): Promise<ToutiaoAuthAccount> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const account = await readAccountFromPage(page);
    if (account !== undefined) {
      return account;
    }

    if (looksLikePostLoginUrl(page.url())) {
      const retry = await readAccountFromPage(page);
      if (retry !== undefined) {
        return retry;
      }
    }

    await page.waitForTimeout(1500);
  }

  throw new ToutiaoCommandError(
    'TOUTIAO_AUTH_TIMEOUT',
    'Timed out waiting for Toutiao QR login. Scan the code in the browser window and try again.',
    1,
    { timeoutMs }
  );
}

function looksLikePostLoginUrl(url: string): boolean {
  return url.includes('mp.toutiao.com')
    && !url.includes('/auth/page/login')
    && !url.includes('login');
}

interface MediaInfoPayload {
  data?: {
    user?: {
      id?: string | number;
      media_id?: string | number;
      name?: string;
      screen_name?: string;
    };
    media?: {
      id?: string | number;
      name?: string;
      screen_name?: string;
    };
  };
}

async function readAccountFromPage(page: Page): Promise<ToutiaoAuthAccount | undefined> {
  try {
    const response = await page.request.get(TOUTIAO_MEDIA_INFO_URL, {
      timeout: 15_000
    });
    if (!response.ok()) {
      return undefined;
    }

    const payload = await response.json() as MediaInfoPayload;
    return mapMediaInfoToAccount(payload);
  } catch {
    return undefined;
  }
}

function mapMediaInfoToAccount(payload: MediaInfoPayload): ToutiaoAuthAccount | undefined {
  const user = payload.data?.user ?? payload.data?.media;
  if (user === undefined) {
    return undefined;
  }

  const name = user.name ?? user.screen_name;
  const mediaIdValue = 'media_id' in user ? user.media_id : user.id;
  const account: ToutiaoAuthAccount = {};
  if (name !== undefined && name !== '') {
    account.name = String(name);
  }
  if (mediaIdValue !== undefined && mediaIdValue !== '') {
    account.mediaId = String(mediaIdValue);
  }

  if (account.name === undefined && account.mediaId === undefined) {
    return undefined;
  }

  return account;
}

async function loadPlaywrightOrThrow(
  loader: PlaywrightLoader
): Promise<typeof import('playwright')> {
  try {
    return await loader();
  } catch {
    throw new ToutiaoCommandError(
      'TOUTIAO_BROWSER_UNAVAILABLE',
      'Toutiao publish requires Playwright to be installed.',
      2
    );
  }
}

async function loadPlaywright(): Promise<typeof import('playwright')> {
  return import('playwright');
}

export { DEFAULT_TOUTIAO_BROWSER_CHANNEL };
