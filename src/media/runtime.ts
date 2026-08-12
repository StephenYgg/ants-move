import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

import { MEDIA_BROWSER_USER_AGENT } from './headers.js';
import { MediaCommandError, type MediaHttpRequest } from './types.js';

export interface MediaRuntime {
  fetchText: (request: MediaHttpRequest) => Promise<string>;
  /**
   * Optional headed-browser fallback for pages that block curl (WAF / JS challenges).
   * Used only after HTML curl and RSS content fallbacks fail.
   */
  fetchHtmlBrowser?: (request: MediaHttpRequest) => Promise<string>;
}

export type MediaExecFile = (
  file: string,
  args: string[],
  options: { encoding: 'utf8'; maxBuffer: number }
) => Promise<{ stderr: string; stdout: string }>;

const execFileAsync = promisify(nodeExecFile) as unknown as MediaExecFile;

const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;
const DEFAULT_BROWSER_TIMEOUT_MS = 45_000;

export function createDefaultMediaRuntime(options: {
  browserTimeoutMs?: number;
  enableBrowserFallback?: boolean;
  execFile?: MediaExecFile;
  loadPlaywright?: () => Promise<typeof import('playwright')>;
  maxBuffer?: number;
} = {}): MediaRuntime {
  const execFile = options.execFile ?? execFileAsync;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const enableBrowserFallback = options.enableBrowserFallback ?? true;
  const browserTimeoutMs = options.browserTimeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS;
  const loadPlaywright = options.loadPlaywright ?? defaultLoadPlaywright;

  const runtime: MediaRuntime = {
    fetchText: async (request) => fetchWithCurl(execFile, request, maxBuffer)
  };

  if (enableBrowserFallback) {
    runtime.fetchHtmlBrowser = async (request) => fetchHtmlWithBrowser(
      loadPlaywright,
      request,
      browserTimeoutMs
    );
  }

  return runtime;
}

async function fetchWithCurl(
  execFile: MediaExecFile,
  request: MediaHttpRequest,
  maxBuffer: number
): Promise<string> {
  const args = [
    '--silent',
    '--show-error',
    '--location',
    '--compressed',
    '--connect-timeout',
    '10',
    '--max-time',
    '45',
    ...Object.entries(request.headers).flatMap(([name, value]) => [
      '--header',
      `${name}: ${value}`
    ]),
    request.url
  ];

  try {
    const result = await execFile('curl', args, {
      encoding: 'utf8',
      maxBuffer
    });
    return result.stdout;
  } catch (error) {
    const execError = error as Error & { code?: number | string; stderr?: string };
    const failureReason = execError.stderr?.trim() || 'curl request failed.';
    throw new MediaCommandError(
      'MEDIA_REQUEST_FAILED',
      `Failed to fetch media resource: ${failureReason}`,
      1,
      {
        curlExitCode: execError.code,
        url: request.url
      }
    );
  }
}

async function fetchHtmlWithBrowser(
  loadPlaywright: () => Promise<typeof import('playwright')>,
  request: MediaHttpRequest,
  timeoutMs: number
): Promise<string> {
  let playwright: typeof import('playwright');
  try {
    playwright = await loadPlaywright();
  } catch (error) {
    throw new MediaCommandError(
      'MEDIA_BROWSER_UNAVAILABLE',
      'Playwright is required for browser article fallback but could not be loaded.',
      1,
      {
        cause: error instanceof Error ? error.message : String(error),
        url: request.url
      }
    );
  }

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      extraHTTPHeaders: request.headers,
      userAgent: request.headers['User-Agent'] ?? MEDIA_BROWSER_USER_AGENT
    });
    const page = await context.newPage();
    const response = await page.goto(request.url, {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded'
    });
    if (response && response.status() >= 400) {
      throw new MediaCommandError(
        'MEDIA_REQUEST_FAILED',
        `Browser article fetch failed with HTTP ${response.status()}.`,
        1,
        { status: response.status(), url: request.url }
      );
    }
    // Allow late client rendering for app-shell pages.
    await page.waitForTimeout(1500);
    return await page.content();
  } catch (error) {
    if (error instanceof MediaCommandError) {
      throw error;
    }
    throw new MediaCommandError(
      'MEDIA_REQUEST_FAILED',
      `Browser article fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      1,
      { url: request.url }
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function defaultLoadPlaywright(): Promise<typeof import('playwright')> {
  return import('playwright');
}
