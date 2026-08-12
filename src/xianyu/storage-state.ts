import { XianyuCommandError } from './types.js';

const MAX_COOKIE_VALUE_LENGTH = 8 * 1024;
const RELEVANT_DOMAIN =
  /(^|\.)(goofish\.com|taobao\.com|tmall\.com|alipay\.com|alicdn\.com|mmstat\.com|aliyun\.com|xianyu\.com)$/i;

export interface PlaywrightStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

/**
 * Playwright rejects oversized / irrelevant cookies (e.g. analytics blobs).
 * Keep only session-relevant cookies with bounded values.
 */
export function sanitizeStorageState(raw: unknown): PlaywrightStorageState {
  if (!raw || typeof raw !== 'object') {
    throw new XianyuCommandError(
      'XIANYU_AUTH_INVALID',
      'Xianyu auth state file is not valid Playwright storageState JSON.',
      2
    );
  }

  const cookiesIn = Array.isArray((raw as { cookies?: unknown }).cookies)
    ? ((raw as { cookies: unknown[] }).cookies)
    : [];
  const originsIn = Array.isArray((raw as { origins?: unknown }).origins)
    ? ((raw as { origins: unknown[] }).origins)
    : [];

  const cookies = cookiesIn
    .map((cookie) => normalizeCookie(cookie))
    .filter((cookie): cookie is PlaywrightStorageState['cookies'][number] => cookie !== undefined);

  const origins = originsIn
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is PlaywrightStorageState['origins'][number] => origin !== undefined);

  if (cookies.length === 0) {
    throw new XianyuCommandError(
      'XIANYU_AUTH_INVALID',
      'Xianyu auth state has no usable session cookies. Run `ants xianyu auth login` again.',
      2
    );
  }

  return { cookies, origins };
}

export function parseAndSanitizeStorageState(jsonText: string): PlaywrightStorageState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new XianyuCommandError(
      'XIANYU_AUTH_INVALID',
      'Failed to parse Xianyu auth state JSON.',
      2,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
  return sanitizeStorageState(parsed);
}

function normalizeCookie(cookie: unknown): PlaywrightStorageState['cookies'][number] | undefined {
  if (!cookie || typeof cookie !== 'object') {
    return undefined;
  }
  const record = cookie as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : '';
  const value = typeof record.value === 'string' ? record.value : '';
  const domain = typeof record.domain === 'string' ? record.domain : '';
  const path = typeof record.path === 'string' ? record.path : '/';
  if (!name || !domain) {
    return undefined;
  }
  if (!isRelevantDomain(domain)) {
    return undefined;
  }
  if (value.length > MAX_COOKIE_VALUE_LENGTH) {
    return undefined;
  }
  // Drop obvious analytics / script payload cookies.
  if (/aplus|umdata|mmstat|__tracker|lottie|analytics/i.test(name)) {
    return undefined;
  }
  if (value.includes('function(') || value.includes('!function')) {
    return undefined;
  }

  const expires =
    typeof record.expires === 'number' && Number.isFinite(record.expires)
      ? record.expires
      : -1;
  const sameSiteRaw = String(record.sameSite ?? 'Lax');
  const sameSite =
    sameSiteRaw === 'Strict' || sameSiteRaw === 'Lax' || sameSiteRaw === 'None'
      ? sameSiteRaw
      : 'Lax';

  return {
    name,
    value,
    domain,
    path,
    expires,
    httpOnly: Boolean(record.httpOnly),
    secure: Boolean(record.secure),
    sameSite
  };
}

function isRelevantDomain(domain: string): boolean {
  const host = domain.startsWith('.') ? domain.slice(1) : domain;
  return RELEVANT_DOMAIN.test(host) || RELEVANT_DOMAIN.test(`.${host}`);
}

function normalizeOrigin(origin: unknown): PlaywrightStorageState['origins'][number] | undefined {
  if (!origin || typeof origin !== 'object') {
    return undefined;
  }
  const record = origin as Record<string, unknown>;
  if (typeof record.origin !== 'string' || !record.origin) {
    return undefined;
  }
  if (!/goofish\.com|taobao\.com/i.test(record.origin)) {
    return undefined;
  }
  const localStorageIn = Array.isArray(record.localStorage) ? record.localStorage : [];
  const localStorage = localStorageIn
    .filter((entry): entry is { name: string; value: string } => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }
      const item = entry as Record<string, unknown>;
      return typeof item.name === 'string'
        && typeof item.value === 'string'
        && item.value.length <= MAX_COOKIE_VALUE_LENGTH;
    })
    .map((entry) => ({ name: entry.name, value: entry.value }));

  return {
    origin: record.origin,
    localStorage
  };
}
