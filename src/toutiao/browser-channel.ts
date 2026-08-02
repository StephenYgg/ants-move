import type { Browser, LaunchOptions } from 'playwright';

import { ToutiaoCommandError } from './types.js';

/**
 * Browser used for Toutiao auth/publish.
 * - chrome/msedge: installed system browser (preferred for login/publish)
 * - chromium: Playwright-managed Chromium for Testing
 */
export type ToutiaoBrowserChannel = 'chrome' | 'msedge' | 'chromium';

export const DEFAULT_TOUTIAO_BROWSER_CHANNEL: ToutiaoBrowserChannel = 'chrome';
export const TOUTIAO_BROWSER_ENV = 'ANTS_TOUTIAO_BROWSER';

const SUPPORTED_CHANNELS = new Set<ToutiaoBrowserChannel>([
  'chrome',
  'msedge',
  'chromium'
]);

export function resolveToutiaoBrowserChannel(
  explicit?: string
): ToutiaoBrowserChannel {
  const raw = (explicit ?? process.env[TOUTIAO_BROWSER_ENV] ?? DEFAULT_TOUTIAO_BROWSER_CHANNEL)
    .trim()
    .toLowerCase();

  if (SUPPORTED_CHANNELS.has(raw as ToutiaoBrowserChannel)) {
    return raw as ToutiaoBrowserChannel;
  }

  throw new ToutiaoCommandError(
    'TOUTIAO_INVALID_INPUT',
    'Browser must be one of: chrome, msedge, chromium.',
    2,
    {
      browser: explicit ?? process.env[TOUTIAO_BROWSER_ENV],
      supported: [...SUPPORTED_CHANNELS]
    }
  );
}

export function buildChromiumLaunchOptions(options: {
  browser: ToutiaoBrowserChannel;
  headless: boolean;
}): LaunchOptions {
  const launchOptions: LaunchOptions = {
    headless: options.headless
  };

  // System browsers: do not force a fake user agent; use the real browser binary.
  if (options.browser !== 'chromium') {
    launchOptions.channel = options.browser;
  }

  return launchOptions;
}

export async function launchToutiaoBrowser(
  playwright: typeof import('playwright'),
  options: {
    browser: ToutiaoBrowserChannel;
    headless: boolean;
  }
): Promise<Browser> {
  try {
    return await playwright.chromium.launch(
      buildChromiumLaunchOptions(options)
    );
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    if (options.browser === 'chromium') {
      throw new ToutiaoCommandError(
        'TOUTIAO_BROWSER_UNAVAILABLE',
        'Toutiao publish requires Playwright Chromium to be installed. Run: npx playwright install chromium',
        2,
        { browser: options.browser, cause }
      );
    }

    throw new ToutiaoCommandError(
      'TOUTIAO_BROWSER_UNAVAILABLE',
      `Toutiao publish could not launch system browser "${options.browser}". Install Google Chrome or Microsoft Edge, or pass --browser chromium.`,
      2,
      { browser: options.browser, cause }
    );
  }
}
