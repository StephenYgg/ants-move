import { createHash } from 'node:crypto';

import {
  buildFilteredSearchRequestBody,
  type XianyuSearchFilterOptions
} from './search-filters.js';
import type { PlaywrightStorageState } from './storage-state.js';
import { XianyuCommandError } from './types.js';

export const XIANYU_MTOP_APP_KEY = '34839810';
export const XIANYU_SEARCH_API = 'mtop.taobao.idlemtopsearch.pc.search';
export const XIANYU_SEARCH_API_VERSION = '1.0';
export const XIANYU_SEARCH_ENDPOINT =
  `https://h5api.m.goofish.com/h5/${XIANYU_SEARCH_API}/${XIANYU_SEARCH_API_VERSION}/`;

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface MtopCookieJar {
  /** name -> value (last write wins) */
  values: Map<string, string>;
}

export interface XianyuSearchRequestBody {
  pageNumber: number;
  keyword: string;
  fromFilter: boolean;
  rowsPerPage: number;
  sortValue: string;
  sortField: string;
  customDistance: string;
  gps: string;
  propValueStr: Record<string, unknown>;
  customGps: string;
  searchReqFromPage: string;
  extraFilterValue: string;
  userPositionJson: string;
}

export type { XianyuSearchFilterOptions } from './search-filters.js';

export function buildSearchRequestBody(
  options: XianyuSearchFilterOptions
): XianyuSearchRequestBody {
  return buildFilteredSearchRequestBody(options);
}

/**
 * Serialize body the way lib-mtop expects for sign input:
 * compact JSON, no extra spaces, Unicode characters unescaped.
 */
export function serializeMtopData(data: unknown): string {
  return JSON.stringify(data);
}

/**
 * H5 MTOP sign: md5(`${token}&${t}&${appKey}&${data}`)
 * token is the prefix of cookie `_m_h5_tk` before the first `_`.
 */
export function signMtopRequest(options: {
  token: string;
  t: string;
  appKey?: string;
  data: string;
}): string {
  const appKey = options.appKey ?? XIANYU_MTOP_APP_KEY;
  const raw = `${options.token}&${options.t}&${appKey}&${options.data}`;
  return createHash('md5').update(raw, 'utf8').digest('hex');
}

export function extractMtopToken(cookieJar: MtopCookieJar): string {
  const tk = cookieJar.values.get('_m_h5_tk');
  if (!tk || !tk.includes('_')) {
    throw new XianyuCommandError(
      'XIANYU_AUTH_REQUIRED',
      'Xianyu session is missing _m_h5_tk. Run `ants xianyu auth login` again.',
      2
    );
  }
  const token = tk.split('_')[0] ?? '';
  if (!token) {
    throw new XianyuCommandError(
      'XIANYU_AUTH_REQUIRED',
      'Xianyu _m_h5_tk token is empty. Run `ants xianyu auth login` again.',
      2
    );
  }
  return token;
}

export function cookieJarFromStorageState(state: PlaywrightStorageState): MtopCookieJar {
  const values = new Map<string, string>();
  for (const cookie of state.cookies) {
    values.set(cookie.name, cookie.value);
  }
  return { values };
}

export function cookieHeaderFromJar(jar: MtopCookieJar): string {
  return [...jar.values.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function applySetCookieHeaders(jar: MtopCookieJar, headers: Headers): void {
  // undici/fetch may expose getSetCookie(); fall back to single set-cookie.
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const lines =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : (() => {
          const single = headers.get('set-cookie');
          return single ? [single] : [];
        })();

  for (const line of lines) {
    const pair = line.split(';', 1)[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) {
      jar.values.set(name, value);
    }
  }
}

export async function mtopSearchPage(options: {
  cookieJar: MtopCookieJar;
  keyword: string;
  pageNumber: number;
  rowsPerPage?: number;
  filters?: Omit<XianyuSearchFilterOptions, 'keyword' | 'pageNumber' | 'rowsPerPage'>;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const bodyObject = buildSearchRequestBody({
    keyword: options.keyword,
    pageNumber: options.pageNumber,
    ...(options.rowsPerPage === undefined ? {} : { rowsPerPage: options.rowsPerPage }),
    ...(options.filters ?? {})
  });
  const data = serializeMtopData(bodyObject);
  const t = String(options.nowMs ?? Date.now());

  // Up to 2 attempts: first may rotate _m_h5_tk via Set-Cookie.
  let lastBody: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = extractMtopToken(options.cookieJar);
    const sign = signMtopRequest({ token, t, data });
    const url = new URL(XIANYU_SEARCH_ENDPOINT);
    url.searchParams.set('jsv', '2.7.2');
    url.searchParams.set('appKey', XIANYU_MTOP_APP_KEY);
    url.searchParams.set('t', t);
    url.searchParams.set('sign', sign);
    url.searchParams.set('v', XIANYU_SEARCH_API_VERSION);
    url.searchParams.set('type', 'originaljson');
    url.searchParams.set('accountSite', 'xianyu');
    url.searchParams.set('dataType', 'json');
    url.searchParams.set('timeout', '20000');
    url.searchParams.set('api', XIANYU_SEARCH_API);
    url.searchParams.set('sessionOption', 'AutoLoginOnly');
    url.searchParams.set('spm_cnt', 'a21ybx.search.0.0');

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://www.goofish.com',
        Referer: 'https://www.goofish.com/',
        'User-Agent': DEFAULT_UA,
        Cookie: cookieHeaderFromJar(options.cookieJar)
      },
      body: new URLSearchParams({ data }).toString()
    });

    applySetCookieHeaders(options.cookieJar, response.headers);

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      if (text.includes('登录') || text.includes('mini_login') || text.includes('<!doctype')) {
        throw new XianyuCommandError(
          'XIANYU_RISK_BLOCKED',
          'Xianyu returned a login/challenge page for the pure API search. Run `ants xianyu auth login` again.',
          2
        );
      }
      throw new XianyuCommandError(
        'XIANYU_PARSE_ERROR',
        'Failed to parse Xianyu MTOP search JSON.',
        2,
        { status: response.status, preview: text.slice(0, 200) }
      );
    }

    lastBody = parsed;
    const retJoined = joinRet(parsed);

    if (/FAIL_SYS_TOKEN|TOKEN_EXOIRED|TOKEN_EMPTY|ILLEGAL_SIGN|SESSION_EXPIRED/i.test(retJoined)) {
      // Token rotated or expired; retry once with updated jar.
      if (attempt === 0) {
        continue;
      }
      throw new XianyuCommandError(
        'XIANYU_AUTH_EXPIRED',
        'Xianyu session/token expired for pure API search. Run `ants xianyu auth login` again.',
        2,
        { ret: (parsed as { ret?: unknown }).ret }
      );
    }

    if (/RGV587|挤爆|FAIL_SYS_USER|FAIL_SYS_USERVALIDATE/i.test(retJoined)) {
      throw new XianyuCommandError(
        'XIANYU_RISK_BLOCKED',
        'Xianyu blocked the pure API search (risk control). Re-login with `ants xianyu auth login`, keep frequency low, or use --transport browser.',
        2,
        { ret: (parsed as { ret?: unknown }).ret }
      );
    }

    return parsed;
  }

  return lastBody;
}

function joinRet(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return '';
  }
  const ret = (body as { ret?: unknown }).ret;
  if (!Array.isArray(ret)) {
    return '';
  }
  return ret.map(String).join(' | ');
}
