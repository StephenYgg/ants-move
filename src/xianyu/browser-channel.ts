import type { Browser, LaunchOptions } from 'playwright';

import type { XianyuBrowserChannel } from './types.js';
import { XianyuCommandError } from './types.js';

export const DEFAULT_XIANYU_BROWSER_CHANNEL: XianyuBrowserChannel = 'chrome';
export const XIANYU_BROWSER_ENV = 'ANTS_XIANYU_BROWSER';

const SUPPORTED_CHANNELS = new Set<XianyuBrowserChannel>([
  'chrome',
  'msedge',
  'chromium'
]);

export function resolveXianyuBrowserChannel(explicit?: string): XianyuBrowserChannel {
  const raw = (explicit ?? process.env[XIANYU_BROWSER_ENV] ?? DEFAULT_XIANYU_BROWSER_CHANNEL)
    .trim()
    .toLowerCase();

  if (SUPPORTED_CHANNELS.has(raw as XianyuBrowserChannel)) {
    return raw as XianyuBrowserChannel;
  }

  throw new XianyuCommandError(
    'XIANYU_INVALID_INPUT',
    'Browser must be one of: chrome, msedge, chromium.',
    2,
    {
      browser: explicit ?? process.env[XIANYU_BROWSER_ENV],
      supported: [...SUPPORTED_CHANNELS]
    }
  );
}

export function buildChromiumLaunchOptions(options: {
  browser: XianyuBrowserChannel;
  headless: boolean;
}): LaunchOptions {
  const launchOptions: LaunchOptions = {
    headless: options.headless,
    args: ['--disable-blink-features=AutomationControlled']
  };

  if (options.browser !== 'chromium') {
    launchOptions.channel = options.browser;
  }

  return launchOptions;
}

export async function launchXianyuBrowser(
  playwright: typeof import('playwright'),
  options: {
    browser: XianyuBrowserChannel;
    headless: boolean;
  }
): Promise<Browser> {
  try {
    return await playwright.chromium.launch(buildChromiumLaunchOptions(options));
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    if (options.browser === 'chromium') {
      throw new XianyuCommandError(
        'XIANYU_BROWSER_UNAVAILABLE',
        'Xianyu requires Playwright Chromium. Run: npx playwright install chromium',
        2,
        { browser: options.browser, cause }
      );
    }
    throw new XianyuCommandError(
      'XIANYU_BROWSER_UNAVAILABLE',
      `Could not launch system browser "${options.browser}". Install Chrome/Edge or pass --browser chromium.`,
      2,
      { browser: options.browser, cause }
    );
  }
}
