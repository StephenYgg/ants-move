import { chmod } from 'node:fs/promises';
import type { Browser, BrowserContext, Page } from 'playwright';

import { publishArticleOnPage } from './publisher/article.js';
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

const TOUTIAO_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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
    statePath: string;
    timeoutMs?: number;
  }) => Promise<ToutiaoAuthStatusResult>;
  withAuthedSession: <T>(
    options: {
      headed?: boolean;
      statePath: string;
      deadlineMs?: number;
    },
    operation: (session: ToutiaoAuthedSession) => Promise<T>
  ) => Promise<T>;
}

export interface ToutiaoPublishRuntimeOptions {
  loadPlaywright?: () => Promise<typeof import('playwright')>;
}

type PlaywrightLoader = () => Promise<typeof import('playwright')>;

export function createDefaultToutiaoPublishRuntime(
  options: ToutiaoPublishRuntimeOptions = {}
): ToutiaoPublishRuntime {
  const playwrightLoader = options.loadPlaywright ?? loadPlaywright;

  return {
    loginWithQr: (loginOptions) => loginWithQr(playwrightLoader, loginOptions),
    withAuthedSession: (sessionOptions, operation) =>
      withAuthedSession(playwrightLoader, sessionOptions, operation)
  };
}

async function loginWithQr(
  playwrightLoader: PlaywrightLoader,
  options: {
    statePath: string;
    timeoutMs?: number;
  }
): Promise<ToutiaoAuthStatusResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  await ensureStateDirectory(options.statePath);
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    const playwright = await loadPlaywrightOrThrow(playwrightLoader);
    browser = await launchChromiumOrThrow(playwright, false);
    context = await browser.newContext({
      locale: 'zh-CN',
      userAgent: TOUTIAO_USER_AGENT
    });
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
    headed?: boolean;
    statePath: string;
    deadlineMs?: number;
  },
  operation: (session: ToutiaoAuthedSession) => Promise<T>
): Promise<T> {
  if (!(await stateFileExists(sessionOptions.statePath))) {
    throw new ToutiaoCommandError(
      'TOUTIAO_AUTH_REQUIRED',
      'Toutiao auth state file is missing. Run `ants toutiao auth login` first.',
      2,
      { statePath: sessionOptions.statePath }
    );
  }

  const deadlineMs = sessionOptions.deadlineMs ?? DEFAULT_PUBLISH_DEADLINE_MS;
  const headed = sessionOptions.headed ?? false;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let deadlineTriggered = false;

  const createTimeoutError = () => new ToutiaoCommandError(
    'TOUTIAO_TIMEOUT',
    'Toutiao publish operation exceeded the command deadline.',
    1,
    { deadlineMs }
  );

  const lifecycle = runAuthedLifecycle({
    headed,
    getBrowser: () => browser,
    setBrowser: (value) => {
      browser = value;
    },
    getContext: () => context,
    setContext: (value) => {
      context = value;
    },
    operation,
    playwrightLoader,
    statePath: sessionOptions.statePath
  });

  return await raceWithDeadline(lifecycle, deadlineMs, () => {
    deadlineTriggered = true;
    void browser?.close().catch(() => undefined);
    return createTimeoutError();
  }, () => deadlineTriggered);
}

async function runAuthedLifecycle<T>(options: {
  headed: boolean;
  getBrowser: () => Browser | undefined;
  setBrowser: (browser: Browser | undefined) => void;
  getContext: () => BrowserContext | undefined;
  setContext: (context: BrowserContext | undefined) => void;
  operation: (session: ToutiaoAuthedSession) => Promise<T>;
  playwrightLoader: PlaywrightLoader;
  statePath: string;
}): Promise<T> {
  try {
    const playwright = await loadPlaywrightOrThrow(options.playwrightLoader);
    const browser = await launchChromiumOrThrow(playwright, !options.headed);
    options.setBrowser(browser);
    const context = await browser.newContext({
      locale: 'zh-CN',
      storageState: options.statePath,
      userAgent: TOUTIAO_USER_AGENT
    });
    options.setContext(context);
    const page = await context.newPage();
    const account = await readAccountFromPage(page);
    if (account === undefined) {
      throw new ToutiaoCommandError(
        'TOUTIAO_AUTH_EXPIRED',
        'Toutiao auth state is present but the creator session is invalid. Run `ants toutiao auth login` again.',
        2,
        { statePath: options.statePath }
      );
    }

    return await options.operation(
      createAuthedSession(page, account, options.statePath)
    );
  } finally {
    await options.getContext()?.close().catch(() => undefined);
    await options.getBrowser()?.close().catch(() => undefined);
  }
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

async function launchChromiumOrThrow(
  playwright: typeof import('playwright'),
  headless: boolean
): Promise<Browser> {
  try {
    return await playwright.chromium.launch({ headless });
  } catch {
    throw new ToutiaoCommandError(
      'TOUTIAO_BROWSER_UNAVAILABLE',
      'Toutiao publish requires Playwright Chromium to be installed.',
      2
    );
  }
}

async function loadPlaywright(): Promise<typeof import('playwright')> {
  return import('playwright');
}
