import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import {
  resolveToutiaoBrowserChannel,
  type ToutiaoBrowserChannel
} from './browser-channel.js';
import { ToutiaoCommandError } from './types.js';

export const DEFAULT_CDP_PORT = 9222;
export const DEFAULT_MANAGED_PROFILE_RELATIVE =
  '.config/ants-move/toutiao/chrome-profile';
export const DEFAULT_BROWSER_META_RELATIVE =
  '.config/ants-move/toutiao/browser.json';

export interface ManagedBrowserMeta {
  browser: ToutiaoBrowserChannel;
  cdpUrl: string;
  pid: number;
  port: number;
  profilePath: string;
  startedAt: string;
}

export interface ManagedBrowserStartResult extends ManagedBrowserMeta {
  alreadyRunning: boolean;
}

export function resolveManagedProfilePath(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== '') {
    return resolve(explicit.trim());
  }
  return resolve(homedir(), DEFAULT_MANAGED_PROFILE_RELATIVE);
}

export function resolveBrowserMetaPath(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== '') {
    return resolve(explicit.trim());
  }
  return resolve(homedir(), DEFAULT_BROWSER_META_RELATIVE);
}

export function buildCdpUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function readManagedBrowserMeta(
  metaPath = resolveBrowserMetaPath()
): Promise<ManagedBrowserMeta | undefined> {
  try {
    const raw = await readFile(metaPath, 'utf8');
    const parsed = JSON.parse(raw) as ManagedBrowserMeta;
    if (
      typeof parsed.pid !== 'number'
      || typeof parsed.port !== 'number'
      || typeof parsed.cdpUrl !== 'string'
      || typeof parsed.profilePath !== 'string'
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export async function isCdpEndpointReady(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, '')}/json/version`, {
      signal: AbortSignal.timeout(2_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function resolveCdpUrl(explicit?: string): Promise<string | undefined> {
  if (explicit !== undefined && explicit.trim() !== '') {
    return explicit.trim().replace(/\/$/, '');
  }

  const meta = await readManagedBrowserMeta();
  if (meta === undefined) {
    return undefined;
  }
  if (await isCdpEndpointReady(meta.cdpUrl)) {
    return meta.cdpUrl;
  }
  return undefined;
}

export async function startManagedBrowser(options: {
  browser?: string;
  metaPath?: string;
  port?: number;
  profilePath?: string;
} = {}): Promise<ManagedBrowserStartResult> {
  const browser = resolveToutiaoBrowserChannel(options.browser);
  if (browser === 'chromium') {
    throw new ToutiaoCommandError(
      'TOUTIAO_INVALID_INPUT',
      'Managed browser profile mode only supports chrome or msedge (real installed browsers).',
      2,
      { browser }
    );
  }

  const port = options.port ?? DEFAULT_CDP_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ToutiaoCommandError(
      'TOUTIAO_INVALID_INPUT',
      'CDP port must be an integer between 1 and 65535.',
      2,
      { port: options.port }
    );
  }

  const profilePath = resolveManagedProfilePath(options.profilePath);
  const metaPath = resolveBrowserMetaPath(options.metaPath);
  const cdpUrl = buildCdpUrl(port);

  const existing = await readManagedBrowserMeta(metaPath);
  if (existing !== undefined && await isCdpEndpointReady(existing.cdpUrl)) {
    return {
      ...existing,
      alreadyRunning: true
    };
  }

  if (await isCdpEndpointReady(cdpUrl)) {
    const orphan: ManagedBrowserMeta = {
      browser,
      cdpUrl,
      pid: existing?.pid ?? 0,
      port,
      profilePath,
      startedAt: new Date().toISOString()
    };
    await writeBrowserMeta(metaPath, orphan);
    return {
      ...orphan,
      alreadyRunning: true
    };
  }

  await mkdir(profilePath, { recursive: true, mode: 0o700 });
  await mkdir(dirname(metaPath), { recursive: true, mode: 0o700 });

  const executable = resolveBrowserExecutable(browser);
  const child = spawnDetachedBrowser(executable, { port, profilePath });

  if (child.pid === undefined) {
    throw new ToutiaoCommandError(
      'TOUTIAO_BROWSER_UNAVAILABLE',
      `Failed to start managed ${browser} process.`,
      1,
      { executable }
    );
  }

  const ready = await waitForCdp(cdpUrl, 30_000);
  if (!ready) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // Ignore.
    }
    throw new ToutiaoCommandError(
      'TOUTIAO_CDP_UNAVAILABLE',
      `Started ${browser}, but the CDP endpoint did not become ready at ${cdpUrl}.`,
      1,
      { cdpUrl, pid: child.pid, port }
    );
  }

  const meta: ManagedBrowserMeta = {
    browser,
    cdpUrl,
    pid: child.pid,
    port,
    profilePath,
    startedAt: new Date().toISOString()
  };
  await writeBrowserMeta(metaPath, meta);

  return {
    ...meta,
    alreadyRunning: false
  };
}

export async function stopManagedBrowser(options: {
  metaPath?: string;
} = {}): Promise<{
  meta?: ManagedBrowserMeta;
  metaPath: string;
  stopped: boolean;
}> {
  const metaPath = resolveBrowserMetaPath(options.metaPath);
  const meta = await readManagedBrowserMeta(metaPath);
  if (meta === undefined) {
    return { stopped: false, metaPath };
  }

  if (meta.pid > 0) {
    try {
      process.kill(meta.pid, 'SIGTERM');
    } catch {
      // Process may already be gone.
    }
  }

  try {
    await unlink(metaPath);
  } catch {
    // Ignore missing meta.
  }

  return {
    stopped: true,
    metaPath,
    meta
  };
}

export async function statusManagedBrowser(options: {
  cdpUrl?: string;
  metaPath?: string;
} = {}): Promise<{
  cdpReady: boolean;
  cdpUrl?: string;
  managed: boolean;
  meta?: ManagedBrowserMeta;
}> {
  const metaPath = resolveBrowserMetaPath(options.metaPath);
  const meta = await readManagedBrowserMeta(metaPath);
  const cdpUrl = options.cdpUrl?.trim() || meta?.cdpUrl;
  if (cdpUrl === undefined || cdpUrl === '') {
    return {
      cdpReady: false,
      managed: false
    };
  }

  const cdpReady = await isCdpEndpointReady(cdpUrl);
  return {
    cdpReady,
    cdpUrl,
    managed: meta !== undefined && meta.cdpUrl === cdpUrl,
    ...(meta === undefined ? {} : { meta })
  };
}

async function writeBrowserMeta(
  metaPath: string,
  meta: ManagedBrowserMeta
): Promise<void> {
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
  await chmod(metaPath, 0o600);
}

function resolveBrowserExecutable(browser: 'chrome' | 'msedge'): string {
  if (process.platform === 'darwin') {
    const macPath = browser === 'chrome'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    if (existsSync(macPath)) {
      return macPath;
    }
  }

  if (process.platform === 'linux') {
    const candidates = browser === 'chrome'
      ? ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']
      : ['microsoft-edge', 'microsoft-edge-stable'];
    for (const candidate of candidates) {
      const absolute = `/usr/bin/${candidate}`;
      if (existsSync(absolute)) {
        return absolute;
      }
    }
    return candidates[0] as string;
  }

  if (process.platform === 'win32') {
    const winPath = browser === 'chrome'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    if (existsSync(winPath)) {
      return winPath;
    }
  }

  throw new ToutiaoCommandError(
    'TOUTIAO_BROWSER_UNAVAILABLE',
    `Could not find installed ${browser} executable for managed browser mode.`,
    2,
    { browser, platform: process.platform }
  );
}

function spawnDetachedBrowser(
  executable: string,
  options: { port: number; profilePath: string }
): ChildProcess {
  const args = [
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.profilePath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    'about:blank'
  ];

  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return child;
}

async function waitForCdp(cdpUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCdpEndpointReady(cdpUrl)) {
      return true;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return false;
}
